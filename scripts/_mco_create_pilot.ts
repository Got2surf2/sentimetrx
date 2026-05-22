/* eslint-disable */
// One-off: create an "AskAna (pilot)" agent as a full clone of the live
// AskAna (bot_id 920c571b-…), then apply the new directory chunks +
// delete the two stale dining chunks against the PILOT ONLY.
//
// Reads /tmp/mco_directory.json (output of _mco_scrape_directory.mjs).
// Live AskAna is untouched. Test at /b/askana-pilot until satisfied;
// then promote with a separate flip script.
//
// Run:
//   DRY_RUN=1 node_modules/.bin/tsx scripts/_mco_create_pilot.ts
//   node_modules/.bin/tsx scripts/_mco_create_pilot.ts

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

const LIVE_BOT_ID = '920c571b-5a09-4d3a-a20e-904a417d20b3'
const PILOT_SLUG = 'askana-pilot'
const PILOT_NAME = 'AskAna (pilot)'
const DATA_PATH = '/tmp/mco_directory.json'
const SOURCE_TAG = 'mco_directory_scrape_2026_05_21_pilot'
const STALE_CHUNK_TITLES = [
  'Shops, Restaurants & Services',
  'shops restaurants services (Orlando International Airport (MCO))',
]

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

type Entry = { name: string; category: 'Shop' | 'Dine' | 'Amenity'; location: string; detail_url: string | null }

function normalizeLocation(loc: string): string {
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

function buildChunks(raw: any) {
  const entries: Entry[] = raw.entries
  const dedup = new Map<string, Entry>()
  for (const e of entries) {
    const k = (e.name || '').toLowerCase() + '|' + (e.location || '').toLowerCase()
    if (!dedup.has(k)) dedup.set(k, e)
  }
  const all = Array.from(dedup.values())

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

  const MAX_CHUNK = 2000
  const chunks: { title: string; content: string; metadata: Record<string, any> }[] = []
  for (const b of buckets) {
    const sorted = b.items.slice().sort((x, y) => x.name.localeCompare(y.name))
    const intro = `This is part of the live ${b.category.toLowerCase()} directory for ${b.label} at Orlando International Airport (MCO), captured from flymco.com on ${raw.fetched_at.slice(0, 10)}.`
    const lines = sorted.map(e => `- ${e.name} (${normalizeLocation(e.location)})`)
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

  const totals = Object.entries(raw.by_category || {}).map(([c, n]) => `${c}: ${n}`).join(' · ')
  chunks.unshift({
    title: 'Shops, Restaurants & Amenities — directory index',
    content: `Orlando International Airport (MCO) Shops, Restaurants & Services directory, captured from flymco.com on ${raw.fetched_at.slice(0, 10)}.\n\nTotal entries: ${all.length} (${totals}).\n\nCoverage by location bucket:\n${buckets.map(b => `- ${b.category} — ${b.label}: ${b.items.length}`).join('\n')}\n\nFor a specific terminal's options, see the per-bucket chunks: "Dine options — Terminal A", "Shop options — Terminals A & B", etc.\n\nWhen the user asks about food, drinks, snacks, coffee, shopping, or in-airport services, prefer naming specific entries from these chunks over directing the user to flymco.com.\n\nSource: ${raw.source_url}`,
    metadata: { source: SOURCE_TAG, source_url: raw.source_url, category: 'index', bucket: 'index', fetched_at: raw.fetched_at, count: all.length },
  })

  return chunks
}

async function main() {
  const raw = JSON.parse(readFileSync(DATA_PATH, 'utf-8'))
  const newChunks = buildChunks(raw)

  console.log('[load] ' + raw.entries.length + ' raw entries')
  console.log('[chunks] new chunks to apply: ' + newChunks.length)

  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 1. Read the live AskAna row
  const { data: live, error: lErr } = await service
    .from('agents')
    .select('*')
    .eq('id', LIVE_BOT_ID)
    .single()
  if (lErr || !live) { console.error('[live] read failed: ' + (lErr?.message || 'no row')); process.exit(1) }
  console.log('[live] loaded ' + live.name + ' (org_id=' + live.org_id + ')')

  // 2. See if pilot already exists; if so, reuse it (idempotent re-runs OK)
  const { data: existingPilot } = await service
    .from('agents')
    .select('id, name, slug, status')
    .eq('slug', PILOT_SLUG)
    .maybeSingle()

  let pilotId: string
  if (existingPilot) {
    pilotId = existingPilot.id
    console.log('[pilot] reusing existing pilot ' + pilotId + ' (' + existingPilot.name + ')')
  } else {
    if (DRY_RUN) {
      console.log('[pilot] would CREATE new pilot agent (DRY_RUN — skipping)')
      pilotId = '00000000-0000-0000-0000-000000000000'
    } else {
      // Build the insert payload — copy everything except id, slug, name, counters, timestamps
      const clonePayload: any = { ...live }
      delete clonePayload.id
      delete clonePayload.conversation_count
      delete clonePayload.created_at
      delete clonePayload.updated_at
      delete clonePayload.last_session_at
      delete clonePayload.last_reviewed_at
      delete clonePayload.next_review_at
      clonePayload.name = PILOT_NAME
      clonePayload.slug = PILOT_SLUG

      const { data: inserted, error: insErr } = await service
        .from('agents')
        .insert(clonePayload)
        .select('id, name, slug')
        .single()
      if (insErr || !inserted) { console.error('[pilot] insert failed: ' + insErr?.message); process.exit(1) }
      pilotId = inserted.id
      console.log('[pilot] created ' + pilotId + ' (' + inserted.name + ', slug ' + inserted.slug + ')')
    }
  }

  // 3. Clear pilot's existing chunks, then clone live chunks fresh
  //    (idempotent re-runs always restore a clean snapshot of the live KB
  //    before applying the new chunks on top).
  if (!DRY_RUN) {
    const { error: dErr } = await service.from('agent_knowledge_chunks').delete().eq('bot_id', pilotId)
    if (dErr) { console.error('[pilot-chunks] clear failed: ' + dErr.message); process.exit(1) }
  }

  const { data: liveChunks, error: cErr } = await service
    .from('agent_knowledge_chunks')
    .select('title, content, metadata, embedding')
    .eq('bot_id', LIVE_BOT_ID)
  if (cErr || !liveChunks) { console.error('[live-chunks] read failed: ' + (cErr?.message || 'none')); process.exit(1) }
  console.log('[live-chunks] read ' + liveChunks.length + ' chunks from live AskAna')

  // Filter out the stale dining chunks BEFORE cloning to pilot
  const toClone = liveChunks.filter((c: any) => !STALE_CHUNK_TITLES.includes(c.title))
  const dropped = liveChunks.length - toClone.length
  console.log('[clone] cloning ' + toClone.length + ' chunks (skipping ' + dropped + ' stale: ' + STALE_CHUNK_TITLES.join(' / ') + ')')

  if (!DRY_RUN && toClone.length > 0) {
    // Insert in batches to stay under Postgres row-size limits
    const BATCH = 30
    for (let i = 0; i < toClone.length; i += BATCH) {
      const batch = toClone.slice(i, i + BATCH).map((c: any) => ({
        bot_id: pilotId,
        title: c.title,
        content: c.content,
        metadata: c.metadata,
        embedding: c.embedding,
      }))
      const { error: bErr } = await service.from('agent_knowledge_chunks').insert(batch)
      if (bErr) { console.error('[clone] batch ' + i + ' failed: ' + bErr.message); process.exit(1) }
      console.log('[clone] inserted ' + Math.min(i + BATCH, toClone.length) + '/' + toClone.length)
    }
  }

  // 4. Insert the new chunks into the pilot + embed
  if (DRY_RUN) {
    console.log('[new] would insert + embed ' + newChunks.length + ' new chunks (DRY_RUN — skipping)')
    console.log('\n[dry-run] no writes made. Re-run without DRY_RUN=1 to apply.')
    return
  }

  const rows = newChunks.map(c => ({ bot_id: pilotId, title: c.title, content: c.content, metadata: c.metadata }))
  const { data: inserted, error: iErr } = await service
    .from('agent_knowledge_chunks')
    .insert(rows)
    .select('id, title, content')
  if (iErr) { console.error('[new] insert failed: ' + iErr.message); process.exit(1) }
  console.log('[new] inserted ' + (inserted?.length || 0) + ' new chunks')

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
          if (uErr) console.error('[embed] update failed: ' + uErr.message)
          else embedded++
        }
      }
      console.log('[embed] ' + Math.min(i + BATCH, inserted.length) + '/' + inserted.length)
    }
    console.log('[embed] done ' + embedded + '/' + inserted.length)
  }

  console.log('\n✔ pilot ready')
  console.log('   id:   ' + pilotId)
  console.log('   slug: ' + PILOT_SLUG)
  console.log('   url:  https://sentimetrx.com/b/' + PILOT_SLUG)
  console.log('\n   chat with the pilot; if dining answers look right, promote with the flip script.')
}

main().catch(e => { console.error(e); process.exit(1) })
