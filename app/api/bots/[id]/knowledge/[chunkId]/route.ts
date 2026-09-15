// app/api/bots/[id]/knowledge/[chunkId]/route.ts
// PATCH  — update a single knowledge chunk (title, content)
// DELETE — delete a single knowledge chunk

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { generateEmbedding } from '@/lib/embeddings'
import { serverError } from '@/lib/apiError'
import { gateResourceForUser, type GateDenied } from '@/lib/auth/gate'
import { logError } from '@/lib/log'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string; chunkId: string }> }

async function gateBotAccess(service: ReturnType<typeof createServiceRoleClient>, userId: string, botId: string): Promise<{ ok: true; orgId: string } | GateDenied> {
  const gate = await gateResourceForUser(service, userId, 'agent', botId)
  return gate.ok ? { ok: true, orgId: gate.targetOrgId } : gate
}

export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  var supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var body = await req.json()
  var updates: Record<string, unknown> = {}
  if (typeof body.title === 'string') updates.title = body.title
  if (typeof body.content === 'string') updates.content = body.content

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
  }

  var service = createServiceRoleClient()

  const gate = await gateBotAccess(service, user.id, params.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  // Verify chunk belongs to this bot (and grab current text for re-embedding)
  var { data: chunk } = await service
    .from('agent_knowledge_chunks')
    .select('id, title, content')
    .eq('id', params.chunkId)
    .eq('bot_id', params.id)
    .single()

  if (!chunk) return NextResponse.json({ error: 'Chunk not found' }, { status: 404 })

  // D2: the tsvector auto-refreshes via trigger on title/content change, but
  // the pgvector `embedding` does NOT — leaving it would keep semantically
  // matching the OLD text forever. Re-embed the (merged) new text on every
  // edit. Blocking, one chunk, cheap. On failure clear the embedding rather
  // than keep a stale one — the chunk stays findable via the lexical fallback.
  const existing = chunk as { title?: string | null; content?: string | null }
  const newTitle = typeof updates.title === 'string' ? updates.title : (existing.title || '')
  const newContent = typeof updates.content === 'string' ? updates.content : (existing.content || '')
  try {
    const emb = await generateEmbedding(newTitle + '\n' + newContent, gate.orgId ?? undefined)
    updates.embedding = emb ? JSON.stringify(emb) : null
  } catch (e: unknown) {
    void logError('bots.knowledge.chunk.update', e instanceof Error ? e.message : undefined, { msg: 'Re-embed failed; clearing stale embedding' })
    updates.embedding = null
  }

  var { error } = await service
    .from('agent_knowledge_chunks')
    .update(updates)
    .eq('id', params.chunkId)

  if (error) return serverError(error, 'bots.knowledge.chunk.update')
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, props: Params) {
  const params = await props.params;
  var supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var service = createServiceRoleClient()

  const gate = await gateBotAccess(service, user.id, params.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  var { error } = await service
    .from('agent_knowledge_chunks')
    .delete()
    .eq('id', params.chunkId)
    .eq('bot_id', params.id)

  if (error) return serverError(error, 'bots.knowledge.chunk.delete')
  return NextResponse.json({ deleted: true })
}
