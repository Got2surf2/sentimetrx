// app/api/bots/research/route.ts
// POST — research a person/org/topic: SERP search → fetch pages → keep full text
// Returns full page content structured for RAG chunking (no AI compression)

import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { searchGoogle } from '@/lib/dataforseo'
import { safeFetch } from '@/lib/safeFetch'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Reuse the same HTML-to-text extraction as fetch-url
function extractText(html: string): string {
  return html
    .replace(/<(script|style|nav|header|footer|noscript)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { query } = body
  if (!query || typeof query !== 'string' || query.trim().length < 2) {
    return NextResponse.json({ error: 'Query is required' }, { status: 400 })
  }

  try {
    // Step 1: Search Google for top results
    const results = await searchGoogle(query.trim(), 10)
    if (results.length === 0) {
      return NextResponse.json({ error: 'No search results found for "' + query + '"' }, { status: 404 })
    }

    // Step 2: Fetch full content from top pages (up to 10)
    const pagesToFetch = results.slice(0, 10)
    const pageContents: { url: string; title: string; text: string }[] = []

    await Promise.all(pagesToFetch.map(async (r) => {
      try {
        // safeFetch — SERP results are external by definition, but a
        // poisoned result pointing at an internal address would let an
        // attacker exfil metadata via this endpoint.
        const res = await safeFetch(r.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Datanautix Bot Trainer/1.0)',
            'Accept': 'text/html,application/xhtml+xml,text/plain',
          },
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) return
        const html = await res.text()
        let text = extractText(html)
        // Keep up to 30K per page — full detail for RAG chunking
        if (text.length > 30000) text = text.slice(0, 30000)
        if (text.length > 200) {
          pageContents.push({ url: r.url, title: r.title, text })
        }
      } catch {
        // Skip failed fetches
      }
    }))

    if (pageContents.length === 0) {
      // Fall back to SERP snippets if all fetches failed
      const snippetText = results.map(function(r) {
        return '## ' + r.title + '\nSource: ' + r.url + '\n\n' + r.description
      }).join('\n\n---\n\n')
      return NextResponse.json({
        knowledge: '# Research: ' + query + '\n\n' + snippetText,
        sources: results.map(r => r.url),
        source_count: results.length,
        note: 'From search snippets only (page fetches failed)',
      })
    }

    // Build structured full-text knowledge base — no AI compression
    const sections = pageContents.map(function(p) {
      var heading = p.title
        .replace(/\s*[\|–—]\s*.+$/, '')
        .replace(/\s*-\s*$/, '')
        .trim() || 'Page'
      return '## ' + heading + '\nSource: ' + p.url + '\n\n' + p.text
    })

    const fullText = '# Research: ' + query + '\n\n' + sections.join('\n\n---\n\n')

    return NextResponse.json({
      knowledge: fullText,
      sources: pageContents.map(p => p.url),
      source_count: pageContents.length,
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Research failed: ' + (err.message || 'unknown error') }, { status: 500 })
  }
}
