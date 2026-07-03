/* eslint-disable */
// One-off: hit DataForSEO once for "restaurants Orlando International Airport MCO",
// filter to actual airport entries (by address / ZIP / terminal mention),
// assign each one to a terminal-context bucket, and write the result to
// data/mco_live_ratings.json. The /api/mco/places route reads from that file
// to populate RestaurantsCard with real Google ratings.
//
// Cost: ~$0.002 per run. Re-run weekly (or whenever) to refresh.
//
// Run: node_modules/.bin/tsx scripts/_mco_dfs_seed.ts

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

function auth() {
  const u = process.env.DATAFORSEO_LOGIN, p = process.env.DATAFORSEO_PASSWORD
  if (!u || !p) throw new Error('DATAFORSEO_LOGIN/PASSWORD missing')
  return 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64')
}

async function mapsSearch(keyword: string, depth: number) {
  const res = await fetch('https://api.dataforseo.com/v3/serp/google/maps/live/advanced', {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify([{ keyword, location_code: 2840, language_code: 'en', device: 'desktop', depth }]),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

// Normalize a name to a fuzzy match token. Strips punctuation, the trailing
// " - Gates X-Y" / " - Terminal X" / " - Orlando Airport" suffixes that flymco
// adds, lowercases, collapses whitespace.
function normalizeName(name: string): string {
  return (name || '')
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/\s*-\s*(?:gates?|gate|terminal|orlando airport|airside|palm court).*$/i, '')
    .replace(/\s*-\s*orlando.*$/i, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Bucket label from the flymco scrape's location field.
function flymcoBucket(loc: string): string {
  const n = (loc || '').toLowerCase()
  if (/terminal\s*-\s*c|terminal c/.test(n)) return 'terminal_c_airside'
  if (/terminal\s*-\s*a\s*&\s*b|terminals?\s*a\s*&\s*b/.test(n)) return 'terminal_a_airside'  // A & B → A airside (we'll dedupe via name)
  if (/terminal\s*-\s*a/.test(n)) return 'terminal_a_airside'
  if (/terminal\s*-\s*b/.test(n)) return 'terminal_b_airside'
  if (/entire airport/.test(n)) return 'landside_main_terminal'
  return 'unknown'
}

function isAirportAddress(addr: string): boolean {
  const a = (addr || '').toLowerCase()
  if (!/32827|jeff fuqua|terminal|airside|gates?|mco|orlando int|palm court|food court/.test(a)) return false
  if (/semoran|gateway village|daetwyler|airport blvd 32812/.test(a)) return false
  return true
}

interface LiveEntry {
  place_id: string
  name: string                   // original flymco name (authoritative)
  matched_dfs_name?: string      // the Google Maps title we matched (for trace)
  rating: number | null
  review_count: number | null
  formatted_address: string
  maps_url: string
  primary_type: string | null
  opening_hours_now: 'open' | 'closed' | 'unknown'
  bucket: string
  location: string               // flymco's "Terminal - X" string
}

async function main() {
  console.log('[dfs] querying Google Maps via DataForSEO…')
  const data = await mapsSearch('restaurants Orlando International Airport MCO', 200)
  const task = data?.tasks?.[0]
  if (task?.status_code !== 20000) throw new Error(`DFS task error: ${task?.status_message}`)
  const items = (task.result?.[0]?.items || []).filter((i: any) => i?.type === 'maps_search')
  console.log('[dfs] ' + items.length + ' raw items')

  const airportDfs = items.filter((it: any) => isAirportAddress(it.address || ''))
  console.log('[filter] ' + airportDfs.length + ' airport-address DFS entries')

  // Build a lookup table from normalized DFS name → DFS item.
  const dfsByName = new Map<string, any[]>()
  for (const it of airportDfs) {
    const key = normalizeName(it.title || '')
    if (!key) continue
    if (!dfsByName.has(key)) dfsByName.set(key, [])
    dfsByName.get(key)!.push(it)
  }

  // Load the flymco scrape — that's our authoritative restaurant list + terminal.
  const scrapePath = '/tmp/mco_directory.json'
  if (!existsSync(scrapePath)) throw new Error('missing /tmp/mco_directory.json — re-run scripts/_mco_scrape_directory.mjs first')
  const scrape = JSON.parse(readFileSync(scrapePath, 'utf-8'))
  const dineEntries = (scrape.entries || []).filter((e: any) => e.category === 'Dine')
  console.log('[scrape] ' + dineEntries.length + ' Dine entries from flymco')

  const entries: LiveEntry[] = []
  let matched = 0
  for (const s of dineEntries) {
    const key = normalizeName(s.name)
    const candidates = dfsByName.get(key)
    if (!candidates || candidates.length === 0) {
      // Best-effort partial match: find any DFS key that starts with this one
      // or vice versa. Cheap but useful for "Auntie Anne's" vs "Auntie Anne's Pretzels".
      let alt: any = null
      const dfsKeys = Array.from(dfsByName.keys())
      for (const k of dfsKeys) {
        if (k.startsWith(key) || key.startsWith(k)) { alt = dfsByName.get(k)![0]; break }
      }
      if (alt) {
        matched++
        const placeId = alt.place_id || alt.cid || (alt.title + '|' + (alt.address || '')).slice(0, 64)
        entries.push({
          place_id: String(placeId),
          name: s.name,
          matched_dfs_name: alt.title,
          rating: typeof alt.rating?.value === 'number' ? alt.rating.value : null,
          review_count: typeof alt.rating?.votes_count === 'number' ? alt.rating.votes_count : null,
          formatted_address: alt.address || '',
          maps_url: alt.url || ('https://www.google.com/maps/place/?q=place_id:' + placeId),
          primary_type: typeof alt.category === 'string' ? alt.category : null,
          opening_hours_now: 'unknown' as const,
          bucket: flymcoBucket(s.location),
          location: s.location,
        })
        continue
      }
      // No match — skip rather than ship a no-rating row. The scraped name will
      // still appear in the KB (so the bot can name it), but the card needs a
      // rating to be useful.
      continue
    }
    // Multiple DFS candidates with the same name (e.g., "Chick-fil-A" landside + airside).
    // Pick the one whose address best matches the flymco location.
    const loc = (s.location || '').toLowerCase()
    let best = candidates[0]
    let bestScore = -1
    for (const c of candidates) {
      const addr = (c.address || '').toLowerCase()
      let score = 0
      if (loc.includes('terminal - c') && /terminal c|palm court|gates? c|c2\d/.test(addr)) score += 3
      if (loc.includes('terminal - a & b') && /terminal a|terminal b|gates? \d|airside [ab12]/.test(addr)) score += 2
      if (loc.includes('entire airport') && /jeff fuqua/.test(addr)) score += 1
      if (typeof c.rating?.votes_count === 'number') score += Math.min(c.rating.votes_count / 1000, 2) // prefer the one with more reviews as tiebreak
      if (score > bestScore) { bestScore = score; best = c }
    }
    matched++
    const placeId = best.place_id || best.cid || (best.title + '|' + (best.address || '')).slice(0, 64)
    entries.push({
      place_id: String(placeId),
      name: s.name,
      matched_dfs_name: best.title,
      rating: typeof best.rating?.value === 'number' ? best.rating.value : null,
      review_count: typeof best.rating?.votes_count === 'number' ? best.rating.votes_count : null,
      formatted_address: best.address || '',
      maps_url: best.url || ('https://www.google.com/maps/place/?q=place_id:' + placeId),
      primary_type: typeof best.category === 'string' ? best.category : null,
      opening_hours_now: 'unknown' as const,
      bucket: flymcoBucket(s.location),
      location: s.location,
    })
  }

  console.log('[match] ' + matched + ' / ' + dineEntries.length + ' flymco entries got a DFS rating')

  // Sort: bucket then rating desc
  entries.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket.localeCompare(b.bucket)
    return (b.rating ?? -1) - (a.rating ?? -1)
  })

  console.log('\nby bucket:')
  const counts = entries.reduce((acc: Record<string, number>, e) => { acc[e.bucket] = (acc[e.bucket] || 0) + 1; return acc }, {})
  for (const [k, v] of Object.entries(counts).sort()) console.log('  ' + k + ': ' + v)

  console.log('\nsample (top 5 by bucket):')
  for (const bucket of ['terminal_a_airside', 'terminal_b_airside', 'terminal_c_airside', 'landside_main_terminal']) {
    const top = entries.filter(e => e.bucket === bucket).slice(0, 5)
    if (top.length === 0) continue
    console.log('  [' + bucket + ']')
    for (const e of top) console.log('    - ' + (e.rating ?? '–') + '★ (' + (e.review_count ?? 0) + ') ' + e.name + (e.matched_dfs_name && e.matched_dfs_name !== e.name ? '  [DFS: ' + e.matched_dfs_name + ']' : ''))
  }

  const outDir = path.join(process.cwd(), 'data')
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
  const outPath = path.join(outDir, 'mco_live_ratings.json')
  writeFileSync(outPath, JSON.stringify({
    fetched_at: new Date().toISOString(),
    source: 'dataforseo google maps serp + flymco directory match',
    query: 'restaurants Orlando International Airport MCO',
    dfs_raw_count: items.length,
    dfs_airport_count: airportDfs.length,
    flymco_dine_count: dineEntries.length,
    matched_count: matched,
    entries,
  }, null, 2))
  console.log('\nwrote ' + outPath + ' (' + entries.length + ' entries)')
}

main().catch(e => { console.error(e); process.exit(1) })
