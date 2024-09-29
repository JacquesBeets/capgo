// Copyright 2023 Signal Messenger, LLC
// SPDX-License-Identifier: AGPL-3.0-only

import { Buffer } from 'node:buffer'
import { HTTPException } from 'hono/http-exception'

export const REQUEST_METHODS = ['POST', 'HEAD', 'PATCH', 'OPTIONS', 'DELETE'] as const

export const HEADERS = [
  'Authorization',
  'Content-Type',
  'Location',
  'Tus-Extension',
  'Tus-Max-Size',
  'Tus-Resumable',
  'Tus-Version',
  'Upload-Concat',
  'Upload-Defer-Length',
  'Upload-Length',
  'Upload-Metadata',
  'Upload-Offset',
  'X-HTTP-Method-Override',
  'X-Requested-With',
  'X-Forwarded-Host',
  'X-Forwarded-Proto',
  'Forwarded',
] as const

export const HEADERS_LOWERCASE = HEADERS.map((header) => {
  return header.toLowerCase()
}) as Array<Lowercase<(typeof HEADERS)[number]>>

export const ALLOWED_HEADERS = HEADERS.join(', ')
export const ALLOWED_METHODS = REQUEST_METHODS.join(', ')
export const EXPOSED_HEADERS = HEADERS.join(', ')
export function readIntFromHeader(headers: Headers, name: string): number {
  const headerString = headers.get(name)
  if (headerString == null) {
    return Number.NaN
  }
  return Number.parseInt(headerString)
}

export function toBase64(v: Uint8Array | ArrayBuffer): string {
  if (v instanceof Uint8Array) {
    return Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64')
  }
  else {
    return Buffer.from(v).toString('base64')
  }
}

// Parse binary data from a base64 string
export function fromBase64(s: string): Uint8Array | undefined {
  try {
    return Buffer.from(s, 'base64')
  }
  catch (err) {
    return undefined
  }
}

export class WritableStreamBuffer {
  buf: ArrayBuffer
  offset: number

  constructor(buf: ArrayBuffer) {
    this.buf = buf
    this.offset = 0
  }

  write(chunk: Uint8Array) {
    const remaining = this.buf.byteLength - this.offset
    if (chunk.byteLength > remaining) {
      throw new RangeError('chunk does not fit')
    }
    this.writeUpTo(chunk)
  }

  writeUpTo(chunk: Uint8Array): number {
    const remaining = this.buf.byteLength - this.offset
    const toWrite = Math.min(remaining, chunk.byteLength)
    new Uint8Array(this.buf, this.offset).set(chunk.subarray(0, toWrite))
    this.offset += toWrite
    return toWrite
  }

  view(): Uint8Array {
    return new Uint8Array(this.buf, 0, this.offset)
  }

  reset() {
    this.offset = 0
  }
}

export interface IntermediatePart {
  kind: 'intermediate'
  bytes: Uint8Array
}

export interface FinalPart {
  kind: 'final'
  bytes: Uint8Array
}

export interface ErrorPart {
  kind: 'error'
  error: HTTPException
  bytes: Uint8Array
}

export type Part = IntermediatePart | FinalPart | ErrorPart

// Take an arbitrary length stream and fill an in-memory buffer, emitting a view of the buffer every time the buffer
// is filled. After emitting an item the buffer is reused, so the caller must finish using the buffer before it
// continues iterating.
//
// If an error is encountered reading the stream, the final part generated by the stream will be an error part
// containing whatever was read before the error was encountered.
export async function* generateParts(body: ReadableStream<Uint8Array>, mem: WritableStreamBuffer): AsyncGenerator<Part> {
  try {
    for await (let chunk of body) {
      while (chunk.byteLength > 0) {
        const copied = mem.writeUpTo(chunk)
        chunk = chunk.subarray(copied, chunk.byteLength)

        // When we've filled mem, we want to emit a part. But we should only do it if we know
        // there's more body to write. Otherwise, if the upload size is exactly the part size
        // we would end up emitting an empty 'final' part which is unnecessary.
        if (chunk.byteLength > 0 && mem.offset >= mem.buf.byteLength) {
          // the memory buffer's position is at its total length
          yield { kind: 'intermediate', bytes: mem.view() }
          mem.reset()
        }
      }
    }
    yield { kind: 'final', bytes: mem.view() }
  }
  catch (e) {
    const msg = `error reading request body: ${e}`
    console.debug(msg)
    yield { kind: 'error', bytes: mem.view(), error: new HTTPException(400, { message: msg }) }
  }
  mem.reset()
}

export type Release = () => void

export class AsyncLock {
  p: Promise<void> | null

  constructor() {
    this.p = null
  }

  // Asynchronously wait for our turn to execute. Returns Release which should be called
  // when the critical section has completed
  async lock(): Promise<Release> {
    // If there is no active promise we can acquire the lock. We loop since
    // someone else may grab the lock before us, in that case we go back
    // to waiting
    while (this.p != null) {
      await this.p
    }
    let resolver: (value: (void | PromiseLike<void>)) => void
    this.p = new Promise((resolve) => {
      resolver = resolve
    })
    return () => {
      this.p = null
      resolver()
    }
  }
}
