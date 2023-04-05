import { serve } from 'https://deno.land/std@0.182.0/http/server.ts'
import axios from 'https://deno.land/x/axiod@0.26.2/mod.ts'
import { categories } from '../_utils/gplay_categ.ts'
import { supabaseAdmin } from '../_utils/supabase.ts'
import { getEnv, methodJson, sendRes } from '../_utils/utils.ts'
import type { BaseHeaders } from '../_utils/types.ts'

const toGetFramwork = 5000
const toGetInfo = 5000
const toGetSimilar = 500

const main = async (url: URL, headers: BaseHeaders, method: string, body: any) => {
  const DEV_FUNCTIONS = getEnv('DEV_FUNCTIONS')
  const baseApi = DEV_FUNCTIONS ? 'http://localhost:54321/functions/v1' : 'https://netlify.capgo.app'
  const API_SECRET = getEnv('API_SECRET')
  const authorizationSecret = headers.apisecret
  if (!authorizationSecret)
    return sendRes({ status: 'Cannot find authorization secret' }, 400)

  if (!authorizationSecret || !API_SECRET || authorizationSecret !== API_SECRET) {
    console.error('Fail Authorization', { authorizationSecret, API_SECRET })
    return sendRes({ message: 'Fail Authorization', authorizationSecret }, 400)
  }
  const options = {
    headers: {
      apisecret: API_SECRET,
    },
  }

  try {
    const { data: appsToGetFramework } = await supabaseAdmin()
      .from('store_apps')
      .select()
      .eq('to_get_framework', true)
      .limit(toGetFramwork)
      .order('created_at', { ascending: true })

    const { data: appsToGetInfo } = await supabaseAdmin()
      .from('store_apps')
      .select()
      .eq('to_get_info', true)
      .limit(toGetInfo)
      .order('created_at', { ascending: true })

    const { data: appsToGetSimilar } = await supabaseAdmin()
      .from('store_apps')
      .select()
      .eq('to_get_similar', true)
      .limit(toGetSimilar)
      .order('created_at', { ascending: true })

    const all = []
    const pageSize = 10
    const pageSizeLittle = 2
    console.log('appsToGetFramework', appsToGetFramework?.length || 0)
    console.log('appsToGetInfo', appsToGetInfo?.length || 0)
    console.log('appsToGetSimilar', appsToGetSimilar?.length || 0)
    console.log('appsToGetTop categories', categories?.length || 0)
    console.log('appsToGetTop total', (categories?.length || 0))
    console.log('appsToGetTop total result', (categories?.length || 0) * 500)
    // loop 100 times to get more random apps
    // for (let i = 0; i < toGetTop; i++) {
    //   const randomCategory = categories[Math.floor(Math.random() * categories.length)]
    //   const randomCountryCode = countries[Math.floor(Math.random() * countries.length)]
    //   console.log('randomCategory', randomCategory, 'randomCountryCode', randomCountryCode)
    // split countries by 10 to batch send to netlify
    for (let i = 0; i < categories.length; i += pageSize) {
      const categoriesBatch = categories.slice(i, i + pageSize)
      console.log('countriesBatch', categoriesBatch.length)
      all.push(axios.post(`${baseApi}/get_top_apk-background`, {
        categories: categoriesBatch,
      }, options))
    }
    // all.push(axios.post('https://netlify.capgo.app/get_top_apk-background', {
    //   categories,
    //   countries,
    // }))
    if (appsToGetFramework?.length) {
      for (let i = 0; i < appsToGetFramework.length; i += pageSizeLittle) {
        const appsBatch = appsToGetFramework.slice(i, i + pageSizeLittle)
        all.push(axios.post(`${baseApi}/get_framework-background`, {
          appIds: appsBatch.map(app => app.app_id),
        }, options))
      }
    }
    if (appsToGetInfo?.length) {
      for (let i = 0; i < appsToGetInfo.length; i += pageSize) {
        const appsInfoBatch = appsToGetInfo.slice(i, i + pageSize)
        all.push(axios.post(`${baseApi}/get_store_info-background`, {
          appIds: appsInfoBatch.map(app => app.app_id),
        }, options))
      }
    }
    if (appsToGetSimilar?.length) {
      for (let i = 0; i < appsToGetSimilar.length; i += pageSize) {
        const appsSimilarBatch = appsToGetSimilar.slice(i, i + pageSize)
        // all.push(axios.post('https://netlify.capgo.app/get_framework-background', {
        //   appIds: appsSimilarBatch.map(app => app.app_id),
        // }))
        console.log('appsSimilarBatch', appsSimilarBatch.length)
        all.push(axios.post(`${baseApi}/get_framework-background`, {
          appIds: appsSimilarBatch.map(app => app.app_id),
        }, options))
      }
    }
    await Promise.all(all)
    return sendRes()
  }
  catch (e) {
    console.log('error', e)
    return sendRes({
      status: 'Error unknow',
      error: JSON.stringify(e),
    }, 500)
  }
}

serve(async (event: Request) => {
  try {
    const url: URL = new URL(event.url)
    const headers: BaseHeaders = Object.fromEntries(event.headers.entries())
    const method: string = event.method
    const body: any = methodJson.includes(method) ? await event.json() : Object.fromEntries(url.searchParams.entries())
    return main(url, headers, method, body)
  }
  catch (e) {
    return sendRes({ status: 'Error', error: JSON.stringify(e) }, 500)
  }
})
