import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { generateStudyGuid } from '@/lib/guid'

// GET /api/studies - list studies visible to current user
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // RLS handles visibility filtering automatically
  const { data, error } = await supabase
    .from('studies')
    .select('id, guid, name, bot_name, bot_emoji, status, visibility, created_by, created_at, config')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/studies - create a new study
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get the user's org_id
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, client_id')
    .eq('id', user.id)
    .single()

  if (!userData?.org_id) {
    return NextResponse.json({ error: 'No organization associated with this user' }, { status: 403 })
  }

  const body = await req.json()
  const { name, bot_name, bot_emoji, config, visibility } = body

  if (!name || !bot_name || !config) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const guid = generateStudyGuid()

  const { data, error } = await supabase
    .from('studies')
    .insert({
      guid,
      org_id:     userData.org_id,
      client_id:  userData.client_id,  // kept for backward compat
      created_by: user.id,
      name,
      bot_name,
      bot_emoji:  bot_emoji || '💬',
      status:     'draft',
      visibility: visibility || 'private',
      config,
    })
    .select('id, guid')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
