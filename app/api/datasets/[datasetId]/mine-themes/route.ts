// app/api/datasets/[datasetId]/mine-themes/route.ts
// Proxies Claude AI theme mining.
// Default: caller org piggybacks on the server's ANTHROPIC_API_KEY (every
// other AI route already does this — usage_log captures per-org spend so
// we can bill back or cap if needed). A user-supplied apiKey in the body
// is still accepted and takes precedence (kept for BYO-key edge cases).
// Proprietary system prompt stays server-side and never reaches the browser.

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { serverError } from '@/lib/apiError'
import {
  type MinedTheme,
  scanThemes, pruneDeadKeywords, deficientThemes,
  mergeKeywordAdditions, applyMeasuredCoverage, buildRefinePrompt,
} from '@/lib/themeMining'

export const dynamic     = 'force-dynamic'
export const maxDuration = 300 // main mine (up to 100s) + refine; consensus mining runs 3 of these in parallel

interface Props { params: Promise<{ datasetId: string }> }

export async function POST(request: Request, props: Props) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Check dataset access (RLS will enforce org membership)
  const { data: dataset } = await supabase
    .from('datasets')
    .select('id')
    .eq('id', params.datasetId)
    .single()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  let body: {
    apiKey?: string
    texts?: string[]
    fieldName?: string
    schemaCtx?: string
    sampleNote?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { apiKey, texts, fieldName, schemaCtx, sampleNote } = body

  // No more NO_API_KEY rejection. callAI() falls back to ANTHROPIC_API_KEY
  // env when body.apiKey is undefined, so customer orgs piggyback on the
  // server key by default. Usage is logged per-org in usage_log.
  if (!texts || !texts.length) {
    return NextResponse.json({ error: 'No text provided' }, { status: 400 })
  }

  // Proprietary prompt -- never sent to browser
  const systemPrompt =
    'You are a qualitative research expert. Return ONLY raw JSON -- no markdown, no backticks. Start with { and end with }.'

  const corpusText = texts.map(function(t, i) { return (i + 1) + '. ' + t }).join('\n')
  const fieldLabel = fieldName || 'responses'
  const schemaLine = schemaCtx ? '\n\nSchema: ' + schemaCtx : ''
  // Consensus mining passes the stratified sample's composition so the AI
  // doesn't collapse a mixed sample into its dominant tone (the 2026-09-03
  // EA Football failure: an "overwhelmingly negative" draw lost the corpus's
  // positive theme entirely). Truncated defensively — it's prompt text.
  const sampleLine = sampleNote && typeof sampleNote === 'string' ? '\n\n' + sampleNote.slice(0, 600) : ''
  const userMsg =
    'Thematic analysis on ' + texts.length + ' responses for field \'' + fieldLabel + '\'.' +
    schemaLine + sampleLine + '\n\nResponses:\n' + corpusText +
    '\n\nIdentify 4-7 distinct themes. For each theme, provide 8-15 keywords. Keywords are matched ' +
    'against responses by word stem (multi-word phrases match their words in order, allowing a few ' +
    'words in between), so every keyword must be wording that LITERALLY appears in the responses:\n' +
    '- Prefer single distinctive words respondents actually wrote (e.g. "overcooked", "pricey", "understaffed")\n' +
    '- Informal/colloquial variants they used (e.g. "meh" for mediocre)\n' +
    '- A 2-3 word phrase ONLY when a single word is too ambiguous ("wait time", "portion size")\n' +
    '- Never invent paraphrase-phrases the respondents did not write\n\n' +
    '\n\nAlso judge whether these responses are reviews or feedback about a ' +
    'RESTAURANT, bar, café, or other food-service venue (food/drink/service/dining), ' +
    'as opposed to a hotel, retailer, clinic, app, or anything non-food-service. ' +
    'Return that as a boolean "foodService".\n\n' +
    'Return:\n' +
    '{"themes":[{"id":"t1","name":"Name","description":"One sentence.",' +
    '"keywords":["core term","synonym1","synonym2","informal variant","short phrase"],' +
    '"sentiment":"positive","count":0,"percentage":0,"relatedThemes":[]}],' +
    '"summary":"2-3 sentences.","fieldName":"' + fieldLabel + '","foodService":false}'

  try {
    let result
    try {
      // 100s, not 60: consensus mining fires 3 of these in parallel, and the
      // measured spread on a 350-review sample is ~55-70s — at 60s exactly one
      // of the three timed out in three consecutive generations (2026-09-03),
      // silently shrinking every consensus to 2 runs.
      result = await callAI({
        tier: 'standard',
        maxTokens: 4000,
        timeoutMs: 100000,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMsg }],
        apiKey,
      })
    } catch (e: unknown) {
      const err = e as { status?: number; message?: string }
      const status = err.status || 500
      if (status === 401) return NextResponse.json({ error: 'AUTH_ERROR: ' + err.message }, { status: 401 })
      if (status === 429) return NextResponse.json({ error: 'QUOTA_ERROR: ' + err.message }, { status: 429 })
      return NextResponse.json({ error: 'API_' + status + ': ' + err.message }, { status })
    }

    const { orgId } = await getCallerOrgContext(supabase)
    logUsage({ org_id: orgId ?? undefined, resource_type: 'dataset', resource_id: params.datasetId, event_type: 'mine_themes' }, result.usage)

    const rawText = result.text

    const clean = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()
    let parsed: { themes?: unknown[]; summary?: string; fieldName?: string; foodService?: boolean }
    try {
      parsed = JSON.parse(clean)
    } catch {
      return NextResponse.json({ error: 'Could not parse themes from AI response' }, { status: 500 })
    }

    if (!parsed || !Array.isArray(parsed.themes) || !parsed.themes.length) {
      return NextResponse.json({ error: 'AI returned no themes' }, { status: 500 })
    }

    // ── Corpus validation (2026-07-13) ─────────────────────────────────
    // The AI reads the sample and estimates each theme's prevalence, but the
    // product counts by keyword scan — and nothing ever checked the two
    // against each other. Measured gap on Carrabba's GSS "Liked Least":
    // AI said 28/25/16/13/12% per theme, the keywords it invented matched
    // 7/3/2/2/0.3% (63 of 105 keywords matched ≤1 of 3,000 comments).
    // Scan the sample with the REAL matcher; where coverage falls far short
    // of the AI's own estimate, feed the unmatched responses back once so it
    // extends keywords with the respondents' literal wording; prune keywords
    // that match nothing; restate count/percentage from the scan so the
    // stored model reports the same numbers every UI surface will show.
    let themes = parsed.themes as MinedTheme[]
    let refined = false
    try {
      let scan = scanThemes(texts, themes)
      const deficient = deficientThemes(themes, scan, texts.length)
      if (deficient.length && scan.unmatched.length >= 10) {
        try {
          const refineResult = await callAI({
            tier: 'standard',
            maxTokens: 2000,
            timeoutMs: 45000,
            system: systemPrompt,
            messages: [{ role: 'user', content: buildRefinePrompt(deficient, scan.unmatched) }],
            apiKey,
          })
          const refineClean = refineResult.text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()
          const refineParsed = JSON.parse(refineClean) as { additions?: { id: string; keywords: string[] }[] }
          if (Array.isArray(refineParsed.additions) && refineParsed.additions.length) {
            themes = mergeKeywordAdditions(themes, refineParsed.additions)
            scan = scanThemes(texts, themes)
            refined = true
          }
          logUsage({ org_id: orgId ?? undefined, resource_type: 'dataset', resource_id: params.datasetId, event_type: 'mine_themes' }, refineResult.usage)
        } catch { /* refinement is best-effort — keep the initial themes */ }
      }
      themes = pruneDeadKeywords(themes, scan)
      scan = scanThemes(texts, themes) // recount post-prune (pruning never changes matches, but keeps kwCounts aligned)
      themes = applyMeasuredCoverage(themes, scan, texts.length)
      parsed.themes = themes
      ;(parsed as Record<string, unknown>).fit = {
        sampleFitPct: texts.length ? Math.round((scan.union / texts.length) * 100) : 0,
        refined,
      }
    } catch { /* validation must never block mining — worst case is pre-validation behavior */ }

    // Smart Dimensions: act on the AI's restaurant judgement. food-service →
    // enable (the client then auto-classifies) and clear any prior suppression.
    // NOT food-service → suppress, which hides the restaurant taxonomy for an
    // otherwise google_reviews-proxied dataset (a hotel/clinic's reviews); we
    // leave taxonomy_enabled alone so an explicit manual opt-in still wins.
    // Best-effort; never blocks the themes response.
    if (parsed.foodService === true) {
      await supabase.from('datasets').update({ taxonomy_enabled: true, taxonomy_suppressed: false }).eq('id', params.datasetId)
    } else if (parsed.foodService === false) {
      await supabase.from('datasets').update({ taxonomy_suppressed: true }).eq('id', params.datasetId)
    }

    return NextResponse.json(parsed)
  } catch (e: unknown) {
    return serverError(e, 'datasets.mineThemes')
  }
}
