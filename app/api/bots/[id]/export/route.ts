// app/api/bots/[id]/export/route.ts
// GET — download a full bot snapshot as JSON: row config + all knowledge chunks.
// Format is versioned ("bot_export_version": 1) so future shape changes can
// be migrated on import. Org-member or admin-org gated.
// Manifest shape lives in lib/promotion.ts (shared with scripts/promote.ts).

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { buildAgentManifest } from '@/lib/promotion'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  type OrgRel = { is_admin_org: boolean | null }
  type UserData = { org_id: string | null; organizations: OrgRel | OrgRel[] | null }
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as UserData | null)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!orgRel?.is_admin_org
  const userOrgId = (userData as UserData | null)?.org_id ?? null

  type BotRow = { org_id: string | null; name: string | null; slug: string | null }
  const service = createServiceRoleClient()
  const { data: bot, error } = await service.from('agents').select('org_id, name, slug').eq('id', params.id).single()
  if (error || !bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  const botRow = bot as BotRow
  if (!isAdmin && botRow.org_id !== userOrgId) {
    return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  }

  const payload = await buildAgentManifest(service, params.id)

  const safeName = String(botRow.slug || botRow.name || 'bot').replace(/[^a-z0-9_-]/gi, '_')
  const filename = 'bot_' + safeName + '_' + new Date().toISOString().slice(0, 10) + '.json'

  return new NextResponse(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
    },
  })
}
