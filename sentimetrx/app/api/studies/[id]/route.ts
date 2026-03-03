import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

export async function GET(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('studies')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = userData?.organizations
  const isAdmin = Array.isArray(orgData)
    ? orgData[0]?.is_admin_org
    : (orgData as any)?.is_admin_org

  const body = await req.json()

  if (body.status === 'closed' && !isAdmin) {
    return NextResponse.json({ error: 'Only admins can close a study' }, { status: 403 })
  }

  const { data: existing } = await supabase
    .from('studies')
    .select('status, created_by')
    .eq('id', params.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (existing.status === 'closed' && !isAdmin) {
    return NextResponse.json({ error: 'This study has been closed by an admin' }, { status: 403 })
  }

  if (!isAdmin && existing.created_by !== user.id) {
    return NextResponse.json({ error: 'You can only edit your own studies' }, { status: 403 })
  }

  const allowed = ['name', 'bot_name', 'bot_emoji', 'status', 'config', 'visibility']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('studies')
    .update(updates)
    .eq('id', params.id)
    .select('id, guid, status, visibility')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: study } = await supabase
    .from('studies')
    .select('id, name, created_by, status')
    .eq('id', params.id)
    .single()

  if (!study) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = userData?.organizations
  const isAdmin = Array.isArray(orgData)
    ? orgData[0]?.is_admin_org
    : (orgData as any)?.is_admin_org

  if (!isAdmin && study.created_by !== user.id) {
    return NextResponse.json({ error: 'You can only delete your own studies' }, { status: 403 })
  }

  const { error } = await supabase
    .from('studies')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { statu
