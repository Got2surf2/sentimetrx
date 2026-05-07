// app/api/campaigns/[id]/stats/route.ts
// GET — aggregate stats for a campaign

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify campaign access
  const { data: campaign } = await supabase
    .from('campaigns')
    .select('id, target_responses, status')
    .eq('id', params.id)
    .single()
  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // Count respondents by status
  const { data: respondents } = await supabase
    .from('campaign_respondents')
    .select('status')
    .eq('campaign_id', params.id)

  const counts = {
    total: 0, pending: 0, sent: 0, opened: 0,
    clicked: 0, completed: 0, bounced: 0, unsubscribed: 0,
  }

  for (const r of (respondents || [])) {
    counts.total++
    const s = r.status as keyof typeof counts
    if (s in counts) counts[s]++
  }

  // Send log stats
  const { count: totalSends } = await supabase
    .from('campaign_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', params.id)

  const { count: failedSends } = await supabase
    .from('campaign_send_log')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', params.id)
    .eq('status', 'failed')

  // Auto-complete: if campaign is active and all recipients are in terminal states
  const terminalCount = counts.completed + counts.bounced + counts.unsubscribed
  const allDone = counts.total > 0 && terminalCount === counts.total
  let campaignStatus = campaign.status as string

  if (allDone && (campaignStatus === 'active' || campaignStatus === 'scheduled')) {
    await supabase.from('campaigns').update({ status: 'completed' }).eq('id', params.id)
    campaignStatus = 'completed'
  }

  return NextResponse.json({
    respondents: counts,
    target_responses: campaign.target_responses,
    completion_rate: counts.total > 0 ? Math.round(counts.completed / counts.total * 100) : 0,
    target_progress: campaign.target_responses
      ? Math.round(counts.completed / campaign.target_responses * 100)
      : null,
    sends: {
      total: totalSends || 0,
      failed: failedSends || 0,
    },
    campaign_status: campaignStatus,
  })
}
