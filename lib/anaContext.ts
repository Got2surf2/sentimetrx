// lib/anaContext.ts
//
// Row → prompt-context formatting for Ask Ana (app/api/ask-ana). Extracted from
// the route so it's unit-testable and so the cross-input ("project preview")
// path reads coherently: when Ana queries a COLLECTION, rows from different
// members (town-hall Q&A, agent turns, survey responses) are pooled and
// formatted under source='collection' — i.e. by the generic branch. So the
// generic branch must recognize the common shapes, not just dump every field.

export const TEXT_TRUNCATE = 300

export function getSourceLabel(source: string): string {
  if (source === 'reddit') return 'Reddit comments and posts'
  if (source === 'substack') return 'Substack reader comments'
  if (source === 'townhall') return 'PulseIQ conversation responses'
  if (source === 'recording') return 'town hall Q&A exchanges'
  if (source === 'bot') return 'agent conversation turns'
  if (source === 'study') return 'survey responses'
  if (source === 'collection') return 'responses'
  if (source === 'google_reviews') return 'Google Reviews'
  return 'data entries'
}

export function truncate(text: string, max: number): string {
  if (!text || text.length <= max) return text
  return text.slice(0, max) + '...'
}

// Internal/bookkeeping fields that clutter the context for Q&A-shaped rows
// (recordings + agents). Dropped from the generic dump so Ana sees the content,
// not the plumbing.
const NOISE_FIELDS = new Set([
  'extraction_id', 'response_text', 'confidence', 'flagged', 'flag_reason',
  'start_sec', 'source_file', 'sentiment_score', 'row_index', 'turn_number',
  'session_id', 'conversation',
])

function nonEmpty(v: unknown): boolean {
  return v != null && String(v).trim() !== ''
}

// One row → one compact "[i] field: value | …" line. Recognizes town-hall Q&A
// (recording) and agent-turn (bot) shapes so a mixed collection reads as
// labeled exchanges; everything else falls back to a noise-filtered field dump.
function formatGenericRow(r: Record<string, unknown>, i: number): string {
  // Town-hall Q&A pair (recording mirror) — question/answer/topic/asker/panelist.
  if (nonEmpty(r.question) || nonEmpty(r.answer)) {
    const parts: string[] = []
    if (nonEmpty(r.topic)) parts.push('Topic: ' + truncate(String(r.topic), 60))
    if (nonEmpty(r.asker)) parts.push('Asker: ' + String(r.asker))
    if (nonEmpty(r.panelist)) parts.push('Answered by: ' + String(r.panelist))
    if (nonEmpty(r.typology) && r.typology !== 'ask') parts.push('Type: ' + String(r.typology))
    if (nonEmpty(r.question)) parts.push('Q: ' + truncate(String(r.question), TEXT_TRUNCATE))
    if (nonEmpty(r.answer)) parts.push('A: ' + truncate(String(r.answer), TEXT_TRUNCATE))
    return '[' + (i + 1) + '] ' + parts.join(' | ')
  }
  // Agent conversation turn (bot mirror) — bot_message/user_message.
  if (nonEmpty(r.user_message)) {
    const parts: string[] = []
    if (nonEmpty(r.bot_message)) parts.push('Agent: ' + truncate(String(r.bot_message), 120))
    parts.push('User: ' + truncate(String(r.user_message), TEXT_TRUNCATE))
    if (nonEmpty(r.sentiment)) parts.push('Sentiment: ' + String(r.sentiment))
    return '[' + (i + 1) + '] ' + parts.join(' | ')
  }
  // Fallback: dump fields, minus the bookkeeping noise.
  const parts = Object.entries(r)
    .filter(function (e) { return nonEmpty(e[1]) && !NOISE_FIELDS.has(e[0]) })
    .map(function (e) {
      const val = typeof e[1] === 'string' ? truncate(e[1], TEXT_TRUNCATE) : e[1]
      return e[0] + ': ' + val
    })
  return '[' + (i + 1) + '] ' + parts.join(' | ')
}

export function formatRowsForContext(rows: Record<string, unknown>[], source: string): string {
  if (rows.length === 0) return '(no data)'

  if (source === 'reddit') {
    return rows.map(function (r, i) {
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
    return rows.map(function (r, i) {
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
    return rows.map(function (r, i) {
      const parts: string[] = []
      if (r.participant_id) parts.push('Participant: ' + r.participant_id)
      if (r.topic) parts.push('Topic: ' + r.topic)
      if (r.bot_message) parts.push('Q: ' + truncate(String(r.bot_message), 120))
      parts.push('A: ' + truncate(String(r.user_message || ''), TEXT_TRUNCATE))
      if (r.responded_at) parts.push('Date: ' + String(r.responded_at).slice(0, 10))
      return '[' + (i + 1) + '] ' + parts.join(' | ')
    }).join('\n')
  }

  // recording / bot / collection / study / upload / google_reviews → shape-aware
  // generic formatter (handles a mixed-source collection row-by-row).
  return rows.map(formatGenericRow).join('\n')
}
