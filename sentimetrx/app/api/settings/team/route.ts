import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { user_id, role } = await req.json()
  if (!user_id || !role) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

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
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { user_id } = await req.json()
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
