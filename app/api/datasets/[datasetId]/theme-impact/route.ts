// app/api/datasets/[datasetId]/theme-impact/route.ts
// Key driver analysis: OLS regression of a numeric target field on binary theme indicators.
// For each theme, returns the coefficient (impact on the target score), p-value, and significance.
// Also returns R² (how much variance the themes collectively explain).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { expandLemma } from '@/lib/lemmas'
import { olsRegression, type RegressionResult } from '@/lib/statsUtils'

type Coef = RegressionResult['coefs'][number]

interface Props { params: Promise<{ datasetId: string }> }

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Lemma-aware keyword regex (same as themeUtils but server-side)
function buildKwRegex(kw: string): RegExp {
  const forms = expandLemma(kw)
  const seen: Record<string, boolean> = {}
  const alts: string[] = []
  for (let i = 0; i < forms.length; i++) {
    const alt = forms[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*'
    if (!seen[alt]) { seen[alt] = true; alts.push(alt) }
  }
  const escOrig = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*'
  if (!seen[escOrig]) alts.push(escOrig)
  return new RegExp('(?<![a-z])(?:' + alts.join('|') + ')', 'i')
}

function matchesTheme(text: string, keywords: string[]): boolean {
  if (!keywords || !keywords.length) return false
  const lower = text.toLowerCase()
  for (let i = 0; i < keywords.length; i++) {
    if (buildKwRegex(keywords[i]).test(lower)) return true
  }
  return false
}

export async function POST(req: Request, props: Props) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cross-org gate: service-role read of the dataset's rows below — confirm the
  // caller's org owns the dataset first (admin-org bypass preserved).
  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  {
    const svc = createServiceRoleClient()
    const { data: dsOrg } = await svc.from('datasets').select('org_id').eq('id', params.datasetId).single()
    if (!dsOrg) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
    if (!isAdmin && (dsOrg as { org_id?: string }).org_id !== orgId) {
      return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
    }
  }

  let body: {
    targetField: string         // numeric field key (e.g. "overall_sat")
    textFields: string[]        // open-ended field keys to match themes against
    themes: { id: string; name: string; keywords: string[] }[]
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { targetField, textFields, themes } = body
  if (!targetField || !textFields?.length || !themes?.length) {
    return NextResponse.json({ error: 'Provide targetField, textFields, and themes' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Stream rows and build regression data. Reads dataset_rows_flat (the sole
  // source of truth) — one record per row in the `data` JSONB column. (Ported
  // from the removed legacy `dataset_rows` batch table 2026-07-02, which this
  // route still read, silently returning empty analysis.)
  const FLAT_PAGE = 1000
  const MAX_ROWS = 10_000
  let page = 0
  let hasMore = true

  // Normalize field keys
  let keyMap: Record<string, string> = {}
  let keyMapBuilt = false
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

  // Pre-compile theme regexes
  const themeRegexes = themes.map(t => ({
    id: t.id,
    name: t.name,
    regexes: (t.keywords || []).filter(Boolean).map(buildKwRegex),
  }))

  // Collect Y values and X matrix (binary theme indicators per row)
  const yValues: number[] = []
  const xMatrix: number[][] = []  // each row is [theme1_present, theme2_present, ...]
  const themeCounts: number[] = new Array(themes.length).fill(0)

  while (hasMore && yValues.length < MAX_ROWS) {
    const from = page * FLAT_PAGE
    const { data: flatRows, error: flatErr } = await service
      .from('dataset_rows_flat')
      .select('data')
      .eq('dataset_id', params.datasetId)
      .order('row_index', { ascending: true })
      .range(from, from + FLAT_PAGE - 1)

    if (flatErr) return NextResponse.json({ error: 'Failed to read dataset rows' }, { status: 500 })
    if (!flatRows || flatRows.length === 0) { hasMore = false; break }

    for (const fr of flatRows) {
      if (yValues.length >= MAX_ROWS) { hasMore = false; break }
      const row = (fr as { data?: Record<string, unknown> }).data
      if (!row) continue

      if (!keyMapBuilt) {
        for (const k of Object.keys(row)) keyMap[normalize(k)] = k
        keyMapBuilt = true
      }

      // Get target value
      const targetKey = keyMap[normalize(targetField)] || targetField
      const yRaw = row[targetKey]
      const y = parseFloat(String(yRaw ?? ''))
      if (isNaN(y)) continue

      // Get text from all text fields
      const texts: string[] = []
      for (const tf of textFields) {
        const tfKey = keyMap[normalize(tf)] || tf
        const v = row[tfKey]
        if (v != null && String(v).trim()) texts.push(String(v).trim())
      }
      const combinedText = texts.join(' ')
      if (!combinedText) continue

      // Binary theme indicators
      const indicators: number[] = []
      for (let ti = 0; ti < themeRegexes.length; ti++) {
        const matched = themeRegexes[ti].regexes.length > 0 && themeRegexes[ti].regexes.some(re => re.test(combinedText.toLowerCase()))
        indicators.push(matched ? 1 : 0)
        if (matched) themeCounts[ti]++
      }

      yValues.push(y)
      xMatrix.push(indicators)
    }

    if (flatRows.length < FLAT_PAGE) hasMore = false
    page++
  }

  if (yValues.length < 30) {
    return NextResponse.json({ error: 'Not enough rows with both a numeric score and text (' + yValues.length + ' found, need 30+)' }, { status: 400 })
  }

  // Filter out themes with too few mentions (< 5) — unstable coefficients
  const validThemeIndices: number[] = []
  for (let ti = 0; ti < themes.length; ti++) {
    if (themeCounts[ti] >= 5) validThemeIndices.push(ti)
  }

  if (validThemeIndices.length === 0) {
    return NextResponse.json({ error: 'No themes have enough mentions (5+) to run regression' }, { status: 400 })
  }

  // Build filtered X matrix with only valid themes
  const filteredX = xMatrix.map(row => validThemeIndices.map(ti => row[ti]))
  const themeNames = validThemeIndices.map(ti => themes[ti].name)

  // Run OLS regression
  const result = olsRegression(yValues, filteredX, themeNames) as RegressionResult | null

  if (!result) {
    return NextResponse.json({ error: 'Regression failed — possible multicollinearity or insufficient variance' }, { status: 400 })
  }

  // Build per-theme output
  const themeImpacts = result.coefs
    .filter((c: Coef) => c.name !== 'Intercept')
    .map((c: Coef) => {
      const ti = validThemeIndices[result.coefs.indexOf(c) - 1] // -1 for intercept
      return {
        themeId: ti !== undefined ? themes[ti]?.id : null,
        themeName: c.name,
        coefficient: Math.round(c.beta * 1000) / 1000,
        pValue: Math.round(c.p * 10000) / 10000,
        significant: c.p < 0.05,
        ci: c.ci ? [Math.round(c.ci[0] * 1000) / 1000, Math.round(c.ci[1] * 1000) / 1000] : null,
        mentions: ti !== undefined ? themeCounts[ti] : 0,
      }
    })
    .sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient))

  const intercept = result.coefs.find((c: Coef) => c.name === 'Intercept')

  return NextResponse.json({
    themeImpacts,
    intercept: intercept ? Math.round(intercept.beta * 1000) / 1000 : null,
    rSquared: Math.round(result.R2 * 10000) / 10000,
    adjustedR2: Math.round(result.R2adj * 10000) / 10000,
    fStat: Math.round(result.F * 100) / 100,
    fPValue: Math.round(result.Fp * 10000) / 10000,
    n: yValues.length,
    themeCount: validThemeIndices.length,
    targetField,
  })
}
