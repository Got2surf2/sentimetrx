/* eslint-disable */
// NEPA — ingest extracted DEIS text into the Blue Mountains agent's knowledgebase.
// Section-aware chunking + quality filter (drops table-garble) + OpenAI embeddings,
// loaded into agent_knowledge_chunks under a removable metadata.source tag so it
// sits alongside — and can be cleared without touching — the 28 curated chunks.
// This is the step-0 proof: point it at a chapter or the whole DEIS, then re-run
// the answerability test to measure the lift.
//
// Extract first:  pdftotext deis.pdf deis.txt
// Run: node --import tsx scripts/oneoff/_nepa_deis_ingest.ts <deis.txt> [--prod] [--tag deis_2026] [--max N]

import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const mm = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}
import { createClient } from '@supabase/supabase-js'

const PROD = process.argv.includes('--prod')
const BOT_ID = PROD ? '5845cdb8-f33e-4a2e-9500-5ed0b37e471c' : '71f8e700-0502-46be-b342-0a032daf03eb'
const tagIdx = process.argv.indexOf('--tag'); const TAG = tagIdx >= 0 ? process.argv[tagIdx + 1] : 'deis_2026'
const maxIdx = process.argv.indexOf('--max'); const MAX = maxIdx >= 0 ? parseInt(process.argv[maxIdx + 1]) : Infinity
const TARGET_WORDS = 800

// A heading line: short, no terminal period, and looks like a chapter/section or Title Case / CAPS.
function isHeading(line: string): boolean {
  const t = line.trim()
  if (t.length < 4 || t.length > 90) return false
  if (/[.!?]$/.test(t)) return false
  if (/^(chapter|section|appendix|part)\b/i.test(t)) return true
  if (/^\d+(\.\d+)*\s+[A-Z]/.test(t)) return true            // "3.2 Recreation"
  const letters = t.replace(/[^A-Za-z]/g, '')
  if (letters.length > 3 && letters === letters.toUpperCase()) return true  // ALL CAPS
  return false
}

// Keep a chunk only if it's mostly real prose (drops interleaved-table garble).
function isQuality(text: string): boolean {
  if (text.length < 220) return false
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length < 40) return false
  const alpha = words.filter(w => /^[A-Za-z][A-Za-z'-]{2,}$/.test(w)).length
  return alpha / words.length >= 0.6
}

function chunkText(raw: string): { title: string; content: string }[] {
  const lines = raw.split('\n')
  const chunks: { title: string; content: string }[] = []
  let heading = 'Blue Mountains Draft EIS', buf: string[] = [], words = 0
  const flush = () => {
    const content = buf.join(' ').replace(/\s+/g, ' ').trim()
    if (content) chunks.push({ title: heading, content })
    buf = []; words = 0
  }
  for (const line of lines) {
    if (isHeading(line)) { flush(); heading = line.trim().slice(0, 90); continue }
    const t = line.trim(); if (!t) continue
    buf.push(t); words += t.split(/\s+/).length
    if (words >= TARGET_WORDS) flush()
  }
  flush()
  return chunks
}

async function embedBatch(texts: string[]): Promise<(number[] | null)[]> {
  const key = process.env.OPENAI_API_KEY!.replace(/\\n$/, '').trim()
  const out: (number[] | null)[] = []
  for (let i = 0; i < texts.length; i += 100) {
    const safe = texts.slice(i, i + 100).map(t => t.slice(0, 6000) || ' ')
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: safe }),
    })
    if (!res.ok) throw new Error('openai ' + res.status + ': ' + (await res.text()).slice(0, 160))
    const data = await res.json()
    out.push(...data.data.map((d: any) => d.embedding as number[]))
    process.stdout.write(`  …embedded ${Math.min(i + 100, texts.length)}/${texts.length}\r`)
  }
  return out
}

async function main() {
  const url = PROD ? process.env.NEXT_PUBLIC_SUPABASE_URL! : process.env.SUPABASE_TEST_URL!
  const key = PROD ? process.env.SUPABASE_SERVICE_ROLE_KEY! : process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!
  const service = createClient(url, key, { auth: { persistSession: false } })

  const raw = readFileSync(process.argv[2], 'utf-8')
  let chunks = chunkText(raw).filter(c => isQuality(c.content))
  const before = chunks.length
  chunks = chunks.slice(0, MAX === Infinity ? chunks.length : MAX)
  console.log(`[chunk] ${before} quality chunks from ${raw.length} chars → ingesting ${chunks.length} (tag=${TAG}, ${PROD ? 'PROD' : 'TEST'} bot ${BOT_ID})`)
  if (!chunks.length) { console.error('no chunks'); process.exit(1) }

  const { data: prior } = await service.from('agent_knowledge_chunks').select('id').eq('bot_id', BOT_ID).contains('metadata', { source: TAG })
  if (prior?.length) { await service.from('agent_knowledge_chunks').delete().eq('bot_id', BOT_ID).contains('metadata', { source: TAG }); console.log('[chunks] cleared', prior.length, 'prior') }

  const rows = chunks.map((c, i) => ({ bot_id: BOT_ID, title: c.title, content: c.content, metadata: { source: TAG, section: c.title, idx: i } }))
  // Insert in batches to stay under payload limits.
  const inserted: { id: string; title: string; content: string }[] = []
  for (let i = 0; i < rows.length; i += 200) {
    const { data, error } = await service.from('agent_knowledge_chunks').insert(rows.slice(i, i + 200)).select('id, title, content')
    if (error) { console.error('[chunks] insert failed:', error.message); process.exit(1) }
    inserted.push(...(data as any))
  }
  console.log('[chunks] inserted', inserted.length)

  const vecs = await embedBatch(inserted.map(c => c.title + '\n' + c.content))
  let embedded = 0
  for (let j = 0; j < inserted.length; j++) {
    if (vecs[j]) { const { error } = await service.from('agent_knowledge_chunks').update({ embedding: JSON.stringify(vecs[j]) }).eq('id', inserted[j].id); if (!error) embedded++ }
  }
  console.log(`\n[embed] done ${embedded}/${inserted.length}`)
  console.log(`✔ ingested tag=${TAG}. Clear with: DELETE where metadata.source='${TAG}'. Re-run answerability to measure lift.`)
}
main().catch(e => { console.error(e); process.exit(1) })
