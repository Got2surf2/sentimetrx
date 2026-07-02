// app/api/bots/[id]/study/route.ts
// GET — the full Agent Study analysis object (Tier-1 + Tier-2). Compute-if-
// stale, memoized in agent_study_cache. ?force=1 recomputes. Consumed by the
// HTML report page; the PPTX export renders the same object.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { getAgentStudy } from '@/lib/agentStudy'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: botId } = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('org_id').eq('id', botId).single()
  if (!bot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const force = req.nextUrl.searchParams.get('force') === '1'
  let study
  try {
    study = await getAgentStudy(botId, { force })
  } catch (err) {
    // getAgentStudy's AI calls use AbortSignal.timeout; a slow vendor surfaces
    // as a TimeoutError. Return a retryable 503 instead of an unhandled 500.
    if (err instanceof Error && err.name === 'TimeoutError') {
      return NextResponse.json(
        { error: 'Analysis is taking longer than usual. Please try again.' },
        { status: 503 },
      )
    }
    throw err
  }
  if (!study) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ study })
}
