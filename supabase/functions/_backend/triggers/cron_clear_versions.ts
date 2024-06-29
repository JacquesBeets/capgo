import { Hono } from 'hono/tiny'
import type { Context } from '@hono/hono'
import { BRES, middlewareAPISecret } from '../utils/hono.ts'
import { supabaseAdmin } from '../utils/supabase.ts'
import { s3 } from '../utils/s3.ts'
import type { Database } from '../utils/supabase.types.ts'

export const app = new Hono()

function errorOut(c: Context, error: string) {
  console.error(error)
  return c.json({ status: error }, 500)
}

app.post('/', middlewareAPISecret, async (c: Context) => {
  try {
    // unsafe parse the body
    const body = await c.req.json<{ version: Database['public']['Tables']['app_versions']['Row'] }>()
    console.log('body cron_clear_versions', body)

    // Let's start with the metadata
    const supabase = supabaseAdmin(c)

    const version = body.version
    if (version.user_id === null) {
      // find the user_id from the app_id
      const { data: app, error: errorApp } = await supabaseAdmin(c)
        .from('apps')
        .select('user_id')
        .eq('app_id', version.app_id)
        .single()
      if (errorApp)
        return errorOut(c, `Cannot find user_id for app_id ${version.app_id} because of error: ${errorApp}`)
      if (!app)
        return errorOut(c, `Cannot find user_id for app_id ${version.app_id} because of no app found`)
      version.user_id = app.user_id
    }
    const v2Path = version.bucket_id ? `apps/${version.user_id}/${version.app_id}/versions/${version.bucket_id}` : version.r2_path
    console.log('v2Path', v2Path)
    let notFound = false
    try {
      const size = await s3.getSize(c, v2Path ?? '')
      if (!size) {
        console.log(`No size for ${v2Path}, ${size}`)
        // throw error to trigger the deletion
        notFound = true
        throw new Error('no_size')
      }
      // get checksum from table app_versions
      const { data: appVersion, error: errorAppVersion } = await supabaseAdmin(c)
        .from('app_versions')
        .select('checksum')
        .eq('id', version.id)
        .single()
      if (errorAppVersion)
        return errorOut(c, `Cannot find checksum for app_versions id ${version.id} because of error: ${errorAppVersion}`)
      if (!appVersion)
        return errorOut(c, `Cannot find checksum for app_versions id ${version.id} because of no app_versions found`)
      const checksum = appVersion.checksum
      if (!checksum) {
        console.log(`No checksum for ${v2Path}, ${checksum}`)
      }

      console.log(`Upsert app_versions_meta (version id: ${version.id}) to: ${size}`)

      await supabase.from('app_versions_meta')
        .upsert({
          id: version.id,
          app_id: version.app_id,
          checksum: checksum ?? '',
          size,
          owner_org: version.owner_org,
        })
    }
    catch (errorSize) {
      console.error('errorSize', notFound, v2Path, errorSize)
      // Ensure that the version is not linked anywhere
      const { count, error, data } = await supabase.from('channels')
        .select('id', { count: 'exact' })
        .or(`version.eq.${version.id},second_version.eq.${version.id}`)

      if (error)
        return errorOut(c, `Cannot check channel count for ${version.id} because of error: ${error}`)

      if ((count ?? 0) > 0) {
        if (notFound) {
          // set channel to unknow version where version is currently set
          // find id of unknow version
          const { data: unknowVersion, error: errorUnknowVersion } = await supabase.from('app_versions')
            .select('id')
            .eq('app_id', version.app_id)
            .eq('name', 'unknown')
            .single()
          if (errorUnknowVersion)
            return errorOut(c, `Cannot find unknow version for app_id ${version.app_id} because of error: ${errorUnknowVersion}`)
          if (!unknowVersion)
            return errorOut(c, `Cannot find unknow version for app_id ${version.app_id} because of no unknow version found`)
          await supabase.from('channels')
            .update({ version: unknowVersion.id, second_version: null })
            .or(`version.eq.${version.id},second_version.eq.${version.id}`)
        }
        else {
          return errorOut(c, `cannot delete failed version ${version.id}, linked in some channels (${data.map(d => d.id).join(', ')})`)
        }
      }

      const { error: error1 } = await supabase.from('app_versions')
        .delete()
        .eq('id', version.id)

      if (error1)
        errorOut(c, `Cannot delete version ${version.id} because of the error: ${error1}`)
    }
    return c.json(BRES)
  }
  catch (e) {
    return c.json({ status: 'Cannot cleanup versions', error: JSON.stringify(e) }, 500)
  }
})
