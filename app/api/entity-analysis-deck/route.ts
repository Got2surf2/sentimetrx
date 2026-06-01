// GET /api/entity-analysis-deck — entity analysis of an open-ended field.
// Built to be additive to a StoryTime deck (uses the same renderDeck() so the
// look-and-feel matches exactly).
//
// Pulls rows from a dataset (or collection — expanded to member datasets),
// extracts the named field, splits multi-entity responses (commas, "and",
// semicolons, newlines), AI-canonicalises variants ("Red Cross" / "ARC" /
// "American Red Cross" → one entity), categorises, and renders 4 slides:
//   1. Entity grid — top 24 by mentions
//   2. Bar chart  — by category
//   3. Entity grid — the long tail (next 24)
//   4. Quotes     — representative raw mentions
//
// Query params:
//   ?dataset=<id>   (required) dataset OR collection-dataset id
//   ?field=<name>   (optional) field name; default "Charities donated to"
//   ?title=<text>   (optional) deck title; default "Entity Analysis"

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { renderDeck, type DeckSpec } from '@/lib/pptx/slideRenderer'
import { aggregateEntities, entitySlideSpecs } from '@/lib/entityAnalysis'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { logDeckDownload } from '@/lib/auth/logDeckDownload'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const MAX_ROWS = 10_000
const DEFAULT_FIELD = 'Charities donated to'

// ── Route handler ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied

  const url = new URL(req.url)
  const datasetId = url.searchParams.get('dataset')?.trim()
  const field = (url.searchParams.get('field') || DEFAULT_FIELD).trim()
  const customTitle = url.searchParams.get('title')?.trim() || null
  if (!datasetId) {
    return new NextResponse('Missing ?dataset=<id>', { status: 400 })
  }
  await logDeckDownload('entity-analysis-deck', `${datasetId}:${field}`)

  const service = createServiceRoleClient()

  // ── Resolve dataset / collection ──
  const { data: dataset } = await service
    .from('datasets')
    .select('id, name, source')
    .eq('id', datasetId)
    .single()
  if (!dataset) {
    return new NextResponse('Dataset not found', { status: 404 })
  }
  const datasetName = (dataset as any).name as string

  let memberIds: string[] = [datasetId]
  if ((dataset as any).source === 'collection') {
    const { data: col } = await service.from('collections').select('id').eq('dataset_id', datasetId).single()
    if (col) {
      const { data: members } = await service
        .from('collection_members')
        .select('dataset_id')
        .eq('collection_id', (col as any).id)
      if (members && members.length > 0) memberIds = members.map((m: any) => m.dataset_id)
    }
  }

  // ── Pull rows + extract field values ──
  const rawValues: string[] = []
  const PAGE = 1000
  for (const dsId of memberIds) {
    let offset = 0
    while (rawValues.length < MAX_ROWS) {
      const { data: rows, error } = await service
        .from('dataset_rows_flat')
        .select('data')
        .eq('dataset_id', dsId)
        .order('row_index', { ascending: true })
        .range(offset, offset + PAGE - 1)
      if (error || !rows || rows.length === 0) break
      for (const r of rows) {
        const val = (r as any).data?.[field]
        if (typeof val === 'string' && val.trim()) rawValues.push(val)
      }
      if (rows.length < PAGE) break
      offset += PAGE
    }
  }

  // ── Canonicalise + aggregate via the shared core ──
  const agg = await aggregateEntities(rawValues)
  if (!agg) {
    return new NextResponse(`No values found for field "${field}" in dataset.`, { status: 404 })
  }

  const deck: DeckSpec = {
    title: customTitle || `${datasetName} — ${field} entity analysis`,
    subtitle: 'Entity analysis · add-on to the StoryTime deck',
    slides: entitySlideSpecs(field, agg),
  }

  const buffer = await renderDeck(deck, datasetName)
  const uint8 = new Uint8Array(buffer)
  const filenameSafe = `${datasetName} — ${field}`.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return new NextResponse(uint8, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${filenameSafe || 'entity-analysis'}.pptx"`,
    },
  })
}
