// app/api/bots/[id]/workbook/route.ts
// GET ?format=xlsx — one combined Excel workbook for an agent, four tabs:
//   1. Summary            — totals / answer rate / languages / top focus areas
//                           (from the cached Agent Study, no fresh AI unless stale)
//   2. Public Comments    — substantive resident feedback (observations /
//                           concerns / suggestions) extracted by the Agent Study;
//                           the artifact behind "I'll capture this for the record".
//   3. Q&A Pairs          — review-gated question→answer pairs (shared with the
//                           conversations export)
//   4. Low-Confidence     — open logged_questions (kb_miss + ai_uncertain only;
//      Answers              deflects excluded), with the agent's actual reply +
//                           PII-redacted. These got an answer — it was flagged weak.
//   5. Full Transcript    — one row per turn
//
// Built for handing a client a single self-contained file. Org-member or
// admin gated (same gate as the conversations export).

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { type Sheet } from '@/lib/xlsxExport'
import { buildStyledWorkbook } from '@/lib/styledWorkbook'
import { loadExportTurns, turnsSheet, pairsSheet, redactPII, type ExportTurn } from '@/lib/agentExport'
import { getAgentStudy, type AgentStudy } from '@/lib/agentStudy'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—')

// Friendlier labels for logged_questions.classification (jargony in the DB).
// Only the two low-confidence signals reach this tab — deflects (intentional
// off-topic redirects) are filtered out upstream since they aren't gaps.
const TYPE_LABEL: Record<string, string> = {
  kb_miss: 'No answer in knowledge base',
  ai_uncertain: 'Uncertain / hedged answer',
}

function summarySheet(botName: string, study: AgentStudy | null, lowConfCount: number): Sheet {
  const rows: (string | number | null)[][] = []
  if (!study) {
    rows.push(['No analysis available yet', ''])
    return { name: 'Summary', headers: [botName + ' — Summary', ''], rows }
  }
  const t = study.totals
  rows.push(['Date range', fmtDay(study.range.first) + ' → ' + fmtDay(study.range.last)])
  rows.push(['Active days', study.range.activeDays])
  rows.push(['Total conversations', t.conversations])
  rows.push(['Total Q&A pairs', t.totalPairs])
  rows.push(['Answered pairs', t.answeredPairs])
  rows.push(['Answer rate', t.answerRatePct != null ? t.answerRatePct + '%' : '—'])
  rows.push(['Public comments captured', study.publicComments.length])
  // The agent DID reply to these — they're flagged low-confidence (thin KB hit
  // or a hedge), awaiting team review. NOT "no answer was given."
  rows.push(['Low-confidence answers (flagged for review)', lowConfCount])
  rows.push(['', ''])
  rows.push(['Languages', 'Conversations'])
  for (const l of study.languages) rows.push(['  ' + l.language, l.sessions + ' (' + l.pct + '%)'])
  rows.push(['', ''])
  rows.push(['Top focus areas', 'Exchanges / Conversations'])
  for (const f of study.focuses.slice(0, 12)) rows.push(['  ' + f.label, f.exchanges + ' / ' + f.sessions])
  return { name: 'Summary', headers: [botName + ' — Summary', ''], rows }
}

interface OpenQ {
  created_at: string
  classification: string
  language: string | null
  session_id: string
  user_message: string
}

// Build a session→ordered-turns index once, then for each flagged question find
// the assistant line that immediately followed it — that's the actual (weak)
// reply the agent gave, so the client can see an answer WAS provided and judge it.
function buildReplyLookup(turns: ExportTurn[]): (sid: string, userMsg: string) => string {
  const bySession = new Map<string, ExportTurn[]>()
  for (const t of turns) {
    if (!bySession.has(t.session_id)) bySession.set(t.session_id, [])
    bySession.get(t.session_id)!.push(t)
  }
  for (const ts of bySession.values()) ts.sort((a, b) => a.turn_number - b.turn_number)
  const norm = (s: string | null) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim()
  return (sid, userMsg) => {
    const ts = bySession.get(sid)
    if (!ts) return ''
    const nq = norm(userMsg)
    const idx = ts.findIndex(t => t.role === 'user' && (norm(t.content) === nq || norm(t.content_en) === nq))
    if (idx < 0) return ''
    for (let j = idx + 1; j < ts.length; j++) if (ts[j].role === 'assistant') return (ts[j].content_en || ts[j].content || '').replace(/\s+/g, ' ').trim()
    return ''
  }
}

// The public-comment record — substantive resident feedback (not questions)
// extracted by the Agent Study. This is the artifact behind the agent's
// "I'll capture this for the record" promise. PII-redacted by default.
function publicCommentsSheet(study: AgentStudy | null): Sheet {
  const rows = (study?.publicComments || []).map(c => [
    (c.createdAt || '').slice(0, 10),
    c.focus || '',
    c.sentiment || '',
    redactPII(c.quote),
    c.sessionId,
  ])
  return {
    name: 'Public Comments',
    headers: ['Date', 'Topic', 'Sentiment', 'Comment (resident, verbatim)', 'Session ID'],
    rows,
  }
}

function lowConfidenceSheet(rows: OpenQ[], turns: ExportTurn[], agentName: string): Sheet {
  const replyAfter = buildReplyLookup(turns)
  const who = (agentName || 'The agent').trim()
  return {
    name: 'Low-Confidence Answers',
    headers: ['Date', 'Type', 'Question (user)', who + "'s answer", 'Language', 'Session ID'],
    rows: rows.map(r => [
      (r.created_at || '').slice(0, 10),
      TYPE_LABEL[r.classification] || r.classification,
      redactPII(r.user_message),
      redactPII(replyAfter(r.session_id, r.user_message)),
      r.language || '',
      r.session_id,
    ]),
  }
}

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: userData } = await service
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org : (orgRel as any)?.is_admin_org
  const userOrgId = (userData as any)?.org_id as string | null

  const { data: bot } = await service.from('agents').select('id, name, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== userOrgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const turns = await loadExportTurns(service, params.id)
  if (!turns || turns.length === 0) {
    return NextResponse.json({ error: 'No conversations to export' }, { status: 404 })
  }

  // Summary aggregates come from the cached Agent Study (cache-first; recomputes
  // only if stale, same as the report page). Low-confidence = the open questions
  // queue, EXCLUDING deflects (intentional off-topic redirects aren't gaps), org_id
  // paired per the multi-tenancy invariant.
  const [study, oqRes] = await Promise.all([
    getAgentStudy(params.id),
    service
      .from('logged_questions')
      .select('created_at, classification, language, session_id, user_message')
      .eq('bot_id', params.id)
      .eq('org_id', bot.org_id)
      .eq('status', 'open')
      .in('classification', ['kb_miss', 'ai_uncertain'])
      .order('created_at', { ascending: false })
      .limit(2000),
  ])
  const lowConf = (oqRes.data || []) as OpenQ[]

  const sheets: Sheet[] = [
    summarySheet(bot.name, study, lowConf.length),
    publicCommentsSheet(study),
    await pairsSheet(service, params.id, turns, bot.name, 'Q&A Pairs'),
    lowConfidenceSheet(lowConf, turns, bot.name),
    turnsSheet(turns, 'Full Transcript'),
  ]

  const fileBase = bot.name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') + '_Export'
  // Always xlsx — a workbook is multi-sheet; CSV would drop all but one. Styled
  // via exceljs (bold/frozen/filtered headers, zebra rows, wrapped text) for a
  // client-grade deliverable.
  const buf = await buildStyledWorkbook(sheets)
  const ab = new ArrayBuffer(buf.byteLength)
  new Uint8Array(ab).set(buf)
  const safe = fileBase.replace(/[^a-z0-9-_]/gi, '-').toLowerCase()
  return new NextResponse(ab, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="' + safe + '.xlsx"',
    },
  })
}
