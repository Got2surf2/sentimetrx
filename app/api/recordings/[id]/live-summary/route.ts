// app/api/recordings/[id]/live-summary/route.ts
//
// POST /api/recordings/[id]/live-summary — Town Hall live capture (§ 15, piece 3).
// Takes the live transcript-so-far (rough single-mic captions from the client)
// and returns a rolling situational-awareness summary for the on-screen panel.
// This is a convenience layer — the authoritative report is built post-meeting
// by the batch pipeline, NOT from this. Runs on the fast (Haiku) tier; the
// client throttles calls by transcript growth.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'

export const dynamic = 'force-dynamic'

const TERMINAL_STATUSES = new Set(['complete', 'failed', 'cancelled'])
const MIN_CHARS = 120
const MAX_CHARS = 60000 // ~15k tokens; if longer, keep the most recent tail

const SYSTEM = `You summarize a meeting transcript AS IT UNFOLDS, for a live on-screen panel the facilitator glances at.

The transcript is rough real-time captions from a single room microphone — speaker labels are absent and words may be imperfect. Infer reasonably, but DO NOT invent facts, numbers, names, or decisions that aren't supported by the text. If little has been said, keep it short.

Return ONLY a JSON object, no prose, no code fences:
{
  "headline": string,                  // <= 8 words, the meeting's current thrust
  "summary": string,                   // 2-3 sentences on what's been discussed so far
  "topics": string[],                  // up to 6 short topic labels surfaced so far
  "open_questions": string[],          // up to 6 questions asked but not yet resolved
  "decisions": string[]                // up to 6 decisions or action items stated; [] if none
}`

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing recording id' }, { status: 400 })

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  const org_id = userRow?.org_id as string | undefined
  if (!org_id) return NextResponse.json({ error: 'org not found' }, { status: 403 })

  const service = createServiceRoleClient()
  // Pair (id, org_id) — bare id with service role is a cross-tenant leak.
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id, org_id, status')
    .eq('id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })
  if (TERMINAL_STATUSES.has(rec.status as string)) {
    return NextResponse.json({ error: `recording is ${rec.status}` }, { status: 409 })
  }

  let transcript: string
  try {
    const body = (await req.json()) as { transcript?: string }
    transcript = (body.transcript ?? '').trim()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (transcript.length < MIN_CHARS) {
    return NextResponse.json({ error: 'transcript too short to summarize yet' }, { status: 422 })
  }
  if (transcript.length > MAX_CHARS) transcript = transcript.slice(-MAX_CHARS)

  let resp
  try {
    resp = await callAI({
      tier: 'fast',
      system: SYSTEM,
      messages: [{ role: 'user', content: transcript }],
      maxTokens: 600,
      timeoutMs: 30000,
      usage: { org_id, resource_type: 'recording', resource_id: recording_id, event_type: 'recording_live_summary' },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'summary failed' }, { status: 502 })
  }

  const parsed = parseJsonObject(resp.text)
  if (!parsed) return NextResponse.json({ error: 'could not parse summary' }, { status: 502 })

  const summary = {
    headline: typeof parsed.headline === 'string' ? parsed.headline : '',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    topics: strArr(parsed.topics),
    open_questions: strArr(parsed.open_questions),
    decisions: strArr(parsed.decisions),
  }

  // Persist the snapshot so Stop can show an instant provisional recap while the
  // batch pipeline runs (and the transcript survives a tab crash). Best-effort —
  // a write failure must not fail the summary the client is waiting on.
  await service
    .from('recordings')
    .update({ live_summary: summary, live_transcript: transcript })
    .eq('id', recording_id)
    .eq('org_id', org_id)

  return NextResponse.json({ ok: true, summary })
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  let t = text.trim()
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b < a) return null
  try { return JSON.parse(t.slice(a, b + 1)) } catch { return null }
}

function strArr(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).slice(0, 6)
}
