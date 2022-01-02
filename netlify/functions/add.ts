import type { Handler } from '@netlify/functions'
import { v4 as uuidv4 } from 'uuid'
import { useSupabase } from '../services/supabase'
import type { definitions } from '~/types/supabase'

interface AppUpload {
  appid: string
  name: string
  icon: string
  contentType: string
}
export const handler: Handler = async(event) => {
  console.log(event.httpMethod)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': '*',
        'Access-Control-Allow-Methods': 'POST',
      },
      body: JSON.stringify({
        message: 'Requires Authorization',
      }),
    }
  }

  const { authorization } = event.headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  }

  let isVerified = false
  let apikey: definitions['apikeys'] | null = null
  const supabase = useSupabase()
  try {
    const { data, error } = await supabase
      .from<definitions['apikeys']>('apikeys')
      .select()
      .eq('key', authorization)
    if (!data || !data.length) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: 'Requires Authorization',
        }),
      }
    }
    apikey = data[0]
    isVerified = !!apikey && !error
  }
  catch (error) {
    isVerified = false
    console.error(error)
  }
  if (!isVerified || !apikey || !event.body) {
    return {
      statusCode: 400,
      headers,
      body: JSON.stringify({
        message: 'cannot Verify User',
      }),
    }
  }

  try {
    const body = JSON.parse(event.body || '{}') as AppUpload
    const fileName = `icon_${uuidv4()}`
    const { error } = await supabase.storage
      .from(`images/${apikey.user_id}/${body.appid}`)
      .upload(fileName, Buffer.from(body.icon, 'base64'), {
        contentType: body.contentType,
      })
    const res = await supabase
      .storage
      .from(`images/${apikey.user_id}`)
      .getPublicUrl(fileName)

    const signedURL = res.data?.publicURL
    if (error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: 'cannot Upload File',
        }),
      }
    }
    const { error: dbError } = await supabase
      .from('apps')
      .insert({
        icon_url: signedURL,
        name: body.name,
        app_id: body.appid,
      })
    if (dbError) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          message: 'cannot add app',
          err: JSON.stringify(dbError),
        }),
      }
    }
  }
  catch (e) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        message: `${e}!`,
      }),
    }
  }
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({ status: 'ok' }),
  }
}
