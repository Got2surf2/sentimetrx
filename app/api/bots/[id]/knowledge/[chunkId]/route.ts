// app/api/bots/[id]/knowledge/[chunkId]/route.ts
// PATCH  — update a single knowledge chunk (title, content)
// DELETE — delete a single knowledge chunk

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string; chunkId: string }> }

async function gateBotAccess(supabase: Awaited<ReturnType<typeof createClient>>, service: ReturnType<typeof createServiceRoleClient>, userId: string, botId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  type OrgRel = { is_admin_org: boolean | null }
  type UserRow = { org_id: string | null; organizations: OrgRel | OrgRel[] | null }
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', userId)
    .single()
  const orgRel = (userData as UserRow | null)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!orgRel?.is_admin_org
  const userOrgId = (userData as UserRow | null)?.org_id ?? null

  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', botId).single()
  if (!bot) return { ok: false, status: 404, error: 'Bot not found' }
  if (!isAdmin && (bot as { org_id: string | null }).org_id !== userOrgId) return { ok: false, status: 404, error: 'Bot not found' }
  return { ok: true }
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

  const gate = await gateBotAccess(supabase, service, user.id, params.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  // Verify chunk belongs to this bot
  var { data: chunk } = await service
    .from('agent_knowledge_chunks')
    .select('id')
    .eq('id', params.chunkId)
    .eq('bot_id', params.id)
    .single()

  if (!chunk) return NextResponse.json({ error: 'Chunk not found' }, { status: 404 })

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

  const gate = await gateBotAccess(supabase, service, user.id, params.id)
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  var { error } = await service
    .from('agent_knowledge_chunks')
    .delete()
    .eq('id', params.chunkId)
    .eq('bot_id', params.id)

  if (error) return serverError(error, 'bots.knowledge.chunk.delete')
  return NextResponse.json({ deleted: true })
}
