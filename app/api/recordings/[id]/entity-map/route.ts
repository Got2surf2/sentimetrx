// app/api/recordings/[id]/entity-map/route.ts
//
// POST — edit the recording's entity map (name/term spelling corrections,
// §3.5b) AFTER generation, from the report. Body: { entities: [{ canonical,
// variants[], type?, mentions? }] }. The transcript's "corrected view" applies
// this on reload; the extracted/polished Q&A only picks it up on a re-analyze
// (that's why the primary editor is the pre-analysis gate — this is the
// fix-it-later path).
//
// Auth: recording OWNER or an admin org. Service-role read pairs id with the
// caller's org for non-admins (404 cross-org).

import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const MAX_ENTITIES = 300

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing recording id' }, { status: 400 })

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  type OrgRel = { is_admin_org?: boolean }
  type UserRow = { org_id?: string | null; organizations?: OrgRel | OrgRel[] | null }
  const orgId = (userRow as UserRow | null)?.org_id as string | undefined
  const orgRel = (userRow as UserRow | null)?.organizations
  const isAdminOrg = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org === true : orgRel?.is_admin_org === true
  if (!orgId) return NextResponse.json({ error: 'org not found' }, { status: 403 })

  const body = await req.json().catch(() => ({}))
  if (!Array.isArray(body?.entities)) {
    return NextResponse.json({ error: 'entities must be an array' }, { status: 400 })
  }

  // Sanitize: trim canonical, dedupe + trim variants, drop blank canonicals, cap.
  type RawEntity = { canonical?: unknown; variants?: unknown; type?: unknown; mentions?: unknown }
  const entities = (body.entities as RawEntity[]).slice(0, MAX_ENTITIES).map(e => ({
    canonical: String(e?.canonical ?? '').trim().slice(0, 120),
    variants: Array.isArray(e?.variants)
      ? Array.from(new Set(e.variants.map((v: unknown) => String(v ?? '').trim()).filter(Boolean))).slice(0, 40)
      : [],
    type: ['name', 'place', 'org', 'term'].includes(e?.type as string) ? (e.type as string) : 'term',
    mentions: Number.isFinite(e?.mentions) ? Math.max(0, Math.floor(e.mentions as number)) : 1,
  })).filter(e => e.canonical)

  const service = createServiceRoleClient()
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id, org_id, created_by, entity_map')
    .eq('id', recording_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAdminOrg && rec.org_id !== orgId) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (!isAdminOrg && rec.created_by !== user.id) {
    return NextResponse.json({ error: 'only the recording owner or an admin can edit the entity map' }, { status: 403 })
  }

  const extracted_at = (rec.entity_map as { extracted_at?: string } | null)?.extracted_at ?? new Date().toISOString()
  const entity_map = entities.length
    ? { entities, extracted_at, reviewed_at: new Date().toISOString() }
    : null

  const { error: updErr } = await service
    .from('recordings')
    .update({ entity_map })
    .eq('id', recording_id)
    .eq('org_id', rec.org_id)
  if (updErr) return serverError(updErr, 'recordings.entityMap', { orgId: rec.org_id })

  return NextResponse.json({ ok: true, count: entities.length })
}
