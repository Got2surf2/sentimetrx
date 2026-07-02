// app/api/bots/[id]/export/route.ts
// GET — download a full bot snapshot as JSON: row config + all knowledge chunks.
// Format is versioned ("bot_export_version": 1) so future shape changes can
// be migrated on import. Org-member or admin-org gated.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org
  const userOrgId = (userData as any)?.org_id as string | null

  const service = createServiceRoleClient()
  const { data: bot, error } = await service.from('agents').select('*').eq('id', params.id).single()
  if (error || !bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && (bot as any).org_id !== userOrgId) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }

  const { data: chunks } = await service
    .from('agent_knowledge_chunks')
    .select('title, content, metadata')
    .eq('bot_id', params.id)
    .order('created_at', { ascending: true })

  // Fields we strip from the export — IDs / timestamps / FKs that don't
  // round-trip into a new bot. The importer re-creates them.
  const STRIP = new Set(['id', 'org_id', 'created_at', 'updated_at', 'last_session_at', 'created_by', 'next_review_at'])
  const cleanBot: Record<string, unknown> = {}
  for (const k of Object.keys(bot as any)) {
    if (!STRIP.has(k)) cleanBot[k] = (bot as any)[k]
  }

  const payload = {
    bot_export_version: 1,
    exported_at: new Date().toISOString(),
    source_bot_id: params.id,
    source_bot_name: (bot as any).name,
    source_bot_slug: (bot as any).slug,
    bot: cleanBot,
    chunks: (chunks || []).map(c => ({ title: c.title, content: c.content, metadata: c.metadata })),
  }

  const safeName = String((bot as any).slug || (bot as any).name || 'bot').replace(/[^a-z0-9_-]/gi, '_')
  const filename = 'bot_' + safeName + '_' + new Date().toISOString().slice(0, 10) + '.json'

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
    },
  })
}
