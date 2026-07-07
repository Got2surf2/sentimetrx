// app/api/social/auto-config/route.ts
// GET/PATCH — auto-reply and auto-hide settings
// Stored in organizations.features.social_auto_config

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'
import { resolveOrg } from '@/lib/resolveOrg'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

async function getAuth(supabase: Awaited<ReturnType<typeof createClient>>) {
  const user = await getAuthUser(supabase)
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id, organizations(features, is_admin_org)').eq('id', user.id).single()
  const org = resolveOrg(data?.organizations)
  return { userId: user.id, orgId: data?.org_id as string | null, features: org?.features || {} }
}

const DEFAULT_CONFIG = {
  auto_reply_enabled: false,
  auto_reply_mode: 'queue', // 'all', 'positive_neutral', 'queue' (human review)
  auto_hide_enabled: false,
  auto_hide_severity: 'severe', // 'severe', 'rude' (severe + rude)
  auto_delete_enabled: false,
  moderation_sensitivity: 'moderate', // 'strict' | 'moderate' | 'lenient'
}

export async function GET() {
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const config = { ...DEFAULT_CONFIG, ...(auth.features?.social_auto_config || {}) }
  return NextResponse.json({ config })
}

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const updates = await req.json()
  const current = { ...DEFAULT_CONFIG, ...(auth.features?.social_auto_config || {}) }
  const merged = { ...current, ...updates }

  const service = createServiceRoleClient()
  const newFeatures = { ...auth.features, social_auto_config: merged }

  const { error } = await service
    .from('organizations')
    .update({ features: newFeatures })
    .eq('id', auth.orgId)

  if (error) return serverError(error, 'social.autoConfig.update', { orgId: auth.orgId })
  return NextResponse.json({ config: merged })
}
