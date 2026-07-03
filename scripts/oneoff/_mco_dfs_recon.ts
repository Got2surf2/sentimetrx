/* eslint-disable */
// Recon: see what DataForSEO's Google Maps SERP returns when we search
// for airport-scoped restaurant queries. Bypasses lib/dataforseo.ts
// (which has 'server-only' guard) by hitting the API directly.
//
// Run: node_modules/.bin/tsx scripts/_mco_dfs_recon.ts

import { readFileSync } from 'fs'
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

async function mapsSearch(keyword: string, depth: number = 100) {
  const res = await fetch('https://api.dataforseo.com/v3/serp/google/maps/live/advanced', {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify([{
      keyword,
      location_code: 2840,  // United States — same as lib/dataforseo.ts default
      language_code: 'en',
      device: 'desktop',
      depth,
    }]),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

async function main() {
  const queries = [
    'Chick-fil-A Orlando International Airport',
    'Cask & Larder Orlando airport',
    'CIBO Express Orlando International Airport',
    'restaurants Orlando International Airport MCO',
  ]
  for (const q of queries) {
    console.log(`\n=== "${q}" ===`)
    try {
      const data = await mapsSearch(q, 100)
      const task = data?.tasks?.[0]
      if (task?.status_code !== 20000) {
        console.error(`  task error: ${task?.status_message}`)
        continue
      }
      const items = (task.result?.[0]?.items || []).filter((i: any) => i?.type === 'maps_search')
      console.log(`  ${items.length} items`)
      for (const it of items.slice(0, 25)) {
        const stars = it.rating?.value ?? '–'
        const votes = it.rating?.votes_count ?? 0
        const addr = it.address ?? ''
        console.log(`  - ${stars}★ (${votes}) ${it.title} :: ${addr.slice(0, 80)}`)
      }
      if (items.length > 25) console.log(`  … +${items.length - 25} more`)
    } catch (e: any) {
      console.error(`  error: ${e?.message || e}`)
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
