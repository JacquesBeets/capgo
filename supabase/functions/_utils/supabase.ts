import { createClient } from 'https://esm.sh/@supabase/supabase-js@^2.2.3'
import { createCustomer } from './stripe.ts'
import type { Database } from './supabase.types.ts'
import { getEnv } from './utils.ts'
import type { Person, Segments } from './plunk.ts'
import { addDataContact } from './plunk.ts'
import { isClickHouseEnabled, sendDeviceToClickHouse, sendLogToClickHouse } from './clickhouse.ts'
import type { Order } from './types.ts'

// Import Supabase client

export interface InsertPayload<T extends keyof Database['public']['Tables']> {
  type: 'INSERT'
  table: string
  schema: string
  record: Database['public']['Tables'][T]['Insert']
  old_record: null
}
export interface UpdatePayload<T extends keyof Database['public']['Tables']> {
  type: 'UPDATE'
  table: string
  schema: string
  record: Database['public']['Tables'][T]['Update']
  old_record: Database['public']['Tables'][T]['Row']
}
export interface DeletePayload<T extends keyof Database['public']['Tables']> {
  type: 'DELETE'
  table: string
  schema: string
  record: null
  old_record: Database['public']['Tables'][T]['Row']
}

export function supabaseClient(auth: string) {
  const options = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
    global: { headers: { Authorization: auth } },
  }
  return createClient<Database>(getEnv('SUPABASE_URL'), getEnv('SUPABASE_ANON_KEY'), options)
}

// WARNING: The service role key has admin priviliges and should only be used in secure server environments!
export function supabaseAdmin() {
  const options = {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  }
  return createClient<Database>(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), options)
}

async function allObject<T extends string, R>(all: { [key in T]: PromiseLike<R> }) {
  const allAwaited: { [key in T]: number } = await Object
    .entries(all)
    .reduce(async (acc, [key, value]) => ({
      ...await acc,
      [key]: await value,
    }), Promise.resolve({} as { [key in T]: number }))
  return allAwaited
}

export function updateOrCreateVersion(update: Database['public']['Tables']['app_versions']['Insert']) {
  console.log('updateOrCreateVersion', update)
  return supabaseAdmin()
    .from('app_versions')
    .upsert(update)
    .eq('app_id', update.app_id)
    .eq('name', update.name)
}

export async function updateOnpremStats(increment: Database['public']['Functions']['increment_store']['Args']) {
  const { error } = await supabaseAdmin()
    .rpc('increment_store', increment)
  if (error)
    console.error('increment_store', error)
}

export function updateOrCreateChannel(update: Database['public']['Tables']['channels']['Insert']) {
  console.log('updateOrCreateChannel', update)
  if (!update.app_id || !update.name || !update.created_by) {
    console.log('missing app_id, name, or created_by')
    return Promise.reject(new Error('missing app_id, name, or created_by'))
  }
  return supabaseAdmin()
    .from('channels')
    .upsert(update)
    .eq('app_id', update.app_id)
    .eq('name', update.name)
    .eq('created_by', update.created_by)
}

export async function checkAppOwner(userId: string | undefined, appId: string | undefined): Promise<boolean> {
  if (!appId || !userId)
    return false
  try {
    const { data, error } = await supabaseAdmin()
      .from('apps')
      .select()
      .eq('user_id', userId)
      .eq('app_id', appId)
    if (!data || !data.length || error)
      return false
    return true
  }
  catch (error) {
    console.log(error)
    return false
  }
}

export async function getCurrentPlanName(userId: string): Promise<string> {
  try {
    const { data } = await supabaseAdmin()
      .rpc('get_current_plan_name', { userid: userId })
      .single()
      .throwOnError()
    return data || ''
  }
  catch (error) {
    console.error('getCurrentPlanName error', userId, error)
  }
  return ''
}

export async function getPlanUsagePercent(userId: string, dateid: string): Promise<number> {
  const { data, error } = await supabaseAdmin()
    .rpc('get_plan_usage_percent', { userid: userId, dateid })
    .single()
  if (error) {
    console.error('getPlanUsagePercent error', error.message)
    throw new Error(error.message)
  }

  return data || 0
}

export async function isGoodPlan(userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin()
      .rpc('is_good_plan_v3', { userid: userId })
      .single()
      .throwOnError()
    return data || false
  }
  catch (error) {
    console.error('isGoodPlan error', userId, error)
  }
  return false
}

export async function isOnboarded(userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin()
      .rpc('is_onboarded', { userid: userId })
      .single()
      .throwOnError()
    return data || false
  }
  catch (error) {
    console.error('isOnboarded error', userId, error)
  }
  return false
}

export async function isFreeUsage(userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin()
      .rpc('is_free_usage', { userid: userId })
      .single()
      .throwOnError()
    return data || false
  }
  catch (error) {
    console.error('isFreeUsage error', userId, error)
  }
  return false
}

export async function isOnboardingNeeded(userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin()
      .rpc('is_onboarding_needed', { userid: userId })
      .single()
      .throwOnError()
    return data || false
  }
  catch (error) {
    console.error('isOnboardingNeeded error', userId, error)
  }
  return false
}

export async function isCanceled(userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin()
      .rpc('is_canceled', { userid: userId })
      .single()
      .throwOnError()
    return data || false
  }
  catch (error) {
    console.error('isCanceled error', userId, error)
  }
  return false
}

export async function isPaying(userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin()
      .rpc('is_paying', { userid: userId })
      .single()
      .throwOnError()
    return data || false
  }
  catch (error) {
    console.error('isPaying error', userId, error)
  }
  return false
}

export async function isTrial(userId: string): Promise<number> {
  try {
    const { data } = await supabaseAdmin()
      .rpc('is_trial', { userid: userId })
      .single()
      .throwOnError()
    return data || 0
  }
  catch (error) {
    console.error('isTrial error', userId, error)
  }
  return 0
}

export async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin()
    .rpc('is_admin', { userid: userId })
    .single()
  if (error)
    throw new Error(error.message)

  return data || false
}

export async function isAllowedAction(userId: string): Promise<boolean> {
  try {
    const { data } = await supabaseAdmin()
      .rpc('is_allowed_action_user', { userid: userId })
      .single()
      .throwOnError()
    return data || false
  }
  catch (error) {
    console.error('isAllowedAction error', userId, error)
  }
  return false
}

export function getSDevice(auth: string, appId: string, versionId?: string, deviceIds?: string[], search?: string, order?: Order[], rangeStart?: number, rangeEnd?: number) {
  // if (!isTinybirdGetLogEnabled()) {
  // do the request to supabase
  console.log(`getDevice appId ${appId} versionId ${versionId} deviceIds ${deviceIds} search ${search} rangeStart ${rangeStart}, rangeEnd ${rangeEnd}`, order)

  const reqCount = supabaseClient(auth)
    .from('devices')
    .select('', { count: 'exact' })
    .eq('app_id', appId)
    .then(res => res.count || 0)
  const req = supabaseClient(auth)
    .from('devices')
    .select(`
      device_id,
      created_at,
      updated_at,
      platform,
      os_version,
      version
  `)
    .eq('app_id', appId)

  if (versionId) {
    console.log('versionId', versionId)
    req.eq('version', versionId)
  }

  if (rangeStart !== undefined && rangeEnd !== undefined) {
    console.log('range', rangeStart, rangeEnd)
    req.range(rangeStart, rangeEnd)
  }

  if (deviceIds && deviceIds.length) {
    console.log('deviceIds', deviceIds)
    if (deviceIds.length === 1)
      req.eq('device_id', deviceIds[0])
    else
      req.in('device_id', deviceIds)
  }
  if (search) {
    console.log('search', search)
    if (deviceIds && deviceIds.length)
      req.or(`action.like.%${search}%`)
    else
      req.or(`device_id.like.%${search}%,custom_id.like.%${search}%`)
  }

  if (order?.length) {
    order.forEach((col) => {
      if (col.sortable && typeof col.sortable === 'string') {
        console.log('order', col.key, col.sortable)
        req.order(col.key as any, { ascending: col.sortable === 'asc' })
      }
    })
  }
  return Promise.all([reqCount, req.then(res => res.data || [])]).then(res => ({ count: res[0], data: res[1] }))

  // }
  // else {
  //   console.log('getDevice enabled')
  //   // check the rights of the user
  //   return readDevicesInTinyBird(appId, versionId, deviceIds, search, order, rangeStart, rangeEnd)
  // }
}

export function getSStats(auth: string, appId: string, deviceIds?: string[], search?: string, order?: Order[], rangeStart?: number, rangeEnd?: number) {
  // if (!isTinybirdGetDevicesEnabled()) {
  console.log(`getStats appId ${appId} deviceIds ${deviceIds} search ${search} rangeStart ${rangeStart}, rangeEnd ${rangeEnd}`, order)
  // getStats ee.forgr.captime undefined  [
  //   { key: "action", sortable: true },
  //   { key: "created_at", sortable: "desc" }
  // ] 0 9
  const reqCount = supabaseClient(auth)
    .from('stats')
    .select('', { count: 'exact' })
    .eq('app_id', appId)
    .then(res => res.count || 0)
  const req = supabaseClient(auth)
    .from('stats')
    .select(`
        device_id,
        action,
        platform,
        version_build,
        version,
        created_at
      `)
    .eq('app_id', appId)

  if (rangeStart !== undefined && rangeEnd !== undefined) {
    console.log('range', rangeStart, rangeEnd)
    req.range(rangeStart, rangeEnd)
  }

  if (deviceIds && deviceIds.length) {
    console.log('deviceIds', deviceIds)
    if (deviceIds.length === 1)
      req.eq('device_id', deviceIds[0])
    else
      req.in('device_id', deviceIds)
  }
  if (search) {
    console.log('search', search)
    if (deviceIds && deviceIds.length)
      req.or(`action.like.%${search}%`)
    else
      req.or(`device_id.like.%${search}%,action.like.%${search}%`)
  }

  if (order?.length) {
    order.forEach((col) => {
      if (col.sortable && typeof col.sortable === 'string') {
        console.log('order', col.key, col.sortable)
        req.order(col.key as any, { ascending: col.sortable === 'asc' })
      }
    })
  }
  return Promise.all([reqCount, req.then(res => res.data || [])]).then(res => ({ count: res[0], data: res[1] }))
  // }
  // else {
  //   console.log('getStats enabled')
  //   // check the rights of the user
  //   return readLogInTinyBird(appId, deviceId, search, order, rangeStart, rangeEnd)
  // }
}

export function sendDevice(device: Database['public']['Tables']['devices']['Update']) {
  const deviceComplete: Database['public']['Tables']['devices']['Insert'] = {
    created_at: device.created_at || new Date().toISOString(),
    updated_at: device.updated_at || new Date().toISOString(),
    // last_mau if not exist take olded js date
    last_mau: device.last_mau || new Date(0).toISOString(),
    platform: device.platform as Database['public']['Enums']['platform_os'],
    os_version: device.os_version as string,
    version: device.version as number,
    version_build: device.version_build as string,
    device_id: device.device_id as string,
    app_id: device.app_id as string,
    plugin_version: device.plugin_version as string,
    is_emulator: !!device.is_emulator,
    is_prod: !!device.is_prod,
    custom_id: device.custom_id as string,
  }
  const all = []
  if (isClickHouseEnabled())
    all.push(sendDeviceToClickHouse([deviceComplete]))
  else
    all.push(supabaseAdmin().from('devices').upsert(deviceComplete))

  return Promise.all(all)
    .catch((e) => {
      console.log('sendDevice error', e)
    })
}

export function sendStats(stats: Database['public']['Tables']['stats']['Update'][]) {
  const all = []
  for (const stat of stats) {
    const statComplete: Database['public']['Tables']['stats']['Insert'] = {
      created_at: stat.created_at || new Date().toISOString(),
      device_id: stat.device_id as string,
      action: stat.action as string,
      app_id: stat.app_id as string,
      version_build: stat.version_build as string,
      version: stat.version as number,
      platform: stat.platform as Database['public']['Enums']['platform_os'],
    }
    if (isClickHouseEnabled())
      all.push(sendLogToClickHouse([statComplete]))
    else
      all.push(supabaseAdmin().from('stats').insert(statComplete))
  }

  return Promise.all(all)
    .catch((e) => {
      console.log('sendDevice error', e)
    })
}

function allDateIdOfMonth() {
  const date_id = new Date().toISOString().slice(0, 7)
  const lastDay = new Date(new Date().getFullYear(), new Date().getMonth(), 0)
  const days = []
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const day = new Date(new Date().getFullYear(), new Date().getMonth(), d).getDate()
    days.push(`${date_id}-${day}`)
  }
  // console.log('days', days)
  return days
}

export async function createAppStat(userId: string, appId: string, date_id: string) {
  const now = new Date()
  const firstDay = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0)
  // console.log('req', req)
  const mlu = supabaseAdmin()
    .from('stats')
    .select('app_id', { count: 'exact', head: true })
    .eq('app_id', appId)
    .lte('created_at', lastDay.toISOString())
    .gte('created_at', firstDay.toISOString())
    .eq('action', 'get')
    .then(res => res.count || 0)
  const mlu_real = supabaseAdmin()
    .from('stats')
    .select('app_id', { count: 'exact', head: true })
    .eq('app_id', appId)
    .lte('created_at', lastDay.toISOString())
    .gte('created_at', firstDay.toISOString())
    .eq('action', 'set')
    .then(res => res.count || 0)
  const devices = supabaseAdmin()
    .from('devices')
    .select('device_id', { count: 'exact', head: true })
    .eq('app_id', appId)
    .eq('is_emulator', false)
    .eq('is_prod', true)
    .lte('updated_at', lastDay.toISOString())
    .gte('updated_at', firstDay.toISOString())
    .then(res => res.count || 0)
  const devices_real = supabaseAdmin()
    .from('devices')
    .select('device_id', { count: 'exact', head: true })
    .eq('app_id', appId)
    .lte('updated_at', lastDay.toISOString())
    .gte('updated_at', firstDay.toISOString())
    .then(res => res.count || 0)
  const bandwidth = supabaseAdmin()
    .from('app_stats')
    .select('bandwidth')
    .eq('app_id', appId)
    .in('date_id', allDateIdOfMonth())
    .then(res => (res.data ? res.data : []).reduce((acc, cur) => acc + (cur.bandwidth || 0), 0))
  const version_size = supabaseAdmin()
    .from('app_versions_meta')
    .select('size')
    .eq('app_id', appId)
    .eq('user_id', userId)
    .then(res => (res.data ? res.data : []).reduce((acc, cur) => acc + (cur.size || 0), 0))
  //  write in SQL select all id of app_versions who match app_id = "toto" and use the result to find all app_versions_meta and sum all size
  const versions = supabaseAdmin()
    .from('app_versions')
    .select('id', { count: 'exact', head: true })
    .eq('app_id', appId)
    .eq('user_id', userId)
    .eq('deleted', false)
    .then(res => res.count || 0)
  const shared = supabaseAdmin()
    .from('channel_users')
    .select('id', { count: 'exact', head: true })
    .eq('app_id', appId)
    .then(res => res.count || 0)
  const channels = supabaseAdmin()
    .from('channels')
    .select('id', { count: 'exact', head: true })
    .eq('app_id', appId)
    .then(res => res.count || 0)
  const all = { mlu, mlu_real, devices, devices_real, bandwidth, version_size, versions, shared, channels }
  type Keys = keyof typeof all
  const allAwaited = await allObject<Keys, number>(all)
  const newData = {
    app_id: appId,
    user_id: userId,
    date_id,
    ...allAwaited,
  }
  return newData
}

export async function createApiKey(userId: string) {
  // check if user has apikeys
  const total = await supabaseAdmin()
    .from('apikeys')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .then(res => res.count || 0)

  if (total === 0) {
    // create apikeys
    return supabaseAdmin()
      .from('apikeys')
      .insert([
        {
          user_id: userId,
          key: crypto.randomUUID(),
          mode: 'all',
        },
        {
          user_id: userId,
          key: crypto.randomUUID(),
          mode: 'upload',
        },
        {
          user_id: userId,
          key: crypto.randomUUID(),
          mode: 'read',
        }])
  }
  return Promise.resolve()
}

export async function createdefaultOrg(userId: string, name = 'Default') {
  // check if user has apikeys
  const total = await supabaseAdmin()
    .from('orgs')
    .select('created_by', { count: 'exact', head: true })
    .eq('created_by', userId)
    .then(res => res.count || 0)

  if (total === 0) {
    // create apikeys
    const { data, error } = await supabaseAdmin()
      .from('orgs')
      .insert(
        {
          created_by: userId,
          logo: 'https://res.cloudinary.com/dz3vsv9pg/image/upload/v1623349123/capgo/logo.png',
          name: `${name} organization`,
        })
      .select()
      .single()
      // create org_users admin from data.id
    if (error)
      console.error('createdefaultOrg error', error)

    if (data) {
      return supabaseAdmin()
        .from('org_users')
        .insert([
          {
            org_id: data.id,
            user_id: userId,
            role: 'admin',
          }])
    }
  }
  return Promise.resolve()
}

export function userToPerson(user: Database['public']['Tables']['users']['Row'], customer: Database['public']['Tables']['stripe_info']['Row']): Person {
  const person: Person = {
    id: user.id,
    product_id: customer.product_id,
    customer_id: customer.customer_id,
    nickname: `${user.first_name ?? ''} ${user.last_name ?? ''}`,
    avatar: user.image_url ? user.image_url : undefined,
    country: user.country ? user.country : undefined,
  }
  return person
}

export async function saveStoreInfo(apps: (Database['public']['Tables']['store_apps']['Insert'])[]) {
  // save in supabase
  if (!apps.length)
    return
  const noDup = apps.filter((value, index, self) => index === self.findIndex(t => (t.app_id === value.app_id)))
  console.log('saveStoreInfo', noDup.length)
  const { error } = await supabaseAdmin()
    .from('store_apps')
    .upsert(noDup)
  if (error)
    console.error('saveStoreInfo error', error)
}

export async function customerToSegment(userId: string, customer: Database['public']['Tables']['stripe_info']['Row'],
  plan?: Database['public']['Tables']['plans']['Row'] | null): Promise<Segments> {
  const segments: Segments = {
    capgo: true,
    onboarded: await isOnboarded(userId),
    trial: false,
    trial7: false,
    trial1: false,
    trial0: false,
    paying: false,
    payingMonthly: plan?.price_m_id === customer.price_id,
    plan: plan?.name ?? '',
    overuse: false,
    canceled: await isCanceled(userId),
    issueSegment: false,
  }
  const trialDaysLeft = await isTrial(userId)
  const paying = await isPaying(userId)
  const canUseMore = await isGoodPlan(userId)

  if (!segments.onboarded)
    return segments

  if (!paying && trialDaysLeft > 1 && trialDaysLeft <= 7) {
    segments.trial = true
    segments.trial7 = true
  }
  else if (!paying && trialDaysLeft === 1) {
    segments.trial = true
    segments.trial1 = true
  }

  else if (!paying && !canUseMore) {
    segments.trial = true
    segments.trial0 = true
  }

  else if (paying && !canUseMore && plan) {
    segments.overuse = true
    segments.paying = true
  }

  else if (paying && canUseMore && plan) {
    segments.paying = true
  }
  else {
    segments.issueSegment = true
  }

  return segments
}

export async function getStripeCustomer(customerId: string) {
  const { data: stripeInfo } = await supabaseAdmin()
    .from('stripe_info')
    .select('*')
    .eq('customer_id', customerId)
    .single()
  return stripeInfo
}

export async function createStripeCustomer(user: Database['public']['Tables']['users']['Row']) {
  const customer = await createCustomer(user.email, user.id, `${user.first_name || ''} ${user.last_name || ''}`)
  // create date + 15 days
  const trial_at = new Date()
  trial_at.setDate(trial_at.getDate() + 15)
  const { error: createInfoError } = await supabaseAdmin()
    .from('stripe_info')
    .insert({
      customer_id: customer.id,
      trial_at: trial_at.toISOString(),
    })
  if (createInfoError)
    console.log('createInfoError', createInfoError)

  const { error: updateUserError } = await supabaseAdmin()
    .from('users')
    .update({
      customer_id: customer.id,
    })
    .eq('id', user.id)
  if (updateUserError)
    console.log('updateUserError', updateUserError)
  const person: Person = {
    id: user.id,
    customer_id: customer.id,
    product_id: 'free',
    nickname: `${user.first_name} ${user.last_name}`,
    avatar: user.image_url ? user.image_url : undefined,
    country: user.country ? user.country : undefined,
  }
  const { data: plan } = await supabaseAdmin()
    .from('plans')
    .select()
    .eq('stripe_id', customer.product_id)
    .single()
  const segment = await customerToSegment(user.id, customer, plan)
  await addDataContact(user.email, { ...person, ...segment }).catch((e) => {
    console.log('updatePerson error', e)
  })
  console.log('stripe_info done')
}
