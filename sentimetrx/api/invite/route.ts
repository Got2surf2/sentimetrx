import { createClient } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/invite — create a new invite token (admin only)
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify the user is a platform admin
  const { data: userData } = await supabase
    .from('users')
    .select('role')
    .eq('id', user.id)
    .single()

  if (userData?.role !== 'platform_admin') {
    return NextResponse.json({ error: 'Only platform admins can create invites' }, { status: 403 })
  }

  const { client_id, email, role } = await req.json()

  if (!client_id) {
    return NextResponse.json({ error: 'client_id is required' }, { status: 400 })
  }

  const serviceSupabase = createServiceRoleClient()

  const { data, error } = await serviceSupabase
    .from('invites')
    .insert({
      client_id,
      email:      email || null,
      role:       role || 'owner',
      created_by: user.id,
    })
    .select('id, token, email, expires_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://sentimetrx.ai'
  return NextResponse.json({
    ...data,
    invite_url: `${base}/invite/${data.token}`,
  }, { status: 201 })
}

// GET /api/invite?token=xxx — validate an invite token (public)
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Missing token' }, { status: 400 })

  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('invites')
    .select('id, token, email, role, used_at, expires_at, clients(name, slug)')
    .eq('token', token)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Invalid invite link' }, { status: 404 })
  }

  if (data.used_at) {
    return NextResponse.json({ error: 'This invite has already been used' }, { status: 410 })
  }

  if (new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This invite has expired' }, { status: 410 })
  }

  return NextResponse.json(data)
}
