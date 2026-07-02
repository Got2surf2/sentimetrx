// app/api/datasets/[datasetId]/operational-review-deck/route.ts
// GET — render the merged "Operational Review" deck as a Datanautix-branded
// PPTX: ONE report combining the independent-acquirer diligence framing with the
// operator-grade improvement-plan detail, plus a NEW Dimensions (aspect-
// sentiment ABSA) section. Backed by the outlet predictor + lib/diligenceData,
// with an optional one-time live competitor benchmark (lib/competitorBenchmark)
// and the persisted taxonomy rollup (lib/taxonomyRollup). Org-scoped (the owning
// org or an admin), per the deck-export brand exception.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { computeOutletPredictor } from '@/lib/outletReport'
import { computeDiligenceData } from '@/lib/diligenceData'
import { computeCompetitorBenchmark } from '@/lib/competitorBenchmark'
import { computeTaxonomyRollup } from '@/lib/taxonomyRollup'
import { taxonomyFieldKey } from '@/lib/dimensionFields'
import { buildOperationalReviewDeck, type OperationalOpts } from '@/lib/pptx/operationalReviewDeck'
import { renderDeck } from '@/lib/pptx/slideRenderer'
import type { SupabaseClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Detect the dataset's default free-text field for the Dimensions rollup — same
// rule as app/api/datasets/[datasetId]/taxonomy/route.ts: sample rows, keep
// columns whose values are mostly multi-word strings of reasonable length, prefer
// `review_text`. Falls back to the first text-like column, else null.
async function detectDefaultTextField(service: SupabaseClient, datasetId: string): Promise<string | null> {
  const { data: rows } = await service
    .from('dataset_rows_flat').select('data').eq('dataset_id', datasetId)
    .order('row_index', { ascending: true }).limit(25)

  const stat: Record<string, { strs: number; spaced: number; len: number }> = {}
  for (const r of (rows ?? []) as { data: Record<string, unknown> }[]) {
    for (const [k, v] of Object.entries(r.data ?? {})) {
      const s = stat[k] ?? (stat[k] = { strs: 0, spaced: 0, len: 0 })
      if (typeof v === 'string' && v.trim()) {
        s.strs++; s.len += v.trim().length
        if (/\s/.test(v.trim())) s.spaced++
      }
    }
  }

  const sampled = (rows ?? []).length
  const candidates = Object.entries(stat)
    .filter(([, s]) => s.strs >= Math.max(1, sampled * 0.5) && s.spaced >= s.strs * 0.4 && s.len / s.strs >= 12)
    .map(([field, s]) => ({ field, avgLen: s.len / s.strs }))
    .sort((a, b) => b.avgLen - a.avgLen)

  return candidates.find(c => c.field === 'review_text')?.field || candidates[0]?.field || null
}

export async function GET(req: NextRequest, props: { params: Promise<{ datasetId: string }> }) {
  const { datasetId } = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: ds } = await service.from('datasets').select('org_id, name').eq('id', datasetId).single()
  if (!ds) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && ds.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const predictor = await computeOutletPredictor(datasetId)
  if (!predictor.available || predictor.brandLevers.length === 0) {
    return NextResponse.json({ error: 'Not enough rated, themed reviews across outlets to build a plan.' }, { status: 400 })
  }

  const brand = ds.name || 'Brand'
  const dd = await computeDiligenceData(datasetId)

  // Brand search name for the live competitor pull. The dataset name often carries
  // a "… Reviews" suffix that isn't in the real Google listing name (e.g. "Ruths
  // Chris Reviews" vs "Ruth's Chris Steak House"), which breaks the contains-match
  // and returns a brand rating of 0. Prefer the review_source brand_name, then
  // strip a trailing "reviews" / "restaurant reviews".
  const { data: src } = await service
    .from('review_sources').select('brand_name').eq('dataset_id', datasetId).maybeSingle()
  const brandSearch = ((src?.brand_name || brand).replace(/\s*(restaurant\s+)?reviews?\s*$/i, '').trim()) || brand

  const url = new URL(req.url)
  const competitorNames = (url.searchParams.get('competitors') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const franchiseStates = (url.searchParams.get('franchiseStates') || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const preparedFor = url.searchParams.get('preparedFor')?.trim() || undefined
  const title = url.searchParams.get('title')?.trim() || undefined
  const subtitle = url.searchParams.get('subtitle')?.trim() || undefined
  const preparedBy = url.searchParams.get('preparedBy')?.trim() || undefined

  const opts: OperationalOpts = { franchiseStates, preparedFor, title, subtitle, preparedBy }

  // Optional one-time live competitor benchmark. Never 500 the whole report if
  // the live pull fails — just ship the deck without the competitor slide.
  if (competitorNames.length) {
    try {
      const bench = await computeCompetitorBenchmark(brandSearch, competitorNames, dd.topMarkets)
      if (bench.competitors.length && bench.brandLifetime.rating > 0) {
        opts.brandLifetime = bench.brandLifetime
        opts.competitors = bench.competitors
      }
    } catch (e) {
      console.warn('[operational-review-deck] competitor benchmark pull failed; shipping without competitor slide:', e)
    }
  }

  // Dimensions (aspect-sentiment ABSA) rollup. Derive the default text field,
  // map it to its persisted taxonomy storage key, and read the rollup. Non-fatal
  // — null or no-signal simply omits the dimensions section from the deck.
  const field = await detectDefaultTextField(service, datasetId)
  const fieldKey = field ? taxonomyFieldKey([field]) : null
  const dimensions = fieldKey
    ? await computeTaxonomyRollup({ service, datasetId, orgId: ds.org_id, field: fieldKey }).catch(() => null)
    : null
  opts.dimensions = dimensions

  const deck = buildOperationalReviewDeck(predictor, dd, brand, opts)
  const buffer = await renderDeck(deck, brand)
  const fileName = brand.replace(/[^a-z0-9]+/gi, '_') + '_Operational_Review.pptx'

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
