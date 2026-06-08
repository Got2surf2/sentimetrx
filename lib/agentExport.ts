// lib/agentExport.ts
//
// Shared building blocks for agent (bot) conversation data exports — used by
// BOTH the single-shape conversations export (`/conversations/export`) and the
// combined multi-sheet workbook (`/workbook`). Kept in one place so the
// turn-loading, the review-gated Q&A pairing, and the PII redaction never drift
// between the two routes.

import type { Sheet } from '@/lib/xlsxExport'
import { isPhase3ReadSafe } from '@/lib/phase3Read'
import {
  autoFlagReasons,
  resolveReviewStatus,
  includedInReports,
  duplicateFingerprintSet,
  type TurnLike,
} from '@/lib/conversationReview'

export interface ExportTurn {
  session_id: string
  turn_number: number
  role: string
  content: string
  content_en: string | null
  language: string | null
  created_at: string
  source: string | null
  content_flags: string[] | null
}

// Substrate-aware turn load: phase-3 `conversation_turns` (joined to its
// session) when read-safe, else the legacy `bot_conversation_turns`. Mirrors
// lib/agentStudy.loadTurns but keeps the export column set + ordering. 5000-row
// cap matches the prior route behavior.
export async function loadExportTurns(service: any, botId: string): Promise<ExportTurn[]> {
  if (isPhase3ReadSafe()) {
    const { data } = await service
      .from('conversation_turns')
      .select('turn_number, role, content, content_en, language, created_at, source, content_flags, conversations!inner(session_id, bot_id)')
      .eq('conversations.bot_id', botId)
      .order('turn_number', { ascending: true })
      .limit(5000)
    return (data || []).map((r: any) => ({
      session_id: r.conversations?.session_id,
      turn_number: r.turn_number,
      role: r.role,
      content: r.content,
      content_en: r.content_en,
      language: r.language,
      created_at: r.created_at,
      source: r.source,
      content_flags: r.content_flags,
    }))
  }
  const { data } = await service
    .from('bot_conversation_turns')
    .select('session_id, turn_number, role, content, content_en, language, created_at, source, content_flags')
    .eq('bot_id', botId)
    .order('session_id')
    .order('turn_number', { ascending: true })
    .limit(5000)
  return (data || []) as ExportTurn[]
}

const clean = (s: string | null) => (s || '').replace(/\s+/g, ' ').trim()

// One row per turn — the raw transcript dump (ungated).
export function turnsSheet(turns: ExportTurn[], name = 'Conversations'): Sheet {
  return {
    name,
    headers: ['Session ID', 'Turn', 'Role', 'Content', 'Language', 'Timestamp'],
    rows: turns.map(t => [t.session_id, t.turn_number, t.role, (t.content || '').replace(/\n/g, ' '), t.language, t.created_at]),
  }
}

// Internal-prompt leak: historical rows where the non-English greeting flow
// POSTed the literal "Greet the user warmly…" instruction as a user turn. Skip
// so it never shows up as a question. (Root cause fixed; see lib/agentStudy.ts.)
const isLeak = (t: string) => /^greet the user warmly\b/i.test((t || '').trim())

// One row per Q&A pair, with the SAME review gate the Agent Study applies: drop
// human-excluded sessions and auto-flagged troll/bot/duplicate/off-topic ones a
// human hasn't approved. So this is "every Q&A from the conversations we count
// as good" — not the raw dump.
export async function pairsSheet(service: any, botId: string, turns: ExportTurn[], name = 'Q&A Pairs'): Promise<Sheet> {
  const bySession = new Map<string, ExportTurn[]>()
  for (const t of turns) {
    if (!bySession.has(t.session_id)) bySession.set(t.session_id, [])
    bySession.get(t.session_id)!.push(t)
  }

  let human = new Map<string, 'approved' | 'excluded'>()
  try {
    const { data } = await service.from('conversation_reviews').select('session_id, status').eq('bot_id', botId)
    for (const r of (data || [])) human.set(r.session_id, r.status)
  } catch { /* table absent → treat all as clean */ }
  const dup = duplicateFingerprintSet(new Map<string, TurnLike[]>(bySession))
  const isGood = (sid: string, ts: TurnLike[]) =>
    includedInReports(resolveReviewStatus(human.get(sid) ?? null, autoFlagReasons(ts, { duplicateFingerprints: dup })))

  const rows: (string | number | null)[][] = []
  let pairNo = 0
  for (const [sid, ts] of bySession) {
    ts.sort((a, b) => a.turn_number - b.turn_number)
    if (!isGood(sid, ts)) continue
    for (let i = 0; i < ts.length; i++) {
      const t = ts[i]
      if (t.role !== 'user' || t.source === 'greeting' || isLeak(t.content)) continue
      let answer = ''
      for (let j = i + 1; j < ts.length; j++) { if (ts[j].role === 'assistant') { answer = clean(ts[j].content); break } }
      rows.push([++pairNo, sid, t.created_at, clean(t.content), answer, t.language])
    }
  }
  return { name, headers: ['#', 'Session ID', 'Timestamp', 'Question (user)', 'Answer (agent)', 'Language'], rows }
}

// PII redaction — email / NA-style phone / US street address. Mirrors the
// logged-questions CSV export; ON by default for client-facing exports.
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE_RE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g
const ADDR_RE = /\b\d{1,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place)\b\.?/g
export function redactPII(text: string | null): string {
  if (!text) return ''
  return text.replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]').replace(ADDR_RE, '[address]')
}
