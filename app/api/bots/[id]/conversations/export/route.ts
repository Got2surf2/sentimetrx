// app/api/bots/[id]/conversations/export/route.ts
// GET ?format=csv|xlsx — export all conversations for a bot.
//   ?shape=turns (default) — one row per turn (Session, Turn, Role, Content, …)
//   ?shape=pairs          — one row per Q&A pair (Question → Answer), the
//                           "list of every question/answer" export.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { dataResponse, parseExportFormat } from '@/lib/xlsxExport'
import { loadExportTurns, turnsSheet, pairsSheet } from '@/lib/agentExport'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: userData } = await service
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org : (orgRel as any)?.is_admin_org
  const userOrgId = (userData as any)?.org_id as string | null

  const { data: bot } = await service.from('agents').select('id, name, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== userOrgId) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const turns = await loadExportTurns(service, params.id)
  if (!turns || turns.length === 0) {
    return NextResponse.json({ error: 'No conversations to export' }, { status: 404 })
  }

  const format = parseExportFormat(req.nextUrl.searchParams.get('format'))
  const shape = req.nextUrl.searchParams.get('shape') === 'pairs' ? 'pairs' : 'turns'
  const safeName = bot.name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_')

  if (shape === 'pairs') {
    const fileBase = safeName + '_QA_Pairs'
    return dataResponse(format, fileBase, [await pairsSheet(service, params.id, turns, bot.name)])
  }

  const fileBase = safeName + '_Conversations'
  return dataResponse(format, fileBase, [turnsSheet(turns)])
}
