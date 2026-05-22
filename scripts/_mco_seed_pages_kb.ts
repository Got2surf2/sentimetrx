/* eslint-disable */
// Consume /tmp/mco_pages.json (output of _mco_scrape_pages.mjs) and seed
// AskAna's KB with one chunk per traveler info page (multi-part where a
// page is >2000 chars). Embeds with text-embedding-3-small.
//
// Idempotent: if chunks tagged with this SOURCE_TAG already exist, they're
// deleted first so re-running this script refreshes the page snapshots in
// place rather than duplicating them.
//
// Run:
//   DRY_RUN=1 node_modules/.bin/tsx scripts/_mco_seed_pages_kb.ts
//   node_modules/.bin/tsx scripts/_mco_seed_pages_kb.ts

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
const DATA_PATH = '/tmp/mco_pages.json'
const SOURCE_TAG = 'mco_pages_scrape_2026_05_22'
const MAX_CHUNK = 2000

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

type Block =
  | { type: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul' | 'ol'; items: string[] }
  | { type: 'dl'; items: { q: string; a: string }[] }
  | { type: 'table'; rows: string[] }

type Page = { url: string; title: string; blocks: Block[]; ok: boolean; error?: string }

function blockToText(b: Block): string {
  switch (b.type) {
    case 'h1': return '\n# ' + b.text + '\n'
    case 'h2': return '\n## ' + b.text + '\n'
    case 'h3': return '\n### ' + b.text + '\n'
    case 'h4':
    case 'h5':
    case 'h6': return '\n**' + b.text + '**\n'
    case 'p': return b.text + '\n'
    case 'ul': return b.items.map(i => '- ' + i).join('\n') + '\n'
    case 'ol': return b.items.map((i, n) => (n + 1) + '. ' + i).join('\n') + '\n'
    case 'dl': return b.items.map(qa => 'Q: ' + qa.q + '\nA: ' + qa.a).join('\n\n') + '\n'
    case 'table': return b.rows.join('\n') + '\n'
  }
}

// Build self-contained chunks from a page. If the page body is small,
// emit one chunk. Otherwise pack consecutive blocks into chunks under
// MAX_CHUNK chars, each prefixed with the page title + URL header.
function chunkPage(page: Page): { title: string; content: string; metadata: Record<string, any> }[] {
  const title = page.title || page.url
  const header = title + '\nSource: ' + page.url + '\n'

  // Render blocks to text. Pre-split any single block that's bigger than
  // MAX_CHUNK on sentence (then word) boundaries so no single chunk blows
  // past the embedding model's 8192-token cap.
  const rendered: string[] = []
  for (const block of page.blocks.map(blockToText)) {
    if (block.length <= MAX_CHUNK) {
      rendered.push(block)
      continue
    }
    // Sentence-aware split
    const sentences = block.split(/(?<=[.!?])\s+/)
    let buf = ''
    for (const s of sentences) {
      if (buf.length + s.length + 1 > MAX_CHUNK && buf.length > 0) {
        rendered.push(buf.trim())
        buf = ''
      }
      buf += (buf ? ' ' : '') + s
      // Sentence itself bigger than MAX_CHUNK — hard-split on whitespace
      while (buf.length > MAX_CHUNK) {
        const cut = buf.lastIndexOf(' ', MAX_CHUNK)
        const at = cut > MAX_CHUNK * 0.5 ? cut : MAX_CHUNK
        rendered.push(buf.slice(0, at).trim())
        buf = buf.slice(at).trim()
      }
    }
    if (buf.trim()) rendered.push(buf.trim())
  }
  // Greedy pack into chunks
  const groups: string[][] = [[]]
  let runningLen = header.length
  for (const t of rendered) {
    const cur = groups[groups.length - 1]
    if (runningLen + t.length > MAX_CHUNK && cur.length > 0) {
      groups.push([])
      runningLen = header.length
    }
    groups[groups.length - 1].push(t)
    runningLen += t.length
  }
  // Filter empty groups
  const filled = groups.filter(g => g.length > 0)
  if (filled.length === 0) return []

  return filled.map((group, idx) => {
    const suffix = filled.length > 1 ? ` (part ${idx + 1} of ${filled.length})` : ''
    return {
      title: title + suffix,
      content: header + (suffix ? '(' + (idx + 1) + ' / ' + filled.length + ')\n' : '') + '\n' + group.join('').trim() + '\n',
      metadata: {
        source: SOURCE_TAG,
        source_url: page.url,
        page_title: title,
        part: idx + 1,
        total_parts: filled.length,
      },
    }
  })
}

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('OPENAI_API_KEY missing')
  // text-embedding-3-small accepts up to 8192 tokens — roughly 28-32k chars.
  // We chunk to 2000 chars in chunkPage(), but a single oversized HTML block
  // (e.g. a long FAQ answer) can blow past that. Hard-cap to be safe.
  const SAFE_CHAR_LIMIT = 28_000
  const safe = texts.map(t => t.length > SAFE_CHAR_LIMIT ? t.slice(0, SAFE_CHAR_LIMIT) : t)
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'text-embedding-3-small', input: safe }),
  })
  if (!res.ok) throw new Error('Embeddings API ' + res.status + ': ' + await res.text())
  const data = await res.json()
  return data.data.map((d: any) => d.embedding as number[])
}

async function main() {
  const raw = JSON.parse(readFileSync(DATA_PATH, 'utf-8'))
  const pages: Page[] = raw.pages

  const ok = pages.filter(p => p.ok && p.blocks && p.blocks.length > 0)
  const failed = pages.filter(p => !p.ok || !p.blocks || p.blocks.length === 0)
  console.log('[load] ' + pages.length + ' pages → ' + ok.length + ' ok / ' + failed.length + ' empty-or-failed')
  if (failed.length > 0) {
    console.log('[load] failed pages:')
    for (const p of failed) console.log('  - ' + p.url + (p.error ? '  (' + p.error + ')' : '  (empty)'))
  }

  const chunks: { title: string; content: string; metadata: Record<string, any> }[] = []
  for (const p of ok) chunks.push(...chunkPage(p))

  console.log('[chunks] produced ' + chunks.length + ' chunks from ' + ok.length + ' pages')
  const sample = chunks.slice(0, 5)
  for (const c of sample) console.log('  - ' + c.title + ' (' + c.content.length + ' chars)')
  console.log('  ... (' + (chunks.length - sample.length) + ' more)')

  if (DRY_RUN) {
    console.log('\n--- DRY_RUN — first chunk preview ---\n')
    console.log(chunks[0]?.content || '(none)')
    console.log('\n[dry-run] skipping delete + insert + embed. Re-run without DRY_RUN=1 to apply.')
    return
  }

  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // 1. Delete existing chunks tagged with this source tag (idempotent refresh)
  const { data: existing, error: lErr } = await service
    .from('agent_knowledge_chunks')
    .select('id, title')
    .eq('bot_id', ASKANA_BOT_ID)
    .contains('metadata', { source: SOURCE_TAG })
  if (lErr) { console.error('[stale-list] failed: ' + lErr.message); process.exit(1) }
  if (existing && existing.length > 0) {
    console.log('[stale] found ' + existing.length + ' existing chunks with source=' + SOURCE_TAG + ' — deleting')
    const { error: dErr } = await service
      .from('agent_knowledge_chunks')
      .delete()
      .eq('bot_id', ASKANA_BOT_ID)
      .contains('metadata', { source: SOURCE_TAG })
    if (dErr) { console.error('[stale-delete] failed: ' + dErr.message); process.exit(1) }
    console.log('[stale] deleted ' + existing.length + ' chunks')
  } else {
    console.log('[stale] no prior chunks with source=' + SOURCE_TAG)
  }

  // 2. Insert new chunks
  const rows = chunks.map(c => ({ bot_id: ASKANA_BOT_ID, title: c.title, content: c.content, metadata: c.metadata }))
  const inserted: any[] = []
  const INS_BATCH = 100
  for (let i = 0; i < rows.length; i += INS_BATCH) {
    const slice = rows.slice(i, i + INS_BATCH)
    const { data, error } = await service.from('agent_knowledge_chunks').insert(slice).select('id, title, content')
    if (error) { console.error('[insert] failed at offset ' + i + ': ' + error.message); process.exit(1) }
    if (data) inserted.push(...data)
    console.log('[insert] ' + Math.min(i + INS_BATCH, rows.length) + '/' + rows.length)
  }
  console.log('[insert] total ' + inserted.length + ' chunks')

  // 3. Embed in batches of 50
  if (inserted.length > 0) {
    const BATCH = 50
    let embedded = 0
    for (let i = 0; i < inserted.length; i += BATCH) {
      const batch = inserted.slice(i, i + BATCH)
      const texts = batch.map(c => c.title + '\n' + c.content)
      const vecs = await embedBatch(texts)
      for (let j = 0; j < batch.length; j++) {
        if (vecs[j]) {
          const { error: uErr } = await service.from('agent_knowledge_chunks')
            .update({ embedding: JSON.stringify(vecs[j]) })
            .eq('id', batch[j].id)
          if (uErr) console.error('[embed] update failed for ' + batch[j].id + ': ' + uErr.message)
          else embedded++
        }
      }
      console.log('[embed] ' + Math.min(i + BATCH, inserted.length) + '/' + inserted.length)
    }
    console.log('[embed] done ' + embedded + '/' + inserted.length)
  }

  console.log('\n✔ KB update complete. ' + chunks.length + ' page chunks live, source=' + SOURCE_TAG)
}

main().catch(e => { console.error(e); process.exit(1) })
