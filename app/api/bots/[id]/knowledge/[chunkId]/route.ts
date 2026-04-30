// app/api/bots/[id]/knowledge/[chunkId]/route.ts
// PATCH  — update a single knowledge chunk (title, content)
// DELETE — delete a single knowledge chunk

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string; chunkId: string } }

export async function PATCH(req: NextRequest, { params }: Params) {
  var supabase = createClient()
  var { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var body = await req.json()
  var updates: Record<string, unknown> = {}
  if (typeof body.title === 'string') updates.title = body.title
  if (typeof body.content === 'string') updates.content = body.content

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  var service = createServiceRoleClient()

  // Verify chunk belongs to this bot
  var { data: chunk } = await service
    .from('bot_knowledge_chunks')
    .select('id')
    .eq('id', params.chunkId)
    .eq('bot_id', params.id)
    .single()

  if (!chunk) return NextResponse.json({ error: 'Chunk not found' }, { status: 404 })

  var { error } = await service
    .from('bot_knowledge_chunks')
    .update(updates)
    .eq('id', params.chunkId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  var supabase = createClient()
  var { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var service = createServiceRoleClient()

  var { error } = await service
    .from('bot_knowledge_chunks')
    .delete()
    .eq('id', params.chunkId)
    .eq('bot_id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
