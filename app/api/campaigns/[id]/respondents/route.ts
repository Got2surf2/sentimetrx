// app/api/campaigns/[id]/respondents/route.ts
// GET  — list respondents for a campaign
// POST — bulk upload respondents with field mapping

import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
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

  // Use service role to bypass campaign_respondents RLS
  const service = createServiceRoleClient()

  // Verify the campaign belongs to the caller's org before reading respondents.
  const { data: campaign } = await service
    .from('campaigns')
    .select('org_id')
    .eq('id', params.id)
    .single()
  if (!campaign || (!isAdmin && campaign.org_id !== userData.org_id)) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  const status = req.nextUrl.searchParams.get('status')
  const limit = parseInt(req.nextUrl.searchParams.get('limit') || '500')
  const offset = parseInt(req.nextUrl.searchParams.get('offset') || '0')

  let query = service
    .from('campaign_respondents')
    .select('*', { count: 'exact' })
    .eq('campaign_id', params.id)
    .order('created_at', { ascending: true })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)

  const { data, error, count } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ respondents: data || [], total: count || 0 })
}

function generateGuid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

export async function POST(req: NextRequest, { params }: Params) {
  const supabase = createClient()
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

  // Verify campaign exists AND belongs to the caller's org.
  const { data: campaign } = await service
    .from('campaigns')
    .select('id, org_id')
    .eq('id', params.id)
    .single()

  if (!campaign || (!isAdmin && campaign.org_id !== userData.org_id)) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { respondents } = body
  if (!Array.isArray(respondents) || respondents.length === 0) {
    return NextResponse.json({ error: 'respondents array is required' }, { status: 400 })
  }

  // Validate emails
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const invalid: string[] = []
  const valid: { email: string; fields: Record<string, string> }[] = []

  for (const r of respondents) {
    if (!r.email || !emailRegex.test(r.email)) {
      invalid.push(r.email || '(empty)')
    } else {
      valid.push({ email: r.email.toLowerCase().trim(), fields: r.fields || {} })
    }
  }

  if (valid.length === 0) {
    return NextResponse.json({ error: 'No valid email addresses found', invalid }, { status: 400 })
  }

  // Check which emails already exist for this campaign
  const existingEmails = new Set<string>()
  const { data: existing } = await service
    .from('campaign_respondents')
    .select('email')
    .eq('campaign_id', params.id)

  if (existing) {
    for (const e of existing) existingEmails.add(e.email)
  }

  // Only insert new respondents (skip duplicates)
  const newRows = valid
    .filter(r => !existingEmails.has(r.email))
    .map(r => ({
      campaign_id: params.id,
      email: r.email,
      fields: r.fields,
      status: 'pending',
      recipient_guid: generateGuid(),
    }))

  let insertedCount = 0
  if (newRows.length > 0) {
    const { data: inserted, error } = await service
      .from('campaign_respondents')
      .insert(newRows)
      .select('id')

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    insertedCount = inserted?.length || newRows.length
  }

  return NextResponse.json({
    imported: insertedCount,
    skipped_duplicate: valid.length - newRows.length,
    skipped_invalid: invalid.length,
    invalid: invalid.slice(0, 10),
  }, { status: 201 })
}

// DELETE — remove one or more respondents by ID (only if pending)
export async function DELETE(req: NextRequest, { params }: Params) {
  const supabase = createClient()
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

  let body: { respondent_ids: string[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  if (!body.respondent_ids?.length) return NextResponse.json({ error: 'respondent_ids required' }, { status: 400 })

  const service = createServiceRoleClient()

  // Verify the campaign belongs to the caller's org before deleting respondents.
  const { data: campaign } = await service
    .from('campaigns')
    .select('org_id')
    .eq('id', params.id)
    .single()
  if (!campaign || (!isAdmin && campaign.org_id !== userData.org_id)) {
    return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })
  }

  // Only delete respondents that are still pending (haven't been sent yet)
  const { data: deleted, error } = await service
    .from('campaign_respondents')
    .delete()
    .eq('campaign_id', params.id)
    .in('id', body.respondent_ids)
    .in('status', ['pending'])
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ deleted: deleted?.length || 0 })
}
