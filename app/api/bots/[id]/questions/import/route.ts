// app/api/bots/[id]/questions/import/route.ts
// POST — paste a client-supplied list of "external" community questions into the
// agent's Question Log. Each becomes a logged_questions row (source='external',
// classification='external', status='open') that flows through the SAME
// /draft → /answer → KB loop as a question the live agent couldn't answer.
//
// Body: { rows: [{ question, name?, email?, phone? }], batchLabel? }
//   - question is required; the rest are optional contact fields kept on
//     external_contact so a reply can be sent back to the asker.
//
// Service role + paired (id, org_id) check per CLAUDE.md multi-tenancy invariants.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { serverError } from '@/lib/apiError'
import { logBotChange } from '@/lib/auditLog'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface Params { params: Promise<{ id: string }> }

interface InRow { question?: string; name?: string; email?: string; phone?: string }

const clean = (v: unknown, max = 2000) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({})) as { rows?: InRow[]; batchLabel?: string }
  const batchLabel = clean(body.batchLabel, 120) || null
  const incoming = Array.isArray(body.rows) ? body.rows.slice(0, 1000) : []

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const rows = incoming
    .map(r => {
      const question = clean(r.question)
      if (question.length < 3) return null
      const contact: Record<string, string> = {}
      const name = clean(r.name, 200), email = clean(r.email, 200), phone = clean(r.phone, 80)
      if (name) contact.name = name
      if (email) contact.email = email
      if (phone) contact.phone = phone
      return {
        org_id: bot.org_id,
        bot_id: params.id,
        // No live session — synthesize a stable id so each external question is
        // its own one-exchange "session" once answered (see the answer route).
        session_id: 'ext:' + crypto.randomUUID(),
        user_message: question,
        classification: 'external',
        source: 'external',
        status: 'open',
        external_contact: Object.keys(contact).length ? contact : null,
        batch_label: batchLabel,
      }
    })
    .filter((r): r is NonNullable<typeof r> => r != null)

  if (rows.length === 0) return NextResponse.json({ error: 'No valid questions found — each row needs a question.' }, { status: 400 })

  const { data: inserted, error } = await service.from('logged_questions').insert(rows).select('id')
  if (error) return serverError(error, 'bots.questions.import', { orgId: bot.org_id })

  void logBotChange({
    botId: params.id, orgId: bot.org_id, actorId: userId, actorEmail: null,
    action: 'import',
    summary: `Imported ${rows.length} external question${rows.length === 1 ? '' : 's'}${batchLabel ? ` (${batchLabel})` : ''}`,
    metadata: { count: rows.length, batchLabel },
  })

  return NextResponse.json({ imported: (inserted || []).length })
}
