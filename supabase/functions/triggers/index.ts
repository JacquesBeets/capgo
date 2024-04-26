import { Hono } from 'hono/tiny'

// Triggers API
import { sentry } from '@hono/sentry'
import { app as clear_app_cache } from '../_backend/triggers/clear_app_cache.ts'
import { app as clear_device_cache } from '../_backend/triggers/clear_device_cache.ts'
import { app as cron_email } from '../_backend/triggers/cron_email.ts'
import { app as cron_good_plan } from '../_backend/triggers/cron_good_plan.ts'
import { app as cron_scrapper } from '../_backend/triggers/cron_scrapper.ts'
import { app as logsnag_insights } from '../_backend/triggers/logsnag_insights.ts'
import { app as on_channel_update } from '../_backend/triggers/on_channel_update.ts'
import { app as on_user_create } from '../_backend/triggers/on_user_create.ts'
import { app as on_user_update } from '../_backend/triggers/on_user_update.ts'
import { app as on_user_delete } from '../_backend/triggers/on_user_delete.ts'
import { app as on_version_create } from '../_backend/triggers/on_version_create.ts'
import { app as on_version_update } from '../_backend/triggers/on_version_update.ts'
import { app as on_version_delete } from '../_backend/triggers/on_version_delete.ts'
import { app as stripe_event } from '../_backend/triggers/stripe_event.ts'
import { app as get_total_stats } from '../_backend/triggers/get_total_stats.ts'
import { app as on_organization_create } from '../_backend/triggers/on_organization_create.ts'
import { app as cron_stats } from '../_backend/triggers/cron_stats.ts'

const functionName = 'triggers'
const appGlobal = new Hono().basePath(`/${functionName}`)

const sentryDsn = Deno.env.get('SENTRY_DSN_SUPABASE')
if (sentryDsn) {
  appGlobal.use('*', sentry({
    dsn: sentryDsn,
  }))
}

appGlobal.route('/clear_app_cache', clear_app_cache)
appGlobal.route('/clear_device_cache', clear_device_cache)
appGlobal.route('/cron_email', cron_email)
appGlobal.route('/cron_good_plan', cron_good_plan)
appGlobal.route('/cron_scrapper', cron_scrapper)
appGlobal.route('/logsnag_insights', logsnag_insights)
appGlobal.route('/on_channel_update', on_channel_update)
appGlobal.route('/on_user_create', on_user_create)
appGlobal.route('/on_user_update', on_user_update)
appGlobal.route('/on_user_delete', on_user_delete)
appGlobal.route('/on_version_create', on_version_create)
appGlobal.route('/on_version_update', on_version_update)
appGlobal.route('/on_version_delete', on_version_delete)
appGlobal.route('/stripe_event', stripe_event)
appGlobal.route('/get_total_stats', get_total_stats)
appGlobal.route('/on_organization_create', on_organization_create)
appGlobal.route('/cron_stats', cron_stats)

Deno.serve(appGlobal.fetch)
