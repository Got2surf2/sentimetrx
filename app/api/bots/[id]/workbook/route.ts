// app/api/bots/[id]/workbook/route.ts
// GET ?format=xlsx — one combined Excel workbook for an agent, four tabs:
//   1. Summary            — totals / answer rate / languages / top focus areas
//                           (from the cached Agent Study, no fresh AI unless stale)
//   2. Q&A Pairs          — review-gated question→answer pairs (shared with the
//                           conversations export)
//   3. Unanswered         — raw logged_questions where status='open', PII-redacted
//   4. Full Transcript    — one row per turn
//
// Built for handing a client a single self-contained file. Org-member or
// admin gated (same gate as the conversations export).

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { dataResponse, type Sheet } from '@/lib/xlsxExport'
import { loadExportTurns, turnsSheet, pairsSheet, redactPII } from '@/lib/agentExport'
import { getAgentStudy, type AgentStudy } from '@/lib/agentStudy'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

const fmtDay = (iso: string | null) => (iso ? new Date(iso).toISOString().slice(0, 10) : '—')

// Friendlier labels for logged_questions.classification (jargony in the DB).
const TYPE_LABEL: Record<string, string> = {
  kb_miss: 'No answer in knowledge base',
  ai_uncertain: 'Uncertain answer',
  deflect: 'Off-topic / redirected',
}

function summarySheet(botName: string, study: AgentStudy | null): Sheet {
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
  rows.push(['Open (unanswered) questions', study.openQuestions.total])
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
  suggested_kb_addition: string | null
}

function unansweredSheet(rows: OpenQ[]): Sheet {
  return {
    name: 'Unanswered Questions',
    headers: ['Date', 'Type', 'Question (user)', 'Suggested answer / KB note', 'Language', 'Session ID'],
    rows: rows.map(r => [
      (r.created_at || '').slice(0, 10),
      TYPE_LABEL[r.classification] || r.classification,
      redactPII(r.user_message),
      redactPII(r.suggested_kb_addition || ''),
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
  // only if stale, same as the report page). Unanswered = the open questions
  // queue, paired with org_id per the multi-tenancy invariant.
  const [study, oqRes] = await Promise.all([
    getAgentStudy(params.id),
    service
      .from('logged_questions')
      .select('created_at, classification, language, session_id, user_message, suggested_kb_addition')
      .eq('bot_id', params.id)
      .eq('org_id', bot.org_id)
      .eq('status', 'open')
      .order('created_at', { ascending: false })
      .limit(2000),
  ])

  const sheets: Sheet[] = [
    summarySheet(bot.name, study),
    await pairsSheet(service, params.id, turns, 'Q&A Pairs'),
    unansweredSheet((oqRes.data || []) as OpenQ[]),
    turnsSheet(turns, 'Full Transcript'),
  ]

  const fileBase = bot.name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') + '_Agent_Export'
  // Always xlsx — a workbook is multi-sheet; CSV would silently drop all but one.
  return dataResponse('xlsx', fileBase, sheets)
}
