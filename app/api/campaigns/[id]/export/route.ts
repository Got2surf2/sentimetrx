// app/api/campaigns/[id]/export/route.ts
// GET ?format=csv|xlsx — export campaign respondent data

import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { dataResponse, parseExportFormat } from '@/lib/xlsxExport'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org

  const service = createServiceRoleClient()

  const { data: campaign } = await service
    .from('campaigns')
    .select('name, org_id')
    .eq('id', params.id)
    .single()

  if (!campaign || (!isAdmin && campaign.org_id !== userData.org_id)) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  const { data: respondents } = await service
    .from('campaign_respondents')
    .select('*')
    .eq('campaign_id', params.id)
    .order('created_at', { ascending: true })
    .range(0, 49999)

  if (!respondents || respondents.length === 0) {
    return new NextResponse('No data to export\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
  }

  // Collect all unique custom field keys across respondents.
  const fieldKeys = new Set<string>()
  for (const r of respondents) {
    if (r.fields) Object.keys(r.fields).forEach(k => fieldKeys.add(k))
  }
  const fieldKeyArr = Array.from(fieldKeys).sort()

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
    r.email,
    r.status,
    ...fieldKeyArr.map(k => r.fields?.[k] ?? ''),
    r.recipient_guid,
    r.sent_at || '',
    r.opened_at || '',
    r.clicked_at || '',
    r.completed_at || '',
    r.created_at || '',
  ])

  const format = parseExportFormat(req.nextUrl.searchParams.get('format'))
  const safeName = (campaign.name || 'campaign').replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const date = new Date().toISOString().slice(0, 10)

  return dataResponse(format, safeName + '-recipients-' + date, [{
    name: 'Recipients',
    headers,
    rows,
  }])
}
