// app/api/brands/route.ts
// GET — distinct brand tags in the caller's org. Powers the brand-tag
// autocomplete on dataset-create forms: picking an existing brand lands the
// new dataset in the same brand-collection (and shares its entity catalog).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'

export const dynamic = 'force-dynamic'

export async function GET() {
  const supabase = createClient()
  const { userId, orgId } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ brands: [] })

  const service = createServiceRoleClient()
  const { data } = await service
    .from('datasets')
    .select('brand_tag')
    .eq('org_id', orgId)
    .not('brand_tag', 'is', null)

  // Distinct, case-insensitive, keeping the first-seen casing.
  const seen = new Set<string>()
  const brands: string[] = []
  for (const r of (data || []) as Array<{ brand_tag: string | null }>) {
    const t = (r.brand_tag || '').trim()
    if (!t) continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    brands.push(t)
  }
  brands.sort((a, b) => a.localeCompare(b))

  return NextResponse.json({ brands })
}
