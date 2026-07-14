// app/api/bots/[id]/knowledge/route.ts
// GET  — list all knowledge chunks for a bot
// POST — ingest text/markdown into chunks (splits by headings, stores with tsvector)
// DELETE — clear all knowledge chunks for a bot

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { logBotChange } from '@/lib/auditLog'
import { serverError } from '@/lib/apiError'
import { ingestKnowledgeText, KnowledgeInsertError } from '@/lib/botKnowledge/ingest'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

type OrgRel = { is_admin_org: boolean | null }
type UserWithOrg = { org_id: string | null; organizations: OrgRel | OrgRel[] | null }

// ── GET: list chunks ──────────────────────────────────────────
export async function GET(_req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as UserWithOrg | null)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!orgRel?.is_admin_org
  const userOrgId = (userData as UserWithOrg | null)?.org_id ?? null

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== userOrgId) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }

  const { data: chunks } = await service
    .from('agent_knowledge_chunks')
    .select('id, title, content, metadata, created_at')
    .eq('bot_id', params.id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ chunks: chunks || [], count: chunks?.length || 0 })
}

// ── POST: ingest text → chunks ────────────────────────────────
export async function POST(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { text, source, source_type, replace } = body as { text: string; source?: string; source_type?: string; replace?: boolean }
  if (!text || text.trim().length < 10) {
    return NextResponse.json({ error: 'text is required (min 10 chars)' }, { status: 400 })
  }

  // Verify bot ownership (admin-org bypass: platform admins can write cross-org)
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgRel = (userData as UserWithOrg | null)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!orgRel?.is_admin_org

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id, subject, opponents, capability, capability_config').eq('id', params.id).single()
  if (!bot || (!isAdmin && bot.org_id !== userData.org_id)) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }

  try {
    const result = await ingestKnowledgeText(service, bot, text, {
      source,
      sourceType: source_type,
      replace,
      actor: { id: user.id, email: user.email || null },
    })
    if (result.message && result.stored === 0 && !result.removed && !result.skipped) {
      // No chunkable content at all → 400 (mirrors the old behavior).
      if (result.message === 'No meaningful content found') {
        return NextResponse.json({ error: result.message }, { status: 400 })
      }
    }
    return NextResponse.json(result)
  } catch (e) {
    if (e instanceof KnowledgeInsertError) return serverError(e.cause, 'bots.knowledge.store')
    return serverError(e, 'bots.knowledge.store')
  }
}

// ── DELETE: clear chunks (all, or by source_type) ────────────
export async function DELETE(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as UserWithOrg | null)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!orgRel?.is_admin_org
  const userOrgId = (userData as UserWithOrg | null)?.org_id ?? null

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== userOrgId) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }

  const url = new URL(req.url)
  const sourceType = url.searchParams.get('source_type')

  // Count what's about to disappear so the audit-log entry has a number.
  let countQ = service.from('agent_knowledge_chunks').select('id', { count: 'exact', head: true }).eq('bot_id', params.id)
  if (sourceType) countQ = countQ.contains('metadata', { source_type: sourceType })
  const { count: chunkCount } = await countQ

  let query = service.from('agent_knowledge_chunks').delete().eq('bot_id', params.id)

  if (sourceType) {
    // Delete only chunks tagged with this source_type
    query = query.contains('metadata', { source_type: sourceType })
  }

  const { error } = await query
  if (error) return serverError(error, 'bots.knowledge.list')

  void logBotChange({
    botId: params.id,
    orgId: bot.org_id,
    actorId: user.id,
    actorEmail: user.email || null,
    action: 'knowledge_cleared',
    summary: 'Cleared ' + (chunkCount ?? 0) + ' knowledge chunk' + (chunkCount === 1 ? '' : 's') + (sourceType ? ' (source_type=' + sourceType + ')' : ' (all sources)'),
    metadata: { source_type: sourceType || null, chunks_removed: chunkCount ?? 0 },
  })

  return NextResponse.json({ cleared: true, source_type: sourceType || 'all', chunks_removed: chunkCount ?? 0 })
}
