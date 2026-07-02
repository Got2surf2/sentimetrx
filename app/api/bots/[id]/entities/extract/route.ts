// app/api/bots/[id]/entities/extract/route.ts
// POST — trigger an entity extraction run for this bot's KB.
// Powers the "Re-extract entities" button on /bots/[id]/entities.
//
// docs/BOTS.md § 9.y.2 — manual trigger only (no auto-extraction on KB
// chunk insert per § 9.y open Q1).
//
// Service role + paired (id, org_id) check on the agent row per CLAUDE.md
// multi-tenancy invariants. Invalidates the in-memory entity cache on
// success so the next user turn picks up freshly discovered entities.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { serverError } from '@/lib/apiError'
import { extractBotEntities } from '@/lib/botEntityExtraction'
import { invalidateEntityCache } from '@/lib/entityMentionDetector'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface Params { params: Promise<{ id: string }> }

export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  const { data: bot } = await service.from('agents').select('id, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && (bot as any).org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const result = await extractBotEntities(service, {
      botId: params.id,
      orgId: (bot as any).org_id,
      triggeredByUser: userId,
    })
    invalidateEntityCache(params.id)
    return NextResponse.json({
      ok: true,
      added: result.added,
      total: result.total,
      cost_cents: result.costCents,
      duration_ms: result.durationMs,
      brand_pushed: result.brandPushed,
    })
  } catch (e: any) {
    return serverError(e, 'bots.entities.extract', { orgId: (bot as any).org_id })
  }
}
