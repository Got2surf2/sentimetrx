// app/api/bots/[id]/batches/route.ts
// POST — import a CSV/paste of community COMMENTS as an external-question batch.
// Unlike /questions/import (already-questions), each row here is a free-text
// comment that may MIX a question with commentary, so one AI pass per batch
// extracts the answerable question (→ logged_questions.user_message) and keeps
// the full comment as commentary (→ original_comment). Owner: "extract the
// question and store the rest as commentary."
//
// Body: { label?, sourceKind?, rows: [{ comment, name?, email?, phone?, address?, agency?, wouldLike? }] }
//
// Creates a question_batches row + one logged_questions row per comment
// (source='external', classification='external', batch_id set). The contact
// fields ride external_contact so a reply can be sent back.
//
// GET — list this agent's batches (with counts) for the batches UI.
//
// Service role + paired (id, org_id) check per CLAUDE.md multi-tenancy invariants.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { logBotChange } from '@/lib/auditLog'
import { draftAnswerFromKB } from '@/lib/agentDraft'
import { runConcurrent } from '@/lib/agentStudy'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface Params { params: Promise<{ id: string }> }

interface InRow { comment?: string; name?: string; email?: string; phone?: string; address?: string; agency?: string; wouldLike?: string }

const clean = (v: unknown, max = 6000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

// One AI pass over all comments → the answerable question (or '' + a short label).
async function extractQuestions(orgId: string, botId: string, comments: { comment: string; wouldLike: string }[]): Promise<{ question: string; summary: string }[]> {
  const blocks = comments.map((c, i) =>
    `### ${i + 1}${c.wouldLike ? ` (intent: ${c.wouldLike})` : ''}\n${c.comment.slice(0, 3000)}`).join('\n\n')
  const system = `You triage a community comment log for a public agency engagement. For EACH numbered comment, distill the single most important ANSWERABLE question the team should respond to — phrased as one concise question in the commenter's voice. If the comment is purely commentary/feedback with no question, return an empty string for "question" and a short (≤8-word) "summary" label of the concern. Do NOT invent facts.
Return ONLY a JSON array aligned by index, no markdown:
[{"question":"...","summary":"short label"}, ...]
Exactly ${comments.length} objects, in order.`
  try {
    const res = await callAI({ tier: 'standard', maxTokens: 2000, timeoutMs: 90000, system, messages: [{ role: 'user', content: blocks }] })
    logUsage({ org_id: orgId, resource_type: 'bot', resource_id: botId, event_type: 'question_extract' }, res.usage)
    const parsed = JSON.parse(res.text.replace(/^```json\s*|\s*```$/g, '').trim())
    if (Array.isArray(parsed)) return parsed.map((p: any) => ({ question: clean(p?.question, 500), summary: clean(p?.summary, 120) }))
  } catch { /* fall through to a deterministic fallback */ }
  // Fallback: first sentence as the "question", no AI.
  return comments.map(c => ({ question: c.comment.split(/(?<=[.!?])\s/)[0].slice(0, 300), summary: '' }))
}

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { label?: string; sourceKind?: string; rows?: InRow[] }
  const label = clean(body.label, 120) || null
  const sourceKind = body.sourceKind === 'csv' ? 'csv' : 'paste'
  const incoming = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : []

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Keep rows that actually carry a comment (contact-only rows aren't questions).
  const rows = incoming.map(r => ({
    comment: clean(r.comment),
    wouldLike: clean(r.wouldLike, 300),
    contact: {
      ...(clean(r.name, 200) ? { name: clean(r.name, 200) } : {}),
      ...(clean(r.email, 200) ? { email: clean(r.email, 200) } : {}),
      ...(clean(r.phone, 80) ? { phone: clean(r.phone, 80) } : {}),
      ...(clean(r.address, 300) ? { address: clean(r.address, 300) } : {}),
      ...(clean(r.agency, 200) ? { agency: clean(r.agency, 200) } : {}),
    } as Record<string, string>,
  })).filter(r => r.comment.length >= 3)

  if (rows.length === 0) return NextResponse.json({ error: 'No comments found — each row needs comment text.' }, { status: 400 })

  const extracted = await extractQuestions(bot.org_id, params.id, rows.map(r => ({ comment: r.comment, wouldLike: r.wouldLike })))
  const userMessages = rows.map((r, i) => {
    const ex = extracted[i] || { question: '', summary: '' }
    return ex.question || ex.summary || r.comment.slice(0, 300)
  })

  // Pre-draft each response from the agent's KB at import time, so a suggestion is
  // ready the moment the queue (or the client review link) opens — never on demand
  // (an empty box has no value). Capped + concurrent to stay within maxDuration;
  // rows beyond the cap fall back to on-demand drafting. Stored on draft_response
  // (NOT suggested_kb_addition — that flags "in knowledge base"; a draft isn't).
  const DRAFT_CAP = 80
  const drafts: (string | null)[] = userMessages.map(() => null)
  const { data: botFull } = await service.from('agents').select('id, org_id, name, system_prompt').eq('id', params.id).single()
  if (botFull) {
    const idx = userMessages.map((_, i) => i).slice(0, DRAFT_CAP)
    const out = await runConcurrent(idx, 6, async (i) => {
      try { return await draftAnswerFromKB(service, botFull, userMessages[i]) } catch { return null }
    })
    idx.forEach((i, k) => { drafts[i] = out[k] })
  }

  const { data: batch, error: batchErr } = await service
    .from('question_batches')
    .insert({ org_id: bot.org_id, bot_id: params.id, label, source_kind: sourceKind, created_by: userId })
    .select('id').single()
  if (batchErr || !batch) return NextResponse.json({ error: batchErr?.message || 'Could not create batch' }, { status: 500 })

  const inserts = rows.map((r, i) => ({
    org_id: bot.org_id,
    bot_id: params.id,
    batch_id: batch.id,
    session_id: 'ext:' + crypto.randomUUID(),
    user_message: userMessages[i],
    original_comment: r.comment,
    classification: 'external',
    source: 'external',
    status: 'open',
    draft_response: drafts[i] || null,   // the AI-suggested response (pre-filled in review)
    external_contact: Object.keys(r.contact).length ? r.contact : null,
    batch_label: label,
  }))

  const { error: insErr } = await service.from('logged_questions').insert(inserts)
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  void logBotChange({
    botId: params.id, orgId: bot.org_id, actorId: userId, actorEmail: null,
    action: 'import',
    summary: `Imported ${inserts.length} community comment${inserts.length === 1 ? '' : 's'}${label ? ` (${label})` : ''}`,
    metadata: { count: inserts.length, batchId: batch.id, sourceKind },
  })

  return NextResponse.json({ batchId: batch.id, imported: inserts.length })
}

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: batches } = await service
    .from('question_batches')
    .select('id, label, source_kind, share_token, share_enabled, share_expires_at, created_at')
    .eq('bot_id', params.id).eq('org_id', bot.org_id)
    .order('created_at', { ascending: false }).limit(200)

  // Per-batch counts (open vs answered) in one pass.
  const ids = (batches || []).map(b => b.id)
  const counts: Record<string, { total: number; answered: number }> = {}
  if (ids.length) {
    const { data: qs } = await service
      .from('logged_questions').select('batch_id, status').eq('bot_id', params.id).in('batch_id', ids)
    for (const q of (qs || []) as { batch_id: string; status: string }[]) {
      const c = counts[q.batch_id] || (counts[q.batch_id] = { total: 0, answered: 0 })
      c.total++; if (q.status === 'answered') c.answered++
    }
  }
  return NextResponse.json({ batches: (batches || []).map(b => ({ ...b, counts: counts[b.id] || { total: 0, answered: 0 } })) })
}
