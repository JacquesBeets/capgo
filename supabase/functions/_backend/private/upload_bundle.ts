// import { cors } from 'hono/cors'
import { Hono } from 'hono/tiny'
import type { Context } from '@hono/hono'
import { DEFAULT_RETRY_PARAMS, RetryBucket } from '../tus/retry.ts'
import { MAX_UPLOAD_LENGTH_BYTES, TUS_VERSION, X_SIGNAL_CHECKSUM_SHA256 } from '../tus/uploadHandler.ts'
import { ALLOWED_HEADERS, ALLOWED_METHODS, EXPOSED_HEADERS, toBase64 } from '../tus/util.ts'

const DO_CALL_TIMEOUT = 1000 * 60 * 30 // 20 minutes

export interface EnvUpload {
  SHARED_AUTH_SECRET: string

  ATTACHMENT_BUCKET: R2Bucket

  BACKUP_BUCKET: R2Bucket

  ATTACHMENT_UPLOAD_HANDLER: DurableObjectNamespace

}

const ATTACHMENT_PREFIX = 'attachments'

export const app = new Hono()
// const corsRes = cors({
//   origin: '*',
//   allowHeaders: ['Content-Type', 'Authorization', 'Content-Length', 'X-Signal-Checksum-SHA256', 'tus-resumable', 'tus-version', 'tus-max-size', 'tus-extension', 'tus-checksum-sha256', 'upload-metadata', 'upload-length', 'upload-offset'],
//   allowMethods: ['POST', 'GET', 'OPTIONS', 'PATCH'],
//   exposeHeaders: ['Content-Length', 'X-Kuma-Revision', 'Content-Range'],
//   maxAge: 600,
//   credentials: true,
// })
app.options(`/upload/${ATTACHMENT_PREFIX}`, optionsHandler)
app.post(`/upload/${ATTACHMENT_PREFIX}`, uploadHandler)

app.options(`/upload/${ATTACHMENT_PREFIX}/:id`, optionsHandler)
app.get(`/upload/${ATTACHMENT_PREFIX}/:id`, getHandler)
app.patch(`/upload/${ATTACHMENT_PREFIX}/:id`, uploadHandler)

app.all('*', (c) => {
  console.log('all upload_bundle', c.req.url)
  return c.json({ error: 'Not Found' }, 404)
})

async function getHandler(c: Context): Promise<Response> {
  const requestId = c.req.param('id')
  console.log('getHandler', requestId)
  const bucket: R2Bucket = c.env.ATTACHMENT_BUCKET

  if (bucket == null) {
    console.log('getHandler upload_bundle', 'bucket is null')
    return c.json({ error: 'Not Found' }, 404)
  }

  const cache = caches.default
  const cacheKey = new Request(new URL(c.req.url), c.req)
  let response = await cache.match(cacheKey)
  if (response != null) {
    return response
  }

  const object = await new RetryBucket(bucket, DEFAULT_RETRY_PARAMS).get(requestId, {
    range: c.req.raw.headers,
  })
  if (object == null) {
    console.log('getHandler upload_bundle', 'object is null')
    return c.json({ error: 'Not Found' }, 404)
  }
  const headers = objectHeaders(object)
  if (object.range != null && c.req.header('range')) {
    headers.set('content-range', rangeHeader(object.size, object.range))
    response = new Response(object.body, { headers, status: 206 })
    return response
  }
  else {
    response = new Response(object.body, { headers })
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()))
    return response
  }
}

function objectHeaders(object: R2Object): Headers {
  const headers = new Headers()
  object.writeHttpMetadata(headers)
  headers.set('etag', object.httpEtag)

  // the sha256 checksum was provided to R2 in the upload
  if (object.checksums.sha256 != null) {
    headers.set(X_SIGNAL_CHECKSUM_SHA256, toBase64(object.checksums.sha256))
  }

  // it was a multipart upload, so we were forced to write a sha256 checksum as a custom header
  if (object.customMetadata?.[X_SIGNAL_CHECKSUM_SHA256] != null) {
    headers.set(X_SIGNAL_CHECKSUM_SHA256, object.customMetadata[X_SIGNAL_CHECKSUM_SHA256])
  }
  return headers
}

function rangeHeader(objLen: number, r2Range: R2Range): string {
  let startIndexInclusive = 0
  let endIndexInclusive = objLen - 1
  if ('offset' in r2Range && r2Range.offset != null) {
    startIndexInclusive = r2Range.offset
  }
  if ('length' in r2Range && r2Range.length != null) {
    endIndexInclusive = startIndexInclusive + r2Range.length - 1
  }
  if ('suffix' in r2Range) {
    startIndexInclusive = objLen - r2Range.suffix
  }
  return `bytes ${startIndexInclusive}-${endIndexInclusive}/${objLen}`
}

// function corsHandler(c: Context): Response {
//   //  allow cors TODO: remove this in production
//   c.header('Access-Control-Allow-Origin', '*')
//   // allow headersfor tus protocol
//   c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Signal-Checksum-SHA256, tus-resumable, tus-version, tus-max-size, tus-extension, tus-checksum-sha256, upload-metadata, upload-length, upload-offset')
//   return c.text('', 204)
// }

function optionsHandler(c: Context): Response {
  console.log('optionsHandler upload_bundle', 'optionsHandler')
  return c.newResponse(null, 204, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': ALLOWED_METHODS,
    'Access-Control-Allow-Headers': ALLOWED_HEADERS,
    'Access-Control-Expose-Headers': EXPOSED_HEADERS,
    'Tus-Resumable': TUS_VERSION,
    'Tus-Version': TUS_VERSION,
    'Tus-Max-Size': MAX_UPLOAD_LENGTH_BYTES.toString(),
    'Tus-Extension': 'creation,creation-defer-length,creation-with-upload,expiration',
  })
}

// TUS protocol requests (POST/PATCH/HEAD) that get forwarded to a durable object
async function uploadHandler(c: Context): Promise<Response> {
  const requestId: string = c.req.param('id')
  console.log('upload_bundle req', 'uploadHandler', requestId)
  const durableObjNs: DurableObjectNamespace = c.env.ATTACHMENT_UPLOAD_HANDLER
  // c.header('Access-Control-Allow-Origin', '*')
  // allow headersfor tus protocol
  // c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Signal-Checksum-SHA256, tus-resumable, tus-version, tus-max-size, tus-extension, tus-checksum-sha256, upload-metadata, upload-length, upload-offset')

  if (durableObjNs == null) {
    console.log('upload_bundle', 'durableObjNs is null')
    return c.json({ error: 'Invalid bucket configuration' }, 500)
  }

  const handler = durableObjNs.get(durableObjNs.idFromName(requestId))
  console.log('can handler')
  return await handler.fetch(c.req.url, {
    body: c.req.raw.body,
    method: c.req.method,
    headers: c.req.raw.headers,
    signal: AbortSignal.timeout(DO_CALL_TIMEOUT),
  }).then((res) => {
    console.log('upload_bundle res', 'uploadHandler', res)
    // res.headers.set('Access-Control-Allow-Origin', '*')
    // res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Signal-Checksum-SHA256, tus-resumable, tus-version, tus-max-size, tus-extension, tus-checksum-sha256, upload-metadata, upload-length, upload-offset')
    return res
  })
}
