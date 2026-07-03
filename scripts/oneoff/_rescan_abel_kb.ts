/* eslint-disable */
// One-off: re-crawl the Abel bot's training URLs (alexvindman.com + ashleymoody.com),
// replace bots.knowledge_base, drop and re-insert bot_knowledge_chunks with embeddings.
// Mirrors what the admin UI does on save (deep-crawl → KB update → chunk + embed).
// Run: node_modules/.bin/tsx scripts/_rescan_abel_kb.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) {
    // Strip surrounding quotes; also strip a trailing literal `\n` artifact
    // that ends up in some pasted secrets (the env file actually contains the
    // two characters `\` `n`, not a newline).
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
  }
}

import { createClient } from '@supabase/supabase-js'

const BOT_ID = '78991aa1-9aeb-4f30-9844-79d5fbb95fc1'
const TRAINING_URLS = ['https://alexvindman.com', 'https://ashleymoody.com']
const MAX_PAGES = 30
const MAX_TEXT_PER_PAGE = 30000
const CRAWL_TIMEOUT = 15000
const MAX_CHUNK = 1500

// ── HTML → text (matches app/api/bots/deep-crawl/route.ts) ─────
function htmlToText(html: string): string {
  let text = html
    .replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4[^>]*>(.*?)<\/h4>/gi, '\n#### $1\n')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#\d+;/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim()
  if (text.length > MAX_TEXT_PER_PAGE) text = text.slice(0, MAX_TEXT_PER_PAGE)
  return text
}

function extractLinks(html: string, baseUrl: URL): string[] {
  const links: string[] = []
  const seen = new Set<string>()
  const re = /href=["']([^"'#]+)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html)) !== null) {
    try {
      const resolved = new URL(match[1], baseUrl.origin)
      if (resolved.hostname !== baseUrl.hostname) continue
      if (/\.(pdf|jpg|jpeg|png|gif|svg|css|js|zip|mp4|mp3|doc|xls|pptx?)$/i.test(resolved.pathname)) continue
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue
      // Skip WP feeds/json/xmlrpc cruft
      if (/\/(feed|wp-json|xmlrpc|wp-content|wp-includes|wp-admin)/i.test(resolved.pathname)) continue
      const normalized = resolved.origin + resolved.pathname.replace(/\/+$/, '')
      if (!seen.has(normalized)) { seen.add(normalized); links.push(normalized) }
    } catch {}
  }
  return links
}

async function crawlSite(rootUrl: string, budget: number): Promise<{ url: string; title: string; text: string }[]> {
  const base = new URL(rootUrl)
  const visited = new Set<string>()
  const pages: { url: string; title: string; text: string }[] = []
  const queue: string[] = [base.origin + base.pathname.replace(/\/+$/, '')]

  while (queue.length > 0 && pages.length < budget) {
    const current = queue.shift()!
    if (visited.has(current)) continue
    visited.add(current)
    try {
      const res = await fetch(current, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Datanautix Abel KB Rescan/1.0)', 'Accept': 'text/html' },
        signal: AbortSignal.timeout(CRAWL_TIMEOUT),
        redirect: 'follow',
      })
      if (!res.ok) { console.log('  skip ' + res.status + ' ' + current); continue }
      const ct = res.headers.get('content-type') || ''
      if (!ct.includes('html') && !ct.includes('text')) continue
      const html = await res.text()
      const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i)
      const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : current
      const text = htmlToText(html)
      if (text.length < 50) { console.log('  thin ' + current); continue }
      pages.push({ url: current, title, text })
      console.log('  ok   ' + pages.length + '/' + budget + '  ' + title.slice(0, 60))
      const links = extractLinks(html, base)
      for (const l of links) {
        if (!visited.has(l) && pages.length + queue.length < budget * 2) queue.push(l)
      }
    } catch (e: any) {
      console.log('  err  ' + current + ' :: ' + (e?.message || e))
    }
  }
  return pages
}

// ── Chunking (matches app/api/bots/[id]/knowledge/route.ts) ────
function chunkText(text: string, baseMeta: Record<string, any>): { title: string; content: string; metadata: Record<string, any> }[] {
  const lines = text.split('\n')
  const chunks: { title: string; content: string; metadata: Record<string, any> }[] = []
  let currentTitle = 'General'
  let currentLines: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const headingMatch = line.match(/^#{2,4}\s+(.+)/)
    const isSeparator = /^-{3,}\s*$/.test(line)
    if (headingMatch || isSeparator) {
      if (currentLines.length > 0) {
        const content = currentLines.join('\n').trim()
        if (content.length >= 20) chunks.push({ title: currentTitle, content, metadata: { ...baseMeta } })
      }
      currentTitle = headingMatch ? headingMatch[1].replace(/\*\*/g, '').trim() : 'General'
      currentLines = []
    } else {
      if (/^---\s*$/.test(line) && i < 5) continue
      currentLines.push(line)
    }
  }
  if (currentLines.length > 0) {
    const content = currentLines.join('\n').trim()
    if (content.length >= 20) chunks.push({ title: currentTitle, content, metadata: { ...baseMeta } })
  }
  // Subdivide oversize chunks
  const out: typeof chunks = []
  for (const c of chunks) {
    if (c.content.length <= MAX_CHUNK) { out.push(c); continue }
    const paras = c.content.split(/\n\n+/)
    let buf = ''; let subIdx = 1
    for (const p of paras) {
      if (buf.length + p.length > MAX_CHUNK && buf.length > 0) {
        out.push({ title: c.title + (subIdx > 1 ? ' (' + subIdx + ')' : ''), content: buf.trim(), metadata: { ...c.metadata } })
        subIdx++; buf = ''
      }
      buf += (buf ? '\n\n' : '') + p
    }
    if (buf.trim().length >= 20) out.push({ title: c.title + (subIdx > 1 ? ' (' + subIdx + ')' : ''), content: buf.trim(), metadata: { ...c.metadata } })
  }
  return out
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
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  // Crawl
  const allSections: string[] = []
  for (const url of TRAINING_URLS) {
    console.log('\n[crawl] ' + url)
    const pages = await crawlSite(url, MAX_PAGES)
    console.log('  → ' + pages.length + ' pages')
    for (const p of pages) {
      const heading = p.title.replace(/\s*[\|–—]\s*.+$/, '').replace(/\s*-\s*$/, '').trim() || 'Page'
      allSections.push('## ' + heading + '\nSource: ' + p.url + '\n\n' + p.text)
    }
  }

  if (allSections.length === 0) { console.error('No pages crawled — aborting.'); process.exit(1) }

  const knowledgeBase = '# Deep Crawl Knowledge Base\n\n' + allSections.join('\n\n---\n\n')
  console.log('\n[kb] total ' + knowledgeBase.length.toLocaleString() + ' chars across ' + allSections.length + ' page sections')

  // Update bot.knowledge_base + training_urls (normalize to https://)
  const { error: upErr } = await service.from('bots').update({
    knowledge_base: knowledgeBase,
    training_urls: TRAINING_URLS,
    updated_at: new Date().toISOString(),
  }).eq('id', BOT_ID)
  if (upErr) { console.error('Bot update failed: ' + upErr.message); process.exit(1) }
  console.log('[db] bots.knowledge_base updated')

  // Drop existing chunks
  const { error: delErr } = await service.from('bot_knowledge_chunks').delete().eq('bot_id', BOT_ID)
  if (delErr) { console.error('Chunk delete failed: ' + delErr.message); process.exit(1) }
  console.log('[db] dropped existing chunks')

  // Chunk + insert
  const chunks = chunkText(knowledgeBase, { source: 'deep_crawl', source_type: 'website', rescanned_at: new Date().toISOString() })
  console.log('[chunks] produced ' + chunks.length + ' chunks')

  const rows = chunks.map(c => ({ bot_id: BOT_ID, title: c.title, content: c.content, metadata: c.metadata }))
  const { data: inserted, error: insErr } = await service.from('bot_knowledge_chunks').insert(rows).select('id, title, content')
  if (insErr) { console.error('Chunk insert failed: ' + insErr.message); process.exit(1) }
  console.log('[db] inserted ' + (inserted?.length || 0) + ' chunks')

  // Embed in batches of 50
  if (inserted && inserted.length > 0) {
    const BATCH = 50
    let embedded = 0
    for (let i = 0; i < inserted.length; i += BATCH) {
      const batch = inserted.slice(i, i + BATCH)
      const texts = batch.map((c: any) => c.title + '\n' + c.content)
      const vecs = await embedBatch(texts)
      for (let j = 0; j < batch.length; j++) {
        if (vecs[j]) {
          const { error: uErr } = await service.from('bot_knowledge_chunks')
            .update({ embedding: JSON.stringify(vecs[j]) })
            .eq('id', (batch[j] as any).id)
          if (uErr) console.error('Embed update failed: ' + uErr.message)
          else embedded++
        }
      }
      console.log('[embed] ' + Math.min(i + BATCH, inserted.length) + '/' + inserted.length)
    }
    console.log('[embed] done ' + embedded + '/' + inserted.length)
  }

  console.log('\n✔ rescan complete')
}

main().catch(e => { console.error(e); process.exit(1) })
