import { parseCronExpression } from 'cron-schedule'

import type { Context } from '@hono/hono'
import dayjs from 'dayjs'
import { supabaseAdmin } from './supabase.ts'
import type { Database } from './supabase.types.ts'
import { trackBentoEvent } from './bento.ts'

interface EventData {
  [key: string]: any
}

async function sendNow(c: Context, eventName: string, eventData: EventData, email: string, orgId: string, uniqId: string, past: Database['public']['Tables']['notifications']['Row'] | null) {
  console.log('send notif', eventName, email)
  const res = await trackBentoEvent(c, email, eventData, eventName)
  if (!res) {
    console.log('trackEvent failed', eventName, email, eventData)
    return false
  }
  if (past != null) {
    const { error } = await supabaseAdmin(c)
      .from('notifications')
      .update({
        last_send_at: dayjs().toISOString(),
        total_send: past.total_send + 1,
      })
      .eq('event', eventName)
      .eq('uniq_id', uniqId)
      .eq('owner_org', orgId)
    if (error) {
      console.error('update notif error', error)
      return false
    }
  }
  else {
    const { error } = await supabaseAdmin(c)
      .from('notifications')
      .insert({
        event: eventName,
        uniq_id: uniqId,
        owner_org: orgId,
        last_send_at: dayjs().toISOString(),
      })
    if (error) {
      console.error('insert notif', error)
      return false
    }
  }
  console.log('send notif done', eventName, email)
  return true
}

function isSendable(last: string, cron: string) {
  const interval = parseCronExpression(cron)
  const last_send_at = new Date(last)
  const now = new Date()
  const nextDate = interval.getNextDate(last_send_at)
  const sendable = dayjs(now).isAfter(nextDate)
  console.log(`
  cron ${cron}
  last_send_at ${last_send_at}
  nextDate ${nextDate}
  now ${now}
  sendable ${sendable}
`)

  return sendable
  // return false
}

export async function sendNotifOrg(c: Context, eventName: string, eventData: EventData, orgId: string, uniqId: string, cron: string) {
  const { data: org, error: orgError } = await supabaseAdmin(c)
    .from('orgs')
    .select()
    .eq('id', orgId)
    .single()

  if (!org || orgError) {
    console.log('org not found', orgId)
    return false
  }
  // check if notif has already been send in notifications table
  const { data: notif } = await supabaseAdmin(c)
    .from('notifications')
    .select()
    .eq('owner_org', org.id)
    .eq('event', eventName)
    .eq('uniq_id', uniqId)
    .single()
  // set user data in crisp
  if (!notif) {
    console.log('notif never sent', eventName, uniqId)
    return sendNow(c, eventName, eventData, org.management_email, orgId, uniqId, null).then(() => true)
  }

  if (notif && !isSendable(notif.last_send_at, cron)) {
    console.log('notif already sent', eventName, orgId)
    return false
  }
  console.log('notif ready to sent', eventName, orgId)
  return sendNow(c, eventName, eventData, org.management_email, orgId, uniqId, notif).then(() => true)
}

// dayjs substract one week
// const last_send_at = dayjs().subtract(1, 'week').toISOString()
// console.log(isSendable(last_send_at, '0 0 1 * *'))
