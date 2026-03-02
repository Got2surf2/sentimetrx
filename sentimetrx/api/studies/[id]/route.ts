import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

interface Params { params: { id: string } }

// GET /api/studies/[id] — get full study including config
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

// PATCH /api/studies/[id] — update study (config, status, name etc)
export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  // Only allow updating these fields — never client_id or guid
  const allowed = ['name', 'bot_name', 'bot_emoji', 'status', 'config']
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
    .select('id, guid, status')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/studies/[id] — delete study and ALL responses (cascade)
export async function DELETE(_req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Confirm the study belongs to this user's client before deleting
  const { data: study } = await supabase
    .from('studies')
    .select('id, name')
    .eq('id', params.id)
    .single()

  if (!study) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // RLS ensures this only deletes if the study belongs to the user's client
  const { error } = await supabase
    .from('studies')
    .delete()
    .eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Return 200 with confirmation (not 204) so client can show success message
  return NextResponse.json({ success: true, deleted: study.name })
}
