// We make some assumtion when running these tests:
// - We have a supabase instance running on localhost:5432
// - We have redis running on localhost:6379

import {
  mergeReadableStreams,
} from 'https://deno.land/std@0.201.0/streams/merge_readable_streams.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@^2.2.3'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@^2.2.3'

import * as p from 'npm:@clack/prompts@0.7.0'

import type { Database } from '../supabase/functions/_utils/supabase.types.ts'
import type { SupabaseType } from './utils.ts'
import {
  testUpdateEndpoint,
} from './tests/updates_test.ts'

let supabaseProcess: Deno.ChildProcess | null = null
let joined: ReadableStream<Uint8Array> | null = null
let supabase: SupabaseClient<Database> | null = null
let functionsUrl: URL | null = null

interface BackendTest {
  name: string
  // How much time run the test
  execute: number
  test: (backendBaseUrl: URL, supabase: SupabaseType) => Promise<void>
}

const tests: BackendTest[] = [
  {
    name: 'Test update endpoint',
    test: testUpdateEndpoint,
    execute: 3,
  },
]

async function getAdminSupabaseTokens(): Promise<{ url: string; serviceKey: string }> {
  const command = new Deno.Command('supabase', {
    args: [
      'status',
    ],
  })

  const { code, stdout, stderr } = await command.output()
  if (code !== 0)
    p.log.error('Cannot get supabase tokens')

  const output = new TextDecoder().decode(stdout)
  const separateLines = output.split(/\r?\n|\r|\n/g)
  let adminToken = separateLines.find(line => line.includes('service_role'))
  let url = separateLines.find(line => line.includes('API URL'))

  if (!adminToken || !url) {
    p.log.error('Cannot get supabase tokens')
    console.log('output\n', output)
    Deno.exit(1)
  }

  adminToken = adminToken.replace('service_role key: ', '').trim()
  url = url.replace('API URL: ', '').trim()

  return {
    serviceKey: adminToken,
    url,
  }
}

export async function connectToSupabase() {
  try {
    const { serviceKey, url } = await getAdminSupabaseTokens()
    const options = {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }
    supabase = createClient<Database>(url, serviceKey, options)
  }
  // deno-lint-ignore no-explicit-any
  catch (e: any) {
    console.error('Cannot create supabase client', e.stack)
    Deno.exit(1)
  }
}

async function startSupabaseBackend(redis: boolean) {
  const command = new Deno.Command('supabase', {
    args: [
      'functions',
      'serve',
      '--env-file',
      `supabase/.env.exemple${redis ? '.redis' : ''}`,
    ],
    stdout: 'piped',
    stderr: 'piped',
  })

  supabaseProcess = command.spawn()

  const joinedStream = mergeReadableStreams(
    supabaseProcess.stdout,
    supabaseProcess.stderr,
  )

  const [first, second] = joinedStream.tee()
  joined = first

  const reader = second.getReader()
  while (true) {
    const chunk = await reader.read()
    if (chunk.done)
      break

    const string = new TextDecoder('utf-8').decode(chunk.value)
    if (string.includes('Serving functions on')) {
      p.log.success('Supabase backend started')
      const split = string.split(' ')
      functionsUrl = new URL(split[split.length - 1].trim().replace('<function-name>', ''))
      break
    }
  }
}

function killSupabase() {
  if (!supabaseProcess || !joined) {
    console.error('supabase process not running or joined stream is null')
    return
  }

  p.log.info('Killing supabase with SIGTERM')
  supabaseProcess.kill('SIGTERM')
}

function killSupabaseAndOutput() {
  killSupabase()

  p.log.info('Supabase output:')
  joined?.pipeTo(Deno.stdout.writable)
}

async function testLoop(functionsUrl: URL, supabase: SupabaseType): Promise<boolean> {
  let ok = true
  for (const test of tests) {
    for (let i = 0; i < test.execute; i++) {
      p.log.info(`Running test (${i + 1}/${test.execute}): \"${test.name}\"`)

      try {
        await test.test(functionsUrl, supabase)
      }
      // deno-lint-ignore no-explicit-any
      catch (e: any) {
        ok = false
        p.log.error(`Test ${test.name} failed with error:\n ${e.stack}`)
        await killSupabaseAndOutput()

        // One second before exiting so that the output is printed

        await new Promise((_resolve) => {
          setTimeout(() => {
            Deno.exit(1)
          }, 1000)
        })
      }

      if (ok)
        p.log.success(`Test \"${test.name}\" passed (${i + 1}/${test.execute})`)
    }
  }
  return ok
}

async function runTests() {
  if (!functionsUrl) {
    p.log.error('No functions URL, cannot run tests')
    Deno.exit(1)
  }

  if (!supabase) {
    p.log.error('No supabase connection, cannot run tests')
    Deno.exit(1)
  }

  let ok = await testLoop(functionsUrl, supabase)
  // This is likely unreacheble
  if (!ok)
    Deno.exit(1)

  const useLocalRedis = Deno.env.get('USE_LOCAL_REDIS') === 'true'
  if (useLocalRedis) {
    p.log.info('Running with redis')
    killSupabase()
    p.log.info('Starting supabase backend with local redis...')
    await startSupabaseBackend(true)
    ok = await testLoop(functionsUrl, supabase)
    if (!ok)
      Deno.exit(1)
    await killSupabaseAndOutput()
    await new Promise(resolve =>
      setTimeout(() => {
        Deno.exit(2)
      }, 1500),
    )
  }

  else { p.log.warn('Skipping running with redis') }

  if (ok)
    Deno.exit(0)
}

p.log.info('Connecting to supabase...')
await connectToSupabase()
p.log.info('Starting supabase backend...')
await startSupabaseBackend(false)
p.log.info('Running tests...')
await runTests()
// setTimeout(killSupabaseAndOutput, 10000)
