/* eslint-disable */
// One-off: pull ~30 days of Google reviews for the Chuy's chain across all
// available locations (DataForSEO), ingest into a new dataset that matches the
// existing google_reviews row shape (review_text/rating/location_*), so the
// taxonomy classifier + compare scripts work on it unchanged.
//
// DataForSEO lib is server-only, so the API calls are replicated here.
//
// Run:
//   --search-only           just list locations + cost estimate (cheap, instant)
//   (default)               search → pull (depth 200, newest) → 30d filter → ingest
//   --keyword "Chuy's"      brand search term
//   --days 30               window
//   --depth 200             max newest reviews fetched per location

import { readFileSync } from 'fs'; import path from 'path'
const env = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const l of env.split('\n')) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'').replace(/\\n$/,'') }
import { createClient } from '@supabase/supabase-js'
import { buildGoogleReviewsSchema, mergeSchemaStats, emptyThemeModel } from '../lib/datasetUtils'

const BASE = 'https://api.dataforseo.com/v3'
const ADMIN_ORG_ID = 'b72e9ee6-0466-459a-8440-988a8bd6d3c5'
const ADMIN_USER_ID = '99c52954-36a5-4137-b511-a0a336c220ea'

const args = process.argv.slice(2)
const getFlag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined }
const searchOnly = args.includes('--search-only')
const keyword = getFlag('--keyword') ?? "Chuy's"
const days = parseInt(getFlag('--days') ?? '30', 10)
const depth = parseInt(getFlag('--depth') ?? '200', 10)
const datasetName = getFlag('--dataset-name') ?? `Chuy's — Google Reviews (last ${days}d)`

function auth() {
  const u = process.env.DATAFORSEO_LOGIN, p = process.env.DATAFORSEO_PASSWORD
  if (!u || !p) throw new Error('DATAFORSEO_LOGIN/PASSWORD required')
  return 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64')
}
async function post(p: string, body: unknown[]) {
  const r = await fetch(BASE + p, { method: 'POST', headers: { Authorization: auth(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status}: ${t.slice(0,200)}`); return JSON.parse(t)
}
async function get(p: string) {
  const r = await fetch(BASE + p, { headers: { Authorization: auth() } })
  const t = await r.text(); if (!r.ok) throw new Error(`${p} ${r.status}: ${t.slice(0,200)}`); return JSON.parse(t)
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Loc { place_id: string; name: string; address: string|null; city: string|null; state: string|null; review_count: number }
async function searchLocations(kw: string): Promise<Loc[]> {
  const data = await post('/serp/google/maps/live/advanced', [{ keyword: kw, location_code: 2840, language_code: 'en', device: 'desktop', os: 'windows', depth: 700 }])
  const items = data?.tasks?.[0]?.result?.[0]?.items || []
  return items.filter((i: any) => i?.type === 'maps_search' && i?.place_id).map((i: any) => ({
    place_id: i.place_id, name: i.title || '', address: i.address || null,
    city: i.address_info?.city || null, state: i.address_info?.region || null, review_count: i.rating?.votes_count ?? 0,
  }))
}
function parseReview(i: any) {
  if (!i) return null
  const id = i.review_id || i.id || (i.profile_name + ':' + i.timestamp)
  return {
    review_id: String(id), profile_name: i.profile_name || i.author_name || 'Anonymous',
    rating: typeof i.rating === 'number' ? i.rating : (i.rating?.value ?? 0),
    review_text: i.review_text || null, timestamp: i.timestamp || '',
    owner_answer: i.owner_answer || null, review_likes: i.reviews_count || 0,
  }
}
// Uses the /reviews/google/ endpoint family (the lib's primary, account-enabled
// path; /business_data/ 40401s on this account). keyword:'place_id:<id>', tag for
// matching results back, get path /reviews/google/task_get/.
const GET_PATH = '/reviews/google/task_get/'
async function fetchReviewsBatch(placeIds: string[]): Promise<Map<string, any[]>> {
  const out = new Map<string, any[]>()
  for (let c = 0; c < placeIds.length; c += 100) {
    const chunk = placeIds.slice(c, c + 100)
    const postData = await post('/reviews/google/task_post', chunk.map(pid => ({ keyword: 'place_id:' + pid, location_code: 2840, language_code: 'en', depth: Math.min(depth, 4490), sort_by: 'newest', tag: pid })))
    const taskIds = (postData?.tasks || []).filter((t: any) => t.id).map((t: any) => ({ id: t.id, tag: t.data?.tag || '' }))
    const pending = new Set<string>(taskIds.map((t: any) => t.id))
    const tagMap = new Map<string, string>(taskIds.map((t: any) => [t.id, t.tag]))
    for (let a = 0; a < 60 && pending.size; a++) {
      await sleep(5000)
      for (const tid of Array.from(pending)) {
        try {
          const res = await get(`${GET_PATH}${tid}`)
          const task = res?.tasks?.[0]; if (!task) continue
          if (task.status_code === 20000 && task.result?.length) {
            out.set(tagMap.get(tid) || '', (task.result[0]?.items || []).map(parseReview).filter(Boolean))
            pending.delete(tid)
          } else if (task.status_code !== 40402 && task.status_code !== 40602 && task.status_code !== 140607 && task.status_code !== 40401) {
            console.error(`  task ${tid} err ${task.status_code}: ${task.status_message}`); pending.delete(tid)
          }
        } catch (e: any) { console.error(`  poll err ${tid}: ${e.message}`) }
      }
      process.stderr.write(`  chunk ${c/100+1}: ${chunk.length - pending.size}/${chunk.length} done\n`)
    }
    if (pending.size) console.error(`  ${pending.size} tasks still pending after polling`)
  }
  return out
}

async function main() {
  console.log(`Searching Google Maps for "${keyword}"...`)
  let locs = await searchLocations(keyword)
  // Keep only real Chuy's (the chain), drop unrelated maps hits.
  locs = locs.filter(l => /chuy/i.test(l.name))
  console.log(`Found ${locs.length} matching locations (${locs.reduce((s,l)=>s+l.review_count,0).toLocaleString()} lifetime reviews across them)`)
  console.log(`Est. pull: ${locs.length} tasks × depth ${depth} newest, filtered to last ${days}d.`)
  console.log(`Est. DataForSEO cost: ~$${(locs.length * 0.0011 * Math.min(depth, 100) / 100 + locs.length * 0.0006).toFixed(2)}–$${(locs.length * 0.0011 * depth / 100).toFixed(2)} (task + per-review).`)
  if (searchOnly) { console.log('\n--search-only: stopping before the paid pull.'); console.log(locs.slice(0,8).map(l=>`  ${l.name} — ${l.city||'?'}, ${l.state||'?'} (${l.review_count} reviews)`).join('\n')); return }

  const cutoff = Date.now() - days * 86400_000
  console.log(`\nPulling reviews (cutoff ${new Date(cutoff).toISOString().slice(0,10)})...`)
  const byPlace = await fetchReviewsBatch(locs.map(l => l.place_id))

  const flat: any[] = []
  let totalPulled = 0, kept = 0
  for (const loc of locs) {
    const reviews = byPlace.get(loc.place_id) || []
    totalPulled += reviews.length
    for (const r of reviews) {
      const ts = Date.parse(r.timestamp)
      if (!isFinite(ts) || ts < cutoff) continue
      kept++
      flat.push({ data: {
        author: r.profile_name, rating: r.rating, location: loc.name, place_id: loc.place_id,
        review_id: r.review_id, review_date: r.timestamp, review_text: r.review_text,
        review_likes: r.review_likes, location_city: loc.city, location_name: loc.name,
        location_state: loc.state, owner_response: r.owner_answer, location_address: loc.address,
      }})
    }
  }
  console.log(`Pulled ${totalPulled} reviews; ${kept} within last ${days}d.`)
  if (!kept) { console.log('Nothing to ingest.'); return }

  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: created, error } = await s.from('datasets').insert({
    org_id: ADMIN_ORG_ID, name: datasetName, created_by: ADMIN_USER_ID, source: 'google_reviews', row_count: 0,
    brand_tag: "Chuy's", description: JSON.stringify({ pull: 'chuys_30d', keyword, days, locations: locs.length, pulled_at: new Date().toISOString() }),
  }).select('id').single()
  if (error) throw error
  const datasetId = created.id
  const rows = flat.map((r, i) => ({ dataset_id: datasetId, row_index: i, data: r.data }))
  for (let i = 0; i < rows.length; i += 500) {
    const { error: e } = await s.from('dataset_rows_flat').insert(rows.slice(i, i + 500)); if (e) throw e
  }
  await s.from('datasets').update({ row_count: kept, updated_at: new Date().toISOString() }).eq('id', datasetId).eq('org_id', ADMIN_ORG_ID)

  // Create dataset_state so /analyze opens (the app's review-sources flow does
  // this; a bare insert without it 404s). Canonical Google Reviews schema,
  // enriched with stats from the rows we just pulled.
  const schema = mergeSchemaStats(buildGoogleReviewsSchema(), flat.map(r => r.data))
  await s.from('dataset_state').insert({
    dataset_id: datasetId, schema_config: schema, theme_model: emptyThemeModel(),
    saved_charts: [], saved_stats: [], filter_state: {}, updated_by: ADMIN_USER_ID,
  })

  console.log(`\nIngested ${kept} reviews into dataset ${datasetId} ("${datasetName}"). dataset_state created (${schema.fields.length} fields).`)
}
main().catch(e => { console.error(e); process.exit(1) })
