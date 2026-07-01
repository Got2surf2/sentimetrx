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

type ReplyTier = 'contact_list' | 'acknowledge' | 'answer'
interface Extracted { question: string; topic: string; tier: ReplyTier }

// One AI pass over all comments. For each it returns an honest title (the real
// question ONLY if one was actually asked, never invented) + a topic label, and a
// reply TIER that drives concise vs full drafting. The response itself is drafted
// from the FULL original comment (not this title), so a complaint with no question
// still gets a relevant reply instead of an answer to a fabricated question.
async function extractQuestions(orgId: string, botId: string, comments: { comment: string; wouldLike: string }[]): Promise<Extracted[]> {
  const blocks = comments.map((c, i) =>
    `### ${i + 1}${c.wouldLike ? ` (form intent: ${c.wouldLike})` : ''}\n${c.comment.slice(0, 3000)}`).join('\n\n')
  const system = `You triage a community comment log for a public agency engagement. For EACH numbered comment return:
- "question": the question the person ACTUALLY asked, lightly cleaned up, in their voice. CRITICAL: if they did not explicitly ask a question or explicitly request specific information, this MUST be an empty string. NEVER invent, infer, or rephrase a statement/complaint/observation into a question.
- "topic": a short neutral label (3–8 words, a noun phrase, NO question mark) describing what the comment is about.
- "tier": one of "answer" | "contact_list" | "acknowledge".
   • "answer" — DEFAULT for anything substantive: a genuine question, an explicit request for information, a concern/issue/feedback the team should respond to (traffic, safety, development, etc.), OR someone who identifies themselves as a REPRESENTATIVE or point of contact (HOA, business, agency, neighborhood) — a stakeholder warrants a real, informative reply, not a one-line list-add. When in doubt, choose "answer".
   • "contact_list" — ONLY when the ENTIRE comment is nothing more than a bare request to be added or kept updated (e.g. "please add me", "keep me posted"), from an individual, with NO concern, question, role, organization, or information need. A stated role/organization (e.g. "as a point of contact for the HOA") DISQUALIFIES this tier → use "answer". Ignore the form-intent checkbox when the comment text itself carries substance or a role.
   • "acknowledge" — a brief, content-free comment, observation, or thanks with nothing for the team to act on or answer.
Do NOT invent facts. Return ONLY a JSON array aligned by index, no markdown:
[{"question":"...","topic":"short label","tier":"answer"}, ...]
Exactly ${comments.length} objects, in order.`
  try {
    const res = await callAI({ tier: 'standard', maxTokens: 2000, timeoutMs: 90000, system, messages: [{ role: 'user', content: blocks }] })
    logUsage({ org_id: orgId, resource_type: 'bot', resource_id: botId, event_type: 'question_extract' }, res.usage)
    const parsed = JSON.parse(res.text.replace(/^```json\s*|\s*```$/g, '').trim())
    if (Array.isArray(parsed)) return parsed.map((p: any): Extracted => {
      const t = p?.tier
      const tier: ReplyTier = t === 'contact_list' || t === 'acknowledge' ? t : 'answer'
      return { question: clean(p?.question, 500), topic: clean(p?.topic, 120), tier }
    })
  } catch { /* fall through to a deterministic fallback */ }
  // Fallback (no AI): treat everything as answerable, no invented question.
  return comments.map(c => ({ question: '', topic: c.comment.slice(0, 80), tier: 'answer' as ReplyTier }))
}

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { label?: string; sourceKind?: string; rows?: InRow[]; createEmpty?: boolean }
  const label = clean(body.label, 120) || null
  const sourceKind = body.sourceKind === 'csv' ? 'csv' : 'paste'
  const incoming = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : []

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Empty batch — a container the admin curates live questions into (no rows).
  if (body.createEmpty) {
    const { data: b, error } = await service
      .from('question_batches')
      .insert({ org_id: bot.org_id, bot_id: params.id, label, source_kind: 'curated', created_by: userId })
      .select('id').single()
    if (error || !b) return NextResponse.json({ error: error?.message || 'Could not create batch' }, { status: 500 })
    return NextResponse.json({ batchId: b.id, imported: 0 })
  }

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
  // The TITLE shown in review = the real question ONLY when it's a single, concise
  // one; a multi-question comment (someone asking six things at once) or a long
  // run-on falls back to the short topic label — never a fabricated question, and
  // never an unwieldy header. The full text lives in the comment + the draft.
  const userMessages = rows.map((r, i) => {
    const ex = extracted[i] || { question: '', topic: '', tier: 'answer' as ReplyTier }
    const q = ex.question || ''
    const oneShortQuestion = q.length > 0 && q.length <= 120 && (q.match(/\?/g) || []).length <= 1
    let title = oneShortQuestion ? q : (ex.topic || q || r.comment.slice(0, 120))
    if (title.length > 140) title = title.slice(0, 137).trimEnd() + '…'
    return title
  })

  // Pre-draft each response at import. Concise mode (default on): simple
  // contact-list / acknowledgement comments get the agency's terse canned line
  // (matching the consultant house style) instead of a 3-paragraph essay; only a
  // real question ('answer' tier) goes through the KB. The reviewer can always hit
  // "Re-draft from knowledge" to upgrade a canned reply to the full answer.
  // Capped + concurrent; rows past the cap fall back to on-demand drafting. Stored
  // on draft_response (NOT suggested_kb_addition — that flags "in knowledge base").
  const DRAFT_CAP = 80
  const drafts: (string | null)[] = userMessages.map(() => null)
  const { data: botFull } = await service.from('agents').select('id, org_id, name, system_prompt, config').eq('id', params.id).single()
  if (botFull) {
    const cfg = ((botFull as any).config || {}) as { conciseAcknowledgements?: boolean; replies?: { contactList?: string; acknowledge?: string } }
    const concise = cfg.conciseAcknowledgements !== false
    const contactLine = cfg.replies?.contactList || 'We’ll add you to the project contact list.'
    const ackLine = cfg.replies?.acknowledge || 'Thank you — your comment has been recorded for the project team.'
    // Only the 'answer' tier needs an AI/KB draft; canned tiers are instant.
    const idx = userMessages.map((_, i) => i)
      .filter(i => !concise || (extracted[i]?.tier ?? 'answer') === 'answer')
      .slice(0, DRAFT_CAP)
    // Draft from the FULL original comment (not the title) so a complaint with no
    // explicit question still gets a relevant, on-point reply.
    const out = await runConcurrent(idx, 6, async (i) => {
      try { return await draftAnswerFromKB(service, botFull, rows[i].comment, '', { asyncReply: true }) } catch { return null }
    })
    idx.forEach((i, k) => { drafts[i] = out[k] })
    // Canned lines for the concise tiers.
    if (concise) {
      for (let i = 0; i < drafts.length; i++) {
        if (drafts[i] != null) continue
        const tier = extracted[i]?.tier ?? 'answer'
        if (tier === 'contact_list') drafts[i] = contactLine
        else if (tier === 'acknowledge') drafts[i] = ackLine
      }
    }
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
