import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { generateStudyGuid } from '@/lib/guid'
import type { StudyConfig } from '@/lib/types'

// GET /api/studies — list studies for the current user's client
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('studies')
    .select(`
      id, guid, name, bot_name, bot_emoji, status, created_at, updated_at,
      config->theme,
      responses(count)
    `)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/studies — create a new study
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get the user's client_id
  const { data: userData } = await supabase
    .from('users')
    .select('client_id, org_id')
    .eq('id', user.id)
    .single()

  const body = await req.json()
  const { name, bot_name, bot_emoji, config } = body

  if (!name || !bot_name || !config) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const guid = generateStudyGuid()

  const { data, error } = await supabase
    .from('studies')
    .insert({
      guid,
      client_id:  userData?.client_id || null,
      org_id:     userData?.org_id    || null,
      created_by: user.id,
      name,
      bot_name,
      bot_emoji:  bot_emoji || '💬',
      status:     body.status === 'active' ? 'active' : 'draft',
      config,
    })
    .select('id, guid')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
