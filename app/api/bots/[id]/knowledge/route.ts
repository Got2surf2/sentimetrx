// app/api/bots/[id]/knowledge/route.ts
// GET  — list all knowledge chunks for a bot
// POST — ingest text/markdown into chunks (splits by headings, stores with tsvector)
// DELETE — clear all knowledge chunks for a bot

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { generateEmbeddings } from '@/lib/embeddings'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { logBotChange } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

// ── GET: list chunks ──────────────────────────────────────────
export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org
  const userOrgId = (userData as any)?.org_id as string | null

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && (bot as any).org_id !== userOrgId) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }

  const { data: chunks } = await service
    .from('agent_knowledge_chunks')
    .select('id, title, content, metadata, created_at')
    .eq('bot_id', params.id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ chunks: chunks || [], count: chunks?.length || 0 })
}

// ── POST: ingest text → chunks ────────────────────────────────
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { text, source, source_type } = body as { text: string; source?: string; source_type?: string }
  if (!text || text.trim().length < 10) {
    return NextResponse.json({ error: 'text is required (min 10 chars)' }, { status: 400 })
  }

  // Verify bot ownership (admin-org bypass: platform admins can write cross-org)
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id, subject, opponents').eq('id', params.id).single()
  if (!bot || (!isAdmin && bot.org_id !== userData.org_id)) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }

  // Split text into chunks by markdown headings or double newlines
  const chunks = chunkText(text, source, source_type)

  if (chunks.length === 0) {
    return NextResponse.json({ error: 'No meaningful content found' }, { status: 400 })
  }

  // Dedup: fetch existing chunk contents for this bot to avoid duplicates
  const { data: existingChunks } = await service
    .from('agent_knowledge_chunks')
    .select('content')
    .eq('bot_id', params.id)

  const existingSet = new Set((existingChunks || []).map(function(c: any) { return c.content.trim() }))
  const deduped = chunks.filter(function(c) { return !existingSet.has(c.content.trim()) })

  if (deduped.length === 0) {
    return NextResponse.json({ stored: 0, skipped: chunks.length, message: 'All content already exists' })
  }

  // Insert chunks (tsvector is auto-populated by trigger)
  const rows = deduped.map(function(c) {
    return {
      bot_id: params.id,
      title: c.title,
      content: c.content,
      metadata: c.metadata,
    }
  })

  const { data: inserted, error } = await service.from('agent_knowledge_chunks').insert(rows).select('id, title, content')
  if (error) {
    return NextResponse.json({ error: 'Failed to store chunks: ' + error.message }, { status: 500 })
  }

  // Generate and store embeddings (non-blocking — chunks work without them via full-text fallback)
  if (inserted && inserted.length > 0) {
    try {
      const texts = inserted.map(function(c: any) { return c.title + '\n' + c.content })
      const embeddings = await generateEmbeddings(texts, bot.org_id)
      for (var i = 0; i < inserted.length; i++) {
        if (embeddings[i]) {
          await service.from('agent_knowledge_chunks')
            .update({ embedding: JSON.stringify(embeddings[i]) })
            .eq('id', (inserted[i] as any).id)
        }
      }
    } catch (e: any) {
      console.error({ at: 'knowledge', msg: "Embedding generation failed (chunks still usable)", err: e?.message })
    }

    // Sentiment + opponent classification
    const subject = (bot as any).subject
    const opponents = (bot as any).opponents
    const opponentNames = Array.isArray(opponents) ? opponents.map(function(o: any) { return typeof o === 'string' ? o : o.name || '' }).filter(Boolean) : []

    if ((subject && subject.trim()) || opponentNames.length > 0) {
      try {
        const batchSize = 20
        for (var b = 0; b < inserted.length; b += batchSize) {
          var batch = inserted.slice(b, b + batchSize)
          var chunkList = batch.map(function(c: any, idx: number) {
            var preview = (c.content || '').slice(0, 300)
            return (b + idx + 1) + '. [' + c.title + '] ' + preview
          }).join('\n')

          var classifyPrompt = 'For each numbered chunk, respond with the number followed by classifications.\n'
          if (subject && subject.trim()) {
            classifyPrompt += 'Sentiment toward "' + subject.trim() + '": positive, negative, or neutral.\n'
          }
          if (opponentNames.length > 0) {
            classifyPrompt += 'If the chunk is primarily about an opponent (' + opponentNames.join(', ') + '), include "opponent:<name>".\n'
          }
          classifyPrompt += '\nFormat per line: "1:neutral" or "1:negative,opponent:Smith"\nOne line per chunk. No explanations.'

          var result = await callAI({
            tier: 'fast',
            maxTokens: 300,
            timeoutMs: 15000,
            system: classifyPrompt,
            messages: [{ role: 'user', content: 'Chunks:\n' + chunkList }],
          })

          logUsage({ org_id: bot.org_id, resource_type: 'bot', resource_id: bot.id, event_type: 'knowledge_classify' }, result.usage)
          var lines = result.text.split('\n')
          for (var li = 0; li < lines.length; li++) {
            var line = lines[li].trim()
            var numMatch = line.match(/^(\d+)\s*:\s*(.+)/i)
            if (!numMatch) continue
            var chunkIdx = parseInt(numMatch[1]) - 1 - b
            if (chunkIdx < 0 || chunkIdx >= batch.length) continue

            var tags = numMatch[2].toLowerCase()
            var sentiment = /positive/.test(tags) ? 'positive' : /negative/.test(tags) ? 'negative' : 'neutral'
            var opponentMatch = tags.match(/opponent\s*:\s*([^,]+)/)
            var opponent = opponentMatch ? opponentMatch[1].trim() : undefined

            var chunkId = (batch[chunkIdx] as any).id
            var existingMeta = rows[b + chunkIdx]?.metadata || {}
            var updatedMeta: any = { ...existingMeta, sentiment }
            if (opponent) updatedMeta.opponent = opponent

            await service.from('agent_knowledge_chunks')
              .update({ metadata: updatedMeta })
              .eq('id', chunkId)
          }
        }
      } catch (e: any) {
        console.error({ at: 'knowledge', msg: "Classification failed (chunks still usable)", err: e?.message })
      }
    }
  }

  void logBotChange({
    botId: params.id,
    orgId: bot.org_id,
    actorId: user.id,
    actorEmail: user.email || null,
    action: 'knowledge_added',
    summary: 'Added ' + rows.length + ' knowledge chunk' + (rows.length === 1 ? '' : 's') + (source ? ' from "' + source + '"' : '') + (source_type ? ' (' + source_type + ')' : ''),
    metadata: { source, source_type, chunks_added: rows.length, chunks_skipped: chunks.length - rows.length },
  })

  return NextResponse.json({ stored: rows.length, chunks: chunks.map(function(c) { return { title: c.title, chars: c.content.length } }) })
}

// ── DELETE: clear chunks (all, or by source_type) ────────────
export async function DELETE(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org
  const userOrgId = (userData as any)?.org_id as string | null

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && (bot as any).org_id !== userOrgId) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const sourceType = url.searchParams.get('source_type')

  // Count what's about to disappear so the audit-log entry has a number.
  let countQ = service.from('agent_knowledge_chunks').select('id', { count: 'exact', head: true }).eq('bot_id', params.id)
  if (sourceType) countQ = countQ.contains('metadata', { source_type: sourceType })
  const { count: chunkCount } = await countQ

  let query = service.from('agent_knowledge_chunks').delete().eq('bot_id', params.id)

  if (sourceType) {
    // Delete only chunks tagged with this source_type
    query = query.contains('metadata', { source_type: sourceType })
  }

  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  void logBotChange({
    botId: params.id,
    orgId: (bot as any).org_id,
    actorId: user.id,
    actorEmail: user.email || null,
    action: 'knowledge_cleared',
    summary: 'Cleared ' + (chunkCount ?? 0) + ' knowledge chunk' + (chunkCount === 1 ? '' : 's') + (sourceType ? ' (source_type=' + sourceType + ')' : ' (all sources)'),
    metadata: { source_type: sourceType || null, chunks_removed: chunkCount ?? 0 },
  })

  return NextResponse.json({ cleared: true, source_type: sourceType || 'all', chunks_removed: chunkCount ?? 0 })
}

// ── Chunking logic ────────────────────────────────────────────
// Splits markdown/text by headings (## or ---) into titled sections.
// Falls back to paragraph-based splitting if no headings found.
function chunkText(text: string, source?: string, sourceType?: string): { title: string; content: string; metadata: Record<string, any> }[] {
  const lines = text.split('\n')
  const chunks: { title: string; content: string; metadata: Record<string, any> }[] = []
  let currentTitle = 'General'
  let currentLines: string[] = []
  const baseMeta: Record<string, any> = {}
  if (source) baseMeta.source = source
  if (sourceType) baseMeta.source_type = sourceType

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // Match markdown headings: ## Title or ### Title (skip # top-level — that's the doc title)
    const headingMatch = line.match(/^#{2,4}\s+(.+)/)
    // Match --- separator (at least 3 dashes on its own line)
    const isSeparator = /^-{3,}\s*$/.test(line)

    if (headingMatch || isSeparator) {
      // Flush previous chunk
      if (currentLines.length > 0) {
        const content = currentLines.join('\n').trim()
        if (content.length >= 20) {
          chunks.push({ title: currentTitle, content, metadata: { ...baseMeta } })
        }
      }
      currentTitle = headingMatch ? headingMatch[1].replace(/\*\*/g, '').trim() : 'General'
      currentLines = []
    } else {
      // Skip frontmatter lines
      if (/^---\s*$/.test(line) && i < 5) continue
      if (/^(name|description|type|originSessionId):/.test(line) && i < 10) continue
      currentLines.push(line)
    }
  }

  // Flush last chunk
  if (currentLines.length > 0) {
    const content = currentLines.join('\n').trim()
    if (content.length >= 20) {
      chunks.push({ title: currentTitle, content, metadata: { ...baseMeta } })
    }
  }

  // Sub-divide any chunks over 1500 chars into smaller pieces
  const MAX_CHUNK = 1500
  const subdivided: typeof chunks = []
  for (const chunk of chunks) {
    if (chunk.content.length <= MAX_CHUNK) {
      subdivided.push(chunk)
    } else {
      // Split by paragraphs, then combine into chunks under the limit
      const paras = chunk.content.split(/\n\n+/)
      let buf = ''
      let subIdx = 1
      for (const para of paras) {
        if (buf.length + para.length > MAX_CHUNK && buf.length > 0) {
          subdivided.push({ title: chunk.title + (subIdx > 1 ? ' (' + subIdx + ')' : ''), content: buf.trim(), metadata: { ...chunk.metadata } })
          subIdx++
          buf = ''
        }
        buf += (buf ? '\n\n' : '') + para
      }
      if (buf.trim().length >= 20) {
        subdivided.push({ title: chunk.title + (subIdx > 1 ? ' (' + subIdx + ')' : ''), content: buf.trim(), metadata: { ...chunk.metadata } })
      }
    }
  }
  if (subdivided.length > chunks.length) return subdivided

  // If only one giant chunk, try splitting by double newlines
  if (chunks.length <= 1 && text.length > 2000) {
    const paragraphs = text.split(/\n\n+/)
    const splitChunks: typeof chunks = []
    for (let i = 0; i < paragraphs.length; i++) {
      const para = paragraphs[i].trim()
      if (para.length < 20) continue
      // Use first line as title if it looks like a heading
      const firstLine = para.split('\n')[0]
      const title = firstLine.length < 80 ? firstLine.replace(/^#+\s*/, '').replace(/\*\*/g, '') : 'Section ' + (i + 1)
      splitChunks.push({ title, content: para, metadata: { ...baseMeta } })
    }
    if (splitChunks.length > 1) return splitChunks
  }

  return chunks
}
