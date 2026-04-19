// app/api/ask-ana/route.ts
// POST /api/ask-ana — streaming AI Q&A against dataset rows
// Uses Anthropic prompt caching so the dataset context is sent once and reused
// for follow-up questions within a 5-minute window.
// Samples large datasets (max 200 rows) and truncates long text (300 chars).

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60

const ROW_CAP       = 10000
const SAMPLE_MAX    = 200    // max rows sent to Claude
const TEXT_TRUNCATE = 300    // max chars per text field

interface Message {
  role: 'user' | 'assistant'
  content: string
}

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

  // Fetch all rows
  const service = createServiceRoleClient()
  const allRows: Record<string, unknown>[] = []
  const FLAT_PAGE = 1000
  let offset = 0
  let fetchMore = true

  while (fetchMore) {
    const { data: flatRows, error } = await service
      .from('dataset_rows_flat')
      .select('data')
      .eq('dataset_id', datasetId)
      .order('row_index', { ascending: true })
      .range(offset, offset + FLAT_PAGE - 1)

    if (error || !flatRows || flatRows.length === 0) { fetchMore = false; break }
    for (let i = 0; i < flatRows.length; i++) allRows.push(flatRows[i].data)
    if (flatRows.length < FLAT_PAGE) fetchMore = false
    offset += FLAT_PAGE
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

  // Random sample if too many rows — Fisher-Yates shuffle, take first SAMPLE_MAX
  const totalFiltered = filteredRows.length
  let sampled = false
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
    : dataset.source === 'townhall' ? 'Town Hall discussion responses'
    : dataset.source === 'study' ? 'survey responses'
    : dataset.source === 'google_reviews' ? 'Google Reviews'
    : 'data entries'

  const sampleNote = sampled
    ? '\n\nNote: This is a representative sample of ' + filteredRows.length + ' rows from ' + totalFiltered + ' total matching rows. Base your analysis on patterns in this sample.'
    : ''

  const filterNote = filters && Object.keys(filters).length > 0
    ? '\n\nNote: The user has active filters applied. You are seeing ' + totalFiltered + ' of ' + allRows.length + ' total rows.' + (sampled ? ' (sampled to ' + filteredRows.length + ')' : '')
    : ''

  const systemPrompt = `You are Ana, a helpful data analyst. You have been given a dataset of ${totalFiltered} ${sourceLabel} from "${dataset.name}".

Answer the user's question based ONLY on this data. Be specific and cite actual quotes when relevant (use quotation marks). If the data doesn't contain enough information to answer, say so.

Keep your responses concise but thorough. Use markdown formatting for readability (bullet points, bold, etc).${filterNote}${sampleNote}

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
              } else if (event.type === 'message_stop') {
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
