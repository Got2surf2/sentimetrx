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
import { logError } from '@/lib/log'
import { getAgentStudy } from '@/lib/agentStudy'
import { buildProjectReportModel, type ProjectReportModel } from '@/lib/projectReport'
import { renderProjectReportHtml } from '@/lib/projectReportHtml'
import { buildCompareModel, renderCompareReportHtml, type ComparePurpose, type CompareReportModel } from '@/lib/projectCompare'
import { AXES, AXIS_LABEL } from '@/lib/taxonomyRollup'
import { buildKwRegex, lexiconScore, classifySentiment, type Theme } from '@/lib/themeUtils'
import { pageSampledRows } from '@/lib/bulkRowSample'
import { SIGNAL_SAMPLE_CAP } from '@/lib/sampledSignalCounts'
import { isPanelMember } from '@/lib/recordings/panel'
import { displayQuestion, displayAnswer } from '@/lib/recordings/qaDisplay'
import type { SourceSummary } from '@/lib/sourceSummary'
import type {
  QaPairPayload, ProceedingsSummary, PanelMember, RecordingAnalysisSummary,
} from '@/lib/recordings/types'
import type { ProjectInputModel, ProjectQA, ProjectComment, ProjectSource, ProjectInputTheme } from '@/lib/projectReport'

type Svc = ReturnType<typeof createServiceRoleClient>

// Minimal shape of a mined theme as persisted in dataset_state.theme_model (Json).
interface RawTheme {
  name?: string
  label?: string
  keywords?: string[]
  count?: number
  sentiment?: string
  avgRating?: number
}
interface ThemeModel { themes?: RawTheme[] }

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
  const { data: rec, error: recErr } = await svc
    .from('recordings')
    .select('id, name, meeting_date, setup_inputs, proceedings_summary, analysis_summary')
    .eq('dataset_id', datasetId)
    .single()
  if (recErr) void logError('projectReportLoad.loadRecordingInput', recErr)
  if (!rec) return null

  const panel: PanelMember[] = (rec.setup_inputs as { panel?: PanelMember[] } | null)?.panel ?? []
  const { data: exs, error: exsErr } = await svc
    .from('recording_extractions')
    .select('unit_type, topic, payload')
    .eq('recording_id', rec.id)
    .eq('unit_type', 'qa_pair')
    .order('sort_order', { ascending: true })
  if (exsErr) void logError('projectReportLoad.loadRecordingInput', exsErr)

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

  return { source, presentation: proceedingsToSummary(rec.proceedings_summary as ProceedingsSummary | null), qa, commentary, themes, dimensions: [], entities: [], sentiment }
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
    qa, commentary, themes, dimensions: [],
    entities: study.entities.map(e => ({ name: e.name, mentions: e.mentions })),
    sentiment,
  }
}

// ── Dimensions (ABSA taxonomy) per input ─────────────────────────────────────
// For taxonomy-classified inputs (typically google_reviews), pull the per-sub
// rollup into the SAME ProjectInputTheme shape so it drops into the comparison
// matrix as a second matrix. Uses the server-side aggregate RPCs (sql/115) —
// NOT a per-row read — so a competitive set of 10–30K-row datasets stays cheap:
// 1 + 7×2 lightweight aggregate queries per input, no paging. Sentiment is
// rating-derived (the meaningful signal for review data); avg rating per sub
// comes from taxonomy_group_stats. Returns [] when the input has no taxonomy.
const titleCase = (s: string) => s.replace(/\b\w/g, c => c.toUpperCase())
function ratingSentiment(avg: number | null): string {
  if (avg == null) return 'neutral'
  if (avg >= 4.0) return 'positive'
  if (avg <= 3.0) return 'negative'
  return 'mixed'
}
async function loadDimensionsForInput(svc: Svc, datasetId: string): Promise<ProjectInputTheme[]> {
  // Primary classified field resolves only when per-field taxonomy exists; null
  // → no Dimensions for this input, skip the 14 axis calls entirely.
  const { data: primaryField, error: primaryFieldErr } = await svc.rpc('taxonomy_primary_field', { p_dataset_id: datasetId })
  if (primaryFieldErr) void logError('projectReportLoad.loadDimensionsForInput', primaryFieldErr)
  if (!primaryField) return []

  const perAxis = await Promise.all(AXES.map(async axis => {
    const [{ data: counts, error: countsErr }, { data: stats, error: statsErr }] = await Promise.all([
      svc.rpc('taxonomy_sub_counts', { p_dataset_id: datasetId, p_axis: axis }),
      svc.rpc('taxonomy_group_stats', { p_dataset_id: datasetId, p_axis: axis, p_value_field: 'rating' }),
    ])
    if (countsErr) void logError('projectReportLoad.loadDimensionsForInput', countsErr)
    if (statsErr) void logError('projectReportLoad.loadDimensionsForInput', statsErr)
    const ratingBySub = new Map<string, number>()
    for (const r of (stats || []) as { group_val: string; avg_val: number | null }[]) {
      if (r.avg_val != null) ratingBySub.set(String(r.group_val), Number(r.avg_val))
    }
    return ((counts || []) as { value: string; count: number }[]).map(c => {
      const sub = String(c.value)
      const avg = ratingBySub.has(sub) ? (ratingBySub.get(sub) as number) : null
      return {
        label: `${AXIS_LABEL[axis]}: ${titleCase(sub)}`,
        count: Number(c.count) || 0,
        sentiment: ratingSentiment(avg),
        avgRating: avg != null ? Math.round(avg * 10) / 10 : null,
        samples: [] as string[],
      }
    })
  }))
  return perAxis.flat().sort((a, b) => b.count - a.count).slice(0, 30)
}

// ── Shared-theme scoring (deterministic, no AI merge) ────────────────────────
// A collection's competitive/brand-360 report aligns better when EVERY member is
// scored against ONE shared theme set (the collection's own unified themes) than
// when each member's separately-mined, differently-named themes are AI-merged
// per report (non-deterministic → duplicate rows + blanks). This reads a
// member's text rows once and counts them against the shared themes' keywords —
// identical labels across members → the matrix aligns by exact label, no AI.
const ROW_TEXT_KEYS = ['review_text', 'body', 'user_message', 'comment', 'response_text'] as const
// Flat dataset row payload — a free-form JSON object with a few fields we read.
interface RowData {
  rating?: unknown
  review_date?: unknown
  date?: unknown
  sentiment?: string | null
  author?: string | null
  reviewer?: string | null
  [k: string]: unknown
}
const rowText = (d: Record<string, unknown>): string => {
  for (const k of ROW_TEXT_KEYS) { const v = d[k]; if (v && String(v).trim()) return String(v) }
  return ''
}

interface MemberRow { text: string; rating: number | null; sentiment: string | null; author: string | null; date: string | null }

// Read a member's flat rows (text + rating + date) for the report substrate.
// Competitive-set datasets are ~8–30K, but a 1M-row member deep-OFFSET-paged
// via `.range()` 57014s (each page re-scans from row 0). Now pages the
// deterministic 50K `idx_drf_sample` via `pageSampledRows` (sql/160, the same
// sample the bulk-rows route + every sampled surface serves) — an index-range
// scan flat in dataset size. At/under the sample size the walk returns every
// row (exact, order-independent aggregates unaffected); above it the report's
// rating-over-time + theme sample are computed over the 50K sample. (Brief E
// item 3, PERFORMANCE_REVIEW.md §7.)
async function readMemberRows(svc: Svc, datasetId: string, cap = SIGNAL_SAMPLE_CAP): Promise<MemberRow[]> {
  const out: MemberRow[] = []
  try {
    await pageSampledRows(svc, datasetId, cap, row => {
      const d = (row.data || {}) as RowData
      const rv = d.rating
      const rating = rv != null && rv !== '' && isFinite(Number(rv)) ? Number(rv) : null
      const rawDate = d.review_date ?? d.date ?? null
      out.push({ text: rowText(d), rating, sentiment: d.sentiment ?? null, author: d.author ?? d.reviewer ?? null, date: rawDate ? String(rawDate) : null })
    })
  } catch (e) {
    void logError('projectReportLoad.readMemberRows', e instanceof Error ? e : new Error(String(e)))
  }
  return out
}

// Compact monthly rating aggregate (rated, dated rows only) — the substrate for
// the rating-over-time chart, re-bucketed to the report's shared cadence later.
function monthlyRatingsFromRows(rows: MemberRow[]): { ym: string; sum: number; n: number }[] {
  const m = new Map<string, { sum: number; n: number }>()
  for (const r of rows) {
    if (r.rating == null || !r.date) continue
    const ym = r.date.slice(0, 7)               // YYYY-MM from an ISO-ish date
    if (!/^\d{4}-\d{2}$/.test(ym)) continue
    const a = m.get(ym) || { sum: 0, n: 0 }
    a.sum += r.rating; a.n++
    m.set(ym, a)
  }
  return [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([ym, a]) => ({ ym, sum: a.sum, n: a.n }))
}

// Collapse the union of members' separately-mined themes into ONE shared set,
// for collections that have no unified theme model of their own. Deterministic:
// greedily cluster themes whose label tokens or keyword sets overlap, union the
// keywords. Cheaper than re-mining from raw text, and reuses work already done —
// every member is then scored against this one set (no per-report AI merge).
const LABEL_STOP = new Set(['and', 'the', 'a', 'an', 'to', 'vs', 'or', 'with', 'for', 'amp'])
function labelTokens(s: string): Set<string> {
  return new Set(s.toLowerCase().split(/[^a-z]+/).filter(t => t.length > 2 && !LABEL_STOP.has(t)))
}
function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}
async function deriveSharedThemes(svc: Svc, memberIds: string[]): Promise<Theme[]> {
  const raw: { name: string; keywords: string[] }[] = []
  for (const id of memberIds) {
    const { data, error: stateErr } = await svc.from('dataset_state').select('theme_model').eq('dataset_id', id).single()
    if (stateErr && stateErr.code !== 'PGRST116') void logError('projectReportLoad.deriveSharedThemes', stateErr)
    for (const t of ((data?.theme_model as ThemeModel | null)?.themes ?? [])) {
      const name = String(t.name || t.label || '').trim()
      const keywords = Array.isArray(t.keywords) ? t.keywords.map(String) : []
      if (name && keywords.length) raw.push({ name, keywords })
    }
  }
  const clusters: { name: string; tokens: Set<string>; kw: Set<string> }[] = []
  for (const t of raw) {
    const tok = labelTokens(t.name)
    const kw = new Set(t.keywords.map(k => k.toLowerCase()))
    const hit = clusters.find(c => jaccard(c.tokens, tok) >= 0.5 || jaccard(c.kw, kw) >= 0.35)
    if (hit) {
      for (const k of kw) hit.kw.add(k)
      for (const x of tok) hit.tokens.add(x)
      if (t.name.length < hit.name.length) hit.name = t.name   // prefer the cleaner/shorter label
    } else {
      clusters.push({ name: t.name, tokens: tok, kw })
    }
  }
  return clusters.map((c, i) => ({
    id: 'shared-' + i, name: c.name, description: '', keywords: [...c.kw],
    sentiment: 'neutral', count: 0, percentage: 0, relatedThemes: [],
  }))
}

function scoreSharedThemes(rows: MemberRow[], shared: Theme[]): ProjectInputTheme[] {
  // Pre-compile each theme's keyword regexes ONCE (buildKwRegex is not cheap).
  const compiled = shared.map(th => ({ name: String(th.name || 'Theme'), res: (th.keywords || []).map(buildKwRegex) }))
  const acc = compiled.map(() => ({ count: 0, ratS: 0, ratN: 0, pos: 0, neg: 0 }))
  for (const r of rows) {
    if (!r.text) continue
    const lower = r.text.toLowerCase()
    let matchedAny = false
    for (let i = 0; i < compiled.length; i++) {
      if (compiled[i].res.length && compiled[i].res.some(re => re.test(lower))) {
        const a = acc[i]; a.count++; matchedAny = true
        if (r.rating != null) { a.ratS += r.rating; a.ratN++ }
      }
    }
    if (matchedAny) {
      const lex = lexiconScore(r.text)
      // Attribute the row's lexicon polarity to each theme it matched.
      for (let i = 0; i < compiled.length; i++) {
        if (compiled[i].res.length && compiled[i].res.some(re => re.test(lower))) { acc[i].pos += lex.pos; acc[i].neg += lex.neg }
      }
    }
  }
  return compiled.map((c, i) => {
    const a = acc[i]
    const avgRating = a.ratN > 0 ? Math.round((a.ratS / a.ratN) * 10) / 10 : null
    let sentiment: string
    if (avgRating != null) sentiment = avgRating >= 4 ? 'positive' : avgRating <= 3 ? 'negative' : 'mixed'
    else { const s = classifySentiment(a.pos, a.neg); sentiment = s === 'insufficient' ? 'neutral' : s }
    return { label: c.name, count: a.count, sentiment, avgRating, samples: [] }
  })
}

// ── Generic (reviews / CSAT / upload) member ─────────────────────────────────
// Reviews + survey/CSAT datasets carry mined themes (theme_model) + rated text
// rows, not Q&A/panel. These are the substrate for the competitive + brand-360
// reports (each column an input; each row a theme). When `sharedThemes` is
// passed (the collection's unified theme set), the member is scored against it
// for deterministic alignment; otherwise its own mined theme_model is used.
async function loadGenericInput(svc: Svc, datasetId: string, label: string, rowCount: number, source: string, brandTag: string | null, sharedThemes?: Theme[]): Promise<ProjectInputModel | null> {
  const kind = source === 'google_reviews' ? 'reviews' : source === 'study' ? 'survey' : 'dataset'
  const src: ProjectSource = {
    id: datasetId, kind,
    name: brandTag || label,
    date: null,
    badge: brandTag || label,
    rowCount,
  }

  let themes: ProjectInputTheme[]
  let commentary: ProjectComment[]
  // Rating-over-time substrate — computed for free from the rows the shared-theme
  // path already reads (the path competitive reports use).
  let monthlyRatings: { ym: string; sum: number; n: number }[] | undefined

  if (sharedThemes && sharedThemes.length) {
    // Shared-theme path: read all rows once, score against the collection's
    // unified themes (deterministic), and take a commentary sample from the head.
    const allRows = await readMemberRows(svc, datasetId)
    themes = scoreSharedThemes(allRows, sharedThemes)
    commentary = allRows.filter(r => r.text && r.text.trim().length >= 8).slice(0, 40)
      .map(r => ({ quote: r.text.slice(0, 240), topic: null, sentiment: r.sentiment, speaker: r.author, source: src.badge }))
    if (kind === 'reviews') {
      const mr = monthlyRatingsFromRows(allRows)
      if (mr.length) monthlyRatings = mr
    }
  } else {
    const { data: stateRow, error: stateRowErr } = await svc.from('dataset_state').select('theme_model').eq('dataset_id', datasetId).single()
    if (stateRowErr && stateRowErr.code !== 'PGRST116') void logError('projectReportLoad.loadGenericInput', stateRowErr)
    const rawThemes: RawTheme[] = (stateRow?.theme_model as ThemeModel | null)?.themes ?? []
    themes = rawThemes.map(t => ({
      label: String(t.name || t.label || 'Theme'),
      count: typeof t.count === 'number' ? t.count : 0,
      sentiment: typeof t.sentiment === 'string' ? t.sentiment : 'neutral',
      avgRating: typeof t.avgRating === 'number' ? t.avgRating : null,
      samples: Array.isArray(t.keywords) ? t.keywords.slice(0, 4).map(String) : [],
    }))
    // A small sample of verbatim rows for representative quotes.
    const { data: rows, error: rowsErr } = await svc.from('dataset_rows_flat').select('data').eq('dataset_id', datasetId).limit(40)
    if (rowsErr) void logError('projectReportLoad.loadGenericInput', rowsErr)
    commentary = (rows || []).map(r => {
      const d = (r.data || {}) as RowData
      const text = rowText(d)
      if (!text || text.trim().length < 8) return null
      return { quote: text.slice(0, 240), topic: null, sentiment: d.sentiment ?? null, speaker: d.author ?? d.reviewer ?? null, source: src.badge }
    }).filter(Boolean) as ProjectComment[]
  }

  // Input sentiment ≈ theme counts weighted by their sentiment.
  const sentiment = themes.reduce((a, t) => {
    const s = (t.sentiment || '').toLowerCase()
    if (s.startsWith('pos')) a.positive += t.count
    else if (s.startsWith('neg')) a.negative += t.count
    else a.neutral += t.count
    return a
  }, { positive: 0, neutral: 0, negative: 0 })

  const dimensions = await loadDimensionsForInput(svc, datasetId)

  return { source: src, presentation: null, qa: [], commentary, themes, dimensions, entities: [], sentiment, monthlyRatings }
}

// ── Per-dataset dispatch (shared by collection load + ad-hoc grouping) ───────
interface DatasetRow { id: string; source: string; name: string; row_count: number | null; description: string | null; brand_tag: string | null }

async function loadInputForDataset(svc: Svc, d: DatasetRow, label: string, sharedThemes?: Theme[]): Promise<ProjectInputModel | null> {
  if (d.source === 'recording') return loadRecordingInput(svc, d.id, label, d.row_count || 0)
  if (d.source === 'bot') return loadAgentInput(svc, d.id, label, d.row_count || 0, d.description)
  return loadGenericInput(svc, d.id, label, d.row_count || 0, d.source, d.brand_tag, sharedThemes) // reviews / CSAT / upload
}

// Load arbitrary datasets (by id, in order) into normalized inputs — used for an
// ad-hoc grouping (e.g. a competitive set not yet saved as a collection).
export async function loadInputsForDatasets(datasetIds: string[]): Promise<ProjectInputModel[]> {
  const svc = createServiceRoleClient()
  const { data: dsRows, error: dsRowsErr } = await svc.from('datasets').select('id, source, name, row_count, description, brand_tag').in('id', datasetIds)
  if (dsRowsErr) void logError('projectReportLoad.loadInputsForDatasets', dsRowsErr)
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
  const { data: collectionDs, error: collectionDsErr } = await svc.from('datasets').select('id, name').eq('id', collectionDatasetId).single()
  if (collectionDsErr) void logError('projectReportLoad.loadProjectInputs', collectionDsErr)
  if (!collectionDs) return null
  const { data: col, error: colErr } = await svc.from('collections').select('id').eq('dataset_id', collectionDatasetId).single()
  if (colErr) void logError('projectReportLoad.loadProjectInputs', colErr)
  if (!col) return null

  const { data: members, error: membersErr } = await svc
    .from('collection_members').select('dataset_id, label, sort_order')
    .eq('collection_id', col.id).order('sort_order', { ascending: true })
  if (membersErr) void logError('projectReportLoad.loadProjectInputs', membersErr)
  if (!members?.length) return { name: collectionDs.name, inputs: [] }

  const ids = members.map(m => m.dataset_id)
  const { data: dsRows, error: dsRowsErr } = await svc.from('datasets').select('id, source, name, row_count, description, brand_tag').in('id', ids)
  if (dsRowsErr) void logError('projectReportLoad.loadProjectInputs', dsRowsErr)
  const dsMap = new Map((dsRows || []).map(d => [d.id, d]))

  // The collection's OWN unified theme set (mined across all members). When it
  // exists, score every member against it so the comparison matrix aligns by
  // exact label — no flaky per-report AI merge of each member's differently-
  // named themes. Only meaningful when members are review/CSAT (generic loader).
  const { data: colState, error: colStateErr } = await svc.from('dataset_state').select('theme_model').eq('dataset_id', collectionDatasetId).single()
  if (colStateErr && colStateErr.code !== 'PGRST116') void logError('projectReportLoad.loadProjectInputs', colStateErr)
  const sharedThemesRaw: RawTheme[] = (colState?.theme_model as ThemeModel | null)?.themes ?? []
  let sharedThemes: Theme[] | undefined = sharedThemesRaw.length
    ? sharedThemesRaw.filter(t => t && (t.keywords?.length)) as Theme[]
    : undefined

  // No collection-level theme set → COLLAPSE the members' own mined themes into
  // one shared set so the matrix still aligns (vs re-mining from raw text, which
  // is far heavier). Only over the review/CSAT members — town halls/agents carry
  // topic summaries, not keyword themes.
  if (!sharedThemes || !sharedThemes.length) {
    const genericIds = members
      .map(m => dsMap.get(m.dataset_id))
      .filter((d): d is NonNullable<typeof d> => !!d && d.source !== 'recording' && d.source !== 'bot')
      .map(d => d.id)
    if (genericIds.length >= 2) {
      const derived = await deriveSharedThemes(svc, genericIds)
      if (derived.length) sharedThemes = derived
    }
  }
  const useShared = !!sharedThemes && sharedThemes.length > 0

  const inputs: ProjectInputModel[] = []
  for (const mem of members) {
    const d = dsMap.get(mem.dataset_id)
    if (!d) continue
    const model = await loadInputForDataset(svc, d as DatasetRow, mem.label || d.name, useShared ? sharedThemes : undefined)
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
// specific report, build the MODEL. Routes own auth; this owns tenancy +
// dispatch so the HTML / PDF / PPTX routes can't drift. The `kind` discriminant
// lets each renderer narrow to the right model without re-resolving the purpose.
export type ProjectBuilt =
  | { ok: true; name: string; purpose: 'community'; kind: 'community'; model: ProjectReportModel }
  | { ok: true; name: string; purpose: ComparePurpose; kind: 'compare'; model: CompareReportModel }
  | { ok: false; status: number; error: string }

export async function buildProjectModelForCollection(
  collectionDatasetId: string,
  caller: { orgId: string; isAdmin: boolean },
  purpose?: ReportPurpose,
  primaryId?: string,   // competitive only — the dataset_id of the focus competitor
): Promise<ProjectBuilt> {
  const svc = createServiceRoleClient()
  const { data: ds, error: dsErr } = await svc.from('datasets').select('id, source, org_id').eq('id', collectionDatasetId).single()
  if (dsErr) void logError('projectReportLoad.buildProjectModelForCollection', dsErr, { orgId: caller.orgId })
  if (!ds) return { ok: false, status: 404, error: 'Not found' }
  if (ds.source !== 'collection') return { ok: false, status: 400, error: 'Not a collection' }
  if (!caller.isAdmin && ds.org_id !== caller.orgId) return { ok: false, status: 404, error: 'Not found' }

  const loaded = await loadProjectInputs(collectionDatasetId)
  if (!loaded || loaded.inputs.length === 0) {
    return { ok: false, status: 409, error: 'Nothing analyzable in this collection yet. Add at least one analyzed dataset (town hall, agent, reviews, or CSAT) first.' }
  }

  const resolved: ReportPurpose = purpose || inferPurpose(loaded.inputs)
  const stamp = new Date().toISOString()
  // The collection's owning org — attribute the report's AI spend to it and gate
  // off-mode (per-org BYOK / AI-disabled) via callAI's usage.org_id.
  const ownerOrgId = (ds as { org_id?: string }).org_id
  if (resolved === 'community') {
    const model = await buildProjectReportModel(loaded.name, loaded.inputs, stamp, { synthesize: true, orgId: ownerOrgId })
    return { ok: true, name: loaded.name, purpose: 'community', kind: 'community', model }
  }
  const model = await buildCompareModel(loaded.name, resolved, loaded.inputs, stamp, { synthesize: true, primaryId, orgId: ownerOrgId })
  return { ok: true, name: loaded.name, purpose: resolved, kind: 'compare', model }
}

// HTML convenience — builds the model then renders it. The HTML + PDF routes
// use this; the PPTX route renders the model directly (lib/pptx/projectReportDeck).
export async function buildProjectReportForCollection(
  collectionDatasetId: string,
  caller: { orgId: string; isAdmin: boolean },
  purpose?: ReportPurpose,
  primaryId?: string,
): Promise<{ ok: true; name: string; purpose: ReportPurpose; html: string } | { ok: false; status: number; error: string }> {
  const built = await buildProjectModelForCollection(collectionDatasetId, caller, purpose, primaryId)
  if (!built.ok) return built
  const html = built.kind === 'community' ? renderProjectReportHtml(built.model) : renderCompareReportHtml(built.model)
  return { ok: true, name: built.name, purpose: built.purpose, html }
}
