// app/api/datasets/[datasetId]/story/route.ts
// POST — generate a Data Story: a self-contained narrative HTML page built
// from the dataset's ENGINE numbers (lib/dataStory), uploaded to the private
// `report-exports` bucket, returned as a shareable /api/story link.
//   - EXPIRY: the signed token embedded in the link (7 days).
//   - REVOCATION: delete the storage object; every link dies instantly.
// The AI writes narrative PROSE only, constrained to payload figures; on any
// AI failure the deterministic narrative ships instead — the story never
// blocks on the model and never carries numbers the engine didn't compute.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { serverError } from '@/lib/apiError'
import { randomUUID } from 'crypto'
import {
  buildStoryPayload, deterministicNarrative, narrativePrompt, parseNarrative,
  renderDataStory, STORY_ROW_CAP,
} from '@/lib/dataStory'
import type { ThemeModel } from '@/lib/themeUtils'
import type { SchemaFieldConfig, DatasetAnalytics } from '@/lib/analyzeTypes'

const BUCKET = 'report-exports'
const EXPIRY_SECONDS = 7 * 24 * 60 * 60

// A 50K-row fetch + recount + AI pass can outlive the default budget.
export const maxDuration = 120

interface Params { params: Promise<{ datasetId: string }> }

export async function POST(_req: Request, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: dataset } = await service
    .from('datasets').select('id, org_id, name, row_count').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) {
    return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  }

  const { data: stateRow } = await service
    .from('dataset_state').select('theme_model, schema_config, analytics')
    .eq('dataset_id', params.datasetId).maybeSingle()
  const themeModel = (stateRow?.theme_model ?? null) as ThemeModel | null
  if (!themeModel?.themes?.length) {
    return NextResponse.json({ error: 'Mine themes first — a Data Story is built from the theme model.' }, { status: 400 })
  }
  const fields = ((stateRow?.schema_config as { fields?: SchemaFieldConfig[] } | null)?.fields) || []
  const analytics = (stateRow?.analytics ?? null) as DatasetAnalytics | null

  try {
    // Rows for the recount — capped; evenSample inside the builder past the cap.
    const rows: Record<string, unknown>[] = []
    for (let from = 0; rows.length < STORY_ROW_CAP; from += 1000) {
      const { data: page, error } = await service
        .from('dataset_rows_flat').select('data').eq('dataset_id', params.datasetId)
        .order('row_index', { ascending: true }).range(from, from + 999)
      if (error) return serverError(error, 'datasets.story.rows', { orgId })
      rows.push(...((page || []) as { data: Record<string, unknown> }[]).map(p => p.data))
      if (!page || page.length < 1000) break
    }
    if (!rows.length) return NextResponse.json({ error: 'No rows to tell a story about.' }, { status: 400 })

    const payload = buildStoryPayload({
      rows, themeModel, datasetName: dataset.name || 'Dataset',
      totalRows: Number(dataset.row_count) || rows.length, fields, analytics,
    })

    // Narrative: AI prose over the computed facts; deterministic on failure.
    let narrative = deterministicNarrative(payload)
    try {
      const prompt = narrativePrompt(payload)
      const res = await callAI({
        tier: 'standard', maxTokens: 700, timeoutMs: 45000,
        system: prompt.system, messages: [{ role: 'user', content: prompt.user }],
      })
      logUsage({ org_id: dataset.org_id, resource_type: 'dataset', resource_id: dataset.id, event_type: 'data_story' }, res.usage)
      narrative = parseNarrative(res.text || '', narrative)
    } catch { /* deterministic narrative ships */ }

    const html = renderDataStory({ ...payload, narrative })

    const path = `reports/${params.datasetId}/story-${randomUUID()}.html`
    const { error: uploadErr } = await service.storage.from(BUCKET).upload(path, Buffer.from(html, 'utf-8'), {
      // EXACTLY 'text/html' — the prod bucket's allowed_mime_types matches the
      // string verbatim, and 'text/html; charset=utf-8' is rejected ("mime type
      // not supported", prod 2026-09-02). The /api/story viewer re-adds the
      // charset on the response header, so readers lose nothing.
      contentType: 'text/html', upsert: false,
    })
    if (uploadErr) return serverError(uploadErr, 'datasets.story.upload', { orgId })

    const { data: signed, error: signErr } = await service.storage.from(BUCKET).createSignedUrl(path, EXPIRY_SECONDS)
    if (signErr || !signed) return serverError(signErr, 'datasets.story.sign', { orgId })

    // Serve through OUR domain (/api/story) — Supabase's storage host refuses
    // to render text/html (anti-phishing), a raw signed URL shows page source.
    const token = new URL(signed.signedUrl).searchParams.get('token') || ''
    return NextResponse.json({
      url: `/api/story/${path}?token=${encodeURIComponent(token)}`,
      storagePath: path,
      expiresInDays: 7,
    })
  } catch (e) {
    return serverError(e, 'datasets.story', { orgId })
  }
}
