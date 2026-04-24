// app/api/bots/research/route.ts
// POST — research a person/org/topic: SERP search → fetch pages → AI summary
// Returns a concise, structured knowledge base ready for bot consumption

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { searchGoogle } from '@/lib/dataforseo'
import { callAI } from '@/lib/ai'

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
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
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

    // Step 2: Fetch content from top pages (cap at 6 to stay within time budget)
    const pagesToFetch = results.slice(0, 6)
    const pageContents: { url: string; title: string; text: string }[] = []

    await Promise.all(pagesToFetch.map(async (r) => {
      try {
        const res = await fetch(r.url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; Datanautix Bot Trainer/1.0)',
            'Accept': 'text/html,application/xhtml+xml,text/plain',
          },
          signal: AbortSignal.timeout(8000),
        })
        if (!res.ok) return
        const html = await res.text()
        let text = extractText(html)
        // Cap each page at 8K chars to keep total manageable
        if (text.length > 8000) text = text.slice(0, 8000)
        if (text.length > 200) {
          pageContents.push({ url: r.url, title: r.title, text })
        }
      } catch {
        // Skip failed fetches
      }
    }))

    if (pageContents.length === 0) {
      // Fall back to SERP snippets if all fetches failed
      const snippetText = results.map(r => r.title + ': ' + r.description).join('\n\n')
      const fallbackResult = await callAI({
        tier: 'fast',
        maxTokens: 1500,
        timeoutMs: 30000,
        system: 'You are a research assistant. Summarize the following search results into a structured knowledge base about "' + query + '". Include key facts, background, notable achievements, and relevant details. Be factual and concise. Use bullet points and clear sections.',
        messages: [{ role: 'user', content: 'Search results:\n\n' + snippetText }],
      })
      return NextResponse.json({
        knowledge: fallbackResult.text,
        sources: results.map(r => r.url),
        source_count: results.length,
        note: 'Generated from search snippets (page fetches failed)',
      })
    }

    // Step 3: AI summarization — condense all page content into a structured knowledge base
    const combinedContent = pageContents.map(p =>
      '--- SOURCE: ' + p.url + ' ---\n' + p.title + '\n' + p.text
    ).join('\n\n')

    // Cap total content sent to AI
    const trimmedContent = combinedContent.length > 40000
      ? combinedContent.slice(0, 40000) + '\n\n[Content truncated]'
      : combinedContent

    const aiResult = await callAI({
      tier: 'fast',
      maxTokens: 2000,
      timeoutMs: 30000,
      system: `You are a research assistant creating a knowledge base for an AI agent about "${query}".

Synthesize the source material into a comprehensive but concise reference document. Structure it with clear sections:

- **Background** — who/what they are, key facts
- **Key Positions & Views** — notable stances, policies, or offerings
- **Career/History** — timeline of major milestones
- **Public Presence** — media, publications, social media, notable quotes
- **Other Notable Facts** — anything else relevant

Rules:
- Be factual, cite specifics (dates, numbers, titles)
- Remove marketing fluff, navigation text, and irrelevant content
- Keep it under 2000 words — this will be loaded on every chat message, so conciseness matters
- Use bullet points for scannability
- If sources conflict, note the discrepancy`,
      messages: [{ role: 'user', content: 'Source material:\n\n' + trimmedContent }],
    })

    return NextResponse.json({
      knowledge: aiResult.text,
      sources: pageContents.map(p => p.url),
      source_count: pageContents.length,
    })
  } catch (err: any) {
    return NextResponse.json({ error: 'Research failed: ' + (err.message || 'unknown error') }, { status: 500 })
  }
}
