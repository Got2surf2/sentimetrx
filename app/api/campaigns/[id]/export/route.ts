// app/api/campaigns/[id]/export/route.ts
// GET — export campaign respondent data as CSV

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  // Fetch campaign
  const { data: campaign } = await service
    .from('campaigns')
    .select('name')
    .eq('id', params.id)
    .single()

  if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

  // Fetch all respondents
  const { data: respondents } = await service
    .from('campaign_respondents')
    .select('*')
    .eq('campaign_id', params.id)
    .order('created_at', { ascending: true })
    .range(0, 49999)

  if (!respondents || respondents.length === 0) {
    return new NextResponse('No data to export\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
  }

  const esc = (v: unknown): string => {
    const s = v == null ? '' : String(v).trim()
    return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }

  // Collect all unique field keys
  const fieldKeys = new Set<string>()
  for (const r of respondents) {
    if (r.fields) Object.keys(r.fields).forEach(k => fieldKeys.add(k))
  }
  const fieldKeyArr = Array.from(fieldKeys).sort()

  // Build CSV
  const headers = [
    'email',
    'status',
    ...fieldKeyArr,
    'recipient_guid',
    'sent_at',
    'opened_at',
    'clicked_at',
    'completed_at',
    'created_at',
  ]

  const rows = respondents.map(r => [
    esc(r.email),
    esc(r.status),
    ...fieldKeyArr.map(k => esc(r.fields?.[k] || '')),
    esc(r.recipient_guid),
    esc(r.sent_at || ''),
    esc(r.opened_at || ''),
    esc(r.clicked_at || ''),
    esc(r.completed_at || ''),
    esc(r.created_at || ''),
  ].join(','))

  const csv = [headers.join(','), ...rows].join('\n')
  const safeName = (campaign.name || 'campaign').replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}-recipients-${date}.csv"`,
    },
  })
}
