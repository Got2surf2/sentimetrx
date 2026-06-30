// app/api/bots/[id]/questions/export-responses.csv/route.ts
// GET — CSV of the agent's EXTERNAL questions (the pasted community list) with
// the accepted response and the asker's contact info, so the client can send the
// responses back. Unlike the general question-log export this deliberately does
// NOT redact contact fields — sending a reply is the whole point (owner decision
// 3). Org-member or admin gated. Personified filename (the agent's name).
//   ?batch=<label>   limit to one pasted batch
//   ?answered=1      only rows that have an accepted response

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'

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
  const { data: bot } = await service.from('agents').select('id, name, slug, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const batch = req.nextUrl.searchParams.get('batch')
  const answeredOnly = req.nextUrl.searchParams.get('answered') === '1'

  let q = service
    .from('logged_questions')
    .select('user_message, answer_text, external_contact, status, batch_label, created_at, resolved_at')
    .eq('bot_id', params.id)
    .eq('org_id', bot.org_id)
    .eq('source', 'external')
    .order('created_at', { ascending: false })
    .limit(10000)
  if (batch) q = q.eq('batch_label', batch)
  if (answeredOnly) q = q.eq('status', 'answered')

  const { data: rows, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const header = ['Question', 'Response', 'Name', 'Email', 'Phone', 'Status', 'Batch', 'Submitted', 'Answered']
  const lines = [header.join(',')]
  for (const r of rows || []) {
    const c = (r.external_contact || {}) as { name?: string; email?: string; phone?: string }
    lines.push([
      r.user_message,
      r.answer_text || '',
      c.name || '',
      c.email || '',
      c.phone || '',
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
