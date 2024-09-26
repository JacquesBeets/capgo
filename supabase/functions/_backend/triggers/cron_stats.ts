import { Hono } from 'hono/tiny'
import type { Context } from '@hono/hono'
import { middlewareAPISecret, useCors } from '../utils/hono.ts'
import { readStatsBandwidth, readStatsMau, readStatsStorage, readStatsVersion } from '../utils/stats.ts'
import { supabaseAdmin } from '../utils/supabase.ts'

interface dataToGet {
  appId?: string
  orgId?: string
  todayOnly?: boolean
}

export const app = new Hono()

app.use('/', useCors)

app.post('/', middlewareAPISecret, async (c: Context) => {
  try {
    const body = await c.req.json<dataToGet>()
    console.log(c.get('requestId'), 'postcron stats body', body)
    if (!body.appId || !body.orgId)
      return c.json({ status: 'No appId' }, 400)

    const supabase = supabaseAdmin(c)

    // get the period of the billing of the organization
    const cycleInfoData = await supabase.rpc('get_cycle_info_org', { orgid: body.orgId }).single()
    const cycleInfo = cycleInfoData.data
    if (!cycleInfo || !cycleInfo.subscription_anchor_start || !cycleInfo.subscription_anchor_end)
      return c.json({ status: 'Cannot get cycle info' }, 400)

    console.log(c.get('requestId'), 'cycleInfo', cycleInfo)
    const startDate = cycleInfo.subscription_anchor_start
    const endDate = cycleInfo.subscription_anchor_end

    // get mau
    let mau = await readStatsMau(c, body.appId, startDate, endDate)
    // get bandwidth
    let bandwidth = await readStatsBandwidth(c, body.appId, startDate, endDate)
    // get storage
    let storage = await readStatsStorage(c, body.appId, startDate, endDate)
    let versionUsage = await readStatsVersion(c, body.appId, startDate, endDate)

    if (body.todayOnly) {
      // take only the last day
      mau = mau.slice(-1)
      bandwidth = bandwidth.slice(-1)
      storage = storage.slice(-1)
      versionUsage = versionUsage.slice(-1)
    }

    console.log(c.get('requestId'), 'mau', mau.length, mau.reduce((acc, curr) => acc + curr.mau, 0), JSON.stringify(mau))
    console.log(c.get('requestId'), 'bandwidth', bandwidth.length, bandwidth.reduce((acc, curr) => acc + curr.bandwidth, 0), JSON.stringify(bandwidth))
    console.log(c.get('requestId'), 'storage', storage.length, storage.reduce((acc, curr) => acc + curr.storage, 0), JSON.stringify(storage))
    console.log(c.get('requestId'), 'versionUsage', versionUsage.length, versionUsage.reduce((acc, curr) => acc + curr.get + curr.fail + curr.install + curr.uninstall, 0))

    // save to daily_mau, daily_bandwidth and daily_storage
    await Promise.all([
      supabase.from('daily_mau')
        .upsert(mau, { onConflict: 'app_id,date' })
        .eq('app_id', body.appId)
        .throwOnError(),
      supabase.from('daily_bandwidth')
        .upsert(bandwidth, { onConflict: 'app_id,date' })
        .eq('app_id', body.appId)
        .throwOnError(),
      supabase.from('daily_storage')
        .upsert(storage, { onConflict: 'app_id,date' })
        .eq('app_id', body.appId)
        .throwOnError(),
      supabase.from('daily_version')
        .upsert(versionUsage, { onConflict: 'app_id,date,version_id' })
        .eq('app_id', body.appId)
        .throwOnError(),
    ])

    console.log(c.get('requestId'), 'stats saved')
    return c.json({ status: 'Stats saved', mau, bandwidth, storage, versionUsage })
  }
  catch (e) {
    console.error(c.get('requestId'), 'Error getting stats', e)
    return c.json({ status: 'Cannot get stats', error: JSON.stringify(e) }, 500)
  }
})
