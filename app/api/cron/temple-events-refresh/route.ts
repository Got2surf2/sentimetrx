// app/api/cron/temple-events-refresh/route.ts
// Weekly refresh of the Guru bot's event-calendar knowledge.
//
// The Hindu Society of Central Florida ("HSCF" / orlandohindutemple.org)
// publishes its event calendar at a third-party widget URL:
// https://orlandohindutemple.mhsoftware.com/. The page is JS-rendered, so we
// fetch the raw HTML, strip markup, and ask Haiku to extract events as
// structured JSON. We then DELETE-and-INSERT event chunks for the bot
// tagged metadata.source='temple_events_cron'. Embeddings are skipped at
// runtime; FTS + trigram in the RAG RPC handle retrieval fine for short
// date-keyed chunks. Cost per run: ~$0.002 (one Haiku call + ~30 chunk
// inserts).
//
// Schedule (vercel.json): Monday 11:00 UTC ≈ 7am ET, weekly. Bot ID is
// hard-coded to the Guru bot for now; generalise via a `kind` flag on bots
// or a per-bot config field when a second client needs it.
//
// vercel.json config:
// { "crons": [{ "path": "/api/cron/temple-events-refresh", "schedule": "0 11 * * 1" }] }

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { checkCronAuth } from '@/lib/cronAuth'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const GURU_BOT_ID = '198073e4-7d80-4437-9120-fede6539506a'
const CALENDAR_URL = 'https://orlandohindutemple.mhsoftware.com/'
const SOURCE_TAG = 'temple_events_cron'

type Event = { date: string; title: string; time?: string }

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const service = createServiceRoleClient()

  // ── Fetch + strip the calendar page ──────────────────────────────────────
  let html: string
  try {
    const res = await fetch(CALENDAR_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SentimetrxCron/1.0)' },
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    })
    if (!res.ok) {
      return NextResponse.json({ ok: false, error: `fetch failed: ${res.status}` }, { status: 502 })
    }
    html = await res.text()
  } catch (err: any) {
    return serverError(err, 'cron.templeEvents.fetch')
  }

  // Strip scripts/styles/tags, normalise whitespace, cap at 60k chars so we
  // stay inside Haiku's input budget comfortably.
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60000)

  if (stripped.length < 200) {
    return NextResponse.json({ ok: false, error: 'stripped page suspiciously short', stripped_len: stripped.length }, { status: 502 })
  }

  // ── Haiku extracts events as JSON ────────────────────────────────────────
  const result = await callAI({
    tier: 'fast',
    maxTokens: 3000,
    timeoutMs: 30000,
    system:
      'You are extracting events from a Hindu temple calendar page. Return ONLY a JSON array, no prose. ' +
      'Each item must be {"date": "YYYY-MM-DD", "title": "...", "time": "..."}. ' +
      'Omit the time field if not specified. Use the page year for dates. ' +
      'Skip past months. Skip navigation/UI text. If you find no events, return [].',
    messages: [{ role: 'user', content: stripped }],
  })
  logUsage({ org_id: '', resource_type: 'bot', resource_id: GURU_BOT_ID, event_type: 'cron_events_extract' }, result.usage)

  let events: Event[] = []
  try {
    // Haiku occasionally wraps JSON in prose despite the prompt. Extract the
    // outermost array if so.
    const text = result.text.trim()
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start === -1 || end === -1) throw new Error('no JSON array found in response')
    events = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(events)) throw new Error('parsed JSON was not an array')
  } catch (err: any) {
    return serverError(err, 'cron.templeEvents.parse', { raw_response: result.text.slice(0, 500) })
  }

  if (events.length === 0) {
    return NextResponse.json({ ok: true, events_found: 0, message: 'No events extracted — leaving existing chunks in place' })
  }

  // ── Group events by ISO week (Sun-Sat starting Sunday) for compact chunks ──
  // Skip events strictly before today to avoid polluting "what's happening
  // this week?" queries with past dates. Haiku frequently includes the
  // visible-but-past month when the calendar widget renders a span.
  const todayUtc = new Date()
  todayUtc.setUTCHours(0, 0, 0, 0)
  const byWeek = new Map<string, Event[]>()
  for (const ev of events) {
    if (!ev?.date || !ev?.title) continue
    const d = new Date(ev.date + 'T12:00:00Z')
    if (isNaN(d.getTime())) continue
    if (d < todayUtc) continue
    // Week key = Sunday-of-week ISO date
    const day = d.getUTCDay() // 0=Sun
    const sunday = new Date(d)
    sunday.setUTCDate(d.getUTCDate() - day)
    const key = sunday.toISOString().slice(0, 10)
    if (!byWeek.has(key)) byWeek.set(key, [])
    byWeek.get(key)!.push(ev)
  }

  // ── Replace existing event chunks ────────────────────────────────────────
  await service
    .from('agent_knowledge_chunks')
    .delete()
    .eq('bot_id', GURU_BOT_ID)
    .eq('metadata->>source', SOURCE_TAG)

  // Insert one chunk per week, sorted oldest-first within chunk
  const rows = Array.from(byWeek.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([weekStart, items]) => {
      const sorted = items.sort((a, b) => (a.date < b.date ? -1 : 1))
      const lines = sorted.map(e =>
        e.time
          ? `- **${e.date}** — ${e.title} (${e.time})`
          : `- **${e.date}** — ${e.title}`
      )
      const startDate = new Date(weekStart + 'T12:00:00Z')
      const endDate = new Date(startDate)
      endDate.setUTCDate(startDate.getUTCDate() + 6)
      const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
      return {
        bot_id: GURU_BOT_ID,
        title: `Temple events — Week of ${fmt(startDate)} to ${fmt(endDate)}, ${startDate.getUTCFullYear()}`,
        content: `Upcoming temple events at the Hindu Society of Central Florida for this week:\n\n${lines.join('\n')}\n\nFull calendar: ${CALENDAR_URL}`,
        metadata: { source: SOURCE_TAG, week_start: weekStart, refreshed_at: new Date().toISOString() },
      }
    })

  const { error: insertErr } = await service.from('agent_knowledge_chunks').insert(rows)
  if (insertErr) {
    return serverError(insertErr, 'cron.templeEvents.insert')
  }

  return NextResponse.json({
    ok: true,
    events_found: events.length,
    weeks_inserted: rows.length,
    sample_titles: rows.slice(0, 3).map(r => r.title),
  })
}
