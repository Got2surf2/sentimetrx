import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { isValidDomainAspect, REO_SENTIMENTS, REO_SEVERITIES, type ReoObservation } from '@/lib/reoVocabulary'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

// Resolve the calling admin's org_id (for the multi-tenancy id+org_id pairing).
async function adminOrgId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return (data as any)?.org_id ?? null
}

export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  const orgId = await adminOrgId()
  if (!orgId) return NextResponse.json({ error: 'no org' }, { status: 400 })

  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('reo_gold_review')
    .select('id, ext_review_id, rating, review_text, proposed, gold, reviewer_note, status, reviewed_at')
    .eq('org_id', orgId)
    .order('ext_review_id', { ascending: true })
  if (error) return serverError(error, 'admin.reoGoldSet.list', { orgId })

  const reviews = data || []
  const counts = reviews.reduce((a: Record<string, number>, r: any) => {
    a[r.status] = (a[r.status] || 0) + 1; return a
  }, {})
  return NextResponse.json({ reviews, total: reviews.length, counts })
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const orgId = await adminOrgId()
  if (!orgId) return NextResponse.json({ error: 'no org' }, { status: 400 })

  const body = await req.json().catch(() => null)
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const status: string = body.status === 'skipped' ? 'skipped'
    : body.status === 'approved' ? 'approved' : 'edited'

  let gold: ReoObservation[] | null = null
  if (status !== 'skipped') {
    if (!Array.isArray(body.gold)) return NextResponse.json({ error: 'gold must be an array' }, { status: 400 })
    // validate every observation against the closed REO vocabulary
    for (const o of body.gold) {
      if (!isValidDomainAspect(o?.domain, o?.aspect))
        return NextResponse.json({ error: `invalid domain/aspect: ${o?.domain} / ${o?.aspect}` }, { status: 400 })
      if (!(REO_SENTIMENTS as readonly string[]).includes(o?.sentiment))
        return NextResponse.json({ error: `invalid sentiment: ${o?.sentiment}` }, { status: 400 })
      if (o?.severity && !(REO_SEVERITIES as readonly string[]).includes(o.severity))
        return NextResponse.json({ error: `invalid severity: ${o.severity}` }, { status: 400 })
    }
    gold = body.gold.map((o: any): ReoObservation => ({
      domain: o.domain, aspect: o.aspect, sentiment: o.sentiment,
      evidence: o.evidence || undefined,
      severity: o.severity || 'none',
      note: o.note || undefined,
    }))
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const service = createServiceRoleClient()
  const { error } = await service
    .from('reo_gold_review')
    .update({
      gold,
      reviewer_note: typeof body.reviewer_note === 'string' ? body.reviewer_note : null,
      status,
      reviewed_at: new Date().toISOString(),
      reviewed_by: user?.id ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', body.id)
    .eq('org_id', orgId)   // id + org_id pairing (cross-tenant guard)
  if (error) return serverError(error, 'admin.reoGoldSet.update', { orgId })

  return NextResponse.json({ ok: true, status })
}
