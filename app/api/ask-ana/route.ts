// app/api/ask-ana/route.ts
// POST /api/ask-ana — streaming AI Q&A + analysis framework mutations
// Uses Anthropic prompt caching so the dataset context is sent once and reused
// for follow-up questions within a 5-minute window.
// Supports configurable sample sizes and collection sampling strategies.
// When Ana detects the user wants to modify themes she returns tool_use blocks
// which the client renders as confirmation cards before writing to dataset_state.

import { NextResponse } from 'next/server'
import type { SerializedFilters } from '@/lib/filterUtils'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { checkMessage } from '@/lib/contentGuard'
import { getEntitiesWithCounts } from '@/lib/entityFilter'
import { TIER_DEFAULT_MODEL } from '@/lib/usageRates'
import { logUsage } from '@/lib/usageLog'
import { getSourceLabel } from '@/lib/anaContext'
import { loadAnaSample, resolveCollectionMembers } from '@/lib/anaReportContext'
import { serverError } from '@/lib/apiError'
import type { SchemaConfig, SchemaFieldConfig } from '@/lib/analyzeTypes'
import { themeSetForField, type ThemeModel as UtilThemeModel } from '@/lib/themeUtils'
import { ANA_QUERY_TOOLS, ANA_QUERY_TOOL_NAMES, executeAnaQueryTool, anaToolStatusLabel, chartConfigForQuery, type AnaQueryContext } from '@/lib/anaQueryTools'
import { loadAnalystMemories, memoryPromptBlock, REMEMBER_GUIDANCE } from '@/lib/analystMemory'

export const dynamic     = 'force-dynamic'
// Query-tool rounds are sequential upstream calls — a multi-round answer on a
// slow aggregate can outlive the old 60s budget.
export const maxDuration = 120

const CONTEXT_CAP    = 500    // absolute max rows sent to Claude
const DEFAULT_SAMPLE = 200    // default if user doesn't configure

interface Message {
  role: 'user' | 'assistant'
  content: string | MessageContent[]
}

interface MessageContent {
  type: string
  [key: string]: unknown
}

// Runtime shape of a theme entry in dataset_state.theme_model.themes.
// A superset of AnaTheme — theme-mutation tools also write name/sentiment/count.
interface ExistingTheme {
  name?: string
  label?: string
  sentiment?: string
  keywords?: string[]
  count?: number
}

// Minimal shape of an Anthropic tool definition passed through to the API.
interface AnthropicTool {
  name: string
  description: string
  input_schema: Record<string, unknown>
}

// ── Tool definitions for theme mutations ───────────────────────────────────
const ANA_TOOLS = [
  {
    name: 'create_theme',
    description: 'Create a new theme to add to the analysis framework. Use when the user asks to create, add, or extract a new theme/topic/category from the data. Always include 8-15 keywords with core terms, synonyms, and informal variants.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name:        { type: 'string', description: 'Theme name (short, descriptive)' },
        description: { type: 'string', description: 'One-sentence description of what this theme captures' },
        keywords:    { type: 'array', items: { type: 'string' }, description: 'Array of 8-15 keywords: core terms, synonyms, informal variants, and short phrases' },
        sentiment:   { type: 'string', enum: ['positive', 'negative', 'mixed', 'neutral'], description: 'Overall sentiment of this theme' },
      },
      required: ['name', 'description', 'keywords', 'sentiment'],
    },
  },
  {
    name: 'update_theme',
    description: 'Update an existing theme — rename it, change description, add/remove keywords, or change sentiment. Reference the theme by its current name.',
    input_schema: {
      type: 'object' as const,
      properties: {
        theme_name:       { type: 'string', description: 'Current name of the theme to update' },
        new_name:         { type: 'string', description: 'New name (omit to keep current)' },
        new_description:  { type: 'string', description: 'New description (omit to keep current)' },
        add_keywords:     { type: 'array', items: { type: 'string' }, description: 'Keywords to add' },
        remove_keywords:  { type: 'array', items: { type: 'string' }, description: 'Keywords to remove' },
        new_sentiment:    { type: 'string', enum: ['positive', 'negative', 'mixed', 'neutral'], description: 'New sentiment (omit to keep current)' },
      },
      required: ['theme_name'],
    },
  },
  {
    name: 'merge_themes',
    description: 'Merge two or more themes into one. Combines their keywords and keeps the best description. Use when themes overlap significantly.',
    input_schema: {
      type: 'object' as const,
      properties: {
        theme_names:    { type: 'array', items: { type: 'string' }, description: 'Names of themes to merge (2+)' },
        merged_name:    { type: 'string', description: 'Name for the merged theme' },
        merged_description: { type: 'string', description: 'Description for the merged theme' },
        merged_sentiment:   { type: 'string', enum: ['positive', 'negative', 'mixed', 'neutral'] },
      },
      required: ['theme_names', 'merged_name', 'merged_description', 'merged_sentiment'],
    },
  },
  {
    name: 'delete_theme',
    description: 'Remove a theme from the analysis framework.',
    input_schema: {
      type: 'object' as const,
      properties: {
        theme_name: { type: 'string', description: 'Name of the theme to delete' },
        reason:     { type: 'string', description: 'Brief reason for deletion' },
      },
      required: ['theme_name'],
    },
  },
  {
    name: 'generate_report',
    description: 'Generate a PowerPoint deck from the data. Use when the user asks for a deck, report, presentation, slides, or to download analysis results. Build slide specs based on the data you analyzed. Available slide types: bar_chart (horizontal bars), kpi_grid (metric cards), table (rows and columns), bullets (key points), quotes (verbatim responses), two_column (side-by-side content), entity_grid (3-column card grid for extracted entities — use for entity/name extraction analysis).',
    input_schema: {
      type: 'object' as const,
      properties: {
        title:    { type: 'string', description: 'Deck title' },
        subtitle: { type: 'string', description: 'Deck subtitle' },
        slides: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type:     { type: 'string', enum: ['bar_chart', 'kpi_grid', 'table', 'bullets', 'quotes', 'two_column', 'entity_grid'] },
              title:    { type: 'string' },
              subtitle: { type: 'string' },
              data:     { type: 'array', description: 'For bar_chart: [{label, value}]' },
              kpis:     { type: 'array', description: 'For kpi_grid: [{value, label, sub?}]' },
              columns:  { type: 'array', description: 'For table: column headers' },
              rows:     { type: 'array', description: 'For table: [[cell, cell, ...], ...]' },
              bullets:  { type: 'array', description: 'For bullets: ["point 1", ...]' },
              quotes:   { type: 'array', description: 'For quotes: [{text, attribution?}]' },
              left:     { type: 'object', description: 'For two_column: {heading?, bullets?, text?}' },
              right:    { type: 'object', description: 'For two_column: {heading?, bullets?, text?}' },
              entities: { type: 'array', description: 'For entity_grid: [{name, mentions, category?, pct?}]. Up to 24 per slide.' },
              accentColor: { type: 'string', description: 'For entity_grid: hex color for accent (e.g. "0F7173")' },
              insight:  { type: 'string', description: 'Optional insight text shown at bottom of slide' },
            },
            required: ['type', 'title'],
          },
          description: 'Array of slide specs. Populate the data fields from your analysis of the dataset — use actual numbers and quotes from the data.',
        },
      },
      required: ['title', 'slides'],
    },
  },
]

// ── remember_preference: propose a standing memory ("Ana remembers") ──────
// An ACTION tool like the theme mutations: it surfaces to the client as a
// confirmation chip; the panel writes to /api/analyst-memory only when the
// analyst taps "Remember this". Never executed server-side.
const REMEMBER_TOOL = {
  name: 'remember_preference',
  description: 'Propose saving a STANDING preference about how this analyst works — what to lead with, what to ignore, who the analysis is for, preferred phrasing. The user confirms or dismisses your proposal in the UI; never assume it saved. Durable ways-of-working only, never one-off requests — and never anything that would change the numbers (reclassifying, merging themes): that belongs to the theme tools.',
  input_schema: {
    type: 'object' as const,
    properties: {
      statement: { type: 'string', description: 'The preference as one clear standing instruction, under 300 characters (e.g. "Lead with the location comparison; the audience is a franchise-focused VP.")' },
      scope:     { type: 'string', enum: ['org', 'dataset'], description: 'org = applies across all of this account\'s data (default); dataset = only this dataset' },
      source:    { type: 'string', enum: ['interview', 'correction'], description: 'interview during the getting-to-know-you conversation; correction otherwise' },
    },
    required: ['statement'],
  },
}

// ── Sampling recommendation tool (metadata-only mode) ─────────────────────
const RECOMMEND_SAMPLING_TOOL = {
  name: 'recommend_sampling',
  description: 'Recommend a sampling configuration based on the user\'s analysis goals. Call this after understanding what the user wants to accomplish.',
  input_schema: {
    type: 'object' as const,
    properties: {
      sample_size: { type: 'number', description: 'Recommended number of rows to analyze (50-500). Consider: quick scan ~100, standard analysis ~200, deep dive ~500.' },
      strategy:    { type: 'string', enum: ['proportional', 'equal', 'floor'], description: 'For collections only. proportional = weight by member size, equal = same count per member, floor = minimum per member then proportional.' },
      reasoning:   { type: 'string', description: 'Brief explanation of why this configuration fits the user\'s goals.' },
    },
    required: ['sample_size', 'reasoning'],
  },
}

export async function POST(req: Request) {
  // Auth + admin-org context. Admin-org users get cross-org dataset visibility
  // (same pattern as the rest of the platform; see lib/auth/orgAccess.ts).
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = { id: userId }

  const body = await req.json()
  const { datasetId, question, conversationHistory, filters, metadataOnly, themeFieldKey } = body as {
    datasetId: string
    question: string
    conversationHistory?: Message[]
    filters?: Record<string, unknown>
    metadataOnly?: boolean
    /** active question's themeFieldKey (TextMine pill) — Ana's framework
     *  context follows the set the user is LOOKING at, not blindly the saved
     *  active one; the panel applies her edits to the same set */
    themeFieldKey?: string
  }
  const sampleSize = Math.max(50, Math.min(body.sampleSize || DEFAULT_SAMPLE, CONTEXT_CAP))
  const samplingStrategy: 'proportional' | 'equal' | 'floor' = body.samplingStrategy || 'proportional'
  // Flat row ids of the client's filtered view — same set ChartsModule sends to
  // the aggregate route, so Ana's query_data numbers match the charts exactly.
  // Sanitized to finite numbers, same 200K cap as the aggregate route.
  let filterRowIds: number[] | null = Array.isArray(body.rowIds)
    ? (body.rowIds.filter(function(x: unknown): x is number { return typeof x === 'number' && Number.isFinite(x) }).slice(0, 200000))
    : null
  if (filterRowIds && filterRowIds.length === 0) filterRowIds = null

  if (!datasetId || !question) {
    return NextResponse.json({ error: 'datasetId and question are required' }, { status: 400 })
  }

  // Content safety check on user question
  const safety = checkMessage('ana_' + user.id, question)
  if (!safety.safe) {
    return NextResponse.json({ error: safety.warning || 'Please rephrase your question.' }, { status: 400 })
  }

  // Verify dataset ownership. Service-role read + explicit org_id
  // check: the org boundary is enforced by our own equality below,
  // not by RLS. Going through the auth-client occasionally returned
  // null for rows that demonstrably existed (the page next to this
  // route had no trouble loading the same dataset), which surfaced
  // as a generic "Dataset not found". Splitting the lookup into
  // exists vs cross-org also lets us return useful diagnostics.
  const service = createServiceRoleClient()
  const { data: dataset } = await service
    .from('datasets')
    .select('id, name, source, row_count, org_id')
    .eq('id', datasetId)
    .single()

  if (!dataset) return NextResponse.json({ error: 'Dataset no longer exists' }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) {
    return NextResponse.json({ error: 'You do not have access to this dataset' }, { status: 403 })
  }
  const { data: stateRow } = await service
    .from('dataset_state')
    .select('theme_model, schema_config')
    .eq('dataset_id', datasetId)
    .single()
  // The theme set Ana reasons about/edits: the active question's own stored
  // set when the client passed its key (per-field theme model), else the
  // saved active (top-level) set — pre-map behavior.
  const storedThemeModel = stateRow?.theme_model as UtilThemeModel | null
  const activeSet = themeFieldKey ? themeSetForField(storedThemeModel, [themeFieldKey]) : null
  const existingThemes: ExistingTheme[] =
    ((activeSet || storedThemeModel) as { themes?: ExistingTheme[] } | null)?.themes || []
  // Which question the framework belongs to — so Ana can say so.
  const themeSetFields = activeSet
    ? (activeSet.fieldNames?.length ? activeSet.fieldNames : (activeSet.fieldName ? [activeSet.fieldName] : []))
    : (storedThemeModel?.fieldNames?.length ? storedThemeModel.fieldNames : (storedThemeModel?.fieldName ? [storedThemeModel.fieldName] : []))
  const schemaFields: SchemaFieldConfig[] = (stateRow?.schema_config as SchemaConfig | null)?.fields || []

  // ── Pull top entities so Ana can reason about "who/what was mentioned" ──
  // Reads this dataset's entity catalog — its own, or the shared brand-/
  // collection catalog it belongs to — with live full-text row counts. Empty
  // until discovery has been run on the Schema tab. Capped at 40 to bound the
  // system-prompt budget. Optional context — never block Ana on it.
  type EntityAgg = { canonical: string; category: string; mentions: number }
  let topEntities: EntityAgg[] = []
  try {
    const entityResult = await getEntitiesWithCounts({ service, datasetId, limit: 40 })
    if (!('notFound' in entityResult)) {
      topEntities = entityResult.entities.map(function(e) {
        return { canonical: e.canonical, category: e.category, mentions: e.mentions }
      })
    }
  } catch { /* entities are optional context */ }

  // ── Resolve collection members (shared with the ad-hoc report route) ─────
  const collectionMembers = await resolveCollectionMembers(service, { id: datasetId, source: dataset.source })

  // ── Interview mode: first-visit conversational elicitation ──────────────
  // The panel enters this when the analyst has no memories and no
  // ana_interviewed flag. No data sample is loaded — this is a short
  // getting-to-know-you conversation whose only output is remember_preference
  // proposals (source 'interview') the analyst confirms chip by chip.
  if (body.interview === true) {
    const fieldList = schemaFields.length > 0
      ? schemaFields.filter(function(f) { return f.status !== 'ignored' })
          .map(function(f) { return f.label || f.field }).join(', ')
      : ''
    // What's already saved — the client history carries only text, so without
    // this Ana re-proposes preferences she already captured (seen live 9/02:
    // second answer produced a card repeating the first answer's memory).
    const savedSoFar = await loadAnalystMemories(service, { userId, orgId })
    const savedNote = savedSoFar.length > 0
      ? '\n\nALREADY SAVED to their memory (never re-propose these; distill only NEW preferences from their LATEST answer):\n' +
        savedSoFar.map(function(m) { return '- ' + m.statement }).join('\n')
      : ''
    const interviewPrompt = `You are Ana, a senior data analyst assistant, meeting this analyst for the FIRST time. They just opened the dataset "${dataset.name}"${fieldList ? ' (fields: ' + fieldList + ')' : ''}.

Your goal: learn how they work, in at most 4 short questions, ONE per reply:
1. What they look at first when new data arrives.
2. Who the analysis is usually for (their audience), and what that audience cares about.
3. Anything to ignore or never lead with.
4. Any phrasing or format preferences for what you write.

After EACH answer, your reply must contain BOTH: (a) in the TEXT, a one-line acknowledgment followed by the NEXT question — the text of every reply ends with a question until the interview is done, so the conversation never stalls while they consider the save; and (b) ONE remember_preference call (source "interview", scope "org" unless they clearly mean only this dataset) with a crisp standing instruction distilled from their answer. Skip the tool call if an answer contains no genuine preference. Never re-ask something they already covered.

After the final answer: thank them briefly, tell them everything you saved is theirs to edit or delete under "What Ana remembers", and that you're ready to dig into the data. Do not ask further questions after that.

Keep every reply short and warm — this is a two-minute conversation, not a survey. If they clearly want to skip ("just let me ask my question"), respect it immediately: answer nothing about the data (you have none loaded), just tell them they can start asking and that you'll learn as you go.${savedNote}`
    return streamAnthropicResponse(interviewPrompt, question, conversationHistory, [REMEMBER_TOOL], dataset.org_id)
  }

  // ── Metadata-only mode: Ana recommends sampling config ──────────────────
  if (metadataOnly) {
    const totalRows = dataset.source === 'collection'
      ? collectionMembers.reduce(function(s, m) { return s + m.row_count }, 0)
      : (dataset.row_count || 0)

    const sourceLabel = getSourceLabel(dataset.source)

    const memberBreakdown = collectionMembers.length > 0
      ? '\n\nCollection members:\n' + collectionMembers.map(function(m) {
          return '- ' + m.name + ': ' + m.row_count.toLocaleString() + ' rows'
        }).join('\n')
      : ''

    const fieldList = schemaFields.length > 0
      ? '\n\nDataset fields: ' + schemaFields
          .filter(function(f) { return f.status !== 'ignored' })
          .map(function(f) { return f.label + ' (' + f.type + ')' })
          .join(', ')
      : ''

    const themeInfo = existingThemes.length > 0
      ? '\n\nCurrent themes: ' + existingThemes.length
      : '\n\nNo themes created yet.'

    const metaPrompt = `You are Ana, a sampling advisor. The user has a dataset that needs sampling configuration before analysis.

Dataset: "${dataset.name}"
Source: ${sourceLabel}
Total rows: ${totalRows.toLocaleString()}${memberBreakdown}${fieldList}${themeInfo}

Your task: understand what the user wants to accomplish with this data, then recommend a sampling configuration using the recommend_sampling tool.

Consider these factors:
- **Quick scan** (~100 rows): good for getting a general sense, spotting obvious patterns
- **Standard analysis** (~200 rows): good balance of coverage and speed, sufficient for most questions
- **Deep dive** (~500 rows): thorough analysis, better for finding subtle patterns or rare mentions

For collections, also recommend a distribution strategy:
- **proportional**: each member contributes rows proportional to its size — best for understanding overall trends
- **equal**: same number of rows per member — best for comparing across members
- **floor**: minimum representation per member, rest proportional — best when you want to ensure small datasets aren't drowned out

Ask the user 1-2 brief questions about what they're looking to learn, then make your recommendation. Be conversational and concise.`

    const tools = [...ANA_TOOLS, RECOMMEND_SAMPLING_TOOL]
    return streamAnthropicResponse(metaPrompt, question, conversationHistory, tools, dataset.org_id)
  }

  // ── Normal mode: fetch + filter + sample rows (shared pipeline) ─────────
  const [{ rows: filteredRows, dataContext, totalDatasetRows, totalFiltered, totalFilteredIsEstimate, sampled, signalNote }, analystMemories] = await Promise.all([
    loadAnaSample({ service, dataset, sampleSize, samplingStrategy, filters: filters as SerializedFilters | undefined, collectionMembers }),
    loadAnalystMemories(service, { userId, orgId }),
  ])

  const hasFilters = !!filters && Object.keys(filters).length > 0
  if (filteredRows.length === 0) {
    return NextResponse.json({
      error: hasFilters ? 'No rows match the active filters.' : 'No rows found in dataset',
    }, { status: 400 })
  }

  // Build system prompt
  const sourceLabel = getSourceLabel(dataset.source)

  // One denominator story, stated once: the filtered population (with "~" when
  // it is a sample-scaled estimate), then the sample drawn from it.
  const tfDisplay = (totalFilteredIsEstimate ? '~' : '') + totalFiltered.toLocaleString()

  // Model A: counts are over the deterministic ≤50K sample (the app's view), not
  // the full dataset — say so, and give the full row count as context.
  const sampleNote = sampled
    ? '\n\nNote: You are seeing a representative sample of ' + filteredRows.length + ' rows drawn from ' +
      (hasFilters
        ? 'the ' + tfDisplay + ' rows in the analyzed 50K sample that match the active filters (dataset total: ' + totalDatasetRows.toLocaleString() + ' rows)'
        : 'the analyzed 50K sample (dataset total: ' + totalDatasetRows.toLocaleString() + ' rows)') +
      '. Base your analysis on patterns in this sample and note that findings are sample-based.'
    : ''

  const filterNote = hasFilters
    ? '\n\nNote: The user has active filters applied. ' + tfDisplay + ' rows in the analyzed sample match the filters (the dataset has ' + totalDatasetRows.toLocaleString() + ' rows total); the rows you see are drawn only from those matching rows.'
    : ''

  const redditContext = dataset.source === 'reddit'
    ? '\n\nThis is Reddit data. Comments with high scores represent mainstream views (community consensus). Comments in the middle range are controversial (mixed reception). Noise and fringe comments (low/negative scores) have been excluded. If the user asks about fringe or rejected views, let them know those are filtered out and they can check the Signals view for that analysis.'
    : ''

  const collectionContext = dataset.source === 'collection' && collectionMembers.length > 0
    ? '\n\nThis is a collection combining ' + collectionMembers.length + ' datasets: ' +
      collectionMembers.map(function(m) { return m.name + ' (' + m.row_count.toLocaleString() + ' rows)' }).join(', ') +
      '. Sampling strategy: ' + samplingStrategy + '.'
    : ''

  // Build theme context for the prompt
  const themeContext = existingThemes.length > 0
    ? '\n\nCurrent analysis framework' +
      (themeSetFields.length ? ' (for the question "' + themeSetFields.join(' + ') + '")' : '') +
      ' has ' + existingThemes.length + ' themes:\n' +
      existingThemes.map(function(t) {
        return '- ' + (t.name || t.label) + ' (' + (t.sentiment || 'neutral') + '): ' +
          (t.keywords || []).slice(0, 6).join(', ') +
          (t.count ? ' [' + t.count + ' matches]' : '')
      }).join('\n')
    : '\n\nNo themes have been created yet for this dataset.'

  // Field KEYS ride along with the labels — query_data / the aggregate SQL
  // address rows by the data key (e.g. "rating"), not the display label
  // ("Star Rating"); without the key Ana's queries silently match nothing.
  const schemaContext = schemaFields.length > 0
    ? '\n\nDataset fields (use the key in [brackets] for query_data): ' + schemaFields
        .filter(function(f) { return f.status !== 'ignored' })
        .map(function(f) { return (f.label || f.field) + ' [' + f.field + '] (' + f.type + (f.section ? ', ' + f.section : '') + ')' })
        .join('; ')
    : ''

  // Entities mentioned in this dataset (only if discovery has been run).
  // Grouped by category so Ana can answer "which charities were mentioned"
  // or "what restaurants come up most" without re-scanning the data. The
  // count is the number of rows mentioning the entity (live full-text count).
  const entitiesByCategory: Record<string, EntityAgg[]> = {}
  topEntities.forEach(function(e) {
    if (!entitiesByCategory[e.category]) entitiesByCategory[e.category] = []
    entitiesByCategory[e.category].push(e)
  })
  const entityContext = topEntities.length > 0
    ? '\n\nEntities mentioned in this dataset (canonicalised, top 40 by rows mentioning them):\n' +
      Object.keys(entitiesByCategory).sort().map(function(cat) {
        const list = entitiesByCategory[cat]
          .map(function(e) { return e.canonical + ' (' + e.mentions + ')' })
          .join(', ')
        return '- ' + cat + ': ' + list
      }).join('\n')
    : ''

  const systemPrompt = `You are Ana, a senior data analyst assistant working with the dataset "${dataset.name}" (${totalDatasetRows.toLocaleString()} ${sourceLabel} total). Your context below includes a small orientation sample of ${filteredRows.length} rows so you know what the data looks like — but your numbers must NOT come from eyeballing that sample.

CRITICAL RULE: You must ONLY use this dataset — via your query tools and the rows provided below — to answer questions. NEVER use outside knowledge, general knowledge, or information not present in this dataset. If the data does not contain enough information to answer a question, say "I don't see enough data in this dataset to answer that" — do NOT fill in gaps with general knowledge or assumptions.

QUERY TOOLS — YOUR NUMBERS COME FROM THESE, NOT THE SAMPLE:
- Every count, percentage, average, breakdown, or trend you state MUST come from a query_data call (it runs the same exact aggregations the app's charts use, scoped to the user's active filters). Never estimate a number from the orientation sample; never present a sample-derived figure as a dataset figure.
- Every quote you present MUST be verbatim from a find_quotes result or from the orientation sample below — and each quote must actually support the claim it illustrates. Use find_quotes to gather evidence for any pattern you report.
- find_quotes totals cover the entire dataset and ignore active filters; for filtered counts use query_data.
- When a tool result says sampled:true, the figures are computed over the app's deterministic 50K analysis sample — say "in the analyzed sample" when reporting them.
- It's normal to make several tool calls before answering. Prefer one query per claim over guessing.

You serve two roles:
1. **Answer questions** — Query the data to answer questions. Be specific; back claims with exact figures from query_data and real quotes from find_quotes. If the data doesn't contain enough to answer, say so clearly.
2. **Modify the analysis framework** — When the user asks you to create, update, merge, or delete themes, use your theme tools. When you spot an opportunity to improve the framework (e.g., you notice many distinct entities that could be grouped, or themes that overlap), suggest it — but always wait for approval before acting.

When using tools, ALWAYS explain what you're about to do in your text response before calling the tool. For example: "I'll create a theme for menu items based on the 23 distinct food references I found in the data."

When the user asks to extract entities, identify organizations, find names, or do entity analysis on an open-ended field:
1. Scan all rows for the relevant field
2. Extract and normalize distinct entity names (merge duplicates like "2nd Harvest" and "Second Harvest Food Bank")
3. Categorize entities by type (e.g. "Food Security", "Healthcare", "Faith-Based")
4. Count mentions per entity
5. Present results clearly, then call generate_report with:
   - A kpi_grid overview slide (total entities, total mentions, categories)
   - One or more entity_grid slides per category (up to 24 entities per slide)
   - A bar_chart slide for the top 10 entities by mentions
   Use different accentColor per category (e.g. "0F7173", "E85A1A", "3B82F6", "8B5CF6", "059669").

When the user asks to download their analysis as slides or a deck, call generate_report and structure your previous analysis into appropriate slide types.

PRODUCT HOW-TO QUESTIONS: You analyze DATA, not the product. If the user asks how to USE Sentimetrx or navigate the app (e.g. "how do I export this?", "where's the Schema tab?", "how do I create an agent?") — a question about the software rather than about their data — do NOT try to answer it from the dataset. Briefly tell them that's what the Help assistant is for and to click the compass (🧭) Help button in the bottom-right corner of the page, where Sherpa can walk them through it.

Keep your responses concise but thorough. Use markdown formatting for readability (bullet points, bold, etc).${memoryPromptBlock(analystMemories, datasetId)}${REMEMBER_GUIDANCE}${body.briefing === true ? '\n\nBRIEFING MODE: The analyst just opened this dataset — this turn is your unprompted opening read, not an answer to a question. Build it THEIR way per ANALYST MEMORY: run the 1\u20133 query_data calls you need, lead with what they care about, keep it under ~150 words plus at most one compact table, briefly note anything you are de-emphasizing per their preferences, and END with 2\u20133 concrete next steps phrased as short questions they could ask you.' : ''}${themeContext}${schemaContext}${entityContext}${filterNote}${signalNote}${sampleNote}${collectionContext}${redditContext}

Here is the orientation sample:
${dataContext}`

  const queryCtx: AnaQueryContext = {
    datasetId,
    rowCount: dataset.row_count || 0,
    source: dataset.source,
    rowIds: filterRowIds,
    fieldKey: themeFieldKey || null,
  }
  const fieldTypes: Record<string, string> = {}
  schemaFields.forEach(function(fld) { if (fld.field) fieldTypes[fld.field] = fld.type })
  return streamAnthropicResponse(systemPrompt, question, conversationHistory, [...ANA_TOOLS, REMEMBER_TOOL, ...ANA_QUERY_TOOLS], dataset.org_id, { service, ctx: queryCtx, fieldTypes })
}

// ── Stream Anthropic response (agentic tool loop) ─────────────────────────
// One user question can now take several model rounds: when the model calls a
// query tool (query_data / find_quotes) we execute it server-side, feed the
// result back, and let the model continue — all inside one SSE response to the
// client. Theme/report tools keep their original behavior: they surface to the
// client as `action` events (confirmation cards) and end the turn.
const MAX_TOOL_ROUNDS = 6

interface CollectedToolUse { id: string; name: string; input: Record<string, unknown> }
type AssistantBlock = { type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }

async function streamAnthropicResponse(
  systemPrompt: string,
  question: string,
  conversationHistory: Message[] | undefined,
  tools: AnthropicTool[],
  orgId: string,
  queryExec?: { service: ReturnType<typeof createServiceRoleClient>, ctx: AnaQueryContext, fieldTypes?: Record<string, string> },
): Promise<Response> {
  // Per-org AI gate: 'off' refuses; 'byo' + anthropic uses customer key;
  // 'byo' + openai falls back to platform env (we eat the cost, same rule
  // as embeddings — customer chose BYOK+OpenAI knowing the streaming
  // endpoint is Anthropic-only). 'platform' uses env.
  const { resolveOrgAiConfig } = await import('@/lib/aiKey')
  const cfg = await resolveOrgAiConfig(orgId)
  if (cfg.mode === 'off') {
    return NextResponse.json({ error: 'AI is disabled for this organization.' }, { status: 403 })
  }
  const apiKey = cfg.mode === 'byo' && cfg.provider === 'anthropic' && cfg.key
    ? cfg.key
    : process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 500 })
  }

  const messages: Message[] = []
  if (conversationHistory && conversationHistory.length > 0) {
    messages.push(...conversationHistory)
  }
  messages.push({ role: 'user', content: question })

  function callAnthropic() {
    return fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey as string,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: TIER_DEFAULT_MODEL.standard,
        max_tokens: 4000,
        stream: true,
        tools,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: { type: 'ephemeral' },
          },
        ],
        messages,
      }),
    })
  }

  // First round is fetched before the Response is constructed so upstream
  // config/auth failures still return a clean JSON error (pre-loop behavior).
  const firstRes = await callAnthropic()
  if (!firstRes.ok) {
    let errMsg = 'AI API error: ' + firstRes.status
    try { const d = await firstRes.json(); errMsg = d?.error?.message || errMsg } catch {}
    return serverError(errMsg, 'askAna.upstream', { orgId })
  }

  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  // Token accounting summed across ALL rounds — logged once on stream end so
  // multi-round answers are attributed like every other AI call.
  let inTok = 0, outTok = 0, cacheRead = 0, cacheCreate = 0

  const readable = new ReadableStream({
    async start(controller) {
      function emit(payload: Record<string, unknown>) {
        controller.enqueue(encoder.encode('data: ' + JSON.stringify(payload) + '\n\n'))
      }

      // Pump one model round: stream text to the client, collect ordered
      // content blocks (text + tool_use) for a possible continuation, forward
      // client-action tools as `action` events. Returns the blocks.
      async function pumpRound(res: Response): Promise<AssistantBlock[]> {
        const reader = res.body!.getReader()
        let buffer = ''
        const blocks: AssistantBlock[] = []
        let currentToolId = ''
        let currentToolName = ''
        let toolInputJson = ''
        let roundOut = 0   // this round's cumulative output tokens (message_delta replaces it)

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const payload = line.slice(6).trim()
            if (payload === '[DONE]') continue

            try {
              const event = JSON.parse(payload)
              if (event.type === 'message_start' && event.message?.usage) {
                const u = event.message.usage
                inTok += u.input_tokens || 0
                cacheRead += u.cache_read_input_tokens || 0
                cacheCreate += u.cache_creation_input_tokens || 0
                roundOut = u.output_tokens || 0
              }
              else if (event.type === 'message_delta' && event.usage?.output_tokens != null) {
                // Cumulative for THIS round — replace, don't add; the round's
                // final figure is folded into the multi-round total below.
                roundOut = event.usage.output_tokens
              }
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                const last = blocks[blocks.length - 1]
                if (last && last.type === 'text') last.text += event.delta.text
                else blocks.push({ type: 'text', text: event.delta.text })
                emit({ text: event.delta.text })
              }
              else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                currentToolId = event.content_block.id || ''
                currentToolName = event.content_block.name || ''
                toolInputJson = ''
              }
              else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
                toolInputJson += event.delta.partial_json || ''
              }
              else if (event.type === 'content_block_stop' && currentToolName) {
                try {
                  const toolInput = JSON.parse(toolInputJson || '{}')
                  blocks.push({ type: 'tool_use', id: currentToolId, name: currentToolName, input: toolInput })
                  // Query tools are executed after the round; everything else
                  // (theme mutations, generate_report, recommend_sampling)
                  // surfaces to the client as a confirmation card.
                  if (!ANA_QUERY_TOOL_NAMES.has(currentToolName)) {
                    emit({ action: { tool: currentToolName, toolId: currentToolId, input: toolInput } })
                  }
                } catch {}
                currentToolName = ''
                currentToolId = ''
                toolInputJson = ''
              }
            } catch {}
          }
        }
        outTok += roundOut
        return blocks
      }

      try {
        let res: Response | null = firstRes
        for (let round = 0; round < MAX_TOOL_ROUNDS && res; round++) {
          const blocks = await pumpRound(res)
          res = null

          const toolUses: CollectedToolUse[] = blocks
            .filter(function(b): b is Extract<AssistantBlock, { type: 'tool_use' }> { return b.type === 'tool_use' })
            .map(function(b) { return { id: b.id, name: b.name, input: b.input } })
          const queryCalls = toolUses.filter(function(t) { return ANA_QUERY_TOOL_NAMES.has(t.name) })
          const actionCalls = toolUses.filter(function(t) { return !ANA_QUERY_TOOL_NAMES.has(t.name) })

          // Continue only when EVERY tool call this round is a server-side
          // query — a client-action card ends the model's turn (the client
          // takes over), and we can't send partial tool_results.
          if (!queryExec || queryCalls.length === 0 || actionCalls.length > 0 || round === MAX_TOOL_ROUNDS - 1) break

          const toolResults: MessageContent[] = []
          for (const call of queryCalls) {
            emit({ status: anaToolStatusLabel(call.name, call.input) })
            let result: Record<string, unknown>
            try {
              result = await executeAnaQueryTool(queryExec.service, queryExec.ctx, call.name, call.input)
            } catch (e) {
              result = { error: 'Query failed: ' + (e instanceof Error ? e.message : 'unknown error') }
            }
            toolResults.push({ type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(result) })
            // Canvas handoff: a successful query_data maps onto the exact
            // Charts-tab config behind this answer — the client renders it as
            // an "Open in Charts" chip under the finished message.
            if (call.name === 'query_data' && !result.error) {
              const target = chartConfigForQuery(call.input, queryExec.fieldTypes)
              if (target) emit({ canvas: target })
            }
          }

          // Anthropic rejects empty text blocks in assistant content.
          const assistantContent = blocks.filter(function(b) { return b.type !== 'text' || b.text.trim().length > 0 }) as unknown as MessageContent[]
          messages.push({ role: 'assistant', content: assistantContent })
          messages.push({ role: 'user', content: toolResults })

          const nextRes = await callAnthropic()
          if (!nextRes.ok) {
            let errMsg = 'AI API error: ' + nextRes.status
            try { const d = await nextRes.json(); errMsg = d?.error?.message || errMsg } catch {}
            emit({ error: errMsg })
            break
          }
          res = nextRes
        }
        emit({ text: '' })
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        controller.enqueue(encoder.encode('data: ' + JSON.stringify({ error: 'Stream interrupted' }) + '\n\n'))
      } finally {
        controller.close()
        logUsage(
          { org_id: orgId, resource_type: 'dataset', event_type: 'ana' },
          { model: TIER_DEFAULT_MODEL.standard, provider: 'anthropic', tier: 'standard',
            input_tokens: inTok, output_tokens: outTok, cache_read_tokens: cacheRead, cache_creation_tokens: cacheCreate },
        )
      }
    }
  })

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
