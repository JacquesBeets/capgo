import { serve } from 'https://deno.land/std@0.167.0/http/server.ts'
import { supabaseAdmin, updateOrAppStats } from '../_utils/supabase.ts'
import { sendRes } from '../_utils/utils.ts'
import type { Database } from '../_utils/supabase.types.ts'

const allDayOfMonth = () => {
  const lastDay = new Date(new Date().getFullYear(), 10, 0).getDate()
  const days = []
  for (let d = 1; d <= lastDay; d++)
    days.push(d)

  return days
}
const getApp = (userId: string, appId: string) => {
  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  const month_id = new Date().toISOString().slice(0, 7)
  // console.log('req', req)
  return {
    mlu: supabaseAdmin()
      .from('stats')
      .select('*', { count: 'exact', head: true })
      .eq('app_id', appId)
      .lte('created_at', lastDay.toISOString())
      .gte('created_at', firstDay.toISOString())
      .eq('action', 'get'),
    mlu_real: supabaseAdmin()
      .from('stats')
      .select('*', { count: 'exact', head: true })
      .eq('app_id', appId)
      .lte('created_at', lastDay.toISOString())
      .gte('created_at', firstDay.toISOString())
      .eq('action', 'set'),
    devices: supabaseAdmin()
      .from('devices')
      .select('*', { count: 'exact', head: true })
      .eq('app_id', appId)
      .eq('is_emulator', false)
      .eq('is_prod', true)
      .eq('date_id', month_id)
      .lte('updated_at', lastDay.toISOString())
      .gte('updated_at', firstDay.toISOString()),
    devicesTT: supabaseAdmin()
      .from('devices')
      .select('*', { count: 'exact', head: true })
      .eq('app_id', appId)
      .eq('date_id', month_id)
      .lte('updated_at', lastDay.toISOString())
      .gte('updated_at', firstDay.toISOString()),
    bandwidth: supabaseAdmin()
      .from('app_stats')
      .select()
      .eq('app_id', appId)
      .in('date_id', allDayOfMonth()),
    versions: supabaseAdmin()
      .from('app_versions_meta')
      .select()
      .eq('app_id', appId)
      .eq('user_id', userId),
    shared: supabaseAdmin()
      .from('channel_users')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', appId),
    channels: supabaseAdmin()
      .from('channels')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', appId),
  }
}
serve(async (event: Request) => {
  const API_SECRET = Deno.env.get('API_SECRET')
  const authorizationSecret = event.headers.get('apisecret')
  if (!authorizationSecret)
    return sendRes({ status: 'Cannot find authorization secret' }, 400)

  if (!authorizationSecret || !API_SECRET || authorizationSecret !== API_SECRET)
    return sendRes({ message: 'Fail Authorization', authorizationSecret, API_SECRET }, 400)

  try {
    const { data: apps } = await supabaseAdmin()
      .from('apps')
      .select()
    if (!apps || !apps.length)
      return sendRes({ status: 'error', message: 'no apps' })
    // explore all apps
    const all = []
    for (const app of apps) {
      if (!app.id)
        continue
      const res = getApp(app.user_id, app.app_id)
      all.push(Promise.all([app, res.mlu, res.mlu_real, res.versions, res.shared, res.channels, res.devices, res.devicesTT, res.bandwidth])
        .then(([app, mlu, mlu_real, versions, shared, channels, devices, devicesTT, bandwidth]) => {
          if (!app.app_id)
            return
          // console.log('app', app.app_id, devices, versions, shared, channels)
          const month_id = new Date().toISOString().slice(0, 7)
          // check if today is first day of the month
          const versionSize = versions.data?.reduce((acc, cur) => acc + (cur.size || 0), 0) || 0
          const bandwidthTotal = bandwidth.data?.reduce((acc, cur) => acc + (cur.bandwidth || 0), 0) || 0
          if (new Date().getDate() === 1) {
            const today_id = new Date().toISOString().slice(0, 10)
            const increment: Database['public']['Functions']['increment_stats_v2']['Args'] = {
              app_id: app.app_id,
              date_id: today_id,
              bandwidth: 0,
              mlu: 0,
              mlu_real: 0,
              devices: 0,
              devices_real: 0,
              version_size: versionSize,
              channels: 0,
              shared: 0,
              versions: 0,
            }
            all.push(updateOrAppStats(increment, today_id, app.user_id))
          }
          const newData: Database['public']['Tables']['app_stats']['Insert'] = {
            app_id: app.app_id,
            date_id: month_id,
            user_id: app.user_id,
            channels: channels.count || 0,
            mlu: mlu.count || 0,
            mlu_real: mlu_real.count || 0,
            devices: devices.count || 0,
            devices_real: devicesTT.count || 0,
            versions: versions.data?.length || 0,
            version_size: versionSize,
            shared: shared.count || 0,
            bandwidth: bandwidthTotal,
          }
          // console.log('newData', newData)
          return supabaseAdmin()
            .from('app_stats')
            .upsert(newData)
        }))
    }
    await Promise.all(all)
    return sendRes()
  }
  catch (e) {
    console.log('Error', e)
    return sendRes({
      status: 'Error unknow',
      error: JSON.stringify(e),
    }, 500)
  }
})
