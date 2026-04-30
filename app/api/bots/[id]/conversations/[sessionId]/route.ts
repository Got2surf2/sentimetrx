// app/api/bots/[id]/conversations/[sessionId]/route.ts
// GET — get all turns for a specific conversation session
// DELETE — delete all turns for a session + associated persona

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: { id: string; sessionId: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify user owns this bot
  const { data: botCheck } = await supabase
    .from('bots')
    .select('id')
    .eq('id', params.id)
    .single()
  if (!botCheck) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })

  const { data: turns, error } = await supabase
    .from('bot_conversation_turns')
    .select('id, turn_number, role, content, content_en, language, created_at, content_flags, source')
    .eq('bot_id', params.id)
    .eq('session_id', params.sessionId)
    .order('turn_number', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ turns: turns || [] })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: botCheck } = await supabase
    .from('bots')
    .select('id')
    .eq('id', params.id)
    .single()
  if (!botCheck) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })

  // Delete turns
  const { error } = await supabase
    .from('bot_conversation_turns')
    .delete()
    .eq('bot_id', params.id)
    .eq('session_id', params.sessionId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Delete associated persona (if any)
  await supabase
    .from('bot_session_personas')
    .delete()
    .eq('bot_id', params.id)
    .eq('session_id', params.sessionId)

  return NextResponse.json({ deleted: true })
}
