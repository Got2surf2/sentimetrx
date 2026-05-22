/* eslint-disable */
// One-off: consume /tmp/mco_directory.json (output of _mco_scrape_directory.mjs)
// and seed AskAna's KB with one structured chunk per (terminal × category)
// group plus a small index chunk. Embeds with text-embedding-3-small.
//
// Safety:
//   - DELETES the two stale dining chunks by id (logged before deletion).
//   - Inserts new chunks tagged metadata.source = 'mco_directory_scrape_2026_05_21'.
//   - DRY_RUN=1 in env to print the chunk text + counts without touching prod.
//
// Run:
//   DRY_RUN=1 node_modules/.bin/tsx scripts/_mco_seed_directory_kb.ts
//   node_modules/.bin/tsx scripts/_mco_seed_directory_kb.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
  }
}

import { createClient } from '@supabase/supabase-js'

const ASKANA_BOT_ID = '920c571b-5a09-4d3a-a20e-904a417d20b3'
const DATA_PATH = '/tmp/mco_directory.json'
const SOURCE_TAG = 'mco_directory_scrape_2026_05_21'
// The two stale dining chunks identified in prod 2026-05-21.
const STALE_CHUNK_IDS = [
  'a14e83a9-3fe4-456b-995c-62dad6b497dd',  // "Shops, Restaurants & Services" — page 1 of 113, mostly elevators/counters
  '66023d55-61ec-403f-949c-b6052522e686',  // "shops restaurants services (Orlando International Airport (MCO))" — landing page header
]

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

type Entry = { name: string; category: 'Shop' | 'Dine' | 'Amenity'; location: string; detail_url: string | null }

function normalizeLocation(loc: string): string {
  // "Terminal - A & B" → "Terminal A & B"; "Terminal - C" → "Terminal C"; "Parking - A & B" → "Parking A & B"; "Entire Airport" passes through
  return loc.replace(/\s*-\s*/, ' ').replace(/\s+/g, ' ').trim()
}

function bucketFor(loc: string): string {
  const n = normalizeLocation(loc).toLowerCase()
  if (/parking/.test(n)) return 'parking-garage'
  if (/entire airport/.test(n)) return 'entire-airport'
  if (/\bterminal\b.*\ba\b.*\bb\b/.test(n)) return 'terminal-ab'
  if (/\bterminal\b.*\bc\b/.test(n)) return 'terminal-c'
  if (/\bterminal\b.*\ba\b/.test(n)) return 'terminal-a'
  if (/\bterminal\b.*\bb\b/.test(n)) return 'terminal-b'
  return 'other'
}

function bucketLabel(b: string): string {
  switch (b) {
    case 'terminal-ab': return 'Terminals A & B'
    case 'terminal-c': return 'Terminal C'
    case 'terminal-a': return 'Terminal A'
    case 'terminal-b': return 'Terminal B'
    case 'parking-garage': return 'Parking Garages'
    case 'entire-airport': return 'Across the Entire Airport'
    case 'other': return 'Other Locations'
    default: return b
  }
}

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: texts }),
  })
  if (!res.ok) throw new Error('Embeddings API ' + res.status + ': ' + await res.text())
  const data = await res.json()
  return data.data.map((d: any) => d.embedding as number[])
}

async function main() {
  const raw = JSON.parse(readFileSync(DATA_PATH, 'utf-8'))
  const entries: Entry[] = raw.entries

  // Dedupe by name+location (case where the scrape captured the same entry under
  // both a filter view and "Show all"). The scrape already de-dupes per category,
  // but we may have the same physical location tagged twice across categories.
  const dedup = new Map<string, Entry>()
  for (const e of entries) {
    const k = (e.name || '').toLowerCase() + '|' + (e.location || '').toLowerCase()
    if (!dedup.has(k)) dedup.set(k, e)
  }
  const all = Array.from(dedup.values())
  console.log('[load] ' + entries.length + ' raw → ' + all.length + ' deduped entries')

  // Group by category × bucket
  type Bucket = { category: string; bucket: string; label: string; items: Entry[] }
  const buckets: Bucket[] = []
  const byKey = new Map<string, Bucket>()
  for (const e of all) {
    const b = bucketFor(e.location)
    const key = e.category + '||' + b
    let bucket = byKey.get(key)
    if (!bucket) {
      bucket = { category: e.category, bucket: b, label: bucketLabel(b), items: [] }
      byKey.set(key, bucket)
      buckets.push(bucket)
    }
    bucket.items.push(e)
  }
  buckets.sort((a, b) => a.category.localeCompare(b.category) || a.bucket.localeCompare(b.bucket))

  // Build one chunk per bucket, splitting large buckets into multiple
  // chunks of ≤MAX_CHUNK chars so retrieval picks tight, focused slices.
  // Each sub-chunk gets the same intro paragraph so it stands alone.
  const MAX_CHUNK = 2000
  const chunks: { title: string; content: string; metadata: Record<string, any> }[] = []
  for (const b of buckets) {
    const sorted = b.items.slice().sort((x, y) => x.name.localeCompare(y.name))
    const intro = `This is part of the live ${b.category.toLowerCase()} directory for ${b.label} at Orlando International Airport (MCO), captured from flymco.com on ${raw.fetched_at.slice(0, 10)}.`
    const lines = sorted.map(e => `- ${e.name} (${normalizeLocation(e.location)})`)
    // Pack lines into chunks under the size budget
    const pages: string[][] = [[]]
    let runningLen = intro.length + 20
    for (const line of lines) {
      const cur = pages[pages.length - 1]
      if (runningLen + line.length + 1 > MAX_CHUNK && cur.length > 0) {
        pages.push([])
        runningLen = intro.length + 20
      }
      pages[pages.length - 1].push(line)
      runningLen += line.length + 1
    }
    pages.forEach((page, idx) => {
      const suffix = pages.length > 1 ? ` (part ${idx + 1} of ${pages.length})` : ''
      const baseTitle = `${b.category} options — ${b.label}`
      chunks.push({
        title: baseTitle + suffix,
        content: `${baseTitle}${suffix}\n\n${intro} This part has ${page.length} entr${page.length === 1 ? 'y' : 'ies'}.\n\n${page.join('\n')}\n\nSource: ${raw.source_url}`,
        metadata: {
          source: SOURCE_TAG,
          source_url: raw.source_url,
          category: b.category,
          bucket: b.bucket,
          part: idx + 1,
          total_parts: pages.length,
          fetched_at: raw.fetched_at,
          count: page.length,
        },
      })
    })
  }

  // Plus a small index chunk summarising what's covered
  const totals = Object.entries(raw.by_category || {}).map(([c, n]) => `${c}: ${n}`).join(' · ')
  chunks.unshift({
    title: 'Shops, Restaurants & Amenities — directory index',
    content: `Orlando International Airport (MCO) Shops, Restaurants & Services directory, captured from flymco.com on ${raw.fetched_at.slice(0, 10)}.\n\nTotal entries: ${all.length} (${totals}).\n\nCoverage by location bucket:\n${buckets.map(b => `- ${b.category} — ${b.label}: ${b.items.length}`).join('\n')}\n\nFor a specific terminal's options, see the per-bucket chunks: "Dine options — Terminal A", "Shop options — Terminals A & B", etc.\n\nWhen the user asks about food, drinks, snacks, coffee, shopping, or in-airport services, prefer naming specific entries from these chunks over directing the user to flymco.com.\n\nSource: ${raw.source_url}`,
    metadata: { source: SOURCE_TAG, source_url: raw.source_url, category: 'index', bucket: 'index', fetched_at: raw.fetched_at, count: all.length },
  })

  console.log('[chunks] produced ' + chunks.length + ' chunks:')
  for (const c of chunks) console.log('  - ' + c.title + ' (' + c.content.length + ' chars)')

  if (DRY_RUN) {
    console.log('\n--- DRY_RUN — sample chunk content ---\n')
    console.log(chunks[1]?.content || chunks[0].content)
    console.log('\n[dry-run] skipping delete + insert + embed. Re-run without DRY_RUN=1 to apply.')
    return
  }

  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 1. Delete stale chunks (by id, with bot_id check for tenant safety)
  for (const cid of STALE_CHUNK_IDS) {
    const { data: existing, error: gErr } = await service
      .from('agent_knowledge_chunks')
      .select('id, title')
      .eq('id', cid)
      .eq('bot_id', ASKANA_BOT_ID)
      .maybeSingle()
    if (gErr || !existing) {
      console.log('[stale-check] ' + cid + ' — not found / already gone')
      continue
    }
    const { error: dErr } = await service
      .from('agent_knowledge_chunks')
      .delete()
      .eq('id', cid)
      .eq('bot_id', ASKANA_BOT_ID)
    if (dErr) { console.error('[delete] ' + cid + ' failed: ' + dErr.message); process.exit(1) }
    console.log('[delete] ' + cid + ' (' + existing.title + ') ✓')
  }

  // 2. Insert new chunks
  const rows = chunks.map(c => ({ bot_id: ASKANA_BOT_ID, title: c.title, content: c.content, metadata: c.metadata }))
  const { data: inserted, error: insErr } = await service
    .from('agent_knowledge_chunks')
    .insert(rows)
    .select('id, title, content')
  if (insErr) { console.error('[insert] failed: ' + insErr.message); process.exit(1) }
  console.log('[insert] ' + (inserted?.length || 0) + ' new chunks')

  // 3. Embed in batches of 50
  if (inserted && inserted.length > 0) {
    const BATCH = 50
    let embedded = 0
    for (let i = 0; i < inserted.length; i += BATCH) {
      const batch = inserted.slice(i, i + BATCH)
      const texts = batch.map((c: any) => c.title + '\n' + c.content)
      const vecs = await embedBatch(texts)
      for (let j = 0; j < batch.length; j++) {
        if (vecs[j]) {
          const { error: uErr } = await service.from('agent_knowledge_chunks')
            .update({ embedding: JSON.stringify(vecs[j]) })
            .eq('id', (batch[j] as any).id)
          if (uErr) console.error('[embed] update failed for ' + (batch[j] as any).id + ': ' + uErr.message)
          else embedded++
        }
      }
      console.log('[embed] ' + Math.min(i + BATCH, inserted.length) + '/' + inserted.length)
    }
    console.log('[embed] done ' + embedded + '/' + inserted.length)
  }

  console.log('\n✔ KB update complete. New per-bucket chunks live; stale dining chunks removed.')
}

main().catch(e => { console.error(e); process.exit(1) })
