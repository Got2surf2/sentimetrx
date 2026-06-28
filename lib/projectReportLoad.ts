// lib/projectReportLoad.ts
//
// Server-only loaders that pull each collection member's per-input report model
// into the normalized ProjectInputModel shape (lib/projectReport.ts). Town halls
// come from recording_extractions + proceedings_summary; agents come from the
// cached Agent Study. Community voices only — panel/organizer speech is excluded
// here (isPanelMember on the recording's roster), the single point of truth so
// every downstream surface inherits it.

import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { getAgentStudy } from '@/lib/agentStudy'
import { buildProjectReportModel } from '@/lib/projectReport'
import { renderProjectReportHtml } from '@/lib/projectReportHtml'
import { buildCompareModel, renderCompareReportHtml, type ComparePurpose } from '@/lib/projectCompare'
import { isPanelMember } from '@/lib/recordings/panel'
import { displayQuestion, displayAnswer } from '@/lib/recordings/qaDisplay'
import type { SourceSummary } from '@/lib/sourceSummary'
import type {
  QaPairPayload, ProceedingsSummary, PanelMember, RecordingAnalysisSummary,
} from '@/lib/recordings/types'
import type { ProjectInputModel, ProjectQA, ProjectComment, ProjectSource, ProjectInputTheme } from '@/lib/projectReport'

type Svc = ReturnType<typeof createServiceRoleClient>

function shortDate(s: string | null): string {
  if (!s) return ''
  try { return new Date(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) } catch { return '' }
}

function proceedingsToSummary(p: ProceedingsSummary | null): SourceSummary | null {
  if (!p || (!p.overview && (p.items?.length ?? 0) === 0)) return null
  return {
    overview: p.overview,
    items: (p.items ?? []).map(it => ({
      title: it.title,
      attribution: it.presenter,
      body: it.what_was_presented,
      figures: it.key_figures,
      refs: (it.slide_refs?.length ?? 0) > 0 ? `${it.slide_refs.length === 1 ? 'Slide' : 'Slides'} ${it.slide_refs.join(', ')}` : null,
    })),
  }
}

// ── Town hall (recording) member ─────────────────────────────────────────────
async function loadRecordingInput(svc: Svc, datasetId: string, label: string, rowCount: number): Promise<ProjectInputModel | null> {
  const { data: rec } = await svc
    .from('recordings')
    .select('id, name, meeting_date, setup_inputs, proceedings_summary, analysis_summary')
    .eq('dataset_id', datasetId)
    .single()
  if (!rec) return null

  const panel: PanelMember[] = (rec.setup_inputs as any)?.panel ?? []
  const { data: exs } = await svc
    .from('recording_extractions')
    .select('unit_type, topic, payload')
    .eq('recording_id', rec.id)
    .eq('unit_type', 'qa_pair')
    .order('sort_order', { ascending: true })

  const source: ProjectSource = {
    id: datasetId, kind: 'town_hall',
    name: label || rec.name,
    date: rec.meeting_date,
    badge: `Town Hall${rec.meeting_date ? ' · ' + shortDate(rec.meeting_date) : ''}`,
    rowCount,
  }

  const qa: ProjectQA[] = []
  const commentary: ProjectComment[] = []
  for (const ex of exs || []) {
    const p = ex.payload as QaPairPayload
    // Community voices only — drop anything whose asker is on the panel roster.
    if (isPanelMember(p.asker_name, panel)) continue
    if (p.question_typology === 'commentary') {
      commentary.push({ quote: displayQuestion(p), topic: ex.topic, sentiment: p.sentiment ?? null, speaker: p.asker_name ?? null, source: source.badge })
    } else {
      qa.push({ question: displayQuestion(p), answer: displayAnswer(p), topic: ex.topic, asker: p.asker_name ?? null, panelist: p.panelist_name ?? null, sentiment: p.sentiment ?? null, source: source.badge })
    }
  }

  const summary = rec.analysis_summary as RecordingAnalysisSummary | null
  const sb = summary?.sentiment_breakdown
  const sentiment = sb
    ? { positive: sb.positive || 0, neutral: (sb.neutral || 0) + (sb.mixed || 0), negative: sb.negative || 0 }
    : { positive: 0, neutral: 0, negative: 0 }
  const themes: ProjectInputTheme[] = (summary?.topic_summaries ?? []).map(ts => ({
    label: ts.topic,
    count: ts.qa_count,
    sentiment: ts.sentiment || 'neutral',
    avgRating: null,
    samples: (ts.representative_exchanges ?? []).map(e => e.question).filter(Boolean).slice(0, 2),
  }))

  return { source, presentation: proceedingsToSummary(rec.proceedings_summary as ProceedingsSummary | null), qa, commentary, themes, entities: [], sentiment }
}

function dominantSentiment(s: { positive: number; neutral: number; negative: number }): string {
  if (s.positive >= s.neutral && s.positive >= s.negative && s.positive > 0) return 'positive'
  if (s.negative >= s.neutral && s.negative >= s.positive && s.negative > 0) return 'negative'
  return 'neutral'
}

// ── Agent (bot) member ───────────────────────────────────────────────────────
async function loadAgentInput(svc: Svc, datasetId: string, label: string, rowCount: number, description: string | null): Promise<ProjectInputModel | null> {
  const m = (description || '').match(/^bot:([0-9a-f-]+)/i)
  if (!m) return null
  const study = await getAgentStudy(m[1])
  if (!study) return null

  const source: ProjectSource = {
    id: datasetId, kind: 'agent',
    name: label || study.bot.name,
    date: study.range.last,
    badge: `via ${study.bot.name}`,
    rowCount,
  }

  const qa: ProjectQA[] = study.focuses.flatMap(f =>
    f.samples.map(s => ({ question: s.question, answer: s.answer, topic: f.label, asker: null, panelist: null, sentiment: s.sentiment ?? null, source: source.badge })))
  const commentary: ProjectComment[] = study.publicComments.map(c => ({ quote: c.quote, topic: c.focus, sentiment: c.sentiment, speaker: null, source: source.badge }))
  const sentiment = study.focuses.reduce(
    (a, f) => ({ positive: a.positive + f.sentiment.positive, neutral: a.neutral + f.sentiment.neutral, negative: a.negative + f.sentiment.negative }),
    { positive: 0, neutral: 0, negative: 0 })
  const themes: ProjectInputTheme[] = study.focuses.map(f => ({
    label: f.label,
    count: f.exchanges,
    sentiment: dominantSentiment(f.sentiment),
    avgRating: null,
    samples: f.samples.map(s => s.question).filter(Boolean).slice(0, 2),
  }))

  return {
    source,
    presentation: study.presentation,
    qa, commentary, themes,
    entities: study.entities.map(e => ({ name: e.name, mentions: e.mentions })),
    sentiment,
  }
}

// ── Generic (reviews / CSAT / upload) member ─────────────────────────────────
// Reviews + survey/CSAT datasets carry mined themes (theme_model) + rated text
// rows, not Q&A/panel. These are the substrate for the competitive + brand-360
// reports (each column an input; each row a theme).
async function loadGenericInput(svc: Svc, datasetId: string, label: string, rowCount: number, source: string, brandTag: string | null): Promise<ProjectInputModel | null> {
  const kind = source === 'google_reviews' ? 'reviews' : source === 'study' ? 'survey' : 'dataset'
  const { data: stateRow } = await svc.from('dataset_state').select('theme_model').eq('dataset_id', datasetId).single()
  const rawThemes: any[] = ((stateRow?.theme_model as any)?.themes) ?? []
  const src: ProjectSource = {
    id: datasetId, kind: kind as any,
    name: brandTag || label,
    date: null,
    badge: brandTag || label,
    rowCount,
  }
  const themes: ProjectInputTheme[] = rawThemes.map(t => ({
    label: String(t.name || t.label || 'Theme'),
    count: typeof t.count === 'number' ? t.count : 0,
    sentiment: typeof t.sentiment === 'string' ? t.sentiment : 'neutral',
    avgRating: typeof t.avgRating === 'number' ? t.avgRating : null,
    samples: Array.isArray(t.keywords) ? t.keywords.slice(0, 4).map(String) : [],
  }))

  // A small sample of verbatim rows for representative quotes.
  const { data: rows } = await svc.from('dataset_rows_flat').select('data').eq('dataset_id', datasetId).limit(40)
  const commentary: ProjectComment[] = (rows || []).map(r => {
    const d = (r.data || {}) as Record<string, any>
    const text = d.review_text || d.body || d.user_message || d.comment || d.response_text || ''
    if (!text || String(text).trim().length < 8) return null
    return { quote: String(text).slice(0, 240), topic: null, sentiment: d.sentiment ?? null, speaker: d.author ?? d.reviewer ?? null, source: src.badge }
  }).filter(Boolean) as ProjectComment[]

  // Input sentiment ≈ theme counts weighted by their sentiment.
  const sentiment = themes.reduce((a, t) => {
    const s = (t.sentiment || '').toLowerCase()
    if (s.startsWith('pos')) a.positive += t.count
    else if (s.startsWith('neg')) a.negative += t.count
    else a.neutral += t.count
    return a
  }, { positive: 0, neutral: 0, negative: 0 })

  return { source: src, presentation: null, qa: [], commentary, themes, entities: [], sentiment }
}

// ── Per-dataset dispatch (shared by collection load + ad-hoc grouping) ───────
interface DatasetRow { id: string; source: string; name: string; row_count: number | null; description: string | null; brand_tag: string | null }

async function loadInputForDataset(svc: Svc, d: DatasetRow, label: string): Promise<ProjectInputModel | null> {
  if (d.source === 'recording') return loadRecordingInput(svc, d.id, label, d.row_count || 0)
  if (d.source === 'bot') return loadAgentInput(svc, d.id, label, d.row_count || 0, d.description)
  return loadGenericInput(svc, d.id, label, d.row_count || 0, d.source, d.brand_tag) // reviews / CSAT / upload
}

// Load arbitrary datasets (by id, in order) into normalized inputs — used for an
// ad-hoc grouping (e.g. a competitive set not yet saved as a collection).
export async function loadInputsForDatasets(datasetIds: string[]): Promise<ProjectInputModel[]> {
  const svc = createServiceRoleClient()
  const { data: dsRows } = await svc.from('datasets').select('id, source, name, row_count, description, brand_tag').in('id', datasetIds)
  const dsMap = new Map((dsRows || []).map(d => [d.id, d]))
  const out: ProjectInputModel[] = []
  for (const id of datasetIds) {
    const d = dsMap.get(id)
    if (!d) continue
    const m = await loadInputForDataset(svc, d as DatasetRow, d.name)
    if (m) out.push(m)
  }
  return out
}

// ── Collection → inputs ──────────────────────────────────────────────────────
export async function loadProjectInputs(collectionDatasetId: string): Promise<{ name: string; inputs: ProjectInputModel[] } | null> {
  const svc = createServiceRoleClient()
  const { data: collectionDs } = await svc.from('datasets').select('id, name').eq('id', collectionDatasetId).single()
  if (!collectionDs) return null
  const { data: col } = await svc.from('collections').select('id').eq('dataset_id', collectionDatasetId).single()
  if (!col) return null

  const { data: members } = await svc
    .from('collection_members').select('dataset_id, label, sort_order')
    .eq('collection_id', col.id).order('sort_order', { ascending: true })
  if (!members?.length) return { name: collectionDs.name, inputs: [] }

  const ids = members.map(m => m.dataset_id)
  const { data: dsRows } = await svc.from('datasets').select('id, source, name, row_count, description, brand_tag').in('id', ids)
  const dsMap = new Map((dsRows || []).map(d => [d.id, d]))

  const inputs: ProjectInputModel[] = []
  for (const mem of members) {
    const d = dsMap.get(mem.dataset_id)
    if (!d) continue
    const model = await loadInputForDataset(svc, d as DatasetRow, mem.label || d.name)
    if (model) inputs.push(model)
  }
  return { name: collectionDs.name, inputs }
}

export type ReportPurpose = 'community' | ComparePurpose

// Smart default when the caller doesn't designate a purpose: all town-hall/agent
// inputs → community; otherwise default to competitive (review/CSAT collections).
// brand-360 (one brand, many sources) is an explicit pick.
export function inferPurpose(inputs: ProjectInputModel[]): ReportPurpose {
  if (inputs.every(i => i.source.kind === 'town_hall' || i.source.kind === 'agent')) return 'community'
  return 'competitive'
}

// Route-facing: gate (collection + admin-aware org), load, pick the purpose-
// specific report, render. Routes own auth; this owns tenancy + dispatch so the
// HTML and PDF routes can't drift. Returns rendered HTML directly.
export async function buildProjectReportForCollection(
  collectionDatasetId: string,
  caller: { orgId: string; isAdmin: boolean },
  purpose?: ReportPurpose,
  primaryId?: string,   // competitive only — the dataset_id of the focus competitor
): Promise<{ ok: true; name: string; purpose: ReportPurpose; html: string } | { ok: false; status: number; error: string }> {
  const svc = createServiceRoleClient()
  const { data: ds } = await svc.from('datasets').select('id, source, org_id').eq('id', collectionDatasetId).single()
  if (!ds) return { ok: false, status: 404, error: 'Not found' }
  if (ds.source !== 'collection') return { ok: false, status: 400, error: 'Not a collection' }
  if (!caller.isAdmin && ds.org_id !== caller.orgId) return { ok: false, status: 404, error: 'Not found' }

  const loaded = await loadProjectInputs(collectionDatasetId)
  if (!loaded || loaded.inputs.length === 0) {
    return { ok: false, status: 409, error: 'Nothing analyzable in this collection yet. Add at least one analyzed dataset (town hall, agent, reviews, or CSAT) first.' }
  }

  const resolved: ReportPurpose = purpose || inferPurpose(loaded.inputs)
  const stamp = new Date().toISOString()
  let html: string
  if (resolved === 'community') {
    const model = await buildProjectReportModel(loaded.name, loaded.inputs, stamp, { synthesize: true })
    html = renderProjectReportHtml(model)
  } else {
    const model = await buildCompareModel(loaded.name, resolved, loaded.inputs, stamp, { synthesize: true, primaryId })
    html = renderCompareReportHtml(model)
  }
  return { ok: true, name: loaded.name, purpose: resolved, html }
}
