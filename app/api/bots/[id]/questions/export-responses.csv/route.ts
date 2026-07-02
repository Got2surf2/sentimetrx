// app/api/bots/[id]/questions/export-responses.csv/route.ts
// GET — CSV of the agent's EXTERNAL questions (the pasted community list) with
// the accepted response and the asker's contact info, so the client can send the
// responses back. Unlike the general question-log export this deliberately does
// NOT redact contact fields — sending a reply is the whole point (owner decision
// 3). Org-member or admin gated. Personified filename (the agent's name).
//   ?batch=<label>   limit to one pasted batch
//   ?answered=1      only rows that have an accepted response

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: Promise<{ id: string }> }

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  return /["\n\r,]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, name, slug, org_id, config').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const batchId = req.nextUrl.searchParams.get('batch')   // batch_id when downloading one batch
  const answeredOnly = req.nextUrl.searchParams.get('answered') === '1'
  const emailsMode = req.nextUrl.searchParams.get('emails') === '1'   // warm, copy-paste email drafts

  let q = service
    .from('logged_questions')
    .select('user_message, original_comment, answer_text, draft_response, external_contact, source, classification, status, batch_id, batch_label, created_at, resolved_at')
    .eq('bot_id', params.id)
    .eq('org_id', bot.org_id)
    .order('created_at', { ascending: false })
    .limit(10000)
  // Scoped to one batch → include everything in it (a curated batch can mix the
  // comment log with live questions). Unscoped → just the comment-log responses.
  if (batchId) q = q.eq('batch_id', batchId)
  else q = q.eq('source', 'external')
  if (answeredOnly) q = q.eq('status', 'answered')

  const { data: rows, error } = await q
  if (error) return serverError(error, 'bots.questions.exportResponses', { orgId: bot.org_id })

  const originOf = (source: string | null, cls: string | null): string => {
    if (source === 'external') return 'Comment log'
    if (cls === 'kb_miss') return 'Website — no agent answer'
    if (cls === 'deflect') return 'Website — off-topic/sensitive'
    if (cls === 'ai_uncertain') return 'Website — agent unsure'
    return source === 'agent' ? 'Website' : (source || '')
  }

  // ── Email-draft mode: a warm, copy-paste-ready email per contact who gave an
  //    email address (owner: "only write draft emails for people who provided an
  //    email"). Body = warm greeting + the response + warm sign-off. ──────────
  if (emailsMode) {
    const cfg = ((bot as any).config || {}) as { emailSignoff?: string; emailSubject?: string }
    const signoff = cfg.emailSignoff || 'The Project Team'
    const subject = cfg.emailSubject || 'Thank you for your comment'
    const firstName = (full?: string) => (full || '').trim().split(/\s+/)[0] || ''
    const header = ['Name', 'Email', 'Subject', 'Email draft']
    const lines = [header.join(',')]
    for (const r of rows || []) {
      const c = (r.external_contact || {}) as { name?: string; email?: string }
      const email = (c.email || '').trim()
      const response = (r.answer_text || r.draft_response || '').trim()
      if (!email || !response) continue   // only people with an email + a response to send
      const fn = firstName(c.name)
      const body = `Hi ${fn || 'there'},\n\n${response}\n\nWarm regards,\n${signoff}`
      lines.push([c.name || '', email, subject, body].map(csvEscape).join(','))
    }
    const agentName = (bot.name || bot.slug || 'Agent').replace(/[^\w.-]+/g, '_')
    const stamp = new Date().toISOString().slice(0, 10)
    return new NextResponse(lines.join('\n'), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${agentName}_Email_Drafts_${stamp}.csv"`,
      },
    })
  }

  const header = ['Question', 'Full comment', 'AI suggested response', 'Final response', 'Origin', 'Name', 'Email', 'Phone', 'Address', 'Agency', 'Status', 'Batch', 'Submitted', 'Answered']
  const lines = [header.join(',')]
  for (const r of rows || []) {
    const c = (r.external_contact || {}) as { name?: string; email?: string; phone?: string; address?: string; agency?: string }
    lines.push([
      r.user_message,
      r.original_comment || '',
      r.draft_response || '',
      r.answer_text || '',
      originOf(r.source, r.classification),
      c.name || '',
      c.email || '',
      c.phone || '',
      c.address || '',
      c.agency || '',
      r.status,
      r.batch_label || '',
      r.created_at,
      r.resolved_at || '',
    ].map(csvEscape).join(','))
  }

  const agentName = (bot.name || bot.slug || 'Agent').replace(/[^\w.-]+/g, '_')
  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `${agentName}_Responses_${stamp}.csv`

  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
