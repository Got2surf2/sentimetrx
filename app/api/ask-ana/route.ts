// app/api/ask-ana/route.ts
// POST /api/ask-ana — streaming AI Q&A + analysis framework mutations
// Uses Anthropic prompt caching so the dataset context is sent once and reused
// for follow-up questions within a 5-minute window.
// Supports configurable sample sizes and collection sampling strategies.
// When Ana detects the user wants to modify themes she returns tool_use blocks
// which the client renders as confirmation cards before writing to dataset_state.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { DEFAULT_SIGNAL_CUTOFFS } from '@/lib/signalTier'
import { checkMessage } from '@/lib/contentGuard'
import { getEntitiesWithCounts } from '@/lib/entityFilter'
import { TIER_DEFAULT_MODEL } from '@/lib/usageRates'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const CONTEXT_CAP    = 500    // absolute max rows sent to Claude
const DEFAULT_SAMPLE = 200    // default if user doesn't configure
const TEXT_TRUNCATE  = 300    // max chars per text field
const FETCH_CAP      = 2000   // max rows to pull from DB before filtering
const MEMBER_FLOOR   = 20     // min rows per collection member in 'floor' strategy
const URL_ONLY_RE    = /^(\s*(https?:\/\/\S+)\s*)+$/i

interface Message {
  role: 'user' | 'assistant'
  content: string | MessageContent[]
}

interface MessageContent {
  type: string
  [key: string]: any
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

// ── Per-member budget computation for collections ─────────────────────────
function computeMemberBudgets(
  members: { dataset_id: string; name: string; row_count: number }[],
  totalBudget: number,
  strategy: 'proportional' | 'equal' | 'floor'
): { dataset_id: string; budget: number }[] {
  const totalRows = members.reduce(function(s, m) { return s + m.row_count }, 0)
  if (totalRows === 0) return members.map(function(m) { return { dataset_id: m.dataset_id, budget: 0 } })

  if (strategy === 'equal') {
    const perMember = Math.floor(totalBudget / members.length)
    return members.map(function(m) {
      return { dataset_id: m.dataset_id, budget: Math.min(perMember, m.row_count) }
    })
  }

  if (strategy === 'floor') {
    // Give each member at least MEMBER_FLOOR rows (or all rows if smaller)
    let remaining = totalBudget
    const floors = members.map(function(m) {
      const f = Math.min(MEMBER_FLOOR, m.row_count)
      remaining -= f
      return f
    })
    if (remaining < 0) remaining = 0
    const nonFloorTotal = members.reduce(function(s, m) { return s + Math.max(0, m.row_count - MEMBER_FLOOR) }, 0)
    return members.map(function(m, i) {
      const extra = nonFloorTotal > 0 ? Math.round(Math.max(0, m.row_count - MEMBER_FLOOR) / nonFloorTotal * remaining) : 0
      return { dataset_id: m.dataset_id, budget: Math.min(floors[i] + extra, m.row_count) }
    })
  }

  // Default: proportional
  return members.map(function(m) {
    return { dataset_id: m.dataset_id, budget: Math.min(Math.max(1, Math.round(m.row_count / totalRows * totalBudget)), m.row_count) }
  })
}

export async function POST(req: Request) {
  // Auth + admin-org context. Admin-org users get cross-org dataset visibility
  // (same pattern as the rest of the platform; see lib/auth/orgAccess.ts).
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = { id: userId }

  const body = await req.json()
  const { datasetId, question, conversationHistory, filters, metadataOnly } = body as {
    datasetId: string
    question: string
    conversationHistory?: Message[]
    filters?: Record<string, any>
    metadataOnly?: boolean
  }
  const sampleSize = Math.max(50, Math.min(body.sampleSize || DEFAULT_SAMPLE, CONTEXT_CAP))
  const samplingStrategy: 'proportional' | 'equal' | 'floor' = body.samplingStrategy || 'proportional'

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
  const existingThemes: any[] = (stateRow?.theme_model as any)?.themes || []
  const schemaFields: any[] = (stateRow?.schema_config as any)?.fields || []

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

  // ── Resolve collection members ──────────────────────────────────────────
  let collectionMembers: { dataset_id: string; name: string; row_count: number }[] = []
  if (dataset.source === 'collection') {
    const { data: col } = await service.from('collections').select('id').eq('dataset_id', datasetId).single()
    if (col) {
      const { data: mems } = await service.from('collection_members').select('dataset_id, label, sort_order').eq('collection_id', col.id).order('sort_order', { ascending: true })
      if (mems && mems.length > 0) {
        const memIds = mems.map(function(m) { return m.dataset_id })
        const { data: memDs } = await service.from('datasets').select('id, name, row_count').in('id', memIds)
        const dsMap: Record<string, { name: string; row_count: number }> = {}
        if (memDs) memDs.forEach(function(d) { dsMap[d.id] = { name: d.name, row_count: d.row_count || 0 } })
        collectionMembers = mems.map(function(m) {
          const info = dsMap[m.dataset_id] || { name: m.label || 'Unknown', row_count: 0 }
          return { dataset_id: m.dataset_id, name: m.label || info.name, row_count: info.row_count }
        })
      }
    }
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
          .filter(function(f: any) { return f.status !== 'ignored' })
          .map(function(f: any) { return f.label + ' (' + f.type + ')' })
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

  // ── Normal mode: fetch data rows with sampling ──────────────────────────
  const allRows: Record<string, unknown>[] = []
  const fetchBudget = Math.min(sampleSize * 3, FETCH_CAP)
  const totalDatasetRows = dataset.source === 'collection'
    ? collectionMembers.reduce(function(s, m) { return s + m.row_count }, 0)
    : (dataset.row_count || 0)

  if (dataset.source === 'collection' && collectionMembers.length > 0) {
    // Collection: distribute fetch budget across members
    const budgets = computeMemberBudgets(collectionMembers, fetchBudget, samplingStrategy)
    for (const b of budgets) {
      if (b.budget <= 0) continue
      const memberInfo = collectionMembers.find(function(m) { return m.dataset_id === b.dataset_id })
      const memberRows = memberInfo ? memberInfo.row_count : 0
      const fetched = await fetchDatasetRows(service, b.dataset_id, b.budget, memberRows)
      for (let i = 0; i < fetched.length; i++) allRows.push(fetched[i])
    }
  } else {
    // Single dataset
    const fetched = await fetchDatasetRows(service, datasetId, fetchBudget, dataset.row_count || 0)
    for (let i = 0; i < fetched.length; i++) allRows.push(fetched[i])
  }

  if (allRows.length === 0) {
    return NextResponse.json({ error: 'No rows found in dataset' }, { status: 400 })
  }

  // Apply filters client-side if provided
  let filteredRows = allRows
  if (filters && Object.keys(filters).length > 0) {
    filteredRows = allRows.filter(function(row) {
      for (const field of Object.keys(filters)) {
        const f = filters[field]
        const val = row[field]
        if (f.type === 'cat') {
          const allowed = new Set(f.values || [])
          if (val == null && f.excludeBlanks) return false
          if (val != null && !allowed.has(String(val))) return false
        } else if (f.type === 'range') {
          const num = Number(val)
          if (isNaN(num)) { if (!f.includeBlanks) return false }
          else if (num < f.values[0] || num > f.values[1]) return false
        }
      }
      return true
    })
  }

  // Filter out URL-only rows (no meaningful text content)
  if (dataset.source === 'reddit' || dataset.source === 'substack' || dataset.source === 'google_reviews') {
    filteredRows = filteredRows.filter(function(r) {
      var text = String(r.body || r.user_message || r.review_text || '').trim()
      return text && !URL_ONLY_RE.test(text)
    })
  }

  // Reddit: vote-weighted sampling — only mainstream + controversial comments
  const totalFiltered = filteredRows.length
  let sampled = false
  let signalNote = ''

  if (dataset.source === 'reddit' && filteredRows.length > 0) {
    const MAINSTREAM_CUTOFF = DEFAULT_SIGNAL_CUTOFFS.mainstream
    const NOISE_CUTOFF = DEFAULT_SIGNAL_CUTOFFS.noise
    const threads: Record<string, { score: number; row: Record<string, unknown> }[]> = {}
    filteredRows.forEach(function(r) {
      const tid = String(r.thread_id || 'unknown')
      if (!threads[tid]) threads[tid] = []
      threads[tid].push({ score: Number(r.score) || 0, row: r })
    })

    const signalRows: Record<string, unknown>[] = []
    Object.values(threads).forEach(function(entries) {
      const sorted = [...entries].sort(function(a, b) { return b.score - a.score })
      const count = sorted.length
      sorted.forEach(function(entry, rank) {
        const percentile = count > 1 ? Math.round((1 - rank / (count - 1)) * 100) : 50
        if (percentile >= NOISE_CUTOFF && entry.score >= 0) {
          signalRows.push(entry.row)
        }
      })
    })

    if (signalRows.length >= 10) {
      filteredRows = signalRows
      signalNote = '\n\nNote: Only mainstream and controversial comments are included (top ' + (100 - NOISE_CUTOFF) + '% by score within each thread). ' + (totalFiltered - signalRows.length) + ' noise/fringe comments excluded.'
    }
  }

  // Random sample if still too many rows for the context window
  const afterSignalCount = filteredRows.length
  if (filteredRows.length > sampleSize) {
    for (let i = filteredRows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      var tmp = filteredRows[i]; filteredRows[i] = filteredRows[j]; filteredRows[j] = tmp
    }
    filteredRows = filteredRows.slice(0, sampleSize)
    sampled = true
  }

  // Format rows for context — keep it compact
  const dataContext = formatRowsForContext(filteredRows, dataset.source)

  // Build system prompt
  const sourceLabel = getSourceLabel(dataset.source)

  const sampleNote = sampled
    ? '\n\nNote: This is a random sample of ' + filteredRows.length + ' rows from ' + totalDatasetRows.toLocaleString() + ' total rows (' + afterSignalCount.toLocaleString() + ' after filtering). Base your analysis on patterns in this sample and note that findings are based on a sample.'
    : ''

  const filterNote = filters && Object.keys(filters).length > 0
    ? '\n\nNote: The user has active filters applied. You are seeing ' + totalFiltered + ' of ' + totalDatasetRows.toLocaleString() + ' total rows.'
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
    ? '\n\nCurrent analysis framework has ' + existingThemes.length + ' themes:\n' +
      existingThemes.map(function(t: any) {
        return '- ' + (t.name || t.label) + ' (' + (t.sentiment || 'neutral') + '): ' +
          (t.keywords || []).slice(0, 6).join(', ') +
          (t.count ? ' [' + t.count + ' matches]' : '')
      }).join('\n')
    : '\n\nNo themes have been created yet for this dataset.'

  const schemaContext = schemaFields.length > 0
    ? '\n\nDataset fields: ' + schemaFields
        .filter(function(f: any) { return f.status !== 'ignored' })
        .map(function(f: any) { return f.label + ' (' + f.type + (f.section ? ', ' + f.section : '') + ')' })
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

  const systemPrompt = `You are Ana, a senior data analyst assistant. You have been given a dataset of ${filteredRows.length} ${sourceLabel} from "${dataset.name}".

CRITICAL RULE: You must ONLY use the data provided below to answer questions. NEVER use outside knowledge, general knowledge, or information not present in this dataset. Every claim, statistic, and insight must be directly traceable to the rows provided. If the data does not contain enough information to answer a question, say "I don't see enough data in this dataset to answer that" — do NOT fill in gaps with general knowledge or assumptions.

You serve two roles:
1. **Answer questions** — Analyze the data to answer questions. Be specific, cite actual quotes when relevant. If the data doesn't contain enough to answer, say so clearly.
2. **Modify the analysis framework** — When the user asks you to create, update, merge, or delete themes, use your tools. When you spot an opportunity to improve the framework (e.g., you notice many distinct entities that could be grouped, or themes that overlap), suggest it — but always wait for approval before acting.

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

Keep your responses concise but thorough. Use markdown formatting for readability (bullet points, bold, etc).${themeContext}${schemaContext}${entityContext}${filterNote}${signalNote}${sampleNote}${collectionContext}${redditContext}

Here is the dataset:
${dataContext}`

  return streamAnthropicResponse(systemPrompt, question, conversationHistory, ANA_TOOLS, dataset.org_id)
}

// ── Fetch rows from a single dataset, using RPC sampling for large ones ───
async function fetchDatasetRows(
  service: ReturnType<typeof createServiceRoleClient>,
  datasetId: string,
  budget: number,
  totalRows: number
): Promise<Record<string, unknown>[]> {
  // Small dataset: fetch all rows sequentially
  if (totalRows <= budget) {
    const rows: Record<string, unknown>[] = []
    const PAGE = 1000
    let offset = 0
    let fetchMore = true
    while (fetchMore) {
      const { data: flatRows, error } = await service
        .from('dataset_rows_flat')
        .select('data')
        .eq('dataset_id', datasetId)
        .order('row_index', { ascending: true })
        .range(offset, offset + PAGE - 1)

      if (error || !flatRows || flatRows.length === 0) break
      for (let i = 0; i < flatRows.length; i++) rows.push(flatRows[i].data)
      if (flatRows.length < PAGE) fetchMore = false
      offset += PAGE
    }
    return rows
  }

  // Large dataset: use RPC random sampling
  const { data: sampled, error } = await service.rpc('sample_row_pairs', {
    p_dataset_id: datasetId,
    p_fields: [],
    p_limit: budget,
  })
  if (error || !sampled) return []
  return sampled.map(function(r: any) { return r.data })
}

// ── Stream Anthropic response ─────────────────────────────────────────────
async function streamAnthropicResponse(
  systemPrompt: string,
  question: string,
  conversationHistory: Message[] | undefined,
  tools: any[],
  orgId: string,
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

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
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

  if (!anthropicRes.ok) {
    let errMsg = 'AI API error: ' + anthropicRes.status
    try { const d = await anthropicRes.json(); errMsg = d?.error?.message || errMsg } catch {}
    return NextResponse.json({ error: errMsg }, { status: 500 })
  }

  // Transform Anthropic SSE stream into a clean text stream for the client
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  const readable = new ReadableStream({
    async start(controller) {
      const reader = anthropicRes.body!.getReader()
      let buffer = ''
      let currentToolId = ''
      let currentToolName = ''
      let toolInputJson = ''

      try {
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
              if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                controller.enqueue(encoder.encode('data: ' + JSON.stringify({ text: event.delta.text }) + '\n\n'))
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
                  const toolInput = JSON.parse(toolInputJson)
                  controller.enqueue(encoder.encode('data: ' + JSON.stringify({
                    action: {
                      tool: currentToolName,
                      toolId: currentToolId,
                      input: toolInput,
                    }
                  }) + '\n\n'))
                } catch {}
                currentToolName = ''
                currentToolId = ''
                toolInputJson = ''
              }
              else if (event.type === 'message_stop') {
                controller.enqueue(encoder.encode('data: [DONE]\n\n'))
              }
            } catch {}
          }
        }
      } catch (err) {
        controller.enqueue(encoder.encode('data: ' + JSON.stringify({ error: 'Stream interrupted' }) + '\n\n'))
      } finally {
        controller.close()
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

// ── Helpers ───────────────────────────────────────────────────────────────

function getSourceLabel(source: string): string {
  if (source === 'reddit') return 'Reddit comments and posts'
  if (source === 'substack') return 'Substack reader comments'
  if (source === 'townhall') return 'PulseIQ conversation responses'
  if (source === 'study') return 'survey responses'
  if (source === 'collection') return 'survey responses'
  if (source === 'google_reviews') return 'Google Reviews'
  return 'data entries'
}

function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text
  return text.slice(0, max) + '...'
}

function formatRowsForContext(rows: Record<string, unknown>[], source: string): string {
  if (rows.length === 0) return '(no data)'

  if (source === 'reddit') {
    return rows.map(function(r, i) {
      const parts: string[] = []
      if (r.author) parts.push('Author: ' + r.author)
      if (r.subreddit) parts.push('r/' + r.subreddit)
      if (r.thread_title) parts.push('Thread: ' + truncate(String(r.thread_title), 80))
      if (r.score != null) parts.push('Score: ' + r.score)
      if (r.post_date) parts.push('Date: ' + r.post_date)
      if (r.depth != null) parts.push(Number(r.depth) === -1 ? 'Type: Post' : 'Type: Comment (depth ' + r.depth + ')')
      parts.push('Text: ' + truncate(String(r.body || ''), TEXT_TRUNCATE))
      return '[' + (i + 1) + '] ' + parts.join(' | ')
    }).join('\n')
  }

  if (source === 'substack') {
    return rows.map(function(r, i) {
      const parts: string[] = []
      if (r.author) parts.push('Author: ' + r.author)
      if (r.post_title) parts.push('Post: ' + truncate(String(r.post_title), 80))
      if (r.likes != null) parts.push('Likes: ' + r.likes)
      if (r.is_author_reply) parts.push('Author Reply: yes')
      if (r.children_count) parts.push('Replies: ' + r.children_count)
      if (r.comment_date) parts.push('Date: ' + String(r.comment_date).slice(0, 10))
      parts.push('Text: ' + truncate(String(r.body || ''), TEXT_TRUNCATE))
      return '[' + (i + 1) + '] ' + parts.join(' | ')
    }).join('\n')
  }

  if (source === 'townhall') {
    return rows.map(function(r, i) {
      const parts: string[] = []
      if (r.participant_id) parts.push('Participant: ' + r.participant_id)
      if (r.topic) parts.push('Topic: ' + r.topic)
      if (r.bot_message) parts.push('Q: ' + truncate(String(r.bot_message), 120))
      parts.push('A: ' + truncate(String(r.user_message || ''), TEXT_TRUNCATE))
      if (r.responded_at) parts.push('Date: ' + String(r.responded_at).slice(0, 10))
      return '[' + (i + 1) + '] ' + parts.join(' | ')
    }).join('\n')
  }

  return rows.map(function(r, i) {
    const parts = Object.entries(r)
      .filter(function(e) { return e[1] != null && e[1] !== '' })
      .map(function(e) {
        const val = typeof e[1] === 'string' ? truncate(e[1], TEXT_TRUNCATE) : e[1]
        return e[0] + ': ' + val
      })
    return '[' + (i + 1) + '] ' + parts.join(' | ')
  }).join('\n')
}
