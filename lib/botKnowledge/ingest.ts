// lib/botKnowledge/ingest.ts
// Shared knowledge-ingest core, extracted from POST /api/bots/[id]/knowledge so
// the resumable super crawl (P2d) and the weekly re-crawl cron (P2e) reuse the
// EXACT same chunk→embed→near-dup→budget→insert→classify path — no duplication,
// no drift. Behavior is byte-for-byte what the route did (P2b); the route's
// knowledgeDedupBudget / D2 / D3 tests guard this move.

import 'server-only'
import type { createServiceRoleClient } from '@/lib/supabase/server'
import { generateEmbeddings } from '@/lib/embeddings'
import { resolveCapability } from '@/lib/agentCapability'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { logBotChange } from '@/lib/auditLog'
import { chunkText } from '@/lib/botKnowledge/chunkText'

type ServiceClient = ReturnType<typeof createServiceRoleClient>
type InsertedChunk = { id: string; title: string; content: string }

export interface IngestBot {
  id: string
  org_id: string
  subject?: string | null
  opponents?: Array<string | { name?: string }> | null
  capability?: string | null
  capability_config?: Record<string, unknown> | null
}

export interface IngestOpts {
  source?: string
  sourceType?: string
  replace?: boolean
  actor?: { id: string; email: string | null }
}

export interface IngestResult {
  stored: number
  removed: number
  near_dup_skipped: number
  budget_skipped: number
  skipped?: number
  message?: string
  chunks?: { title: string; chars: number }[]
}

/** Thrown when the chunk INSERT fails; the caller maps it to a 5xx. */
export class KnowledgeInsertError extends Error {
  constructor(public cause: unknown) { super('knowledge insert failed') }
}

const NEAR_DUP_SIM = 0.95

// Background bulk sources write chunks the editor's knowledge textarea never
// holds (the super-crawl job P2d, the re-crawl cron P2e). A D3 editor save
// (replace:true) posts only authored content (textarea + FAQ + facts +
// opponents) and would otherwise prune these — so replace-mode pruning SKIPS
// any chunk tagged with a protected source_type. (The standard /deep-crawl and
// document upload append to the textarea, so their content IS in the save
// payload and is correctly managed by replace.)
const REPLACE_PROTECTED_SOURCE_TYPES = new Set(['deep-crawl', 're-crawl'])

function isProtectedFromReplace(metadata: unknown): boolean {
  const st = (metadata as { source_type?: string } | null)?.source_type
  return typeof st === 'string' && REPLACE_PROTECTED_SOURCE_TYPES.has(st)
}

/**
 * Ingest free text into an agent's knowledge base. `replace: true` = the D3
 * diff-upsert of the WHOLE KB (editor save); default = append (crawl / research
 * / fetch-url / document). Returns counts; throws KnowledgeInsertError if the
 * insert fails (so an append caller can surface a partial/failed batch).
 */
export async function ingestKnowledgeText(service: ServiceClient, bot: IngestBot, text: string, opts: IngestOpts = {}): Promise<IngestResult> {
  const { source, sourceType, replace } = opts
  const chunks = chunkText(text, source, sourceType)
  if (chunks.length === 0) {
    return { stored: 0, removed: 0, near_dup_skipped: 0, budget_skipped: 0, message: 'No meaningful content found' }
  }

  // Dedup: fetch existing chunk contents for this bot to avoid exact duplicates.
  const { data: existingChunks } = await service
    .from('agent_knowledge_chunks')
    .select('id, content, metadata')
    .eq('bot_id', bot.id)

  const existingSet = new Set((existingChunks || []).map(function(c: { content: string }) { return c.content.trim() }))
  const deduped = chunks.filter(function(c) { return !existingSet.has(c.content.trim()) })

  // D3 replace: prune only chunks whose content is gone, AFTER the new ones
  // land — but NEVER prune background bulk-source chunks (super-crawl / re-crawl
  // cron) that the editor's authored payload doesn't contain by design.
  const incomingSet = new Set(chunks.map(function(c) { return c.content.trim() }))
  const staleIds = replace
    ? (existingChunks || []).filter(function(c: { id: string; content: string; metadata?: unknown }) { return !incomingSet.has(c.content.trim()) && !isProtectedFromReplace(c.metadata) }).map(function(c: { id: string }) { return c.id })
    : []

  async function pruneStale() {
    if (staleIds.length === 0) return
    const { error: delErr } = await service.from('agent_knowledge_chunks').delete().in('id', staleIds).eq('bot_id', bot.id)
    if (delErr) console.error({ at: 'knowledge', msg: 'replace prune failed (new chunks already stored)', err: delErr.message })
  }

  if (deduped.length === 0) {
    await pruneStale()
    return { stored: 0, skipped: chunks.length, removed: staleIds.length, near_dup_skipped: 0, budget_skipped: 0, message: staleIds.length ? 'Removed ' + staleIds.length + ' stale chunk(s); rest unchanged' : 'All content already exists' }
  }

  // Embed candidates BEFORE insert (stored in the same INSERT), enabling the
  // near-dup guard + chunk budget. Embedding failure → lexical-only chunks.
  const capKnobs = resolveCapability(bot)
  let candEmbeddings: (number[] | null)[]
  try {
    candEmbeddings = await generateEmbeddings(deduped.map(function(c) { return c.title + '\n' + c.content }), bot.org_id)
  } catch (e: unknown) {
    console.error({ at: 'knowledge', msg: 'candidate embedding failed (proceeding lexical-only)', err: e instanceof Error ? e.message : undefined })
    candEmbeddings = deduped.map(function() { return null })
  }

  // Near-dup guard — APPEND path only (cosine ≥ 0.95, sql/135).
  let nearDupSkipped = 0
  let survivorIdx = deduped.map(function(_c, j) { return j })
  if (!replace) {
    const sims = await Promise.all(deduped.map(async function(_c, j): Promise<number> {
      const emb = candEmbeddings[j]
      if (!emb) return 0
      try {
        const r = await service.rpc('match_agent_knowledge_embedding', { p_bot_id: bot.id, p_embedding: JSON.stringify(emb), p_exclude_id: null, p_limit: 1 }) as { data: Array<{ similarity: number }> | null }
        return Array.isArray(r.data) && r.data[0] ? r.data[0].similarity : 0
      } catch { return 0 }
    }))
    survivorIdx = survivorIdx.filter(function(j) { return sims[j] < NEAR_DUP_SIM })
    nearDupSkipped = deduped.length - survivorIdx.length
  }

  // Chunk budget: keep the agent's total under its budget (2K std / 5K super).
  const remainingExisting = (existingChunks?.length || 0) - staleIds.length
  const budgetRoom = Math.max(0, capKnobs.chunkBudget - remainingExisting)
  const budgetSkipped = Math.max(0, survivorIdx.length - budgetRoom)
  survivorIdx = survivorIdx.slice(0, budgetRoom)

  if (survivorIdx.length === 0) {
    await pruneStale()
    return { stored: 0, skipped: chunks.length, removed: staleIds.length, near_dup_skipped: nearDupSkipped, budget_skipped: budgetSkipped, message: 'No new chunks stored (duplicates or chunk budget reached)' }
  }

  const rows = survivorIdx.map(function(j) {
    const c = deduped[j]
    return {
      bot_id: bot.id,
      title: c.title,
      content: c.content,
      metadata: c.metadata,
      embedding: candEmbeddings[j] ? JSON.stringify(candEmbeddings[j]) : null,
    }
  })

  const { data: inserted, error } = await service.from('agent_knowledge_chunks').insert(rows).select('id, title, content')
  if (error) {
    // Insert failed — do NOT prune. The old KB is left fully intact.
    throw new KnowledgeInsertError(error)
  }

  await pruneStale()

  if (inserted && inserted.length > 0) {
    const subject = bot.subject
    const opponents = bot.opponents
    const opponentNames = Array.isArray(opponents) ? opponents.map(function(o: string | { name?: string }) { return typeof o === 'string' ? o : o.name || '' }).filter(Boolean) : []

    if ((subject && subject.trim()) || opponentNames.length > 0) {
      try {
        const batchSize = 20
        for (var b = 0; b < inserted.length; b += batchSize) {
          var batch = inserted.slice(b, b + batchSize)
          var chunkList = batch.map(function(c: InsertedChunk, idx: number) {
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

            var chunkId = (batch[chunkIdx] as InsertedChunk).id
            var existingMeta = rows[b + chunkIdx]?.metadata || {}
            var updatedMeta: Record<string, unknown> = { ...existingMeta, sentiment }
            if (opponent) updatedMeta.opponent = opponent

            await service.from('agent_knowledge_chunks')
              .update({ metadata: updatedMeta })
              .eq('id', chunkId)
          }
        }
      } catch (e: unknown) {
        console.error({ at: 'knowledge', msg: "Classification failed (chunks still usable)", err: e instanceof Error ? e.message : undefined })
      }
    }
  }

  if (opts.actor) {
    void logBotChange({
      botId: bot.id,
      orgId: bot.org_id,
      actorId: opts.actor.id,
      actorEmail: opts.actor.email,
      action: 'knowledge_added',
      summary: 'Added ' + rows.length + ' knowledge chunk' + (rows.length === 1 ? '' : 's') + (source ? ' from "' + source + '"' : '') + (sourceType ? ' (' + sourceType + ')' : ''),
      metadata: { source, source_type: sourceType, chunks_added: rows.length, chunks_skipped: chunks.length - rows.length },
    })
  }

  return { stored: rows.length, removed: staleIds.length, near_dup_skipped: nearDupSkipped, budget_skipped: budgetSkipped, chunks: chunks.map(function(c) { return { title: c.title, chars: c.content.length } }) }
}
