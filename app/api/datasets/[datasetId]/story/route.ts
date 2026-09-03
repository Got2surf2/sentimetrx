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
import { randomUUID, randomBytes } from 'crypto'
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
        tier: 'standard', maxTokens: 2000, timeoutMs: 60000,
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

    // Short link (sql/198): mint a crypto-random slug; the data_stories row
    // carries the editable lifecycle (expires_at / revoked_at) and the
    // /story/[slug] viewer serves it. Falls back to the signed-URL token link
    // when the insert fails — deploy-order safety for a database that hasn't
    // run sql/198 yet (same pattern as the PGRST202 retries in aggregate).
    const slug = Array.from(randomBytes(12), (b) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('')
    const { error: rowErr } = await service.from('data_stories').insert({
      org_id: dataset.org_id, dataset_id: dataset.id, slug,
      title: dataset.name || 'Data Story', storage_path: path, created_by: userId,
      expires_at: new Date(Date.now() + EXPIRY_SECONDS * 1000).toISOString(),
    })
    if (!rowErr) {
      return NextResponse.json({ url: `/story/${slug}`, storagePath: path, expiresInDays: 7 })
    }

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

// ── Share-tab link management (GET list · PATCH revoke/extend) ──────────────
// The slug is the capability, so management is strictly org-gated: every
// data_stories query pairs dataset_id with the gated dataset's org_id
// (multi-tenancy invariant — service-role queries never filter by id alone).

async function gateStoryDataset(supabase: Awaited<ReturnType<typeof createClient>>, datasetId: string) {
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return { fail: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const service = createServiceRoleClient()
  const { data: dataset } = await service
    .from('datasets').select('id, org_id').eq('id', datasetId).single()
  if (!dataset || (!isAdmin && dataset.org_id !== orgId)) {
    return { fail: NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 }) }
  }
  return { service, dataset: dataset as { id: string; org_id: string }, orgId }
}

export async function GET(_req: Request, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const gate = await gateStoryDataset(supabase, params.datasetId)
  if ('fail' in gate) return gate.fail
  const { data, error } = await gate.service
    .from('data_stories')
    .select('id, slug, title, created_at, expires_at, revoked_at')
    .eq('dataset_id', params.datasetId).eq('org_id', gate.dataset.org_id)
    .order('created_at', { ascending: false })
  // A pre-sql/198 DB has no table — an empty list keeps the UI section hidden.
  return NextResponse.json({ stories: error ? [] : (data || []) })
}

export async function PATCH(req: Request, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const gate = await gateStoryDataset(supabase, params.datasetId)
  if ('fail' in gate) return gate.fail

  let body: { storyId?: string; action?: string; days?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }) }
  const { storyId, action } = body
  if (!storyId || (action !== 'revoke' && action !== 'extend')) {
    return NextResponse.json({ error: 'storyId and action (revoke | extend) are required' }, { status: 400 })
  }

  const { data: story } = await gate.service
    .from('data_stories').select('id, expires_at, revoked_at')
    .eq('id', storyId).eq('dataset_id', params.datasetId).eq('org_id', gate.dataset.org_id)
    .maybeSingle()
  if (!story) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })

  let patch: { revoked_at?: string; expires_at?: string }
  if (action === 'revoke') {
    patch = { revoked_at: new Date().toISOString() }
  } else {
    // Extend from whichever is later — now (revives an expired link) or the
    // current expiry (adds time to a live one). Revocation is not undone here.
    const days = Math.min(90, Math.max(1, Math.round(Number(body.days) || 7)))
    const base = Math.max(Date.now(), new Date(story.expires_at as string).getTime())
    patch = { expires_at: new Date(base + days * 86400e3).toISOString() }
  }
  const { error: upErr } = await gate.service
    .from('data_stories').update(patch)
    .eq('id', storyId).eq('dataset_id', params.datasetId).eq('org_id', gate.dataset.org_id)
  if (upErr) return serverError(upErr, 'datasets.story.manage', { orgId: gate.orgId })
  return NextResponse.json({ ok: true, ...patch })
}
