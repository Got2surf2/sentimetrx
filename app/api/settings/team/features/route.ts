import { createClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { ModuleFeatures } from '@/lib/types'

const MODULE_KEYS: (keyof ModuleFeatures)[] = [
  'surveys', 'analyze', 'googleReviews', 'reddit', 'substack', 'townhall', 'campaigns', 'bots',
]

// PATCH /api/settings/team/features — update a user's feature flags
export async function PATCH(req: NextRequest) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  const { user_id, features } = body
  if (!user_id || !features || typeof features !== 'object') {
    return NextResponse.json({ error: 'Missing user_id or features' }, { status: 400 })
  }

  // Verify caller is owner in the same org
  const { data: actor } = await supabase
    .from('users')
    .select('org_id, role, organizations(features)')
    .eq('id', user.id)
    .single()

  if (!actor?.org_id) return NextResponse.json({ error: 'No org' }, { status: 403 })
  if (actor.role !== 'owner') {
    return NextResponse.json({ error: 'Only owners can manage permissions' }, { status: 403 })
  }

  // Verify target is in same org
  const { data: target } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user_id)
    .single()

  if (!target || target.org_id !== actor.org_id) {
    return NextResponse.json({ error: 'Not in same org' }, { status: 403 })
  }

  // Sanitize: only allow module keys that the org has enabled
  const orgRaw = Array.isArray(actor.organizations) ? actor.organizations[0] : actor.organizations
  const orgFeatures: ModuleFeatures = (orgRaw as any)?.features || {}
  const sanitized: ModuleFeatures = {}
  for (const key of MODULE_KEYS) {
    if (orgFeatures[key] && features[key]) {
      sanitized[key] = true
    }
  }

  const { error } = await supabase
    .from('users')
    .update({ features: sanitized })
    .eq('id', user_id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, features: sanitized })
}
