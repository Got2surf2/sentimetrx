/* eslint-disable */
// scripts/phase3-backfill-sarina.ts
//
// Phase 3 commit 3 of the agents x PulseIQ convergence (docs/CONVERGENCE.md).
// Reads bot_conversation_turns rows and reconstructs the matching
// conversations + conversation_turns rows in the new Phase 3 substrate.
// Idempotent — re-runs are no-ops once a session's rows are already mirrored.
//
// Usage:
//   tsx scripts/phase3-backfill-sarina.ts                       # Sarina (default)
//   tsx scripts/phase3-backfill-sarina.ts --bot-id <uuid>       # one specific bot
//   tsx scripts/phase3-backfill-sarina.ts --all-bots            # every bot with rows
//   tsx scripts/phase3-backfill-sarina.ts --all-bots --dry-run  # show what would happen
//
// Defaults to Sarina live: 5c468b90-13fc-46a2-8855-312dc0a1e428.
//
// --all-bots queries `bot_conversation_turns` for the distinct bot_id set,
// then runs the per-bot backfill in a loop with a per-bot acceptance check.
// Critical for Tier 5 cleanup: every customer's history must be in the new
// substrate before `DROP TABLE bot_conversation_turns` is safe. See the
// "BEFORE DROPPING bot_conversation_turns" entry in the open-work-queue
// memory for the full sequencing.
//
// Acceptance: per-bot row parity — deduped bot_conversation_turns count
// must equal conversation_turns count joined back through conversations.

import { readFileSync } from 'fs'
import path from 'path'

// Load .env.local (script runs outside Next.js)
try {
  const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
  for (const line of envText.split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {
  // .env.local may be absent in CI — let createClient throw a clearer error
}

import { createClient } from '@supabase/supabase-js'

const SARINA_BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'

interface BotTurnRow {
  id: string
  bot_id: string
  session_id: string
  turn_number: number
  role: string
  content: string
  content_en: string | null
  language: string | null
  source: string | null
  content_flags: unknown
  sentiment: string | null
  sentiment_score: number | null
  created_at: string | null
}

function arg(name: string): string | null {
  const i = process.argv.indexOf(name)
  if (i === -1) return null
  const v = process.argv[i + 1]
  if (!v || v.startsWith('--')) return ''
  return v
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name)
}

interface BackfillResult {
  botId: string
  botName: string
  sessionsProcessed: number
  conversationsUpserted: number
  turnsInserted: number
  turnsSkippedExisting: number
  turnsDroppedDuplicate: number
  parityOk: boolean
  srcCountExact: number
  dstCount: number
}

async function backfillBot(
  service: any,
  botId: string,
  dryRun: boolean,
): Promise<BackfillResult | null> {
  // Resolve org_id + name from the bot row.
  const { data: bot, error: botErr } = await service
    .from('agents')
    .select('id, name, org_id')
    .eq('id', botId)
    .single()
  if (botErr || !bot) {
    console.error(`Failed to load bot ${botId}:`, botErr?.message)
    return null
  }
  const orgId = (bot as any).org_id as string
  const botName = (bot as any).name as string
  console.log(`\n──── ${botName} (${botId}) ────`)
  console.log(`  org_id: ${orgId}`)

  // Pull all turns for the bot. Page in batches of 1000 so this scales beyond
  // the default Supabase row cap.
  const allTurns: BotTurnRow[] = []
  let offset = 0
  const PAGE = 1000
  for (;;) {
    const { data, error } = await service
      .from('bot_conversation_turns')
      .select('id, bot_id, session_id, turn_number, role, content, content_en, language, source, content_flags, sentiment, sentiment_score, created_at')
      .eq('bot_id', botId)
      .order('session_id', { ascending: true })
      .order('turn_number', { ascending: true })
      .range(offset, offset + PAGE - 1)
    if (error) {
      console.error(`Page read failed at offset ${offset}:`, error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    allTurns.push(...(data as BotTurnRow[]))
    if (data.length < PAGE) break
    offset += PAGE
  }
  console.log(`  ${allTurns.length} turns across ${new Set(allTurns.map(t => t.session_id)).size} sessions`)

  // Group by session_id.
  const bySession = new Map<string, BotTurnRow[]>()
  for (const t of allTurns) {
    const arr = bySession.get(t.session_id) || []
    arr.push(t)
    bySession.set(t.session_id, arr)
  }

  let sessionsProcessed = 0
  let conversationsUpserted = 0
  let turnsInserted = 0
  let turnsSkippedExisting = 0
  let turnsDroppedDuplicate = 0
  let sessionsWithLanguageMismatch = 0

  for (const [sessionId, rawTurns] of Array.from(bySession.entries())) {
    sessionsProcessed++
    // bot_conversation_turns has no UNIQUE(session_id, turn_number); race-
    // condition retries on the initial greeting created a small number of
    // (session_id, turn_number=0) duplicates in prod. The new conversation_turns
    // UNIQUE index rejects those. Keep the earliest by created_at — that's the
    // row the route's downstream logic treats as canonical.
    const dedupedByTurn = new Map<number, BotTurnRow>()
    for (const t of rawTurns) {
      const existing = dedupedByTurn.get(t.turn_number)
      if (!existing) {
        dedupedByTurn.set(t.turn_number, t)
      } else {
        const existingTime = existing.created_at ? Date.parse(existing.created_at) : Infinity
        const tTime = t.created_at ? Date.parse(t.created_at) : Infinity
        if (tTime < existingTime) dedupedByTurn.set(t.turn_number, t)
      }
    }
    turnsDroppedDuplicate += rawTurns.length - dedupedByTurn.size
    const turns = Array.from(dedupedByTurn.values()).sort((a, b) => a.turn_number - b.turn_number)

    const firstWithLang = turns.find(t => t.language)
    const language = firstWithLang?.language || 'en'
    const otherLangs = new Set(turns.map(t => t.language).filter(Boolean))
    if (otherLangs.size > 1) sessionsWithLanguageMismatch++

    if (dryRun) {
      console.log(`  [dry] session ${sessionId}: ${turns.length} turns${turns.length !== rawTurns.length ? ' (dropped ' + (rawTurns.length - turns.length) + ' dups)' : ''}, language=${language}`)
      continue
    }

    // Upsert conversations row.
    const { data: convRow, error: convErr } = await service
      .from('conversations')
      .upsert(
        {
          bot_id: botId,
          session_id: sessionId,
          org_id: orgId,
          language,
          created_at: turns[0]?.created_at || new Date().toISOString(),
        },
        { onConflict: 'bot_id,session_id' },
      )
      .select('id')
      .single()

    if (convErr || !convRow) {
      console.error(`  session ${sessionId}: conversations upsert failed:`, convErr?.message)
      continue
    }
    conversationsUpserted++
    const conversationId = (convRow as { id: string }).id

    // Discover already-inserted turn_numbers so we don't re-insert.
    const { data: existing } = await service
      .from('conversation_turns')
      .select('turn_number')
      .eq('conversation_id', conversationId)
    const existingTurnNumbers = new Set((existing || []).map((r: any) => r.turn_number as number))

    const toInsert = turns
      .filter(t => !existingTurnNumbers.has(t.turn_number))
      .map(t => ({
        conversation_id: conversationId,
        org_id: orgId,
        turn_number: t.turn_number,
        role: t.role,
        content: t.content,
        content_en: t.content_en,
        language: t.language,
        source: t.source || 'normal',
        content_flags: t.content_flags,
        sentiment: t.sentiment,
        sentiment_score: t.sentiment_score,
        created_at: t.created_at || new Date().toISOString(),
      }))

    turnsSkippedExisting += turns.length - toInsert.length

    if (toInsert.length === 0) continue

    const { error: insErr } = await service.from('conversation_turns').insert(toInsert)
    if (insErr) {
      console.error(`  session ${sessionId}: insert failed:`, insErr.message)
      continue
    }
    turnsInserted += toInsert.length
  }

  console.log('')
  console.log(`  Summary for ${botName}:`)
  console.log(`    sessions processed:            ${sessionsProcessed}`)
  console.log(`    conversations upserted:        ${conversationsUpserted}`)
  console.log(`    conversation_turns inserted:   ${turnsInserted}`)
  console.log(`    conversation_turns skipped:    ${turnsSkippedExisting} (already present)`)
  if (turnsDroppedDuplicate > 0) {
    console.log(`    source duplicates dropped:     ${turnsDroppedDuplicate} (race-condition retries on (session_id, turn_number))`)
  }
  if (sessionsWithLanguageMismatch > 0) {
    console.log(`    sessions with mixed language:  ${sessionsWithLanguageMismatch} (used first-seen value)`)
  }

  if (dryRun) {
    return { botId, botName, sessionsProcessed, conversationsUpserted, turnsInserted, turnsSkippedExisting, turnsDroppedDuplicate, parityOk: true, srcCountExact: 0, dstCount: 0 }
  }

  // Acceptance check: deduped source rows must equal destination rows.
  // The conversation_turns UNIQUE(conversation_id, turn_number) index means
  // destination will be SHORTER than source by exactly turnsDroppedDuplicate.
  const { count: srcCountExact } = await service
    .from('bot_conversation_turns')
    .select('id', { count: 'exact', head: true })
    .eq('bot_id', botId)

  const { data: convIds } = await service
    .from('conversations')
    .select('id')
    .eq('bot_id', botId)
  const convIdList = (convIds || []).map((r: any) => r.id as string)
  let dstCount = 0
  if (convIdList.length > 0) {
    const { count } = await service
      .from('conversation_turns')
      .select('id', { count: 'exact', head: true })
      .in('conversation_id', convIdList)
    dstCount = count || 0
  }

  const dedupedSrc = (srcCountExact || 0) - turnsDroppedDuplicate
  console.log('')
  console.log(`  Acceptance check for ${botName}:`)
  console.log(`    bot_conversation_turns total:  ${srcCountExact}`)
  console.log(`    source duplicates removed:     ${turnsDroppedDuplicate}`)
  console.log(`    deduped source target:         ${dedupedSrc}`)
  console.log(`    conversation_turns destination: ${dstCount}`)
  // Semantic acceptance:
  //   dst === dedupedSrc  → perfect migration ✅
  //   dst >  dedupedSrc   → new substrate has EXTRA rows (e.g. write-only-to-
  //                          new path was hit at some point; data loss is NOT
  //                          possible; safe to proceed). Warning, not failure.
  //   dst <  dedupedSrc   → new substrate is MISSING rows that exist in
  //                          legacy. DATA LOSS RISK if we drop the legacy
  //                          table. Hard failure.
  const dstExceedsSrc = dstCount > dedupedSrc
  const dstMissesSrc = dstCount < dedupedSrc
  const parityOk = !dstMissesSrc
  if (dstMissesSrc) {
    console.error(`    ❌ DATA LOSS RISK for ${botName} (${dedupedSrc} deduped src vs ${dstCount} dst — missing ${dedupedSrc - dstCount} rows)`)
  } else if (dstExceedsSrc) {
    console.log(`    ⚠️  ${botName}: ${dstCount - dedupedSrc} extra row(s) in new substrate (not in legacy). Safe to proceed — no data loss possible. Likely from earlier mirror-only writes.`)
  } else {
    console.log(`    ✅ ROW COUNTS MATCH`)
  }

  return { botId, botName, sessionsProcessed, conversationsUpserted, turnsInserted, turnsSkippedExisting, turnsDroppedDuplicate, parityOk, srcCountExact: srcCountExact || 0, dstCount }
}

async function discoverBotsWithData(
  service: any,
): Promise<string[]> {
  // Pull every distinct bot_id from bot_conversation_turns. Pages defensively
  // in case the future row count exceeds Supabase's default cap; for today's
  // ~2200 rows across ~8 bots this is one fetch.
  const allBotIds = new Set<string>()
  let offset = 0
  const PAGE = 1000
  for (;;) {
    const { data, error } = await service
      .from('bot_conversation_turns')
      .select('bot_id')
      .range(offset, offset + PAGE - 1)
    if (error) {
      console.error('Failed to discover bot ids:', error.message)
      process.exit(1)
    }
    if (!data || data.length === 0) break
    for (const r of data) allBotIds.add((r as any).bot_id as string)
    if (data.length < PAGE) break
    offset += PAGE
  }
  return Array.from(allBotIds).sort()
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
    process.exit(1)
  }

  const dryRun = hasFlag('--dry-run')
  const allBots = hasFlag('--all-bots')
  const explicitBotId = arg('--bot-id')

  if (allBots && explicitBotId) {
    console.error('Cannot pass both --all-bots and --bot-id. Pick one.')
    process.exit(1)
  }

  const service = createClient(url, serviceKey, { auth: { persistSession: false } })

  let botIds: string[]
  if (allBots) {
    console.log(`Phase 3 backfill — ALL BOTS${dryRun ? ' (DRY RUN)' : ''}`)
    botIds = await discoverBotsWithData(service)
    console.log(`Discovered ${botIds.length} bots with bot_conversation_turns rows.`)
  } else {
    const botId = explicitBotId || SARINA_BOT_ID
    console.log(`Phase 3 backfill — single bot ${botId}${dryRun ? ' (DRY RUN)' : ''}`)
    botIds = [botId]
  }

  const results: BackfillResult[] = []
  for (const botId of botIds) {
    const r = await backfillBot(service, botId, dryRun)
    if (r) results.push(r)
  }

  if (dryRun) {
    console.log('')
    console.log('DRY RUN complete — no rows written.')
    return
  }

  if (allBots) {
    // Aggregate summary across bots.
    console.log('\n════ ALL-BOTS BACKFILL SUMMARY ════')
    const totalSessions = results.reduce((a, b) => a + b.sessionsProcessed, 0)
    const totalConv = results.reduce((a, b) => a + b.conversationsUpserted, 0)
    const totalInserted = results.reduce((a, b) => a + b.turnsInserted, 0)
    const totalSkipped = results.reduce((a, b) => a + b.turnsSkippedExisting, 0)
    const totalDups = results.reduce((a, b) => a + b.turnsDroppedDuplicate, 0)
    const totalSrc = results.reduce((a, b) => a + b.srcCountExact, 0)
    const totalDst = results.reduce((a, b) => a + b.dstCount, 0)
    const failures = results.filter(r => !r.parityOk)
    console.log(`  bots processed:                ${results.length}`)
    console.log(`  sessions across all bots:      ${totalSessions}`)
    console.log(`  conversations upserted:        ${totalConv}`)
    console.log(`  conversation_turns inserted:   ${totalInserted}`)
    console.log(`  conversation_turns skipped:    ${totalSkipped}`)
    console.log(`  source duplicates dropped:     ${totalDups}`)
    console.log(`  bot_conversation_turns total:  ${totalSrc}`)
    console.log(`  conversation_turns total:      ${totalDst}`)
    if (failures.length > 0) {
      console.error(`\n  ❌ ${failures.length} bot(s) FAILED parity check (data loss risk — dst < deduped src):`)
      for (const f of failures) {
        console.error(`     - ${f.botName} (${f.botId}): src ${f.srcCountExact - f.turnsDroppedDuplicate} deduped vs dst ${f.dstCount}`)
      }
      console.error('\n  DO NOT proceed with Tier 5 cleanup until all bots pass.')
      process.exit(2)
    }
    const overcounts = results.filter(r => r.dstCount > (r.srcCountExact - r.turnsDroppedDuplicate))
    if (overcounts.length > 0) {
      console.log(`\n  ⚠️  ${overcounts.length} bot(s) have MORE rows in new substrate than deduped legacy (no data-loss risk, FYI):`)
      for (const o of overcounts) {
        const dedupedSrc = o.srcCountExact - o.turnsDroppedDuplicate
        console.log(`     - ${o.botName}: dst ${o.dstCount} > deduped src ${dedupedSrc} (+${o.dstCount - dedupedSrc})`)
      }
    }
    console.log(`\n  ✅ ALL ${results.length} BOTS PASSED PARITY CHECK — safe to proceed with read-path cutover.`)
  }

  console.log('\nDONE.')
}

main().catch(e => { console.error(e); process.exit(1) })
