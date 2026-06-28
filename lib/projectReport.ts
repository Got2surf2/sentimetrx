// lib/projectReport.ts
//
// Project (brand-level) report — the COMPLETE, source-attributed roll-up across
// every input in a collection (town halls + agents). Distinct from the Ask Ana
// preview (which samples): this aggregates the per-input report MODELS, so every
// Q&A pair and every community comment is present and tagged with its source.
//
// Pipeline:
//   1. loaders (lib/projectReportLoad.ts) → ProjectInputModel[] (one per input,
//      community voices only — panel/organizer speech already excluded)
//   2. aggregateRawClusters()  → deterministic by-topic pooling with source tags
//   3. synthesizeThemes() (AI) → merge synonymous topics into unified brand themes
//   4. synthesizeExec()   (AI) → cross-input executive summary
//   5. buildProjectReportModel() orchestrates → ProjectReportModel
//   6. render (lib/projectReportHtml.ts) reuses the shared sourceSummary +
//      commentary renderers, adds a sources manifest + source-attributed Q&A.
//
// AI is used only for naming/merging/summarizing; the grouping + counts are
// deterministic in code, so the numbers always reconcile.

import { callAI } from '@/lib/ai'
import type { SourceSummary } from '@/lib/sourceSummary'

// ── Normalized per-input shapes ──────────────────────────────────────────────

export type ProjectSourceKind = 'town_hall' | 'agent' | 'reviews' | 'survey' | 'dataset'

export interface ProjectSource {
  id: string                       // dataset_id of the member
  kind: ProjectSourceKind
  name: string                     // display name, e.g. "NOWOCATS Meeting 2"
  date: string | null              // meeting date (town hall) / last-active (agent), ISO or null
  badge: string                    // short per-item attribution, e.g. "Town Hall · Jun 16" / "via Sarina"
  rowCount: number
}

export interface ProjectQA {
  question: string
  answer: string
  topic: string | null
  asker: string | null
  panelist: string | null
  sentiment: string | null
  source: string                   // ProjectSource.badge
}

export interface ProjectComment {
  quote: string
  topic: string | null
  sentiment: string | null
  speaker: string | null
  source: string                   // ProjectSource.badge
}

// A mined/derived theme for one input — the comparison substrate for the
// competitive + brand-360 reports (each column is an input; each row a theme).
export interface ProjectInputTheme {
  label: string
  count: number                    // rows/exchanges matched
  sentiment: string                // positive|neutral|negative|mixed
  avgRating: number | null         // review datasets only
  samples: string[]                // 1-3 short verbatim snippets
}

export interface ProjectInputModel {
  source: ProjectSource
  presentation: SourceSummary | null   // meeting presentation OR agent KB summary
  qa: ProjectQA[]
  commentary: ProjectComment[]
  themes: ProjectInputTheme[]          // per-input themes (reviews/CSAT/recordings/agents)
  entities: { name: string; mentions: number }[]
  sentiment: { positive: number; neutral: number; negative: number }
}

// ── Aggregate (brand-level) shapes ───────────────────────────────────────────

export interface ProjectTheme {
  title: string
  summary: string | null
  sentiment: string | null
  sources: string[]                // which source badges contributed
  qa: ProjectQA[]
  commentary: ProjectComment[]
  count: number                    // qa + commentary items
}

export interface ProjectReportModel {
  name: string
  generatedAt: string
  sources: ProjectSource[]
  execSummary: string
  presentations: { source: ProjectSource; summary: SourceSummary }[]
  themes: ProjectTheme[]
  commentary: ProjectComment[]     // every community comment, source-tagged
  entities: { name: string; mentions: number; sources: string[] }[]
  sentiment: { positive: number; neutral: number; negative: number }
  totals: { sources: number; townHalls: number; agents: number; qa: number; comments: number }
  method: string
}

// ── Deterministic aggregation ────────────────────────────────────────────────

const norm = (t: string | null | undefined) => (t || 'General').trim()
const keyOf = (t: string | null | undefined) => norm(t).toLowerCase()

interface RawCluster {
  topic: string                    // representative label (first seen casing)
  sources: Set<string>
  qa: ProjectQA[]
  commentary: ProjectComment[]
}

// Pool every input's Q&A + commentary by raw topic string. Deterministic — the
// AI pass later merges synonymous clusters; counts come from here, never the model.
export function aggregateRawClusters(inputs: ProjectInputModel[]): RawCluster[] {
  const map = new Map<string, RawCluster>()
  const bucket = (topic: string | null | undefined): RawCluster => {
    const k = keyOf(topic)
    let c = map.get(k)
    if (!c) { c = { topic: norm(topic), sources: new Set(), qa: [], commentary: [] }; map.set(k, c) }
    return c
  }
  for (const inp of inputs) {
    for (const qa of inp.qa) { const c = bucket(qa.topic); c.qa.push(qa); c.sources.add(inp.source.badge) }
    for (const cm of inp.commentary) { const c = bucket(cm.topic); c.commentary.push(cm); c.sources.add(inp.source.badge) }
  }
  return [...map.values()].sort((a, b) =>
    (b.qa.length + b.commentary.length) - (a.qa.length + a.commentary.length))
}

function aggregateEntities(inputs: ProjectInputModel[]): ProjectReportModel['entities'] {
  const map = new Map<string, { name: string; mentions: number; sources: Set<string> }>()
  for (const inp of inputs) {
    for (const e of inp.entities) {
      const k = e.name.trim().toLowerCase()
      if (!k) continue
      let r = map.get(k)
      if (!r) { r = { name: e.name.trim(), mentions: 0, sources: new Set() }; map.set(k, r) }
      r.mentions += e.mentions
      r.sources.add(inp.source.badge)
    }
  }
  return [...map.values()]
    .map(r => ({ name: r.name, mentions: r.mentions, sources: [...r.sources] }))
    .sort((a, b) => b.mentions - a.mentions)
}

// ── AI synthesis (naming / merging / summarizing only) ───────────────────────

interface ThemeMerge { theme: string; memberTopics: string[]; summary: string; sentiment: string }

// Ask the model to merge synonymous raw topics into unified brand themes. Returns
// a mapping; the regrouping + counts stay deterministic in buildProjectReportModel.
export async function synthesizeThemes(clusters: RawCluster[], projectName: string): Promise<ThemeMerge[]> {
  const list = clusters.map(c => {
    const sample = [...c.qa.map(q => q.question), ...c.commentary.map(m => m.quote)]
      .filter(Boolean).slice(0, 3).map(s => s.slice(0, 120))
    return `- "${c.topic}" (${c.qa.length + c.commentary.length} items, sources: ${[...c.sources].join('; ')})\n    e.g. ${sample.join(' | ')}`
  }).join('\n')

  const res = await callAI({
    tier: 'standard', maxTokens: 1800, timeoutMs: 60000,
    system: `You are synthesizing community-engagement findings across multiple inputs (town halls + an agent) for "${projectName}". You are given raw topic labels mined separately from each input. Merge labels that mean the same thing into unified themes (e.g. "Funding" + "Budget" → one theme). Keep genuinely distinct topics separate. Use ONLY the labels provided — do not invent topics.
Return ONLY JSON, no markdown:
{"themes":[{"theme":"Unified Theme Name","memberTopics":["exact raw label","exact raw label"],"summary":"1 neutral sentence on what the community raised here, across the inputs","sentiment":"positive|neutral|negative|mixed"}]}
Every raw label must appear in exactly one theme's memberTopics. Order themes by total importance.`,
    messages: [{ role: 'user', content: `Raw topics:\n${list}` }],
  })
  try {
    const parsed = JSON.parse(res.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
    const themes = Array.isArray(parsed.themes) ? parsed.themes : []
    return themes
      .filter((t: any) => t && typeof t.theme === 'string' && Array.isArray(t.memberTopics))
      .map((t: any) => ({
        theme: String(t.theme).trim(),
        memberTopics: t.memberTopics.map((s: any) => String(s)),
        summary: typeof t.summary === 'string' ? t.summary.trim() : '',
        sentiment: typeof t.sentiment === 'string' ? t.sentiment : 'neutral',
      }))
  } catch {
    return []
  }
}

export async function synthesizeExec(model: Omit<ProjectReportModel, 'execSummary'>): Promise<string> {
  const themeLines = model.themes.slice(0, 10)
    .map(t => `- ${t.title} (${t.count} items, ${t.sentiment}; ${t.sources.length} source${t.sources.length === 1 ? '' : 's'})${t.summary ? ': ' + t.summary : ''}`)
    .join('\n')
  const srcLines = model.sources.map(s => `${s.name} (${s.kind === 'town_hall' ? 'town hall' : 'agent'})`).join(', ')
  const res = await callAI({
    tier: 'standard', maxTokens: 700, timeoutMs: 45000,
    system: `You are writing the executive summary of a community-engagement report for "${model.name}". It synthesizes findings ACROSS ${model.totals.sources} inputs (${model.totals.townHalls} town hall(s) + ${model.totals.agents} agent(s)): ${srcLines}. Base it ONLY on the themes + counts given. 3-5 sentences, neutral and specific, naming the dominant concerns and how widely they recurred across inputs. No invented statistics.`,
    messages: [{ role: 'user', content: `Themes:\n${themeLines}\n\nTotals: ${model.totals.qa} Q&A, ${model.totals.comments} community comments.` }],
  })
  return res.text.trim()
}

// ── Orchestration ────────────────────────────────────────────────────────────

export interface BuildOpts { synthesize?: boolean }   // synthesize=false → deterministic only (no AI)

export async function buildProjectReportModel(
  name: string,
  inputs: ProjectInputModel[],
  generatedAt: string,
  opts: BuildOpts = {},
): Promise<ProjectReportModel> {
  const clusters = aggregateRawClusters(inputs)
  const sources = inputs.map(i => i.source)
  const sentiment = inputs.reduce(
    (a, i) => ({ positive: a.positive + i.sentiment.positive, neutral: a.neutral + i.sentiment.neutral, negative: a.negative + i.sentiment.negative }),
    { positive: 0, neutral: 0, negative: 0 })

  // Merge raw clusters → unified themes (AI), else 1:1 fallback by raw topic.
  let merges: ThemeMerge[] = []
  if (opts.synthesize !== false && clusters.length > 0) {
    try { merges = await synthesizeThemes(clusters, name) } catch { merges = [] }
  }
  const byKey = new Map(clusters.map(c => [keyOf(c.topic), c]))
  const used = new Set<string>()
  const themes: ProjectTheme[] = []
  for (const m of merges) {
    const members = m.memberTopics.map(t => byKey.get(keyOf(t))).filter(Boolean) as RawCluster[]
    if (members.length === 0) continue
    members.forEach(c => used.add(keyOf(c.topic)))
    const qa = members.flatMap(c => c.qa)
    const commentary = members.flatMap(c => c.commentary)
    const srcs = new Set<string>(); members.forEach(c => c.sources.forEach(s => srcs.add(s)))
    themes.push({ title: m.theme, summary: m.summary || null, sentiment: m.sentiment || null, sources: [...srcs], qa, commentary, count: qa.length + commentary.length })
  }
  // Any cluster the AI didn't place (or no-AI path) → its own theme.
  for (const c of clusters) {
    if (used.has(keyOf(c.topic))) continue
    themes.push({ title: c.topic, summary: null, sentiment: null, sources: [...c.sources], qa: c.qa, commentary: c.commentary, count: c.qa.length + c.commentary.length })
  }
  themes.sort((a, b) => b.count - a.count)

  const totals = {
    sources: inputs.length,
    townHalls: inputs.filter(i => i.source.kind === 'town_hall').length,
    agents: inputs.filter(i => i.source.kind === 'agent').length,
    qa: inputs.reduce((n, i) => n + i.qa.length, 0),
    comments: inputs.reduce((n, i) => n + i.commentary.length, 0),
  }

  const base: Omit<ProjectReportModel, 'execSummary'> = {
    name,
    generatedAt,
    sources,
    presentations: inputs.filter(i => i.presentation).map(i => ({ source: i.source, summary: i.presentation as SourceSummary })),
    themes,
    commentary: inputs.flatMap(i => i.commentary),
    entities: aggregateEntities(inputs),
    sentiment,
    totals,
    method: `Aggregated across ${totals.sources} inputs (${totals.townHalls} town hall(s) + ${totals.agents} agent(s)). Every Q&A pair and community comment is included (not sampled); organizer/panel speech is excluded. Topics merged into themes by AI; all counts computed deterministically in code.`,
  }

  let execSummary = ''
  if (opts.synthesize !== false && themes.length > 0) {
    try { execSummary = await synthesizeExec(base) } catch { execSummary = '' }
  }
  return { ...base, execSummary }
}
