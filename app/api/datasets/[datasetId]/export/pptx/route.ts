// app/api/datasets/[datasetId]/export/pptx/route.ts
// POST — generate a consulting-quality PowerPoint from dataset analytics.
// Body: { fields: string[], audience: 'executive'|'stakeholder'|'full' }

import { NextResponse } from 'next/server'
import { callAI } from '@/lib/ai'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { smartOrder, isOrdinalScale } from '@/lib/scaleUtils'
import { aliasedCounts } from '@/lib/aliasUtils'
import { deserializeFilters, applyFilters, type SerializedFilters } from '@/lib/filterUtils'
import { pickBestComments } from '@/lib/export/scoreComments'
import { buildKwRegex, themeSetsForExport, themeModelKey, type ThemeModel, type ThemeFieldSet } from '@/lib/themeUtils'
import { isSubstantiveText } from '@/lib/datasetUtils'
import { computeThemeImpact } from '@/lib/themeImpact'
import { DN as DN_SHARED, trunc } from '@/lib/pptx/shared'
import { renderDeck, type DeckSpec, type SlideSpec, type DistBarsSlide, type NumericStatsSlide, type CompactGridSlide } from '@/lib/pptx/slideRenderer'
import { DECK_STYLES } from '@/lib/pptx/styles'
import { catalogToAggregate, entitySlideSpecs, categoriseEntityNames } from '@/lib/entityAnalysis'
import { getEntitiesWithCounts } from '@/lib/entityFilter'
import { discoverEntities } from '@/lib/entityDiscovery'
import { computeTaxonomyRollup } from '@/lib/taxonomyRollup'
import { computeInsightAlerts, dimensionsToSignals, themesToSignals, type AlertKind } from '@/lib/insightAlerts'
import { buildQuantSignals } from '@/lib/quantSignals'
import { buildThemeSignals } from '@/lib/themeSignals'
import { serverError } from '@/lib/apiError'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

// ── Generator version ────────────────────────────────────────────────────────
const STORYTIME_VERSION = '1.2.0'  // bump on each release

interface Params { params: Promise<{ datasetId: string }> }

// Bounded promise pool — keeps at most `limit` tasks in flight at once
// (mirrors theme-counts/route.ts; used for per-theme AI quote-picking so
// export latency doesn't grow linearly with theme count).
async function runPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results = new Array<T>(tasks.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }))
  return results
}

// Extended palette with datasets-specific colors
const DN = {
  ...DN_SHARED,
  tealDark:    '0A4F51',
  tealPale:    'E0F2F1',
  tealPale2:   'B2DFDB',
  navyMid:     '0F3A54',
  navyLight:   '1A5070',
  goldLight:   'F5D98A',
  goldPale:    'FFF8E1',
  orangePale:  'FEF0E8',
  ink:         '0D2B45',
  inkSoft:     '1A3A50',
  slateDark:   '4A6572',
}

// Trim to a sentence boundary — only when text exceeds max length.
function trimNatural(s: string, max: number): string {
  if (!s) return s
  if (s.length <= max) return s
  const candidate = s.slice(0, max)
  // Find the last sentence-ending punctuation
  const lastEnd = Math.max(
    candidate.lastIndexOf('.'),
    candidate.lastIndexOf('!'),
    candidate.lastIndexOf('?'),
  )
  if (lastEnd >= 1) return candidate.slice(0, lastEnd + 1)
  // No sentence end — trim to last word boundary and add ellipsis
  const lastSpace = candidate.lastIndexOf(' ')
  return (lastSpace > 0 ? candidate.slice(0, lastSpace) : candidate) + '…'
}

function pct(v: number, total: number) { return total > 0 ? Math.round(v / total * 100) : 0 }

// Color for a numeric rating value on a min–max scale (green=high, red=low)
function ratingColor(val: number, min: number, max: number): string {
  const range = max - min
  if (range <= 0) return DN.teal
  const frac = (val - min) / range
  if (frac >= 0.8)  return '059669'  // green
  if (frac >= 0.6)  return '34D399'  // light green
  if (frac >= 0.4)  return 'D97706'  // amber
  if (frac >= 0.2)  return 'F97316'  // orange
  return 'DC2626'                     // red
}

// ── AI narrative generation ───────────────────────────────────────────────────

interface FieldInsight {
  keyFinding: string
  narrative:    string
  implication:  string
  watchout?:    string
  pickedQuotes?: string[]
}

interface Narratives {
  reportTitle:     string
  executiveSummary: string[]
  keyTakeaways:    string[]
  fieldInsights:   Record<string, FieldInsight>
}

async function generateNarratives(
  orgId: string,
  datasetName: string,
  totalRows: number,
  audience: string,
  fields: SelectedField[],
  instructions?: string
): Promise<Narratives> {

  const audienceNote = {
    executive:   'C-suite audience. Every sentence must earn its place. Lead with so-what, not data.',
    stakeholder: 'Manager/analyst audience. Be data-driven and specific. Include percentages and averages.',
    full:        'Full team audience. Be thorough. Include nuance, caveats, and context. More detail is better.',
  }[audience] || ''

  const fieldBlocks = fields.map(function(f) {
    const s = f.summary
    if (!s) return `${f.label} (${f.type}): no data available`
    if (s.type === 'categorical') {
      const aliasedC: Record<string, number> = f.valueAliases && Object.keys(f.valueAliases).length > 0
        ? aliasedCounts(f.field, s.counts || {}, [{ field: f.field, valueAliases: f.valueAliases }])
        : (s.counts || {})
      const top5 = Object.entries(aliasedC)
        .sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([k, v]) => `"${k}" ${v} (${pct(v, s.nonNull!)}%)`).join(', ')
      return `${f.label} (categorical, n=${s.nonNull}): top responses — ${top5} | unique values: ${s.uniqueCount}`
    } else if (s.type === 'numeric') {
      const range = (s.max as number) - (s.min as number)
      const posInRange = range > 0 ? (((s.avg as number) - (s.min as number)) / range * 100).toFixed(0) : '50'
      return `${f.label} (numeric, n=${s.nonNull}): avg=${s.avg?.toFixed(2)}, median=${s.median?.toFixed(2)}, min=${s.min}, max=${s.max}, std=${s.std?.toFixed(2)} | avg sits at ${posInRange}% of possible range`
    } else if (s.type === 'open-ended') {
      // Prefer live evenly-sampled verbatims over the stale 10-item analytics snapshot
      const samplePool = (f.liveSample && f.liveSample.length > 0) ? f.liveSample : (s.sample || [])
      const allSamples = samplePool.slice(0, 20).map((t: string, i: number) => `[${i}] "${t.slice(0, 500)}"`).join('\n')
      return `${f.label} (open-ended, n=${s.nonNull}): avg ${s.avgWordCount} words per response\nCANDIDATE QUOTES (indexed 0–${Math.min(19, samplePool.length-1)}):\n${allSamples}`
    } else if (s.type === 'date') {
      return `${f.label} (date): ${s.min} to ${s.max}, n=${s.nonNull}`
    }
    return `${f.label}: no data`
  }).join('\n\n')

  const customInstructions = instructions ? `\n\nCLIENT INSTRUCTIONS (follow these precisely — they override any defaults):\n${instructions}\n` : ''

  const prompt = `You are a senior consultant preparing a data readout presentation. Write compelling, specific insights — not generic observations.

Dataset: "${datasetName}" — ${totalRows.toLocaleString()} responses
Audience: ${audience}. ${audienceNote}
${customInstructions}
FIELD DATA:
${fieldBlocks}

Return ONLY valid JSON. No markdown fences. No extra text. This exact structure:
{
  "reportTitle": "short punchy subtitle for the deck (8 words max)",
  "executiveSummary": [
    "Bullet 1 — most important headline finding with a specific number",
    "Bullet 2 — second most important finding",
    "Bullet 3 — pattern or trend worth noting",
    "Bullet 4 — area of concern or opportunity",
    "Bullet 5 — forward-looking implication"
  ],
  "keyTakeaways": [
    "Takeaway 1 — actionable recommendation from the data",
    "Takeaway 2 — what to do about the biggest finding",
    "Takeaway 3 — what to watch or measure next"
  ],
  "fieldInsights": {
${fields.map(f => {
  const isOE = f.type === 'open-ended'
  return `    "${f.field}": {
      "keyFinding": "one strong punchy statement about this field (max 12 words)",
      "narrative": "2-3 sentences. Specific data references. What the distribution reveals. What drives it.",
      "implication": "1-2 sentences. So what? What should be done or watched as a result?",
      "watchout": "1 sentence caveat, limitation or counter-reading (optional, omit if nothing meaningful)"${isOE ? `,
      "pickedQuotes": ["pick 3-5 of the most insightful, distinct, and representative quotes from CANDIDATE QUOTES above. Prefer quotes that are at least 200 characters and end at a natural sentence boundary. Do not truncate mid-sentence. No paraphrasing — use exact text from the candidates."]` : ''}
    }`
}).join(',\n')}
  }
}`

  const result = await callAI({
    tier: 'advanced',
    maxTokens: 3500,
    timeoutMs: 38000,
    messages: [{ role: 'user', content: prompt }],
    usage: { org_id: orgId, resource_type: 'dataset', event_type: 'pptx' },
  })
  // callAI auto-logs usage (usage:{…} above); no manual logUsage — that double-counted.

  const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')

  try {
    return JSON.parse(raw)
  } catch {
    return {
      reportTitle: 'Data Analysis Report',
      executiveSummary: ['Analysis completed successfully.'],
      keyTakeaways: ['Review the detailed findings for actionable insights.'],
      fieldInsights: Object.fromEntries(fields.map(f => [f.field, { keyFinding: f.label, narrative: '', implication: '', watchout: '' }])),
    }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

// Field summary as this deck consumes it. Starts life as an analytics
// FieldSummary (lib/analyzeTypes — a discriminated union) but is deliberately
// loosened here: recomputeSummaries() merges partial recomputes over whatever
// snapshot exists, so every stat is optional and the discriminant is a plain
// string. min/max are numbers on numeric summaries and ISO strings on date
// summaries (dates are only ever string-interpolated in this file).
interface DeckFieldSummary {
  type?:         string
  nonNull?:      number
  counts?:       Record<string, number>
  uniqueCount?:  number
  min?:          number | string
  max?:          number | string
  avg?:          number
  median?:       number
  std?:          number
  avgWordCount?: number
  sample?:       string[]
  isDiscrete?:   boolean
  valueCounts?:  Record<string, number>
  histogram?:    { min: number; max: number; count: number }[]
}

interface SelectedField {
  field:      string
  label:      string
  type:       string
  summary:    DeckFieldSummary | null
  remapping?: Record<string, number>
  valueAliases?: Record<string, string>
  section?:   string   // 'psychographic' | 'demographic' | 'core' | undefined
  prompt?:    string   // original survey question text
  liveSample?: string[] // evenly-sampled verbatims from allRows — replaces stale analytics snapshot
  sqt?:       string   // survey-question type (rating/…) — present on some survey schema fields
  scoreField?: boolean | string
}

// Minimal shape of a schema field (dataset_state.schema_config.fields[*]).
interface SchemaField {
  field:      string
  label?:     string
  type:       string
  status?:    string
  section?:   string
  prompt?:    string
  remapping?: Record<string, number>
  valueAliases?: Record<string, string>
  sqt?:       string
  scoreField?: boolean | string
}

interface SchemaConfig {
  fields?: SchemaField[]
  primaryDateField?: string
}

// Theme object as it flows through the deck: the stored theme model theme, plus
// the count/percentage/totalResponses/kwFreqs fields computed here at export time.
interface DeckTheme {
  id:            string
  name?:         string
  description?:  string
  keywords?:     string[]
  sentiment?:    string
  count?:        number
  percentage?:   number
  totalResponses?: number
  snippetCount?: number
  kwFreqs?:      { word: string; freq: number; pct: number }[]
}

interface ThemeModelRow {
  themes?:     DeckTheme[]
  fieldNames?: string[]
  fieldName?:  string
}

// Minimal shape of the study config referenced for prompt backfill.
interface StudyConfig {
  questions?:         { id?: string; prompt?: string; exportLabel?: string }[]
  psychographicBank?: { key: string; q?: string }[]
  demoFields?:        { key: string; label?: string }[]
}

// Minimal shape of the datasets row selected by this route.
interface DatasetRow {
  id:            string
  name:          string
  source:        string | null
  row_count:     number | null
  ana_library:   unknown
  study_id:      string | null
  org_id:        string
  taxonomy_enabled:    boolean | null
  taxonomy_suppressed: boolean | null
  studies?:      { id: string; name: string; config: unknown } | null
}

// ── Slide builders ────────────────────────────────────────────────────────────

// ── Auto-generate insight text when AI is unavailable ────────────────────────
function autoInsight(label: string, orderedKeys: string[], counts: Record<string, number>, total: number, isOrdinal: boolean, top2: number, bot2: number): string {
  if (!orderedKeys.length || total === 0) return 'No data available for this field.'
  const topKey  = orderedKeys[0]
  const topPct  = pct(counts[topKey] || 0, total)
  if (isOrdinal) {
    const lines: string[] = []
    if (top2 >= 75)      lines.push(top2 + '% of respondents rated ' + label + ' positively — a strong result.')
    else if (top2 >= 55) lines.push('A majority (' + top2 + '%) gave ' + label + ' a positive rating.')
    else                 lines.push('Only ' + top2 + '% gave ' + label + ' a positive rating — below expectations.')
    lines.push(topPct + '% selected "' + topKey + '" as their response.')
    if (bot2 > 5) lines.push(bot2 + '% expressed dissatisfaction — an area to monitor.')
    return lines.join(' ')
  }
  const secondKey = orderedKeys[1]
  if (!secondKey) return '"' + topKey + '" was selected by all ' + total.toLocaleString() + ' respondents.'
  const secondPct = pct(counts[secondKey] || 0, total)
  return '"' + topKey + '" is the most common response (' + topPct + '%), followed by "' + secondKey + '" (' + secondPct + '%). Together they account for ' + (topPct + secondPct) + '% of all responses.'
}

// Field-level analytics counts for a text-analytics slide subtitle.
// comments = responses with text in this field; signals = total theme
// mentions (a response can hit multiple themes, so signals ≥/≤ comments).
interface TextCounts { comments: number; signals: number }
// Map a field value to a card accent strip color
// Numeric: green→red gradient based on relative value
// Categorical: deterministic palette color per unique value
function valueToColor(val: string, allValsForField?: string[]): string {
  // Try numeric interpretation first
  const num = parseFloat(val)
  if (!isNaN(num) && val.trim() !== '') {
    // Need context of min/max; if allValsForField provided, compute gradient
    if (allValsForField && allValsForField.length > 1) {
      const nums = allValsForField.map(Number).filter(n => !isNaN(n))
      const lo = Math.min(...nums), hi = Math.max(...nums)
      const frac = hi > lo ? (num - lo) / (hi - lo) : 0.5
      if (frac >= 0.75) return '059669'
      if (frac >= 0.55) return '34D399'
      if (frac >= 0.45) return '94A3B8'
      if (frac >= 0.25) return 'F97316'
      return 'DC2626'
    }
  }
  // Sentiment-aware coloring for implicit positive/negative categorical values
  const lv = val.toLowerCase().trim()
  const positiveTerms = ['very satisfied', 'extremely satisfied', 'very likely', 'extremely likely', 'strongly agree', 'excellent', 'outstanding', 'very good', 'promoter', 'positive', 'very happy', 'very pleased', 'always', 'definitely']
  const negativeTerms = ['very dissatisfied', 'extremely dissatisfied', 'very unlikely', 'extremely unlikely', 'strongly disagree', 'terrible', 'very poor', 'poor', 'detractor', 'negative', 'very unhappy', 'never', 'not at all']
  const neutralTerms  = ['neutral', 'neither', 'passive', 'somewhat', 'not sure', 'no opinion']
  if (positiveTerms.some(t => lv.includes(t))) return DN.green
  if (negativeTerms.some(t => lv.includes(t))) return DN.red
  if (neutralTerms.some(t => lv.includes(t)))  return DN.slate

  // Categorical: deterministic palette color
  const palette = [DN.teal, DN.gold, '7C3AED', DN.green, 'E85A1A', DN.navyLight, '0891B2', 'DB2777', '65A30D', '9333EA']
  let hash = 0
  for (let i = 0; i < val.length; i++) hash = (hash * 31 + val.charCodeAt(i)) & 0xffff
  return palette[hash % palette.length]
}

// ── Main route handler ────────────────────────────────────────────────────────

export async function POST(req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // ── Provenance tracker — populates the closing "How this deck was made" slide
  const ssStartedAt = Date.now()

  const body = await req.json().catch(() => ({}))
  const selectedFieldNames: string[] = body.fields || []
  const audience: string             = body.audience || 'stakeholder'
  const mode: string                 = body.mode || 'quick'
  const instructions: string         = body.instructions || ''
  const commentConfig: Record<string, { enabled: boolean; slides: number }> = body.commentConfig || {}
  const commentAnnotations: string[]  = body.commentAnnotations || []
  const commentColorField: string     = body.commentColorField  || ''
  const includeThemeSlides: boolean   = body.includeThemeSlides !== false
  // Themes per slide on the Theme Analysis grid: 0/undefined = auto, else 1/2/4/6.
  const themesPerSlide: number        = Number(body.themesPerSlide) || 0
  const selectedThemeIds: string[]    = body.selectedThemeIds   || []
  // Per-field theme sets: theme-id selection for the NON-active sets, keyed by
  // themeFieldKey (theme ids repeat across sets — t1..tN in each — so a flat id
  // list can't address them). Absent key = include that set in full; an empty
  // array = user deselected every theme in that set, skip it.
  const selectedThemesByField: Record<string, string[]> = (body.selectedThemesByField && typeof body.selectedThemesByField === 'object') ? body.selectedThemesByField : {}
  const rawFilters: SerializedFilters = body.filters || {}
  const hasFilters = Object.keys(rawFilters).length > 0
  const reportTitle: string             = body.reportTitle || ''
  const impactOEFields: string[]       = body.impactOEFields || []
  const skipAI: boolean                = body.skipAI === true
  const deckStyle: string | undefined  = typeof body.style === 'string' && body.style in DECK_STYLES ? body.style : undefined
  // Closer-slide toggles — default ON; ExportModal lets the user opt out per export
  const includeCustomDecks: boolean    = body.includeCustomDecks !== false
  const includeProvenance:  boolean    = body.includeProvenance  !== false
  // Dimensions (ABSA taxonomy) section — coverage + what-stands-out + a
  // heads-up watch list. Default ON; only emitted when the dataset has
  // Dimensions enabled AND classified signal exists. (#A)
  const includeDimensions:  boolean    = body.includeDimensions   !== false
  // Generation-recap appendix — recaps the export inputs (+ verbatim custom
  // instructions) so a deck's storytelling can be retraced. Default ON;
  // suppressible for clean client deliverables. (#10)
  const includeRecap:       boolean    = body.includeRecap       !== false
  // Entity analysis: field keys to run org/charity entity analysis on (native
  // slides). skipTextAnalytics drops the theme/verbatim sections entirely so a
  // deck can be entity-only (e.g. "skip text analytics, just analyse Charities").
  const entityFields: string[]         = Array.isArray(body.entityFields) ? body.entityFields : []
  const skipTextAnalytics: boolean     = body.skipTextAnalytics === true

  if (mode === 'quick' && selectedFieldNames.length === 0) {
    return NextResponse.json({ error: 'Select at least one field' }, { status: 400 })
  }

  // Cross-org gate: the dataset lookup uses the service role (bypasses RLS),
  // so it must verify caller ownership or any authed user could export another
  // org's dataset by id. Admin-org may export any (Phase E). Multi-tenancy invariant.
  const { orgId, isAdmin } = await getCallerOrgContext(supabase)

  const service = createServiceRoleClient()

  const { data: datasetRaw } = await service
    .from('datasets').select('id, name, source, row_count, ana_library, study_id, org_id, taxonomy_enabled, taxonomy_suppressed, studies(id, name, config)').eq('id', params.datasetId).single()
  const dataset = datasetRaw as DatasetRow | null
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  const { data: stateRow } = await service
    .from('dataset_state').select('schema_config, analytics, theme_model').eq('dataset_id', params.datasetId).single()
  if (!stateRow) return NextResponse.json({ error: 'Dataset state not found' }, { status: 404 })

  const schema      = stateRow.schema_config as SchemaConfig | null
  const analytics   = stateRow.analytics
  const allThemes: DeckTheme[] = (stateRow.theme_model as ThemeModelRow | null)?.themes || []

  // Backfill missing prompts from study config (for PPTX subtitles)
  const studyConfig = dataset.studies?.config as StudyConfig | undefined
  if (studyConfig && schema?.fields) {
    schema.fields.forEach(function(f: SchemaField) {
      if (f.prompt) return  // Already has prompt
      // Try to find matching question in study config
      if (studyConfig.questions) {
        const q = studyConfig.questions.find((qq) => {
          const col = qq.exportLabel || qq.prompt || qq.id
          return f.field === col || f.field.includes(col as string)
        })
        if (q?.prompt) f.prompt = q.prompt
      }
      // Try psychographic bank — match exactly how sanitizeColumnName works
      if (!f.prompt && f.field.startsWith('psycho_') && studyConfig.psychographicBank) {
        const sanitize = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        const fieldKey = f.field.replace('psycho_', '')
        const pq = studyConfig.psychographicBank.find((pp) => sanitize(pp.key) === fieldKey)
        if (pq?.q) f.prompt = pq.q
      }
      // Try demo fields — match exactly how sanitizeColumnName works
      if (!f.prompt && f.field.startsWith('demo_') && studyConfig.demoFields) {
        const sanitize = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        const fieldKey = f.field.replace('demo_', '')
        const df = studyConfig.demoFields.find((dd) => sanitize(dd.key) === fieldKey)
        if (df) {
          f.prompt = df.label
        }
      }
    })
  }
  const themes      = selectedThemeIds.length > 0
    ? allThemes.filter((t: DeckTheme) => selectedThemeIds.includes(t.id))
    : allThemes
  const datasetName = dataset.name

  if (!analytics?.fieldSummaries) {
    return NextResponse.json({ error: 'Analytics not yet computed — run compute first' }, { status: 400 })
  }

  // Builder mode with no explicit fields → use all schema fields
  const allSchemaFields: string[] = (schema?.fields || [])
    .filter((f) => ['open-ended', 'categorical', 'numeric', 'date'].includes(f.type) && f.status !== 'ignored')
    .map((f) => f.field)
  const fieldNamesToUse = selectedFieldNames.length > 0 ? selectedFieldNames : allSchemaFields

  const selectedFields: SelectedField[] = fieldNamesToUse
    .map(function(fieldName) {
      const schemaField = (schema?.fields || []).find((f) => f.field === fieldName)
      if (!schemaField) return null
      return { field: fieldName, label: schemaField.label || fieldName, type: schemaField.type, summary: analytics.fieldSummaries[fieldName] || null, remapping: schemaField.remapping, valueAliases: schemaField.valueAliases, section: schemaField.section || undefined, prompt: schemaField.prompt }
    })
    .filter(Boolean) as SelectedField[]

  if (selectedFields.length === 0) {
    return NextResponse.json({ error: 'No valid fields selected' }, { status: 400 })
  }

  // Fetch rows for comment sampling and theme matching.
  // Fetch rows from dataset_rows_flat (the sole source of truth).
  // For collections: union rows from member datasets.
  // Row cap honors the platform's no-sampling-under-50K rule (CLAUDE.md): load
  // EVERY row when the dataset is ≤50K, only sampling above that. The real value
  // is set from flatCount below; this is just the >50K ceiling.
  const allRows: Record<string, unknown>[] = []
  let rowsSampled = false
  let MAX_ROWS = 50_000

  // Collections: fetch from member datasets
  const isCollection = dataset?.source === 'collection'
  let flatDatasetIds: string[] = [params.datasetId]
  let collectionLabels: Record<string, string> = {}
  if (isCollection) {
    const { data: col } = await service.from('collections').select('id').eq('dataset_id', params.datasetId).single()
    if (col) {
      const { data: members } = await service.from('collection_members').select('dataset_id, label').eq('collection_id', col.id).order('sort_order', { ascending: true })
      if (members && members.length > 0) {
        flatDatasetIds = members.map(m => m.dataset_id)
        members.forEach(m => { collectionLabels[m.dataset_id] = m.label })
      }
    }
  }

  // Try flat table first
  let flatCount = 0
  for (const dsId of flatDatasetIds) {
    const { count } = await service.from('dataset_rows_flat').select('id', { count: 'exact', head: true }).eq('dataset_id', dsId)
    flatCount += count || 0
  }
  // ≤50K total → load all (no sampling, per the platform rule); >50K → cap at 50K.
  if (flatCount > 0) MAX_ROWS = flatCount <= 50_000 ? flatCount : 50_000

  if (flatCount > 0) {
    // Flat table — paginate in chunks of 1000 (Supabase default limit)
    const FLAT_PAGE = 1000
    for (const dsId of flatDatasetIds) {
      let flatOffset = 0
      const label = collectionLabels[dsId] || undefined
      while (allRows.length < MAX_ROWS) {
        const { data: flatRows, error: flatErr } = await service
          .from('dataset_rows_flat')
          .select('data')
          .eq('dataset_id', dsId)
          .order('row_index', { ascending: true })
          .range(flatOffset, flatOffset + FLAT_PAGE - 1)
        if (flatErr || !flatRows || flatRows.length === 0) break
        for (const fr of flatRows) {
          const row = (fr.data || fr) as Record<string, unknown>
          if (label) row._collection_label = label
          allRows.push(row)
          if (allRows.length >= MAX_ROWS) break
        }
        if (flatRows.length < FLAT_PAGE) break
        flatOffset += FLAT_PAGE
      }
      if (allRows.length >= MAX_ROWS) break
    }
    if (allRows.length >= MAX_ROWS && flatCount > allRows.length) rowsSampled = true
  }
  // Legacy dataset_rows batch fallback removed 2026-07-02 — dataset_rows_flat is
  // the sole source of truth; flatCount === 0 means the dataset has no rows.
  // Live flat-table count is authoritative whenever it exists — persisted
  // snapshots (analytics.totalRows, dataset.row_count) drift BOTH ways: stale-low
  // when members gain rows, stale-HIGH after a dedup cleanup (e.g. Ruth's Chris
  // 30,170 snapshot vs 27,234 live post-dedup). Math.max only caught the low case
  // and surfaced the stale-high 30,170 on the report. Trust flatCount when > 0.
  const knownTotal = flatCount > 0 ? flatCount : (Math.max(analytics?.totalRows || 0, dataset.row_count || 0) || 0)

  // Build a normalized key map so we can find columns regardless of case/spaces
  // e.g. schema field "general_experience_comments" matches row key "General Experience Comments"
  function normalize(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''); }
  const rowKeyMap: Record<string, string> = {}  // normalizedKey → actualKey in first row
  if (allRows.length > 0) {
    for (const k of Object.keys(allRows[0])) rowKeyMap[normalize(k)] = k
  }
  function rowVal(row: Record<string, unknown>, fieldKey: string): string {
    // Direct match first, then normalized fallback
    if (row[fieldKey] !== undefined && row[fieldKey] !== null) return String(row[fieldKey]).trim()
    const actual = rowKeyMap[normalize(fieldKey)]
    if (actual && row[actual] !== undefined && row[actual] !== null) return String(row[actual]).trim()
    return ''
  }

  // Apply filters if provided — filter rows before any analysis
  let filterDescription = ''
  if (hasFilters) {
    const filters = deserializeFilters(rawFilters)
    const before = allRows.length
    const filtered = applyFilters(allRows, filters)
    // Replace allRows so all downstream processing uses filtered data
    allRows.length = 0
    for (let fi = 0; fi < filtered.length; fi++) allRows.push(filtered[fi])
    // Build human-readable filter description for the About slide
    const parts: string[] = []
    for (const field of Object.keys(rawFilters)) {
      const f = rawFilters[field]
      const schemaField = (schema?.fields || []).find((sf) => sf.field === field)
      const label = schemaField?.label || field
      if (f.type === 'cat' && f.values?.length) {
        parts.push(label + ': ' + f.values.slice(0, 5).join(', ') + (f.values.length > 5 ? ' (+' + (f.values.length - 5) + ' more)' : ''))
      } else if (f.type === 'range' && f.values) {
        parts.push(label + ': ' + f.values[0] + ' – ' + f.values[1])
      } else if (f.type === 'daterange' && f.values) {
        const fmtDt = (ts: number) => new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        parts.push(label + ': ' + fmtDt(f.values[0]) + ' – ' + fmtDt(f.values[1]))
      }
    }
    filterDescription = parts.join('  ·  ')
    filterDescription = 'Filtered: ' + allRows.length + ' of ' + before + ' rows  ·  ' + filterDescription

    // Recompute field summaries from filtered rows so all slides reflect filtered data
    recomputeSummaries()
  }

  // Also recompute when sampled or collection (collections have no analytics of their own)
  if ((rowsSampled || isCollection) && !hasFilters) {
    recomputeSummaries()
  }

  function recomputeSummaries() {
    for (const sf of selectedFields) {
      const key = rowKeyMap[normalize(sf.field)] || sf.field
      if (sf.type === 'categorical') {
        const counts: Record<string, number> = {}
        let nonNull = 0
        for (const row of allRows) {
          const v = row[key] != null ? String(row[key]).trim() : ''
          if (v) { counts[v] = (counts[v] || 0) + 1; nonNull++ }
        }
        sf.summary = { ...(sf.summary || {}), counts, nonNull, uniqueCount: Object.keys(counts).length }
      } else if (sf.type === 'numeric') {
        const vals: number[] = []
        for (const row of allRows) {
          const n = parseFloat(String(row[key] ?? ''))
          if (!isNaN(n)) vals.push(n)
        }
        if (vals.length > 0) {
          vals.sort((a, b) => a - b)
          const sum = vals.reduce((s, v) => s + v, 0)
          sf.summary = { ...(sf.summary || {}), nonNull: vals.length, min: vals[0], max: vals[vals.length - 1], avg: Math.round(sum / vals.length * 100) / 100, median: vals[Math.floor(vals.length / 2)] }
        }
      } else if (sf.type === 'open-ended') {
        let nonNull = 0
        for (const row of allRows) {
          const v = row[key] != null ? String(row[key]).trim() : ''
          if (v) nonNull++
        }
        sf.summary = { ...(sf.summary || {}), nonNull }
      }
    }
  }

  // Build live verbatim samples for each OE field (20 evenly-spaced responses ≥ 30 chars).
  // Replaces the stale 10-item analytics snapshot used for AI quote candidates.
  // For positively-framed fields ("liked most", "best", etc.) filter out complaint-pattern
  // responses so showcase quotes actually reflect the field's intent.
  const POSITIVE_FRAME_TERMS = ['liked', 'love', 'best', 'enjoy', 'favour', 'favor', 'positive', 'highlight', 'appreciate', 'great about', 'good about']
  const NEGATIVE_FRAME_TERMS = ['dislik', 'worst', 'complaint', 'problem', 'issue', 'improv', 'suggest', 'concern', 'disappoint', 'frustrat', 'bad about', 'difficult', 'challenge']
  // Complaint-pattern indicators in response text
  const COMPLAINT_SIGNALS = ['no one', 'nobody', 'didn\'t', 'did not', 'wouldn\'t', 'would not', 'couldn\'t', 'could not', 'wasn\'t', 'was not', 'weren\'t', 'were not', 'never', 'ignored', 'waited', 'wait', 'rude', 'horrible', 'terrible', 'awful', 'unacceptable', 'disappointing', 'poor service', 'not helpful']

  function isPositivelyFramedField(f: SelectedField): boolean {
    const lbl = (f.label + ' ' + (f.prompt || '')).toLowerCase()
    return POSITIVE_FRAME_TERMS.some(t => lbl.includes(t)) && !NEGATIVE_FRAME_TERMS.some(t => lbl.includes(t))
  }

  function looksLikeComplaint(text: string): boolean {
    const lower = text.toLowerCase()
    return COMPLAINT_SIGNALS.filter(s => lower.includes(s)).length >= 2
  }

  if (allRows.length > 0) {
    selectedFields.forEach(function(f) {
      if (f.type !== 'open-ended') return
      const positiveFrame = isPositivelyFramedField(f)
      const texts = allRows
        .map(function(row) { return rowVal(row, f.field) })
        .filter(function(t) {
          if (t.length < 30) return false
          if (positiveFrame && looksLikeComplaint(t)) return false
          return true
        })
      // Fall back to unfiltered if filtering left too few (< 5)
      const source = texts.length >= 5 ? texts : allRows
        .map(function(row) { return rowVal(row, f.field) })
        .filter(function(t) { return t.length >= 30 })
      if (source.length === 0) return
      const n    = Math.min(20, source.length)
      const step = source.length / n
      f.liveSample = Array.from({ length: n }, function(_, i) { return source[Math.floor(i * step)] })
    })
  }

  // Re-compute theme counts by keyword-matching allRows against a specific open-ended field.
  // Uses multi-match semantics (a row can match multiple themes) so percentage = "% of
  // respondents who mentioned this theme". Two-count model (owner 2026-07-14): the
  // denominator = SUBSTANTIVE comments in this field ("N/A"/"Nothing" excluded), and
  // because count is over the same filtered array the numerator is substantive too —
  // both flip in lockstep, matching the in-app theme %.
  function computeFieldThemes(fieldKey: string, themeList: DeckTheme[]): DeckTheme[] {
    if (!themeList.length || !allRows.length) return themeList
    // Extract + lowercase each row's text once (not per theme)
    const texts = allRows
      .map(function(row) { return rowVal(row, fieldKey) })
      .filter(function(t) { return isSubstantiveText(t) })
      .map(function(t) { return t.toLowerCase() })
    const total = texts.length || 1
    // Pre-compile regexes once per theme (not per row)
    const themeRegexes = themeList.map(function(t: DeckTheme) {
      return (t.keywords || []).map(function(kw: string) { return buildKwRegex(kw) })
    })
    return themeList
      .map(function(t: DeckTheme, ti: number) {
        const regexes = themeRegexes[ti]
        const count = texts.filter(function(text) {
          return regexes.some(function(re: RegExp) { return re.test(text) })
        }).length
        return Object.assign({}, t, { count, percentage: Math.round(count / total * 100), totalResponses: total })
      })
      .filter(function(t: DeckTheme) { return (t.count || 0) > 0 })
      .sort(function(a: DeckTheme, b: DeckTheme) { return (b.count || 0) - (a.count || 0) })
  }

  // Theme text fields the theme model was built on (canonical theme scope). Mirrors
  // /api/share/analytics + the in-app Themes page so deck theme numbers match the app.
  const themeModelAny: ThemeModelRow = (stateRow.theme_model as ThemeModelRow | null) || {}
  const themeFields: string[] = (Array.isArray(themeModelAny.fieldNames) && themeModelAny.fieldNames.length)
    ? themeModelAny.fieldNames
    : (themeModelAny.fieldName ? [themeModelAny.fieldName]
       : selectedFields.filter(f => f.type === 'open-ended').map(f => f.field))

  // Per-field theme sets beyond the active one: each gets its own Theme
  // Analysis section counted against ITS OWN field(s). Gated to sets whose
  // field is among the export's selected open-ended fields (quick mode picks
  // fields; a set for an unselected prompt shouldn't ride along), and to the
  // per-set theme selection from the export dialog. The active set keeps the
  // existing selectedThemeIds path, so single-set decks are unchanged.
  const activeSetKey = themeModelKey(stateRow.theme_model as ThemeModel | null)
  const extraThemeSets: ThemeFieldSet[] = themeSetsForExport(stateRow.theme_model as ThemeModel | null)
    .filter(s => s.key !== activeSetKey)
    // Single-question sets only: multi-field entries are artifacts of the
    // retired combine-on-multi-select toggle ("muddy" per the owner) and
    // don't earn a deck section. An ACTIVE combined model still exports via
    // the canonical path above.
    .filter(s => s.fields.length === 1)
    .filter(s => s.fields.some(fk => selectedFields.some(sf => sf.type === 'open-ended' && sf.field === fk)))
    .map(s => {
      const sel = selectedThemesByField[s.key]
      if (!sel) return s
      return { ...s, model: { ...s.model, themes: s.model.themes.filter(t => sel.includes(t.id)) } }
    })
    .filter(s => s.model.themes.length > 0)

  // Canonical theme set — counted ONCE across all theme fields (not per open-ended
  // field), so the executive summary, the Theme Analysis slides, and the in-app Themes
  // page all report the same %. Also computes per-keyword frequency (kwFreqs) so the
  // theme-cloud slides can size each keyword by how often it appears.
  function computeCanonicalThemes(themeList: DeckTheme[], fieldsOverride?: string[]): DeckTheme[] {
    const countFields = fieldsOverride && fieldsOverride.length ? fieldsOverride : themeFields
    if (!themeList.length || !allRows.length || !countFields.length) return themeList
    // Two-count model: substantive comments only (per-field-any, matching the
    // in-app union_substantive) — filter rows first, then join for matching.
    const rowTexts = allRows
      .filter(function(row) { return countFields.some(function(fk) { return isSubstantiveText(rowVal(row, fk)) }) })
      .map(function(row) { return countFields.map(function(fk) { return rowVal(row, fk) }).join('  ').toLowerCase() })
    const total = rowTexts.length || 1
    return themeList
      .map(function(t: DeckTheme) {
        const kws: string[] = t.keywords || []
        const regexes = kws.map(function(kw: string) { return buildKwRegex(kw) })
        const kwCounts = kws.map(function() { return 0 })
        let count = 0
        for (let ri = 0; ri < rowTexts.length; ri++) {
          const text = rowTexts[ri]
          let matched = false
          for (let ki = 0; ki < regexes.length; ki++) {
            if (regexes[ki].test(text)) { kwCounts[ki]++; matched = true }
          }
          if (matched) count++
        }
        const kwFreqs = kws
          .map(function(kw: string, ki: number) { return { word: kw, freq: kwCounts[ki], pct: Math.round(kwCounts[ki] / total * 100) } })
          .filter(function(k) { return k.freq > 0 })
          .sort(function(a, b) { return b.freq - a.freq })
        return Object.assign({}, t, { count, percentage: Math.round(count / total * 100), totalResponses: total, kwFreqs })
      })
      .filter(function(t: DeckTheme) { return (t.count || 0) > 0 })
      .sort(function(a: DeckTheme, b: DeckTheme) { return (b.count || 0) - (a.count || 0) })
  }

  // Visibility filter: drop themes at or below 3% (matches the in-app Theme Clouds).
  // Falls back to the top 5 by count if nothing clears the bar.
  function visibleThemes(list: DeckTheme[]): DeckTheme[] {
    const vis = list.filter(function(t: DeckTheme) { return (t.percentage || 0) > 3 })
    return vis.length > 0 ? vis : list.slice(0, 5)
  }

  // Demo/psycho fields to annotate comments with
  const commentDemoFields = selectedFields.filter(f => f.section === 'demographic' || f.section === 'psychographic').slice(0, 4)

  // AI narratives
  let narratives: Narratives = {
    reportTitle: '',
    executiveSummary: [],
    keyTakeaways: [],
    fieldInsights: Object.fromEntries(selectedFields.map(f => [f.field, { keyFinding: f.label, narrative: '', implication: '', watchout: '' }])),
  }
  if (!skipAI) {
    try { narratives = await generateNarratives(dataset.org_id, datasetName, knownTotal || analytics.totalRows, audience, selectedFields, instructions || undefined) }
    catch (e) { console.error({ at: 'export/pptx', msg: "AI error", err: e }) }
  }

  // ── Assemble the deck (shared cream renderer) ────────────────────────────────
  try {
    const dataSource = dataset.study_id ? 'study' as const : 'upload' as const
    const n = allRows.length
    const N = knownTotal > n ? knownTotal : (dataset.row_count || n)
    let samplingNote: string | undefined
    if (rowsSampled || N > n) {
      const fpc = N > n ? Math.sqrt((N - n) / (N - 1)) : 1
      const moe = Math.round(1.96 * Math.sqrt(0.25 / n) * fpc * 1000) / 10
      samplingNote = 'Based on a systematic sample of ' + n.toLocaleString() + ' of ' + N.toLocaleString() + ' total responses (95% CI: ±' + moe + '%).'
    }
    if (!samplingNote && n > 0 && n < (dataset.row_count || Infinity)) {
      samplingNote = 'Analysis based on ' + n.toLocaleString() + ' of ' + (dataset.row_count || 0).toLocaleString() + ' total responses.'
    }
    const displayRows = allRows.length || analytics?.totalRows || dataset.row_count || 0

    // ── Rating-based accent color for comment cards ──────────────────────────
    const ratingField = selectedFields.find(f => f.type === 'numeric' && f.summary?.min != null)
    const ratingKey = ratingField ? (rowKeyMap[normalize(ratingField.field)] || ratingField.field) : ''
    const ratingMin = (ratingField?.summary?.min ?? 0) as number  // ratingField is numeric-typed, so min/max are numbers
    const ratingMax = (ratingField?.summary?.max ?? 5) as number
    const quoteRatingMap = new Map<string, number>()
    if (ratingField && allRows.length > 0) {
      const oeKeys = selectedFields.filter(f => f.type === 'open-ended').map(f => rowKeyMap[normalize(f.field)] || f.field)
      for (const row of allRows) {
        const rv = parseFloat(String(row[ratingKey] ?? ''))
        if (isNaN(rv)) continue
        for (const oek of oeKeys) {
          const txt = String(row[oek] || '').trim()
          if (txt.length >= 30) quoteRatingMap.set(txt.slice(0, 120), rv)
        }
      }
    }
    const getStripColor = function(quoteText: string): string | undefined {
      if (!ratingField || quoteRatingMap.size === 0) return undefined
      const key = quoteText.replace(/[“”]/g, '').trim().slice(0, 120)
      const rv = quoteRatingMap.get(key)
      if (rv != null) return ratingColor(rv, ratingMin, ratingMax)
      const prefix = key.slice(0, 60)
      let fuzzyResult: string | undefined
      quoteRatingMap.forEach(function(v, k) { if (!fuzzyResult && k.startsWith(prefix)) fuzzyResult = ratingColor(v, ratingMin, ratingMax) })
      return fuzzyResult
    }

    // ── Slide assembly ───────────────────────────────────────────────────────
    const slides: SlideSpec[] = []
    const aiFor = (f: SelectedField): FieldInsight => narratives.fieldInsights?.[f.field] || { keyFinding: f.label, narrative: '', implication: '', watchout: '' }
    const hasRealAI = (ai: FieldInsight, f: SelectedField) => !!(ai.keyFinding && ai.keyFinding !== f.label && ai.keyFinding !== f.field)
    const aiInsight = (ai: FieldInsight, f: SelectedField): string | undefined => {
      if (!hasRealAI(ai, f)) return undefined
      const parts = [ai.narrative || ai.keyFinding]
      if (ai.implication) parts.push('→ ' + ai.implication)
      return parts.filter(Boolean).join('  ')
    }
    const sentLabel = (s?: string) => s ? s.charAt(0).toUpperCase() + s.slice(1) : undefined
    // Ordinal scale color (best→worst); green high, red low. Cream-family hexes.
    function ordinalColor(i: number, nn: number): string {
      const frac = nn <= 1 ? 0 : i / (nn - 1)
      if (frac < 0.15) return '059669'
      if (frac < 0.38) return '34D399'
      if (frac < 0.62) return '94A3B8'
      if (frac < 0.82) return 'F97316'
      return 'DC2626'
    }
    const sentTone = (t2: number) => t2 >= 70 ? '059669' : t2 >= 50 ? 'D97706' : 'DC2626'

    // Canonical theme set — counted ONCE across all theme fields (matches the
    // in-app Themes page / export picker) and reused everywhere so every theme %
    // in the deck agrees. >3% visibility filter applied.
    const sortedThemes = [...themes].sort((a, b) => (b.count || 0) - (a.count || 0))
    const canonicalThemes = (allRows.length > 0) ? visibleThemes(computeCanonicalThemes(sortedThemes)) : sortedThemes
    const canonMeta: TextCounts | undefined = (allRows.length > 0 && themeFields.length > 0)
      ? { comments: canonicalThemes[0]?.totalResponses ?? allRows.filter(r => themeFields.some(fk => isSubstantiveText(rowVal(r, fk)))).length,
          signals: canonicalThemes.reduce((sum, t) => sum + (t.count || 0), 0) }
      : undefined
    const metaSub = (base: string) => canonMeta ? base + ' · ' + canonMeta.comments.toLocaleString() + ' comments · ' + canonMeta.signals.toLocaleString() + ' signals' : base

    // ── 1. Executive Summary (findings — NOT the scope/method metrics, which
    //    live in "About This Report" so the two slides don't repeat each other).
    //    KPIs here are the headline *findings* (overall score, top theme, themes
    //    count); the narrative bullets are the real summary of what the data says.
    const numericField = selectedFields.find(f => f.type === 'numeric')
    const openField = selectedFields.find(f => f.type === 'open-ended')
    const execKpis: { value: string; label: string; sub?: string; color?: string }[] = []
    const ratingNum = selectedFields.find(f => f.type === 'numeric' && (f.sqt === 'rating' || f.scoreField || f.field === 'rating')) || numericField
    if (ratingNum?.summary?.avg != null) {
      const isStar = ((ratingNum.summary.max ?? 5) as number) <= 5
      execKpis.push({ value: (isStar ? '★' : '') + ratingNum.summary.avg.toFixed(1), label: 'Overall ' + trunc(ratingNum.label || ratingNum.field, 16) })
    }
    if (canonicalThemes[0]) execKpis.push({ value: (canonicalThemes[0].percentage || 0) + '%', label: 'Top theme', sub: trunc(canonicalThemes[0].name || '', 22) })
    if (canonicalThemes.length > 0) execKpis.push({ value: String(canonicalThemes.length), label: canonicalThemes.length === 1 ? 'Theme identified' : 'Themes identified' })
    if (execKpis.length === 0 && openField?.summary?.avgWordCount) execKpis.push({ value: String(openField.summary.avgWordCount), label: 'Avg Words / Response' })
    if (execKpis.length === 0) execKpis.push({ value: displayRows.toLocaleString(), label: 'Total Responses' })
    slides.push({ type: 'kpi_grid', title: 'Executive Summary', subtitle: metaSub('What the data is telling us'), kpis: execKpis })
    const execBullets = (narratives.executiveSummary || []).filter(b => b && b.length > 10)
    if (execBullets.length > 0) slides.push({ type: 'bullets', title: 'Key Findings', bullets: execBullets })

    // ── 2. Survey Overview (survey sources only) ─────────────────────────────
    {
      const surveyFields = (schema?.fields || [])
      const isSurveySource = !!dataset.study_id
        || surveyFields.some((f) => ['custom', 'psychographic', 'demographic'].includes(f.section || ''))
        || allRows.some((r) => r.status != null)
      if (isSurveySource && allRows.length > 0) {
        const has = (row: Record<string, unknown>, key: string) => rowVal(row, key).length > 0
        const oeF = surveyFields.filter((f) => f.type === 'open-ended')
        const stages: { label: string; count: number }[] = [{ label: 'Started', count: allRows.length }]
        const ratingF = surveyFields.find((f) => f.field === 'experience_score') || surveyFields.find((f) => f.field === 'nps_score')
        if (ratingF) { const c = allRows.filter((r) => has(r, ratingF.field)).length; if (c > 0) stages.push({ label: ratingF.label || 'Rating', count: c }) }
        if (oeF.length > 0) { const c = allRows.filter((r) => oeF.some((f) => has(r, f.field))).length; if (c > 0) stages.push({ label: 'Conversation', count: c }) }
        const custF = surveyFields.filter((f) => f.section === 'custom')
        if (custF.length > 0) { let maxA = 0; const c = allRows.filter((r) => { const a = custF.filter((f) => has(r, f.field)).length; if (a > maxA) maxA = a; return a > 0 }).length; if (c > 0) stages.push({ label: 'Survey Questions (' + maxA + ')', count: c }) }
        const psyF = surveyFields.filter((f) => f.section === 'psychographic')
        if (psyF.length > 0) { let maxA = 0; const c = allRows.filter((r) => { const a = psyF.filter((f) => has(r, f.field)).length; if (a > maxA) maxA = a; return a > 0 }).length; if (c > 0) stages.push({ label: 'Psychographics (' + maxA + ')', count: c }) }
        const demF = surveyFields.filter((f) => f.section === 'demographic')
        if (demF.length > 0) { const c = allRows.filter((r) => demF.some((f) => has(r, f.field))).length; if (c > 0) stages.push({ label: 'Demographics (optional)', count: c }) }
        const completed = allRows.filter((r) => rowVal(r, 'status').toLowerCase() === 'complete').length
        stages.push({ label: 'Completed', count: completed })
        const commentFields: string[] = (themeFields && themeFields.length) ? themeFields : oeF.map((f) => f.field)
        const withComments = commentFields.length > 0 ? allRows.filter((r) => commentFields.some((fk: string) => has(r, fk))).length : 0
        if (stages.length >= 3) {
          slides.push({ type: 'survey_funnel', title: 'Survey Overview', subtitle: 'Responses, engagement and completion funnel',
            kpis: [ { value: allRows.length.toLocaleString(), label: 'Responses', sub: 'total collected' },
                    { value: withComments.toLocaleString(), label: 'With comments', sub: 'left open-ended feedback', color: '2E2A25' } ],
            stages })
        }
      }
    }

    // ── 3. About this report ─────────────────────────────────────────────────
    let completionNote: string | undefined
    if (dataset.study_id) {
      try {
        const { data: resp } = await service.from('responses').select('status, payload').eq('study_id', dataset.study_id).order('created_at', { ascending: true }).limit(1000)
        if (resp && resp.length > 0) {
          const completeCount = resp.filter((r: { status?: string | null }) => r.status === 'complete' || r.status == null).length
          const cpct = Math.round(completeCount / resp.length * 100)
          completionNote = resp.length.toLocaleString() + ' total responses · ' + completeCount.toLocaleString() + ' complete (' + cpct + '%)'
        }
      } catch {}
    }
    {
      const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const openCount = selectedFields.filter(f => f.type === 'open-ended').length
      const catCount = selectedFields.filter(f => f.type === 'categorical').length
      const numCount = selectedFields.filter(f => f.type === 'numeric').length
      // Date range of the DATA in the report (distinct from the generation date).
      let dataRange: string | undefined
      {
        const dRaw = schema?.primaryDateField || (dataset.source === 'google_reviews' ? 'review_date' : null)
        if (dRaw) {
          const dk = rowKeyMap[normalize(dRaw)] || dRaw
          let mn = Infinity, mx = -Infinity
          for (const row of allRows) { const t = Date.parse(String(row[dk] ?? '')); if (isFinite(t)) { if (t < mn) mn = t; if (t > mx) mx = t } }
          if (isFinite(mn) && mx >= mn) {
            const f = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
            dataRange = f(mn) === f(mx) ? f(mn) : f(mn) + ' – ' + f(mx)
          }
        }
      }
      const aboutKpis = [
        { value: displayRows.toLocaleString(), label: samplingNote ? 'Sampled Responses' : 'Total Responses', sub: completionNote || (samplingNote ? 'sampled for this analysis' : 'in this analysis') },
        ...(dataRange ? [{ value: dataRange, label: 'Data Range', sub: 'span of responses analyzed' }] : []),
        { value: String(selectedFields.length), label: 'Fields Analyzed', sub: openCount + ' open · ' + catCount + ' cat · ' + numCount + ' num' },
        { value: dateStr, label: 'Report Generated', sub: audience + ' edition · v' + STORYTIME_VERSION },
      ]
      const collectionMethod = dataSource === 'study' ? 'Collected using Sarina (AI conversational survey). ' : 'Data uploaded from an external source. '
      // Two-count model: state the base once so every "N comments" / theme % in
      // the deck is read against substantive comments (raw response counts above
      // and rating averages stay over all rows).
      const substantiveNote = canonMeta ? ' Comment counts and theme percentages are over substantive comments — real feedback; one-word and "N/A"/"Nothing" non-answers are excluded.' : ''
      const aboutNote = [samplingNote, filterDescription || '', 'Methodology: ' + collectionMethod + 'Analyzed using Datanautix AI Text Analytics.' + substantiveNote].filter(Boolean).join('   ')
      slides.push({ type: 'kpi_grid', title: 'About This Report', subtitle: 'Methodology, scope and data coverage', kpis: aboutKpis, insight: aboutNote })
    }

    // ── Heads-Up watch list (universal exception alerts) ──────────────────────
    // Lens-agnostic: themes (organic topics) + Dimensions (ABSA, when enabled) +
    // quant variables (rating + numerics), each with recent-vs-prior trends from
    // the in-view date range. Renders for ANY dataset that surfaces ≥1 alert — no
    // longer gated on Dimensions. Placed up front as the executive exception list.
    const rk = (f: string) => rowKeyMap[normalize(f)] || f
    const dateRaw = schema?.primaryDateField || (dataset.source === 'google_reviews' ? 'review_date' : null)
    const dateKey = dateRaw ? rk(dateRaw) : null

    // Dimensions rollup (with trend windows) — computed ONCE here and reused by
    // the Dimensions section below. Gated on Dimensions being enabled (explicit
    // flag, or the google_reviews proxy unless suppressed — mirrors textmineNav).
    const dimEnabled = !!dataset.taxonomy_enabled ||
      (dataset.source === 'google_reviews' && !dataset.taxonomy_suppressed)
    let dim: Awaited<ReturnType<typeof computeTaxonomyRollup>> | null = null
    if (includeDimensions && dimEnabled) {
      const { data: dimField } = await service.rpc('taxonomy_primary_field', { p_dataset_id: params.datasetId })
      if (dimField) {
        const r = await computeTaxonomyRollup({ service, datasetId: params.datasetId, orgId: dataset.org_id, field: String(dimField), dateField: dateRaw })
        if (r.withSignal > 0) dim = r
      }
    }

    {
      // Quant lens — numeric fields (rating + any other numerics), recent-vs-prior.
      const numFields = (schema?.fields || []).filter(f => f.type === 'numeric' && f.status !== 'ignored')
      const ratingFieldName = numFields.find(f => f.sqt === 'rating' || f.scoreField || f.field === 'rating')?.field
      const quantSpecs = numFields.map(f => ({ key: rk(f.field), label: f.label || f.field, isRating: f.field === ratingFieldName }))
      const { signals: quantSignals, windowLabel: quantWin } = buildQuantSignals(allRows, dateKey, quantSpecs)

      // Theme lens — organic themes, windowed keyword re-matching + rating pos/neg.
      const themeSpecs = canonicalThemes.map(t => ({ label: t.name || '', keywords: t.keywords || [] }))
      const { signals: themeSig, windowLabel: themeWin } = buildThemeSignals({
        themes: themeSpecs, rows: allRows, textKeys: themeFields.map(fk => rk(fk)),
        ratingKey: ratingKey || null, dateKey,
      })

      // Dimension lens — recent window is the "now" when we can trend, else full.
      const dimSignals = dim ? dimensionsToSignals(dim.recent || dim, dim.prior) : []

      // Overall rating baseline for the static "rating-drag" detection (all-rows
      // dimensions overall when classified; else the in-view rating mean).
      let overallRating: number | null = dim?.overallAvgRating ?? null
      if (overallRating == null && ratingKey) {
        let s = 0, c = 0
        for (const row of allRows) { const v = parseFloat(String(row[ratingKey] ?? '')); if (!isNaN(v)) { s += v; c++ } }
        if (c > 0) overallRating = +(s / c).toFixed(2)
      }

      const alerts = computeInsightAlerts({
        signals: [...themesToSignals(themeSig), ...dimSignals],
        quant: quantSignals,
        safety: dim?.alerts || [],
        overallAvgRating: overallRating,
        baselineRows: dim?.classifiedRows ?? allRows.length,
        windowLabel: dim?.windowLabel || quantWin || themeWin || null,
        max: 8,
      })
      if (alerts.length) {
        const KIND_LABEL: Record<AlertKind, string> = {
          safety: 'Safety', pain: 'Pain point', bright: 'Bright spot',
          deteriorating: 'Trending down', heating: 'Heating up', improving: 'Improving',
        }
        const counts = alerts.reduce<Record<string, number>>((m, a) => { m[a.kind] = (m[a.kind] || 0) + 1; return m }, {})
        const summary = Object.entries(counts).map(([k, n]) => `${n} ${KIND_LABEL[k as AlertKind].toLowerCase()}${n > 1 ? 's' : ''}`).join(' · ')
        slides.push({
          type: 'table',
          title: 'Heads-Up',
          subtitle: 'Exception conditions worth acting on — across themes, Dimensions and the numbers, grounded in the data',
          columns: ['Signal', 'What', 'Detail'],
          rows: alerts.map(a => [`${a.icon} ${KIND_LABEL[a.kind]}`, a.title, a.detail]),
          insight: summary,
        })
      }
    }

    // ── Dimensions (ABSA taxonomy) section ────────────────────────────────────
    // Coverage + What-Stands-Out (mirrors the Operational Review deck), reusing
    // the rollup computed above. The Heads-Up moved out to the universal block.
    if (dim) {
      slides.push({ type: 'section', title: 'Dimensions', subtitle: 'Aspect-level (ABSA) lens — touchpoint, attribute, product, beverage, ambiance, context, outcome', eyebrow: 'Dimensions' })

      // Aspect coverage — the 7 axes by mention rate.
      slides.push({
        type: 'column_chart',
        title: 'Dimensions — Aspect Coverage',
        subtitle: `${dim.withSignal.toLocaleString()} of ${dim.classifiedRows.toLocaleString()} classified comments carry at least one aspect`,
        yAxisLabel: '% of classified comments mentioning the axis',
        valueSuffix: '%',
        data: dim.axes.map(a => ({ label: a.label, value: Math.round(a.rate) })),
      })

      // What stands out — top sub-aspects by mention volume.
      const topSubs = [...dim.subs].sort((a, b) => b.count - a.count).slice(0, 10)
      const lowest = topSubs.filter(s => s.posPct != null).sort((a, b) => (a.posPct as number) - (b.posPct as number)).slice(0, 3)
      let standOut = lowest.length
        ? `The fix list is the lowest %-positive aspects: ${lowest.map(s => `${s.sub} (${s.posPct}%)`).join(', ')}.`
        : `Counts shown; %-positive where assertion polarity exists.`
      if (dim.alerts.length) standOut += ` Severity flags: ${dim.alerts.map(a => `${a.tag} (${a.count})`).join(', ')} across ${dim.alertRows.toLocaleString()} comments — review first.`
      slides.push({
        type: 'table',
        title: 'Dimensions — What Stands Out',
        subtitle: `Top ${topSubs.length} sub-aspects by mention volume`,
        columns: ['Aspect', 'Axis', 'Mentions', '% Positive', 'Avg ★'],
        rows: topSubs.map(s => [
          trunc(s.sub, 28), s.axis, String(s.count),
          s.posPct != null ? `${s.posPct}%` : '—',
          s.avgRating != null ? `${s.avgRating.toFixed(1)}★` : '—',
        ]),
        insight: standOut,
      })
    }

    // ── Field groupings ──────────────────────────────────────────────────────
    const openEndedSelected = selectedFields.filter(f => f.type === 'open-ended')
    const coreFields = selectedFields.filter(f => !f.section || f.section === 'core')
    const customFields = selectedFields.filter(f => f.section === 'custom')
    const psychoFields = selectedFields.filter(f => f.section === 'psychographic')
    let demoFields = selectedFields.filter(f => f.section === 'demographic')
    const personalDemoOrder = ['gender', 'age', 'race', 'household_income', 'household income', 'income']
    const addressDemoFields = ['address', 'street', 'city', 'state', 'zip', 'postal_code', 'country']
    demoFields = demoFields.sort((a, b) => {
      const key = (f: SelectedField) => {
        const fl = f.field.toLowerCase().replace(/[_\s]/g, '_')
        for (let i = 0; i < personalDemoOrder.length; i++) { if (fl.includes(personalDemoOrder[i].replace(/[_\s]/g, '_'))) return i }
        if (addressDemoFields.some(af => fl.includes(af.replace(/[_\s]/g, '_')))) return 1000
        return 2000
      }
      return key(a) - key(b)
    })
    const commentDemoFields2 = selectedFields.filter(f => f.section === 'demographic' || f.section === 'psychographic').slice(0, 4)
    const usedCommentTexts = new Set<string>()

    // dist_bars spec for a categorical field (ordinal-aware order + colors + KPIs)
    function catSpec(f: SelectedField): DistBarsSlide {
      const ai = aiFor(f)
      const s = f.summary
      const rawCountsOrig = (s?.counts || {}) as Record<string, number>
      const rawCounts = f.valueAliases && Object.keys(f.valueAliases).length > 0 ? aliasedCounts(f.field, rawCountsOrig, [{ field: f.field, valueAliases: f.valueAliases }]) : rawCountsOrig
      const allKeys = Object.keys(rawCounts)
      const total = allKeys.reduce((sum, k) => sum + (rawCounts[k] || 0), 0)
      const isOrdinal = (f.remapping && Object.keys(f.remapping).length > 0) || isOrdinalScale(allKeys)
      let orderedKeys = isOrdinal ? smartOrder(allKeys, f.remapping).slice().reverse() : allKeys.slice().sort((a, b) => (rawCounts[b] || 0) - (rawCounts[a] || 0))
      orderedKeys = orderedKeys.filter(k => (rawCounts[k] || 0) > 0).slice(0, 9)
      const nn = orderedKeys.length
      const top2 = isOrdinal ? pct(orderedKeys.slice(0, 2).reduce((s2, k) => s2 + (rawCounts[k] || 0), 0), total) : 0
      const bot2 = isOrdinal && orderedKeys.length >= 4 ? pct(orderedKeys.slice(-2).reduce((s2, k) => s2 + (rawCounts[k] || 0), 0), total) : 0
      const topKey = orderedKeys[0] || ''
      const topPct = pct(rawCounts[topKey] || 0, total)
      const data = orderedKeys.map((k, i) => ({ label: k, value: rawCounts[k] || 0, color: isOrdinal ? ordinalColor(i, nn) : undefined }))
      const kpis: { value: string; label: string; sub?: string; color?: string }[] = [
        { value: total.toLocaleString(), label: 'Respondents' },
        { value: topPct + '%', label: 'Top Response', sub: trunc(topKey, 22), color: isOrdinal ? sentTone(top2) : undefined },
      ]
      if (isOrdinal) kpis.push({ value: top2 + '%', label: 'Top-2 Positive', color: sentTone(top2) })
      else kpis.push({ value: String(orderedKeys.length), label: 'Unique Values' })
      const insight = hasRealAI(ai, f) ? trimNatural(ai.keyFinding, 200) : autoInsight(f.label, orderedKeys, rawCounts, total, isOrdinal, top2, bot2)
      const subtitle = (f.section === 'demographic' || f.section === 'psychographic') && f.prompt ? f.prompt : 'Response distribution · ' + (s?.nonNull || 0).toLocaleString() + ' responses'
      return { type: 'dist_bars', title: f.label, subtitle, kpis, data, insight }
    }

    // numeric_stats spec for a numeric field (stat cards + histogram + mean line)
    function numSpec(f: SelectedField): NumericStatsSlide {
      const ai = aiFor(f)
      const s = f.summary
      const range = ((s?.max ?? 0) as number) - ((s?.min ?? 0) as number)  // numSpec is only called for numeric fields
      const posInRange = range > 0 ? ((s?.avg ?? 0) - ((s?.min ?? 0) as number)) / range : 0.5
      const perfColor = posInRange >= 0.65 ? '059669' : posInRange <= 0.35 ? 'DC2626' : 'D97706'
      const stats = [
        { label: 'Average', value: s?.avg != null ? String(Math.round(s.avg * 10) / 10) : '—', color: perfColor },
        { label: 'Median', value: s?.median != null ? String(Math.round(s.median * 10) / 10) : '—' },
        { label: 'Std Dev', value: s?.std != null ? String(Math.round(s.std * 10) / 10) : '—' },
        { label: 'Min → Max', value: (s?.min ?? '—') + ' – ' + (s?.max ?? '—') },
        { label: 'n', value: (s?.nonNull || 0).toLocaleString() },
      ]
      let histogram: { label: string; count: number }[] | undefined
      let meanFrac: number | undefined
      let meanLabel: string | undefined
      const isDiscrete = !!(s?.isDiscrete && s?.valueCounts && Object.keys(s.valueCounts || {}).length > 0)
      if (isDiscrete) {
        const rc = s.valueCounts as Record<string, number>
        const keys = Object.keys(rc).sort((a, b) => Number(a) - Number(b))
        histogram = keys.map(k => ({ label: k, count: rc[k] || 0 }))
        if (s?.avg != null && range > 0) { meanFrac = (s.avg - (s.min as number)) / range; meanLabel = 'avg ' + (Math.round(s.avg * 10) / 10) }
      } else if (Array.isArray(s?.histogram) && s.histogram.length > 0) {
        histogram = s.histogram.map((b: { min: number; count: number }) => ({ label: String(Math.round(b.min)), count: b.count }))
        if (s?.avg != null && range > 0) { meanFrac = (s.avg - (s.min as number)) / range; meanLabel = 'avg ' + Math.round(s.avg) }
      }
      const insight = hasRealAI(ai, f) ? aiInsight(ai, f) : (posInRange >= 0.65 ? 'Average sits in the upper range — strong performance.' : posInRange <= 0.35 ? 'Average sits in the lower range — opportunity for improvement.' : 'Average sits in the mid range.')
      const subtitle = (f.section === 'demographic' || f.section === 'psychographic') && f.prompt ? f.prompt : 'Numeric distribution · ' + (s?.nonNull || 0).toLocaleString() + ' responses'
      return { type: 'numeric_stats', title: f.label, subtitle, stats, histogram, meanFrac, meanLabel, insight }
    }

    // compact_grid cells from a list of categorical fields
    function compactCells(fields: SelectedField[]): CompactGridSlide['cells'] {
      return fields.map(f => {
        const s = f.summary
        const rawCountsOrig = (s?.counts || {}) as Record<string, number>
        const rawCounts = f.valueAliases && Object.keys(f.valueAliases).length > 0 ? aliasedCounts(f.field, rawCountsOrig, [{ field: f.field, valueAliases: f.valueAliases }]) : rawCountsOrig
        const allKeys = Object.keys(rawCounts)
        const total = allKeys.reduce((sum, k) => sum + (rawCounts[k] || 0), 0)
        const isOrd = (f.remapping && Object.keys(f.remapping).length > 0) || isOrdinalScale(allKeys)
        let orderedKeys = isOrd ? smartOrder(allKeys, f.remapping).slice().reverse() : allKeys.slice().sort((a, b) => (rawCounts[b] || 0) - (rawCounts[a] || 0))
        orderedKeys = orderedKeys.filter(k => (rawCounts[k] || 0) > 0).slice(0, 6)
        return { label: f.label, total, bars: orderedKeys.map((k, i) => ({ label: k, value: rawCounts[k] || 0, color: isOrd ? ordinalColor(i, orderedKeys.length) : undefined })) }
      })
    }
    const pushCompact = (title: string, subtitle: string, fields: SelectedField[]) => {
      const cells = compactCells(fields)
      for (let i = 0; i < cells.length; i += 4) slides.push({ type: 'compact_grid', title, subtitle, cells: cells.slice(i, i + 4) })
    }

    // verbatim comment grid slides for one open-ended field
    function pushCommentSlides(f: SelectedField) {
      const cfg = commentConfig[f.field]
      const cmtEnabled = cfg ? cfg.enabled : true
      if (!cmtEnabled) return
      const cmtSlides = cfg ? Math.max(1, Math.min(3, cfg.slides)) : (audience === 'full' ? 3 : 2)
      const perSlide = 6
      const maxComments = cmtSlides * perSlide
      const annotFields = commentAnnotations.length > 0 ? selectedFields.filter(sf => commentAnnotations.includes(sf.field)) : commentDemoFields2
      const allColorVals = commentColorField ? allRows.map(r => rowVal(r, commentColorField)).filter(Boolean) : []
      const allItems = allRows
        .map(row => {
          const text = rowVal(row, f.field)
          const pills = annotFields
            .map(df => ({ label: rowVal(row, df.field), tone: (df.section === 'demographic' ? 'demo' : df.section === 'psychographic' ? 'psycho' : 'neutral') as 'demo' | 'psycho' | 'neutral' }))
            .filter(p => p.label.length > 0 && p.label.length < 40)
          const colorValue = commentColorField ? rowVal(row, commentColorField) : ''
          const accent = colorValue ? valueToColor(colorValue, allColorVals) : getStripColor(text)
          return { text, pills, colorValue, accent }
        })
        .filter(c => c.text.length >= 80 && !usedCommentTexts.has(c.text.slice(0, 120)))
        .sort((a, b) => { const aFit = a.text.length >= 80 && a.text.length <= 300 ? 0 : Math.abs(a.text.length - 190); const bFit = b.text.length >= 80 && b.text.length <= 300 ? 0 : Math.abs(b.text.length - 190); return aFit - bFit })
      const items = (function() {
        if (!commentColorField) return allItems.slice(0, maxComments)
        const groups: Record<string, typeof allItems> = {}
        allItems.forEach(c => { const key = c.colorValue || '__none__'; (groups[key] = groups[key] || []).push(c) })
        const buckets = Object.values(groups); const result: typeof allItems = []; let i = 0
        while (result.length < maxComments) { let added = false; for (let b = 0; b < buckets.length && result.length < maxComments; b++) { if (buckets[b][i]) { result.push(buckets[b][i]); added = true } } if (!added) break; i++ }
        return result
      })()
      items.forEach(c => usedCommentTexts.add(c.text.slice(0, 120)))
      if (items.length === 0) return
      const cFieldThemes = allRows.length > 0 ? computeFieldThemes(f.field, sortedThemes) : []
      const cComments = cFieldThemes[0]?.totalResponses ?? allRows.filter(r => isSubstantiveText(rowVal(r, f.field))).length
      const cSignals = cFieldThemes.reduce((sum, t) => sum + (t.count || 0), 0)
      const numSlides = Math.ceil(items.length / perSlide)
      for (let si = 0; si < numSlides; si++) {
        const slice = items.slice(si * perSlide, (si + 1) * perSlide)
        const sectionTag = f.section ? f.section.charAt(0).toUpperCase() + f.section.slice(1) + ' · ' : ''
        const slideTag = numSlides > 1 ? '  ·  Slide ' + (si + 1) + ' of ' + numSlides : ''
        slides.push({ type: 'comments_grid', title: f.label,
          subtitle: sectionTag + 'Verbatim responses · ' + cComments.toLocaleString() + ' comments · ' + cSignals.toLocaleString() + ' signals' + slideTag,
          comments: slice.map(c => ({ text: c.text, accent: c.accent, pills: c.pills.slice(0, 4) })) })
      }
    }

    // theme-detail quote picking (async; mirrors the old buildThemeSlides)
    function matchesTheme(text: string, regexes: RegExp[]): boolean {
      if (!regexes.length) return false
      const lower = text.toLowerCase()
      return regexes.some(function(re) { return re.test(lower) })
    }
    async function themeDetailQuotes(t: DeckTheme, fieldsOverride?: string[]): Promise<{ text: string }[]> {
      const quoteFields = fieldsOverride && fieldsOverride.length ? fieldsOverride : themeFields
      if (!allRows.length || !quoteFields.length) return []
      const keys = quoteFields.map(fk => rowKeyMap[normalize(fk)] || fk)
      const kwRegexes = ((t.keywords || []) as string[]).map(function(kw) {
        const e = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp('(?<![a-z])' + e + '\\w*', 'i')
      })
      const matched: string[] = []
      for (const row of allRows) {
        const text = keys.map(k => String(row[k] || '')).join(' ').trim().replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' ')
        if (text.length < 80) continue
        if (matchesTheme(text, kwRegexes)) matched.push(text)
      }
      if (!matched.length) return []
      matched.sort((a, b) => b.length - a.length)
      const pool = matched.slice(0, Math.min(matched.length, 40))
      const themeInfo = { name: t.name || '', description: t.description || '', keywords: t.keywords || [], sentiment: t.sentiment || '' }
      const useAI = pool.length > 8 ? (skipAI ? undefined : dataset!.org_id) : undefined
      const picked = await pickBestComments(pool, themeInfo, 4, useAI, usedCommentTexts, 350)
      return picked.map(text => ({ text: trimNatural(text.replace(/[\r\n]+/g, ' ').replace(/\s{2,}/g, ' '), 240) }))
    }

    // ── 4. Open-ended verbatim overviews + ONE canonical Theme Analysis ──────
    if (!skipTextAnalytics && openEndedSelected.length > 0) {
      for (const f of openEndedSelected) {
        const divSubtitle = (f.prompt && f.prompt !== f.label) ? f.prompt : 'Verbatim responses in respondents’ own words'
        slides.push({ type: 'section', title: f.label, subtitle: divSubtitle, eyebrow: 'Open-ended' })
        const ai = aiFor(f)
        const s = f.summary
        const samplePool: string[] = (f.liveSample && f.liveSample.length > 0) ? f.liveSample : (s?.sample || [])
        const candidates = samplePool.filter((q: string) => q && q.trim().length >= 80).map((q: string) => q.trim())
        const fieldQuotes = ((ai.pickedQuotes && ai.pickedQuotes.length > 0)
          ? ai.pickedQuotes.slice(0, 5)
          : (candidates.length >= 5 ? candidates.slice(0, 5) : samplePool.filter((q: string) => q && q.trim().length > 40).slice(0, 5))
        ).map((q: string) => trimNatural(q, 240))
        if (fieldQuotes.length > 0) {
          slides.push({ type: 'quotes', title: f.label,
            subtitle: metaSub(f.prompt && f.prompt !== f.label ? f.prompt : 'Open-ended verbatim responses'),
            quotes: fieldQuotes.map((q: string) => ({ text: q })), insight: aiInsight(ai, f) })
        }
      }

      // Field label for a theme set's section title ("Liked Most" not the raw
      // column name) — used only when more than one set is in the deck. Survey
      // labels are often the full question sentence, so titles truncate.
      const setFieldLabel = (flds: string[]) => trunc(flds
        .map(fk => { const sf = (schema?.fields || []).find((s) => s.field === fk); return sf?.label || fk })
        .join(' + '), 60)
      const multiSetDeck = extraThemeSets.length > 0
      const perGrid = themesPerSlide && themesPerSlide > 0 ? Math.min(themesPerSlide, 5) : 5

      // One Theme Analysis block per set. The active set renders exactly as
      // before (same titles/meta) unless other sets exist, in which case every
      // block is labeled with its prompt so praise/complaint sets read apart.
      const renderThemeBlock = async (blockThemes: DeckTheme[], blockFields: string[], labeled: boolean) => {
        if (blockThemes.length === 0) return
        const label = setFieldLabel(blockFields)
        // Section-slide titles render on ONE line before the divider rule —
        // a wrapped second line strikes through it (QC'd 2026-07-11) — so the
        // section gets a hard-truncated label and the subtitle carries the
        // full question. Card-slide headers wrap cleanly, so they keep more.
        const sectionTitle = labeled ? 'Theme Analysis — ' + trunc(label, 30) : 'Theme Analysis'
        const cardsTitle = labeled ? 'Theme Analysis — ' + label : 'Theme Analysis'
        const comments = blockThemes[0]?.totalResponses ?? allRows.filter(r => blockFields.some(fk => isSubstantiveText(rowVal(r, fk)))).length
        const signals = blockThemes.reduce((sum, t) => sum + (t.count || 0), 0)
        const blockMeta = (base: string) => base + ' · ' + comments.toLocaleString() + ' comments · ' + signals.toLocaleString() + ' signals'
        const sub = labeled ? blockMeta : metaSub
        slides.push({ type: 'section', title: sectionTitle,
          subtitle: labeled ? 'Themes in “' + label + '” · counted against that question’s responses' : 'Themes across all open-ended responses · keywords sized by how often each idea appears',
          eyebrow: 'Themes' })
        for (let pg = 0; pg < blockThemes.length; pg += perGrid) {
          const page = blockThemes.slice(pg, pg + perGrid)
          slides.push({ type: 'theme_cards', title: cardsTitle, subtitle: sub(blockThemes.length + ' themes identified'),
            cards: page.map((t) => ({ name: t.name || '', pct: t.percentage || 0, count: t.count, total: t.totalResponses, sentiment: sentLabel(t.sentiment),
              keywords: ((t.kwFreqs && t.kwFreqs.length) ? t.kwFreqs : (t.keywords || []).map((w: string) => ({ word: w, pct: 0 }))).slice(0, 8).map((k: { word: string; pct: number }) => ({ word: k.word, pct: k.pct })) })) })
        }
        // Quote-picking per theme is AI-bound (~1-2s each) — run 3 at a time,
        // then push slides in the original theme order.
        const themeQuotes = await runPool(blockThemes.map(t => () => themeDetailQuotes(t, blockFields)), 3)
        blockThemes.forEach((t, ti) => {
          const q = themeQuotes[ti]
          if (q.length > 0) {
            slides.push({ type: 'quotes', title: t.name || 'Theme',
              subtitle: sub((t.percentage || 0) + '% · ' + (t.count || 0).toLocaleString() + ' of ' + (t.totalResponses || 0).toLocaleString() + (t.sentiment ? ' · ' + sentLabel(t.sentiment) : '')),
              quotes: q, insight: t.description || undefined })
          }
        })
      }

      if (includeThemeSlides && canonicalThemes.length > 0) {
        await renderThemeBlock(canonicalThemes, themeFields, multiSetDeck)
      }
      if (includeThemeSlides) {
        for (const set of extraThemeSets) {
          const setSorted = [...(set.model.themes as DeckTheme[])].sort((a, b) => (b.count || 0) - (a.count || 0))
          const setCounted = allRows.length > 0 ? visibleThemes(computeCanonicalThemes(setSorted, set.fields)) : setSorted
          await renderThemeBlock(setCounted, set.fields, true)
        }
      }
    }

    // ── 4b. Entity analysis — native specs from the stored entity catalog ────
    if (entityFields.length > 0) {
      const entLabels = entityFields.map(k => { const sf = (schema?.fields || []).find((s) => s.field === k); return sf?.label || k })
      const sectionTitle = entLabels.length === 1 ? entLabels[0] + ' — Entity Analysis' : 'Entity Analysis'
      const PLATFORM_NAMES = new Set(['sentimetrx', 'datanautix'])
      try {
        let ents = await getEntitiesWithCounts({ service, datasetId: params.datasetId, limit: 200, textFieldKeys: entityFields })
        let entityRows = ('notFound' in ents ? [] : ents.entities).filter(e => !PLATFORM_NAMES.has(e.canonical.toLowerCase().trim()))
        if (entityRows.length === 0 && !skipAI) {
          try {
            await discoverEntities({ service, datasetId: params.datasetId, mode: 'manual', triggeredByUser: user.id })
            ents = await getEntitiesWithCounts({ service, datasetId: params.datasetId, limit: 200, textFieldKeys: entityFields })
            entityRows = ('notFound' in ents ? [] : ents.entities).filter(e => !PLATFORM_NAMES.has(e.canonical.toLowerCase().trim()))
          } catch (e) { console.error({ at: 'export/pptx', msg: 'entity discovery failed', err: e }) }
        }
        if (entityRows.length > 0) {
          if (!skipAI) {
            try {
              const focusMap = await categoriseEntityNames(entityRows.map(e => e.canonical), orgId ?? undefined)
              if (Object.keys(focusMap).length > 0) entityRows = entityRows.map(e => ({ ...e, category: focusMap[e.canonical] || e.category }))
            } catch (e) { console.error({ at: 'export/pptx', msg: 'entity recategorisation failed', err: e }) }
          }
          const catAgg: Record<string, number> = {}
          for (const e of entityRows) catAgg[e.category] = (catAgg[e.category] || 0) + e.mentions
          const entityCats = Object.entries(catAgg).map(([category, mentions]) => ({ category, mentions })).sort((a, b) => b.mentions - a.mentions)
          const agg = catalogToAggregate(entityRows, entityCats)
          slides.push({ type: 'section', title: sectionTitle, subtitle: 'Organisations named by respondents · canonicalised and grouped by focus area' })
          const specs = entitySlideSpecs(entLabels[0] || 'Entities', agg, { includeQuotes: false })
          for (const spec of specs) slides.push(spec as unknown as SlideSpec)
        }
      } catch (e) { console.error({ at: 'export/pptx', msg: 'entity analysis failed', err: e }) }
    }

    // ── 5. Categorical + numeric fields (all sections) ───────────────────────
    const nonOECore = coreFields.filter(f => f.type !== 'open-ended')
    if (nonOECore.length > 0) {
      slides.push({ type: 'section', title: 'Core Study Questions', subtitle: 'Primary research questions and measured outcomes' })
      nonOECore.forEach(f => {
        if (f.type === 'categorical' && audience !== 'executive') slides.push(catSpec(f))
        else if (f.type === 'numeric' && audience !== 'executive') slides.push(numSpec(f))
      })
    }
    const nonOECustom = customFields.filter(f => f.type !== 'open-ended').sort((a, b) => ((b.summary?.nonNull || 0) - (a.summary?.nonNull || 0)))
    if (nonOECustom.length > 0) {
      const customCat = nonOECustom.filter(f => f.type === 'categorical')
      const customNum = nonOECustom.filter(f => f.type === 'numeric')
      slides.push({ type: 'section', title: 'Survey Questions', subtitle: 'Custom questions asked to respondents' })
      if (customCat.length >= 3) pushCompact('Survey Questions', 'Response distributions', customCat)
      else customCat.forEach(f => slides.push(catSpec(f)))
      customNum.forEach(f => slides.push(numSpec(f)))
    }
    if (psychoFields.filter(f => f.type !== 'open-ended').length > 0 && audience !== 'executive') {
      const psychoCat = psychoFields.filter(f => f.type === 'categorical')
      const psychoNum = psychoFields.filter(f => f.type === 'numeric')
      slides.push({ type: 'section', title: 'Psychographic Profile', subtitle: 'Attitudes, values, motivations and lifestyle indicators' })
      if (psychoCat.length >= 3) pushCompact('Psychographic Profile', 'Response distributions', psychoCat)
      else psychoCat.forEach(f => slides.push(catSpec(f)))
      psychoNum.forEach(f => slides.push(numSpec(f)))
    }
    if (demoFields.filter(f => f.type !== 'open-ended').length > 0 && audience !== 'executive') {
      const demoCat = demoFields.filter(f => f.type === 'categorical')
      const demoNum = demoFields.filter(f => f.type === 'numeric')
      slides.push({ type: 'section', title: 'Demographic Breakdown', subtitle: 'Audience composition and segment characteristics' })
      if (demoCat.length >= 3) pushCompact('Demographic Breakdown', 'Audience composition', demoCat)
      else demoCat.forEach(f => slides.push(catSpec(f)))
      demoNum.forEach(f => slides.push(numSpec(f)))
    }

    // ── 6. Sample comments (verbatim pages) at the end ───────────────────────
    if (!skipTextAnalytics && openEndedSelected.length > 0) {
      for (const f of openEndedSelected) {
        const dividerSubtitle = (f.prompt && f.prompt !== f.label) ? f.prompt : 'Selected responses in respondents’ own words'
        slides.push({ type: 'section', title: f.label, subtitle: dividerSubtitle, eyebrow: 'Verbatim' })
        pushCommentSlides(f)
      }
    }

    // ── 7. Theme Impact / Key Driver Analysis (full-team report only) ────────
    const impactScoreFields: string[] = body.impactScoreFields || []
    const scoreFields = (impactScoreFields.length > 0
      ? selectedFields.filter(f => impactScoreFields.indexOf(f.field) !== -1)
      : selectedFields.filter(f => f.type === 'numeric' || (f.type === 'categorical' && f.remapping && Object.keys(f.remapping).length >= 3))
    ).slice(0, 2)
    const impactOE = impactOEFields.length > 0 ? openEndedSelected.filter(f => impactOEFields.indexOf(f.field) !== -1) : []
    if (audience === 'full' && themes.length >= 3 && scoreFields.length > 0 && impactOE.length > 0 && allRows.length >= 30) {
      const themeInput = themes.map((t) => ({ id: t.id || '', name: t.name || '', keywords: t.keywords || [] }))
      for (const sf of scoreFields.slice(0, 2)) {
        for (const oe of impactOE) {
          try {
            const analysis = computeThemeImpact({ themes: themeInput, rows: allRows, scoreField: sf.field, textFields: [oe.field], scoreRemapping: sf.remapping, rowKeyMap }, (sf.label || sf.field) + ' × ' + (oe.label || oe.field))
            if (analysis) {
              const r2Pct = Math.round(analysis.rSquared * 100)
              const targetLabel = analysis.fieldLabel || ''
              const topTheme = analysis.impacts[0]
              const interpretation = 'How to read this chart: Each bar shows how much a topic in written feedback connects to ' + targetLabel + '. '
                + (topTheme ? 'When people write about "' + topTheme.themeName + '", their ' + targetLabel + ' tends to be ' + (topTheme.coefficient >= 0 ? 'higher' : 'lower') + ' by ~' + Math.abs(topTheme.coefficient).toFixed(1) + ' points. ' : '')
                + 'Longer bars mean a stronger connection. The themes collectively explain ' + r2Pct + '% of what drives ' + targetLabel + ' scores.'
              slides.push({ type: 'theme_impact', title: 'Key Driver Analysis — ' + targetLabel,
                subtitle: 'OLS regression · n=' + analysis.n.toLocaleString() + ' · R²=' + r2Pct + '% · baseline=' + analysis.intercept.toFixed(1),
                impacts: analysis.impacts.slice(0, 10).map((im) => ({ themeName: im.themeName, coefficient: im.coefficient, significant: im.significant })),
                interpretation })
            }
          } catch { /* skip */ }
        }
      }
    }

    // ── 8. Closing key takeaways ─────────────────────────────────────────────
    if ((narratives.keyTakeaways || []).length > 0) {
      slides.push({ type: 'bullets', title: 'Key Takeaways', bullets: narratives.keyTakeaways.slice(0, 6) })
    }

    // ── 9. "Every deck is custom" + provenance receipt ───────────────────────
    try {
      if (!includeCustomDecks && !includeProvenance) throw '__skip_closers__'
      const contentCount = slides.length   // excludes the cover renderDeck adds
      const totalAfter = contentCount + 1 + (includeCustomDecks ? 1 : 0) + (includeProvenance ? 1 : 0) + (includeRecap ? 1 : 0)

      if (includeCustomDecks) slides.push({
        type: 'custom_decks',
        title: 'Every deck is custom.',
        tagline: 'Not template-filled — generated for your data, your fields, your questions.',
        capabilities: [
          'This report composes itself from your dataset — slides chosen by what the data shows.',
          'Give us a question, get a deck — entity analysis, churn drivers, theme deep-dives, segment comparisons.',
          'Every run is fresh — same chrome, different content. Take it from analysis to readout in minutes.',
        ],
        examples: [
          'Why are customers churning?',
          'What new programs would they support?',
          'Top complaints by segment?',
          'Which themes drive ratings?',
        ],
        hook: 'Ask: "What would you want a custom slide for?"',
      })

      if (!includeProvenance) throw '__skip_closers__'
      const wallClockSeconds = (Date.now() - ssStartedAt) / 1000

      let totalWords = 0
      let totalSentences = 0
      const vocab = new Set<string>()
      for (const row of allRows) {
        for (const f of selectedFieldNames) {
          const v = rowVal(row, f)
          if (!v) continue
          for (const w of v.toLowerCase().match(/[a-z][a-z'-]+/g) || []) { vocab.add(w); totalWords += 1 }
          totalSentences += v.split(/[.!?]+/).filter(s => s.trim().length > 2).length
        }
      }
      const schemaFields = (schema?.fields || []).filter((f) => f.status !== 'ignored')
      const oeCount = schemaFields.filter((f) => f.type === 'open-ended').length
      const catCount = schemaFields.filter((f) => f.type === 'categorical').length
      const numCount = schemaFields.filter((f) => f.type === 'numeric').length
      const dateCount = schemaFields.filter((f) => f.type === 'date').length
      const fieldsCaptured = oeCount + catCount + numCount + dateCount
      const themesCount = (themes && themes.length) || 0
      const takeawaysCount = (narratives.keyTakeaways || []).length
      const humanHours = Math.max(1, Math.round(Math.max(1, contentCount) * 0.25))

      const outputs: { value: string; label: string; sub?: string }[] = [
        { value: `${totalAfter} slides`, label: 'in this report', sub: 'distributions · themes · representative quotes' },
        { value: themesCount > 0 ? String(themesCount) : audience.charAt(0).toUpperCase() + audience.slice(1),
          label: themesCount > 0 ? (themesCount === 1 ? 'theme surfaced' : 'themes surfaced') : 'narrative tier',
          sub: themesCount > 0 ? 'with keywords, sentiment, and sample quotes' : 'depth tuned to the chosen audience' },
      ]
      if (takeawaysCount > 0) {
        outputs.push({ value: String(takeawaysCount), label: takeawaysCount === 1 ? 'key takeaway written' : 'key takeaways written', sub: 'distilled from the findings' })
      }

      slides.push({
        type: 'provenance',
        title: 'How this deck was made.',
        wallClockSeconds,
        secondStat: {
          value: `${allRows.length.toLocaleString()}${rowsSampled ? '*' : ''}`,
          label: rowsSampled ? 'responses (sampled)' : 'responses analysed',
          sub: isCollection ? `across ${flatDatasetIds.length} datasets` : 'single dataset',
        },
        columnHeaders: { inputs: 'WHAT WE LOOKED AT', processing: 'WHAT WE DID', outputs: 'WHAT WE PRODUCED' },
        inputs: [
          { value: totalWords.toLocaleString(), label: 'words of open-ended text read', sub: `${totalSentences.toLocaleString()} sentences · ${vocab.size.toLocaleString()} unique words` },
          { value: String(oeCount), label: oeCount === 1 ? 'open-ended field analysed' : 'open-ended fields analysed', sub: rowsSampled ? '* sampling applied above 50K rows' : 'every response read, not sampled' },
          { value: String(fieldsCaptured), label: 'fields captured in the schema', sub: `${catCount} categorical · ${numCount} numeric${dateCount ? ` · ${dateCount} date` : ''}` },
        ],
        processing: [
          { value: themesCount > 0 ? String(themesCount) : 'pattern', label: themesCount > 0 ? (themesCount === 1 ? 'theme identified' : 'themes identified') : 'discovery pass', sub: `Claude (Anthropic) · narrative tuned for ${audience}` },
          { value: 'Sentiment', label: 'scored on every response', sub: 'positive · neutral · negative' },
          { value: 'Quotes', label: 'selected to evidence each theme', sub: 'AI-ranked for representativeness' },
        ],
        outputs,
        pipelineStages: ['ingest', 'clean', 'themes (LLM)', 'sentiment', 'impact', 'rank quotes', 'narrative (LLM)', 'compose', 'render'],
        humanEquivLow: humanHours,
        humanEquivHigh: humanHours,
        note: 'Estimated analyst time to produce the equivalent readout by hand — reading every response, identifying themes, selecting quotes, building charts, and writing the narrative. Assumes ~15 minutes per content slide (excluding the title and closing slides).',
      })
    } catch (provErr) {
      if (provErr !== '__skip_closers__') console.error({ at: 'export/pptx', msg: 'provenance/custom-decks slide failed', err: provErr instanceof Error ? provErr.message : provErr })
    }

    // ── 10. Generation-recap appendix ────────────────────────────────────────
    if (includeRecap) {
      try {
        const labelFor = (key: string): string => selectedFields.find(f => f.field === key)?.label || (schema?.fields || []).find((f) => f.field === key)?.label || key
        const cap = (s: string) => (s.length > 160 ? s.slice(0, 157) + '…' : s)
        const themeNames = (themes || []).map((t) => t.name).filter(Boolean)
        const recapRows: { k: string; v: string }[] = []
        recapRows.push({ k: 'Mode', v: mode === 'quick' ? 'Quick (selected fields)' : 'Builder (full schema)' })
        recapRows.push({ k: 'Audience', v: audience })
        if (deckStyle) recapRows.push({ k: 'Style', v: DECK_STYLES[deckStyle as keyof typeof DECK_STYLES]?.label || deckStyle })
        if (reportTitle) recapRows.push({ k: 'Report title', v: cap(reportTitle) })
        recapRows.push({ k: 'Fields', v: selectedFields.length ? cap(`${selectedFields.length}: ` + selectedFields.map(f => f.label || f.field).join(', ')) : 'all schema fields' })
        if (skipTextAnalytics) recapRows.push({ k: 'Text analytics', v: 'skipped (entity-only deck)' })
        else recapRows.push({ k: 'Themes', v: !includeThemeSlides ? 'theme slides off' : selectedThemeIds.length ? cap(`${themeNames.length} selected: ` + themeNames.join(', ')) : `all (${themeNames.length})` })
        if (entityFields.length) recapRows.push({ k: 'Entity fields', v: cap(entityFields.map(labelFor).join(', ')) })
        if (impactOEFields.length) recapRows.push({ k: 'Impact fields', v: cap(impactOEFields.map(labelFor).join(', ')) })
        if (filterDescription) recapRows.push({ k: 'Filters', v: cap(filterDescription) })
        if (commentColorField) recapRows.push({ k: 'Comment color-by', v: labelFor(commentColorField) })
        if (commentAnnotations.length) recapRows.push({ k: 'Comment notes', v: `${commentAnnotations.length} annotation(s)` })
        recapRows.push({ k: 'Appendices', v: [includeProvenance && 'methodology', includeCustomDecks && 'capabilities', 'this recap'].filter(Boolean).join(', ') })

        slides.push({ type: 'table', title: 'Report Inputs', subtitle: 'Selections used to generate this deck · for traceability', columns: ['Setting', 'Value'], rows: recapRows.map(r => [r.k, r.v]) })
        if (instructions && instructions.trim()) {
          slides.push({ type: 'bullets', title: 'Custom Instructions (verbatim)', bullets: [instructions.trim()] })
        }
      } catch (recapErr) {
        console.error({ at: 'export/pptx', msg: 'recap slide failed', err: recapErr instanceof Error ? recapErr.message : recapErr })
      }
    }

    // ── Render via the shared cream renderer ─────────────────────────────────
    const deckTitle = reportTitle || narratives.reportTitle || datasetName
    const deck: DeckSpec = { title: deckTitle, subtitle: '', preparedBy: 'Datanautix', style: deckStyle, slides }
    const buffer = await renderDeck(deck, datasetName)
    const safeName = datasetName.replace(/[^a-z0-9]/gi, '_').slice(0, 40)
    const filename = safeName + '_report_' + new Date().toISOString().slice(0, 10) + '.pptx'

    return new Response(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="' + filename + '"',
        'Content-Length': String(buffer.length),
      },
    })
  } catch (buildErr) {
    return serverError(buildErr, 'datasets.exportPptx', { orgId: orgId ?? undefined })
  }
}
