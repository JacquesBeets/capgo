import type { Context } from 'hono'
import ky from 'ky'
import dayjs from 'dayjs'
import { getEnv } from './utils.ts'
import type { Database } from './supabase.types.ts'

// type is require for the bindings no interface
// eslint-disable-next-line ts/consistent-type-definitions
export type Bindings = {
  DEVICE_USAGE: AnalyticsEngineDataPoint
  BANDWIDTH_USAGE: AnalyticsEngineDataPoint
  VERSION_USAGE: AnalyticsEngineDataPoint
  APP_LOG: AnalyticsEngineDataPoint
  DB_DEVICES: D1Database
  HYPERDRIVE: Hyperdrive
}

const DEFAULT_LIMIT = 1000
export function trackDeviceUsageCF(c: Context, device_id: string, app_id: string) {
  if (!c.env.DEVICE_USAGE)
    return Promise.resolve()
  c.env.DEVICE_USAGE.writeDataPoint({
    blobs: [device_id],
    indexes: [app_id],
  })
  return Promise.resolve()
}

export function trackBandwidthUsageCF(c: Context, device_id: string, app_id: string, file_size: number) {
  if (!c.env.BANDWIDTH_USAGE)
    return Promise.resolve()
  c.env.BANDWIDTH_USAGE.writeDataPoint({
    blobs: [device_id],
    doubles: [file_size],
    indexes: [app_id],
  })
  return Promise.resolve()
}

export function trackVersionUsageCF(c: Context, version_id: number, app_id: string, action: string) {
  if (!c.env.VERSION_USAGE)
    return Promise.resolve()
  c.env.VERSION_USAGE.writeDataPoint({
    blobs: [app_id, version_id, action],
    indexes: [app_id],
  })
  return Promise.resolve()
}

export function trackLogsCF(c: Context, app_id: string, device_id: string, action: string, version_id: number) {
  if (!c.env.APP_LOG)
    return Promise.resolve()
  c.env.APP_LOG.writeDataPoint({
    blobs: [device_id, action],
    doubles: [version_id],
    indexes: [app_id],
  })
  return Promise.resolve()
}

export async function trackDevicesCF(c: Context, app_id: string, device_id: string, version_id: number, platform: Database['public']['Enums']['platform_os'], plugin_version: string, os_version: string, version_build: string, custom_id: string, is_prod: boolean, is_emulator: boolean) {
  // TODO: fix this
  console.log('trackDevicesCF', app_id, device_id, version_id, platform, plugin_version, os_version, version_build, custom_id, is_prod, is_emulator)
  if (!c.env.DB_DEVICES)
    return Promise.resolve()
  try {
    const updated_at = new Date().toISOString()
    const query = `INSERT INTO devices ( updated_at, device_id, version, app_id, platform, plugin_version, os_version, version_build, custom_id, is_prod, is_emulator ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT ( device_id, app_id ) DO UPDATE SET updated_at = excluded.updated_at, version = excluded.version, platform = excluded.platform, plugin_version = excluded.plugin_version, os_version = excluded.os_version, version_build = excluded.version_build, custom_id = excluded.custom_id, is_prod = excluded.is_prod, is_emulator = excluded.is_emulator`
    console.log('trackDevicesCF query', query)
    console.log(`trackDevicesCF updated_at: ${updated_at} device_id: ${device_id}, app_id: ${app_id}, version_id: ${version_id}, platform: ${platform}, plugin_version: ${plugin_version}, os_version: ${os_version}, version_build: ${version_build}, custom_id: ${custom_id}, is_prod: ${is_prod}, is_emulator: ${is_emulator}`)
    const insertD1 = c.env.DB_DEVICES
      .prepare(query)
      .bind(updated_at, device_id, version_id, app_id, platform, plugin_version, os_version, version_build, custom_id, is_prod, is_emulator)
      .run()
    const res = await insertD1
    console.log('trackDevicesCF res', res)
    // backgroundTask(c, insertD1)
  }
  catch (e) {
    console.error('Error inserting device', e)
  }

  return Promise.resolve()
}

export function formatDateCF(date: string | undefined) {
  return dayjs(date).format('YYYY-MM-DD HH:mm:ss')
}

async function runQueryToCF<T>(c: Context, query: string) {
  const CF_ANALYTICS_TOKEN = getEnv(c, 'CF_ANALYTICS_TOKEN')
  const CF_ACCOUNT_ID = getEnv(c, 'CF_ACCOUNT_ANALYTICS_ID')

  const response = await ky.post(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/analytics_engine/sql`, {
    headers: {
      'Authorization': `Bearer ${CF_ANALYTICS_TOKEN}`,
      'Content-Type': 'text/plain; charset=utf-8',
      'Accept-Encoding': 'gzip, zlib, deflate, zstd, br',
    },
    body: query,
  })

  const res = await response.json<{
    data: T
    meta: { name: string, type: string }[]
    rows: number
    rows_before_limit_at_least: number
  }>()
  return res.data
}

interface DeviceUsageCF {
  date: string
  mau: number
  app_id: string
}

export async function readDeviceUsageCF(c: Context, app_id: string, period_start: string, period_end: string) {
  if (!c.env.DEVICE_USAGE)
    return [] as DeviceUsageCF[]
  const query = `SELECT
  toStartOfInterval(timestamp, INTERVAL '1' DAY) AS date,
  count(DISTINCT blob1) AS mau,
  index1 AS app_id
FROM device_usage
WHERE
  app_id = '${app_id}'
  AND timestamp >= toDateTime('${formatDateCF(period_start)}')
  AND timestamp < toDateTime('${formatDateCF(period_end)}')
GROUP BY app_id, date
ORDER BY date, app_id`

  console.log('readDeviceUsageCF query', query)
  try {
    return await runQueryToCF<DeviceUsageCF[]>(c, query)
  }
  catch (e) {
    console.error('Error reading device usage', e)
  }
  return [] as DeviceUsageCF[]
}

interface BandwidthUsageCF {
  date: string
  bandwidth: number
  app_id: string
}

export async function readBandwidthUsageCF(c: Context, app_id: string, period_start: string, period_end: string) {
  if (!c.env.BANDWIDTH_USAGE)
    return [] as BandwidthUsageCF[]
  const query = `SELECT
  toStartOfInterval(timestamp, INTERVAL '1' DAY) AS date,
  sum(double1) AS bandwidth,
  blob2 AS app_id
FROM bandwidth_usage
WHERE
  timestamp >= toDateTime('${formatDateCF(period_start)}')
  AND timestamp < toDateTime('${formatDateCF(period_end)}')
  AND app_id = '${app_id}'
GROUP BY date, app_id
ORDER BY date, app_id`

  console.log('readBandwidthUsageCF query', query)
  try {
    return await runQueryToCF<BandwidthUsageCF[]>(c, query)
  }
  catch (e) {
    console.error('Error reading bandwidth usage', e)
  }
  return [] as BandwidthUsageCF[]
}

interface StoreApp {
  created_at: string // Assuming ISO string format for datetime
  app_id: string
  url: string
  title: string
  summary: string
  icon: string
  free: boolean
  category: string
  capacitor: boolean
  developer_email: string
  installs: number
  developer: string
  score: number
  to_get_framework: boolean
  onprem: boolean
  updates: number
  to_get_info: boolean
  to_get_similar: boolean
  updated_at: string // Assuming ISO string format for datetime
  cordova: boolean
  react_native: boolean
  capgo: boolean
  kotlin: boolean
  flutter: boolean
  native_script: boolean
  lang?: string // Optional as it's not NOT NULL
  developer_id?: string // Optional as it's not NOT NULL
}

interface VersionUsageCF {
  date: string
  app_id: string
  version_id: number
  get: number
  fail: number
  install: number
  uninstall: number
}

export async function readStatsVersionCF(c: Context, app_id: string, period_start: string, period_end: string) {
  if (!c.env.VERSION_USAGE)
    return [] as VersionUsageCF[]
  const query = `SELECT
  blob1 as app_id,
  blob2 as version_id,
  toStartOfInterval(timestamp, INTERVAL '1' DAY) AS date,
  sum(if(blob3 = 'get', 1, 0)) AS get,
  sum(if(blob3 = 'fail', 1, 0)) AS fail,
  sum(if(blob3 = 'install', 1, 0)) AS install,
  sum(if(blob3 = 'uninstall', 1, 0)) AS uninstall
FROM version_usage
WHERE
  app_id = '${app_id}'
  AND timestamp >= toDateTime('${formatDateCF(period_start)}')
  AND timestamp < toDateTime('${formatDateCF(period_end)}')
GROUP BY date, app_id, version_id
ORDER BY date`

  console.log('readStatsVersionCF query', query)
  try {
    return await runQueryToCF<VersionUsageCF[]>(c, query)
  }
  catch (e) {
    console.error('Error reading version usage', e)
  }
  return [] as VersionUsageCF[]
}

interface DeviceRowCF {
  app_id: string
  device_id: string
  version_id: number
  platform: string
  plugin_version: string
  os_version: string
  version_build: string
  custom_id: string
  is_prod: string
  is_emulator: string
  updated_at: string
}

export async function countDevicesCF(c: Context, app_id: string) {
  if (!c.env.DB_DEVICES)
    return 0

  const query = `SELECT count(*) AS total FROM devices WHERE app_id = ?1`

  console.log('countDevicesCF query', query)
  try {
    const readD1 = c.env.DB_DEVICES
      .prepare(query)
      .bind(app_id)
      .first('total')
    const res = await readD1
    return res
  }
  catch (e) {
    console.error('Error reading device list', e)
  }
  return [] as DeviceRowCF[]
}

export async function readDevicesCF(c: Context, app_id: string, range_start: number, range_end: number, version_id?: string, deviceIds?: string[], search?: string) {
  if (!c.env.DB_DEVICES)
    return [] as DeviceRowCF[]

  let deviceFilter = ''
  let rangeStart = range_start
  let rangeEnd = range_end
  if (deviceIds && deviceIds.length) {
    console.log('deviceIds', deviceIds)
    if (deviceIds.length === 1) {
      deviceFilter = `AND device_id = '${deviceIds[0]}'`
      rangeStart = 0
      rangeEnd = 1
    }
    else {
      const devicesList = deviceIds.join(',')
      deviceFilter = `AND device_id IN (${devicesList})`
      rangeStart = 0
      rangeEnd = deviceIds.length
    }
  }
  let searchFilter = ''
  if (search) {
    console.log('search', search)
    if (deviceIds && deviceIds.length)
      searchFilter = `AND custom_id LIKE '%${search}%')`
    else
      searchFilter = `AND (device_id LIKE '%${search}%' OR custom_id LIKE '%${search}%')`
  }
  let versionFilter = ''
  if (version_id)
    versionFilter = `AND version_id = ${version_id}`

  const query = `SELECT
  app_id,
  device_id,
  version,
  platform,
  plugin_version,
  os_version,
  version_build,
  is_prod,
  is_emulator,
  custom_id,
  updated_at
FROM devices
WHERE
  app_id = '${app_id}' ${deviceFilter} ${searchFilter} ${versionFilter}
ORDER BY updated_at DESC
LIMIT ${rangeEnd} OFFSET ${rangeStart}`

  console.log('readDevicesCF query', query)
  try {
    console.log('readDevicesCF exec')
    const readD1 = c.env.DB_DEVICES
      .prepare(query)
      .all()
    console.log('readDevicesCF exec await')
    const res = await readD1
    console.log('readDevicesCF res', res)
    return res.results
  }
  catch (e) {
    console.error('Error reading device list', e)
  }
  return [] as DeviceRowCF[]
}

interface StatRowCF {
  app_id: string
  device_id: string
  action: string
  version_id: number
  created_at: string
}

export async function readStatsCF(c: Context, app_id: string, period_start: string, period_end: string, deviceIds?: string[], search?: string, limit = DEFAULT_LIMIT) {
  if (!c.env.APP_LOG)
    return [] as StatRowCF[]

  let deviceFilter = ''

  if (deviceIds && deviceIds.length) {
    console.log('deviceIds', deviceIds)
    if (deviceIds.length === 1) {
      deviceFilter = `AND device_id = '${deviceIds[0]}'`
    }
    else {
      const devicesList = deviceIds.join(',')
      deviceFilter = `AND device_id IN (${devicesList})`
    }
  }
  let searchFilter = ''
  if (search) {
    const searchLower = search.toLowerCase()
    if (deviceIds && deviceIds.length)
      searchFilter = `AND position('${searchLower}' IN toLower(action)) > 0`
    else
      searchFilter = `AND (position('${searchLower}' IN toLower(device_id)) > 0 OR position('${searchLower}' IN toLower(action)) > 0)`
  }
  const query = `SELECT
  index1 as app_id,
  blob1 as device_id,
  blob2 as action,
  double1 as version_id,
  timestamp as created_at
FROM app_log
WHERE
  app_id = '${app_id}' ${deviceFilter} ${searchFilter}
  AND created_at >= toDateTime('${formatDateCF(period_start)}')
  AND created_at < toDateTime('${formatDateCF(period_end)}')
GROUP BY app_id, created_at, action, device_id, version_id
ORDER BY created_at, app_id
LIMIT ${limit}`

  console.log('readStatsCF query', query)
  try {
    return await runQueryToCF<StatRowCF[]>(c, query)
  }
  catch (e) {
    console.error('Error reading stats list', e, JSON.stringify(e))
  }
  return [] as StatRowCF[]
}

export async function getAppsFromCF(c: Context): Promise<{ app_id: string }[]> {
  if (!c.env.DB_DEVICES)
    return Promise.resolve([])

  const query = `SELECT app_id FROM store_apps WHERE (onprem = 1 OR capgo = 1) AND url != ''`
  console.log('getAppsFromCF query', query)
  // use c.env.DB_DEVICES and table store_apps
  try {
    const readD1 = c.env.DB_DEVICES
      .prepare(query)
      .all()
    const res = await readD1
    return res
  }
  catch (e) {
    console.error('Error reading app list', e)
  }
  return []
}

export async function countUpdatesFromStoreAppsCF(c: Context): Promise<number> {
  if (!c.env.DB_DEVICES)
    return Promise.resolve(0)
  // use countUpdatesFromStoreAppsClickHouse as exemple to make it work with Cloudflare
  const query = `SELECT SUM(updates) + SUM(installs) AS count FROM store_apps WHERE onprem = 1 OR capgo = 1`

  console.log('countUpdatesFromStoreAppsCF query', query)
  try {
    const readD1 = c.env.DB_DEVICES
      .prepare(query)
      .first('count')
    const res = await readD1
    return res
  }
  catch (e) {
    console.error('Error counting updates from store apps', e)
  }
  return 0
}

export async function countUpdatesFromLogsCF(c: Context): Promise<number> {
  // TODO: This will be a problem in 3 months where the old logs will be deleted automatically by Cloudflare starting 22/08/2024
  const query = `SELECT SUM(_sample_interval) AS count FROM app_log WHERE action = 'get'`

  console.log('countUpdatesFromLogsCF query', query)
  try {
    const readAnalytics = await runQueryToCF<{ count: number }[]>(c, query)
    return readAnalytics[0].count
  }
  catch (e) {
    console.error('Error counting updates from logs', e)
  }
  return 0
}

export async function reactActiveAppsCF(c: Context) {
  const query = `SELECT DISTINCT app_id FROM app_log WHERE created_at >= DATE('now', '-1 month') AND created_at < DATE('now') AND action = 'get'`
  console.log('reactActiveAppsCF query', query)
  try {
    const response = await runQueryToCF<{ app_id: string }[]>(c, query)
    return response
  }
  catch (e) {
    console.error('Error counting active apps', e)
  }
  return []
}

export async function getAppsToProcessCF(c: Context, flag: 'to_get_framework' | 'to_get_info' | 'to_get_similar', limit: number) {
  if (!c.env.DB_DEVICES)
    return Promise.resolve([] as StoreApp[])
  const query = `SELECT * FROM store_apps WHERE ${flag} = 1 ORDER BY created_at ASC LIMIT ${limit}`

  console.log('getAppsToProcessCF query', query)
  try {
    const readD1 = c.env.DB_DEVICES
      .prepare(query)
      .all()
    const res = await readD1
    return res as StoreApp[]
  }
  catch (e) {
    console.error('Error getting apps to process', e)
  }
  return [] as StoreApp[]
}

interface topApp {
  url: string
  title: string
  icon: string
  summary: string
  installs: number
  category: string
}
export async function getTopAppsCF(c: Context, mode: string, limit: number): Promise<topApp[]> {
  if (!c.env.DB_DEVICES)
    return Promise.resolve([] as StoreApp[])
  let modeQuery = ''
  if (mode === 'cordova')
    modeQuery = 'cordova = 1 AND capacitor = 0'

  else if (mode === 'flutter')
    modeQuery = 'flutter = 1'

  else if (mode === 'reactNative')
    modeQuery = 'react_native = 1'

  else if (mode === 'nativeScript')
    modeQuery = 'native_script = 1'

  else if (mode === 'capgo')
    modeQuery = 'capgo = 1'
  else
    modeQuery = 'capacitor = 1'

  const query = `SELECT url, title, icon, summary, installs, category FROM store_apps WHERE ${modeQuery} ORDER BY installs DESC LIMIT ${limit}`

  console.log('getTopAppsCF query', query)
  try {
    const readD1 = c.env.DB_DEVICES
      .prepare(query)
      .all()
    const res = await readD1
    return res as StoreApp[]
  }
  catch (e) {
    console.error('Error getting top apps', e)
  }
  return [] as StoreApp[]
}

export async function getTotalAppsByModeCF(c: Context, mode: string) {
  if (!c.env.DB_DEVICES)
    return Promise.resolve(0)
  let modeQuery = ''
  if (mode === 'cordova')
    modeQuery = 'cordova = 1 AND capacitor = 0'

  else if (mode === 'flutter')
    modeQuery = 'flutter = 1'

  else if (mode === 'reactNative')
    modeQuery = 'react_native = 1'

  else if (mode === 'nativeScript')
    modeQuery = 'native_script = 1'

  else if (mode === 'capgo')
    modeQuery = 'capgo = 1'
  else
    modeQuery = 'capacitor = 1'

  const query = `SELECT COUNT(*) AS total FROM store_apps WHERE ${modeQuery}`

  console.log('getTotalAppsByModeCF query', query)
  try {
    const readD1 = c.env.DB_DEVICES
      .prepare(query)
      .first('total')
    const res = await readD1
    return res
  }
  catch (e) {
    console.error('Error getting total apps by mode', e)
  }
  return 0
}

export async function getStoreAppByIdCF(c: Context, appId: string): Promise<StoreApp> {
  if (!c.env.DB_DEVICES)
    return Promise.resolve({} as StoreApp)
  const query = `SELECT * FROM store_apps WHERE app_id = '${appId}' LIMIT 1`

  console.log('getStoreAppByIdCF query', query)
  try {
    const readD1 = c.env.DB_DEVICES
      .prepare(query)
      .first()
    const res = await readD1
    return res
  }
  catch (e) {
    console.error('Error getting store app by id', e)
  }
  return {} as StoreApp
}

export async function saveStoreInfoCF(c: Context, app: Partial<StoreApp>) {
  if (!c.env.DB_DEVICES)
    return Promise.resolve()

  const columns = Object.keys(app).filter(column => column !== 'app_id') as (keyof StoreApp)[]

  const placeholders = columns.map(() => '?').join(', ')
  const updates = columns.map(column => `${column} = EXCLUDED.${column}`).join(', ')
  const values = columns.map(column => app[column])

  const query = `INSERT INTO store_apps (app_id, ${columns.join(', ')}) VALUES (?, ${placeholders}) ON CONFLICT(app_id) DO UPDATE SET ${updates}`

  try {
    const res = await c.env.DB_DEVICES
      .prepare(query)
      .bind(app.app_id, ...values)
      .run()
    console.log('saveStoreInfoCF result', res)
  }
  catch (e) {
    console.error('Error saving store info', e)
  }

  return Promise.resolve()
}

export async function bulkUpdateStoreAppsCF(c: Context, apps: StoreApp[]) {
  if (!c.env.DB_DEVICES)
    return Promise.resolve()

  if (!apps.length)
    return Promise.resolve()

  // loop on all apps to insert with saveStoreInfoCF
  const jobs = []
  for (const app of apps)
    jobs.push(saveStoreInfoCF(c, app))

  return Promise.all(jobs)
}

export async function updateStoreApp(c: Context, appId: string, updates: number) {
  if (!c.env.DB_DEVICES)
    return Promise.resolve()

  const query = `INSERT INTO store_apps (app_id, updates) VALUES (?, ?) ON CONFLICT(app_id) DO UPDATE SET updates = updates + ?`

  try {
    const res = await c.env.DB_DEVICES
      .prepare(query)
      .bind(appId, updates)
      .run()
    console.log('updateStoreApp result', res)
  }
  catch (e) {
    console.error('Error updating StoreApp', e)
  }

  return Promise.resolve()
}
