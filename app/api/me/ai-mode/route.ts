// app/api/me/ai-mode/route.ts
// Returns the caller's org AI mode so the UI can hide / disable AI
// features when an org has set ai_key_mode='off'. The server-side gate
// in lib/ai.ts, lib/embeddings.ts, lib/moderation.ts, and ask-ana is
// the actual guarantee — this endpoint is just for UX.
//
// No admin required. Returns mode only (never the BYOK secret or
// set-by metadata — that's the /api/admin/orgs/[id]/ai-key endpoint).

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { resolveOrgAiConfig } from '@/lib/aiKey'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users').select('org_id').eq('id', user.id).single()
  const orgId = (userRow as any)?.org_id as string | undefined
  if (!orgId) return NextResponse.json({ mode: 'platform', enabled: true })

  const cfg = await resolveOrgAiConfig(orgId)
  return NextResponse.json({
    mode:     cfg.mode,
    provider: cfg.provider,
    enabled:  cfg.mode !== 'off',
  })
}
