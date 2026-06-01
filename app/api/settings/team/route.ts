import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/settings/team — list all users in the caller's org
export async function GET(_req: NextRequest) {
  var supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var { data: actor } = await supabase.from('users').select('org_id, role').eq('id', user.id).single()
  if (!actor?.org_id) return NextResponse.json({ error: 'No org' }, { status: 403 })

  var { data: members, error } = await supabase
    .from('users')
    .select('id, email, full_name, role, created_at, disabled, features')
    .eq('org_id', actor.org_id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ members: members || [] })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const { user_id, role } = body
  if (!user_id || !role) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

  const ALLOWED_ROLES = ['owner', 'admin', 'member', 'viewer']
  if (!ALLOWED_ROLES.includes(body.role)) return NextResponse.json({ error: 'Invalid role' }, { status: 400 })

  const { data: actor } = await supabase.from('users').select('org_id, role').eq('id', user.id).single()
  const { data: target } = await supabase.from('users').select('org_id').eq('id', user_id).single()

  if (!actor || !target || actor.org_id !== target.org_id) {
    return NextResponse.json({ error: 'Not in same org' }, { status: 403 })
  }
  if (actor.role !== 'owner') {
    return NextResponse.json({ error: 'Only owners can change roles' }, { status: 403 })
  }

  const { error } = await supabase.from('users').update({ role }).eq('id', user_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const { user_id } = body
  if (!user_id) return NextResponse.json({ error: 'Missing user_id' }, { status: 400 })
  if (user_id === user.id) return NextResponse.json({ error: 'Cannot remove yourself' }, { status: 400 })

  const { data: actor } = await supabase.from('users').select('org_id, role').eq('id', user.id).single()
  const { data: target } = await supabase.from('users').select('org_id').eq('id', user_id).single()

  if (!actor || !target || actor.org_id !== target.org_id) {
    return NextResponse.json({ error: 'Not in same org' }, { status: 403 })
  }
  if (actor.role !== 'owner') {
    return NextResponse.json({ error: 'Only owners can remove members' }, { status: 403 })
  }

  const { error } = await supabase.from('users').update({ org_id: null }).eq('id', user_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
