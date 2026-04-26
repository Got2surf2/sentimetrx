// app/api/ask-ana/route.ts
// POST /api/ask-ana — streaming AI Q&A + analysis framework mutations
// Uses Anthropic prompt caching so the dataset context is sent once and reused
// for follow-up questions within a 5-minute window.
// Samples large datasets (max 200 rows) and truncates long text (300 chars).
// When Ana detects the user wants to modify themes she returns tool_use blocks
// which the client renders as confirmation cards before writing to dataset_state.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { DEFAULT_SIGNAL_CUTOFFS } from '@/lib/signalTier'
import { checkMessage } from '@/lib/contentGuard'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const ROW_CAP       = 10000
const SAMPLE_MAX    = 200    // max rows sent to Claude
const TEXT_TRUNCATE = 300    // max chars per text field
const URL_ONLY_RE   = /^(\s*(https?:\/\/\S+)\s*)+$/i

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
    description: 'Generate a PowerPoint deck from the data. Use when the user asks for a deck, report, presentation, or slides. Build slide specs based on the data you analyzed. Available slide types: bar_chart (horizontal bars), kpi_grid (metric cards), table (rows and columns), bullets (key points), quotes (verbatim responses), two_column (side-by-side content).',
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
              type:     { type: 'string', enum: ['bar_chart', 'kpi_grid', 'table', 'bullets', 'quotes', 'two_column'] },
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

export async function POST(req: Request) {
  // Auth
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users').select('org_id').eq('id', user.id).single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { datasetId, question, conversationHistory, filters } = body as {
    datasetId: string
    question: string
    conversationHistory?: Message[]
    filters?: Record<string, any>
  }

  if (!datasetId || !question) {
    return NextResponse.json({ error: 'datasetId and question are required' }, { status: 400 })
  }

  // Content safety check on user question
  const safety = checkMessage('ana_' + user.id, question)
  if (!safety.safe) {
    return NextResponse.json({ error: safety.warning || 'Please rephrase your question.' }, { status: 400 })
  }

  // Verify dataset ownership
  const { data: dataset } = await supabase
    .from('datasets')
    .select('id, name, source, row_count, org_id')
    .eq('id', datasetId)
    .eq('org_id', userData.org_id)
    .single()

  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  if (dataset.row_count > ROW_CAP) {
    return NextResponse.json({
      error: 'Dataset too large for Ask Ana. Maximum ' + ROW_CAP.toLocaleString() + ' rows supported.'
    }, { status: 400 })
  }

  // Fetch dataset state (themes + schema) for framework context
  const service = createServiceRoleClient()
  const { data: stateRow } = await service
    .from('dataset_state')
    .select('theme_model, schema_config')
    .eq('dataset_id', datasetId)
    .single()
  const existingThemes: any[] = (stateRow?.theme_model as any)?.themes || []
  const schemaFields: any[] = (stateRow?.schema_config as any)?.fields || []

  // Fetch all rows — collections union from member datasets
  const allRows: Record<string, unknown>[] = []
  const FLAT_PAGE = 1000

  // Determine which dataset_ids to fetch from
  let flatDatasetIds: string[] = [datasetId]
  if (dataset.source === 'collection') {
    const { data: col } = await service.from('collections').select('id').eq('dataset_id', datasetId).single()
    if (col) {
      const { data: members } = await service.from('collection_members').select('dataset_id').eq('collection_id', col.id).order('sort_order', { ascending: true })
      if (members && members.length > 0) {
        flatDatasetIds = members.map(m => m.dataset_id)
      }
    }
  }

  for (const dsId of flatDatasetIds) {
    let offset = 0
    let fetchMore = true
    while (fetchMore && allRows.length < ROW_CAP) {
      const { data: flatRows, error } = await service
        .from('dataset_rows_flat')
        .select('data')
        .eq('dataset_id', dsId)
        .order('row_index', { ascending: true })
        .range(offset, offset + FLAT_PAGE - 1)

      if (error || !flatRows || flatRows.length === 0) { fetchMore = false; break }
      for (let i = 0; i < flatRows.length; i++) {
        allRows.push(flatRows[i].data)
        if (allRows.length >= ROW_CAP) { fetchMore = false; break }
      }
      if (flatRows.length < FLAT_PAGE) fetchMore = false
      offset += FLAT_PAGE
    }
    if (allRows.length >= ROW_CAP) break
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
  // Only apply to sources that have a known text field — study/collection/upload rows
  // have varied field names so skip this filter for them.
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
    // Per-thread percentile classification (same cutoffs as signalTier.ts)
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
    // If fewer than 10 signal rows, fall back to all rows
  }

  // Random sample if still too many rows
  const afterSignalCount = filteredRows.length
  if (filteredRows.length > SAMPLE_MAX) {
    for (let i = filteredRows.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      var tmp = filteredRows[i]; filteredRows[i] = filteredRows[j]; filteredRows[j] = tmp
    }
    filteredRows = filteredRows.slice(0, SAMPLE_MAX)
    sampled = true
  }

  // Format rows for context — keep it compact
  const dataContext = formatRowsForContext(filteredRows, dataset.source)

  // Build system prompt
  const sourceLabel = dataset.source === 'reddit' ? 'Reddit comments and posts'
    : dataset.source === 'substack' ? 'Substack reader comments'
    : dataset.source === 'townhall' ? 'PulseIQ conversation responses'
    : dataset.source === 'study' ? 'survey responses'
    : dataset.source === 'collection' ? 'survey responses'
    : dataset.source === 'google_reviews' ? 'Google Reviews'
    : 'data entries'

  const sampleNote = sampled
    ? '\n\nNote: This is a representative sample of ' + filteredRows.length + ' rows from ' + afterSignalCount + ' signal rows. Base your analysis on patterns in this sample.'
    : ''

  const filterNote = filters && Object.keys(filters).length > 0
    ? '\n\nNote: The user has active filters applied. You are seeing ' + totalFiltered + ' of ' + allRows.length + ' total rows.'
    : ''

  const redditContext = dataset.source === 'reddit'
    ? '\n\nThis is Reddit data. Comments with high scores represent mainstream views (community consensus). Comments in the middle range are controversial (mixed reception). Noise and fringe comments (low/negative scores) have been excluded. If the user asks about fringe or rejected views, let them know those are filtered out and they can check the Signals view for that analysis.'
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

  const systemPrompt = `You are Ana, a senior data analyst assistant. You have been given a dataset of ${filteredRows.length} ${sourceLabel} from "${dataset.name}".

You serve two roles:
1. **Answer questions** — Analyze the data to answer questions. Be specific, cite actual quotes when relevant. If the data doesn't contain enough to answer, say so.
2. **Modify the analysis framework** — When the user asks you to create, update, merge, or delete themes, use your tools. When you spot an opportunity to improve the framework (e.g., you notice many distinct entities that could be grouped, or themes that overlap), suggest it — but always wait for approval before acting.

When using tools, ALWAYS explain what you're about to do in your text response before calling the tool. For example: "I'll create a theme for menu items based on the 23 distinct food references I found in the data."

Keep your responses concise but thorough. Use markdown formatting for readability (bullet points, bold, etc).${themeContext}${schemaContext}${filterNote}${signalNote}${sampleNote}${redditContext}

Here is the dataset:
${dataContext}`

  // Build messages
  const messages: Message[] = []
  if (conversationHistory && conversationHistory.length > 0) {
    messages.push(...conversationHistory)
  }
  messages.push({ role: 'user', content: question })

  // Get API key
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'AI not configured' }, { status: 500 })
  }

  // Stream response from Anthropic with prompt caching
  // The system prompt (with dataset) is marked as cacheable so follow-up
  // questions reuse the cached context instead of re-sending all rows.
  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      stream: true,
      tools: ANA_TOOLS,
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
      // Track tool_use blocks being built up across deltas
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
              // Tool use: start of a new tool block
              else if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                currentToolId = event.content_block.id || ''
                currentToolName = event.content_block.name || ''
                toolInputJson = ''
              }
              // Tool use: accumulate input JSON
              else if (event.type === 'content_block_delta' && event.delta?.type === 'input_json_delta') {
                toolInputJson += event.delta.partial_json || ''
              }
              // Tool use: block complete — emit action event
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

// Truncate text to max length, adding ellipsis
function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text
  return text.slice(0, max) + '...'
}

// Format rows compactly for the system prompt context
function formatRowsForContext(rows: Record<string, unknown>[], source: string): string {
  if (rows.length === 0) return '(no data)'

  // For Reddit: focus on key fields
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

  // For Substack: focus on comment engagement
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

  // For Town Hall: focus on conversation data
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

  // Generic: include all fields
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
