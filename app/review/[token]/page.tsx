// app/review/[token]/page.tsx
// PUBLIC client-review page for a question batch — no auth, gated PURELY by the
// share token + share_enabled + expiry (mirrors /th/[token]). The client walks
// the batch's open questions, sees an AI-drafted response (grounded in the
// agent's KB), and edits/accepts each. All actions go through the token-gated
// POST /api/review/[token]. Fail-closed: unknown/disabled/expired token → 404.

import { notFound } from 'next/navigation'
import { createServiceRoleClient } from '@/lib/supabase/server'
import ReviewClient from './ReviewClient'

export const dynamic = 'force-dynamic'

export default async function ClientReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!token) notFound()

  const service = createServiceRoleClient()
  const { data: batch } = await service
    .from('question_batches')
    .select('id, bot_id, label, share_enabled, share_expires_at')
    .eq('share_token', token).maybeSingle()

  if (!batch || !batch.share_enabled) notFound()
  if (batch.share_expires_at && new Date(batch.share_expires_at).getTime() < Date.now()) notFound()

  const { data: bot } = await service.from('agents').select('name').eq('id', batch.bot_id).single()

  // Only the batch's questions are exposed — never any org/agent internals.
  const { data: qs } = await service
    .from('logged_questions')
    .select('id, user_message, original_comment, answer_text, status, external_contact')
    .eq('batch_id', batch.id)
    .order('created_at', { ascending: true })

  const questions = (qs || []).map(q => ({
    id: q.id,
    question: q.user_message,
    comment: q.original_comment || '',
    answer: q.answer_text || '',
    status: q.status as string,
    asker: ((q.external_contact || {}) as { name?: string }).name || '',
  }))

  return (
    <ReviewClient
      token={token}
      agentName={bot?.name || 'the agent'}
      batchLabel={batch.label || ''}
      initial={questions}
    />
  )
}
