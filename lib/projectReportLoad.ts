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
import { buildProjectReportModel, type ProjectReportModel } from '@/lib/projectReport'
import { isPanelMember } from '@/lib/recordings/panel'
import { displayQuestion, displayAnswer } from '@/lib/recordings/qaDisplay'
import type { SourceSummary } from '@/lib/sourceSummary'
import type {
  QaPairPayload, ProceedingsSummary, PanelMember, RecordingAnalysisSummary,
} from '@/lib/recordings/types'
import type { ProjectInputModel, ProjectQA, ProjectComment, ProjectSource } from '@/lib/projectReport'

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

  const sb = (rec.analysis_summary as RecordingAnalysisSummary | null)?.sentiment_breakdown
  const sentiment = sb
    ? { positive: sb.positive || 0, neutral: (sb.neutral || 0) + (sb.mixed || 0), negative: sb.negative || 0 }
    : { positive: 0, neutral: 0, negative: 0 }

  return { source, presentation: proceedingsToSummary(rec.proceedings_summary as ProceedingsSummary | null), qa, commentary, entities: [], sentiment }
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

  return {
    source,
    presentation: study.presentation,
    qa, commentary,
    entities: study.entities.map(e => ({ name: e.name, mentions: e.mentions })),
    sentiment,
  }
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
  const { data: dsRows } = await svc.from('datasets').select('id, source, name, row_count, description').in('id', ids)
  const dsMap = new Map((dsRows || []).map(d => [d.id, d]))

  const inputs: ProjectInputModel[] = []
  for (const mem of members) {
    const d = dsMap.get(mem.dataset_id)
    if (!d) continue
    const label = mem.label || d.name
    let model: ProjectInputModel | null = null
    if (d.source === 'recording') model = await loadRecordingInput(svc, d.id, label, d.row_count || 0)
    else if (d.source === 'bot') model = await loadAgentInput(svc, d.id, label, d.row_count || 0, d.description)
    // Other source types are skipped (the project report is for town halls + agents).
    if (model) inputs.push(model)
  }
  return { name: collectionDs.name, inputs }
}

// Route-facing: gate (collection + admin-aware org), load, build. Routes own auth;
// this owns tenancy + the pipeline so the HTML and PDF routes can't drift.
export async function buildProjectReportForCollection(
  collectionDatasetId: string,
  caller: { orgId: string; isAdmin: boolean },
): Promise<{ ok: true; model: ProjectReportModel } | { ok: false; status: number; error: string }> {
  const svc = createServiceRoleClient()
  const { data: ds } = await svc.from('datasets').select('id, source, org_id').eq('id', collectionDatasetId).single()
  if (!ds) return { ok: false, status: 404, error: 'Not found' }
  if (ds.source !== 'collection') return { ok: false, status: 400, error: 'Not a collection' }
  if (!caller.isAdmin && ds.org_id !== caller.orgId) return { ok: false, status: 404, error: 'Not found' }

  const loaded = await loadProjectInputs(collectionDatasetId)
  if (!loaded || loaded.inputs.length === 0) {
    return { ok: false, status: 409, error: 'No analyzed town halls or agents in this collection yet. Add at least one and run its analysis first.' }
  }
  const model = await buildProjectReportModel(loaded.name, loaded.inputs, new Date().toISOString(), { synthesize: true })
  return { ok: true, model }
}
