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
import { resolveScopeMembers } from '@/lib/collectionScope'
import { randomUUID, randomBytes } from 'crypto'
import {
  buildStoryPayload, deterministicNarrative, narrativePrompt, parseNarrative,
  renderDataStory, STORY_ROW_CAP,
} from '@/lib/dataStory'
import { themeSetForField, type ThemeModel } from '@/lib/themeUtils'
import type { SchemaFieldConfig, DatasetAnalytics } from '@/lib/analyzeTypes'

const BUCKET = 'report-exports'
const EXPIRY_SECONDS = 7 * 24 * 60 * 60

// A 50K-row fetch + recount + AI pass can outlive the default budget.
export const maxDuration = 120

interface Params { params: Promise<{ datasetId: string }> }

export async function POST(req: Request, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Optional body: { fields } — the verbatim selection active in the UI.
  // The story is then told about THAT question's theme set (owner, 2026-09-04),
  // not whatever selection happened to be persisted as the model's top level.
  let requestedFields: string[] = []
  try {
    const body = await req.json()
    if (Array.isArray(body?.fields)) requestedFields = body.fields.map(String).filter(Boolean)
  } catch { /* body is optional — old callers send none */ }

  const service = createServiceRoleClient()
  const { data: dataset } = await service
    .from('datasets').select('id, org_id, name, row_count, source').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) {
    return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  }
  const isCollection = dataset.source === 'collection'

  const { data: stateRow } = await service
    .from('dataset_state').select('theme_model, schema_config, analytics')
    .eq('dataset_id', params.datasetId).maybeSingle()
  const storedModel = (stateRow?.theme_model ?? null) as ThemeModel | null
  let themeModel = storedModel
  if (requestedFields.length && storedModel) {
    // Resolve the UI selection's own theme set (per-field map, 2026-07-11).
    // A selection that was never mined gets an honest 400, not a story told
    // about a different question's themes.
    const focused = themeSetForField(storedModel, requestedFields)
    if (!focused?.themes?.length) {
      return NextResponse.json({
        error: 'No themes have been mined for the selected question yet — mine themes on it first, then build the story.',
      }, { status: 400 })
    }
    themeModel = focused
  }
  if (!themeModel?.themes?.length) {
    return NextResponse.json({ error: 'Mine themes first — a Data Story is built from the theme model.' }, { status: 400 })
  }
  const fields = ((stateRow?.schema_config as { fields?: SchemaFieldConfig[] } | null)?.fields) || []
  const analytics = (stateRow?.analytics ?? null) as DatasetAnalytics | null

  try {
    // Rows for the recount — capped; evenSample inside the builder past the cap.
    // A COLLECTION owns no rows (owner, 2026-09-04): fan out to the members,
    // split the cap proportionally, and TAG each row with its member's label —
    // the members then become the story's segments (per-member profiles).
    const rows: Record<string, unknown>[] = []
    async function pageRows(dsId: string, cap: number, tag: string | null) {
      for (let from = 0; from < cap; from += 1000) {
        const { data: page, error } = await service
          .from('dataset_rows_flat').select('data').eq('dataset_id', dsId)
          .order('row_index', { ascending: true }).range(from, Math.min(from + 999, cap - 1))
        if (error) throw error
        for (const p of (page || []) as { data: Record<string, unknown> }[]) {
          rows.push(tag != null ? { ...p.data, __member__: tag } : p.data)
        }
        if (!page || page.length < 1000) break
      }
    }
    if (isCollection) {
      const members = (await resolveScopeMembers(service, params.datasetId))
        .filter(m => m.datasetId !== params.datasetId)
      const { data: memberDs } = await service
        .from('datasets').select('id, name, row_count').in('id', members.map(m => m.datasetId))
      const rowsOf = new Map(((memberDs || []) as { id: string; name: string | null; row_count: number | null }[])
        .map(d => [d.id, { rows: Number(d.row_count) || 0, name: d.name || 'Member' }]))
      const totalMemberRows = members.reduce((s, m) => s + (rowsOf.get(m.datasetId)?.rows || 0), 0) || 1
      for (const m of members) {
        const info = rowsOf.get(m.datasetId)
        if (!info?.rows) continue
        const share = Math.max(1000, Math.round(STORY_ROW_CAP * info.rows / totalMemberRows))
        await pageRows(m.datasetId, Math.min(share, info.rows), m.label || info.name)
      }
    } else {
      await pageRows(params.datasetId, STORY_ROW_CAP, null)
    }
    if (!rows.length) return NextResponse.json({ error: 'No rows to tell a story about.' }, { status: 400 })

    const storyFields = isCollection
      ? [...fields, { field: '__member__', label: 'Member', type: 'categorical' } as SchemaFieldConfig]
      : fields
    const payload = buildStoryPayload({
      rows, themeModel, datasetName: dataset.name || 'Dataset',
      totalRows: Number(dataset.row_count) || rows.length, fields: storyFields, analytics,
      preferSegmentField: isCollection ? '__member__' : undefined,
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

async function gateStoryDataset(supabase: Awaited<ReturnType<typeof createClient>>, datasetId: string): Promise<NextResponse | { service: ReturnType<typeof createServiceRoleClient>; dataset: { id: string; org_id: string }; orgId: string }> {
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const service = createServiceRoleClient()
  const { data: dataset } = await service
    .from('datasets').select('id, org_id').eq('id', datasetId).single()
  if (!dataset || (!isAdmin && dataset.org_id !== orgId)) {
    return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  }
  return { service, dataset: dataset as { id: string; org_id: string }, orgId }
}

export async function GET(_req: Request, props: Params) {
  const params = await props.params
  const supabase = await createClient()
  const gate = await gateStoryDataset(supabase, params.datasetId)
  if (gate instanceof NextResponse) return gate
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
  if (gate instanceof NextResponse) return gate

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
