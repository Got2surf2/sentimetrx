// app/api/admin/agent-tester/route.ts
// POST — Run a piece of text through every guardrail / moderation /
// classifier we have, return a structured report of what triggered.
// Used by /admin/agent-tester to give a single-screen view of what an
// agent would flag, route, or sanitize for any given input.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import {
  SKIP_PATTERNS, isInputSafe, isOutputSafe, isOutputClean,
  cleanAiOutput, looksLikeAIRefusal,
} from '@/lib/guardrails'
import { checkMessage, scoreSentimentFull, bleepText, CONTENT_SAFETY_DEFAULTS } from '@/lib/contentGuard'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

interface RuleHit { name: string; pattern: string }
interface IntentHit { label: string; matched_keywords: string[]; url?: string; message?: string; source: 'bot_intent' | 'townhall_theme' }

const SKIP_PATTERN_LABELS = ['profanity', 'violence', 'sexual', 'slurs', 'urls']

type TargetType = 'bot' | 'session'

export async function POST(req: Request) {
  const denied = await requireAdmin()
  if (denied) return denied
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  const orgId = (userData as any)?.org_id

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const text: string = String(body?.text || '').trim()
  // Accept either a bot or a townhall session as the "agent" to test against.
  // Bot intents and townhall themes both act as intent buckets — same shape,
  // different source — so the rest of the pipeline is identical.
  const targetType: TargetType = body?.targetType === 'session' ? 'session' : 'bot'
  const targetId: string | null = body?.targetId || body?.botId || null
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })
  if (text.length > 2000) return NextResponse.json({ error: 'text too long (max 2000 chars)' }, { status: 400 })

  // ── Optionally load the agent (bot or session) to apply its config ───
  let agent: any = null
  let safetyConfig = CONTENT_SAFETY_DEFAULTS
  let intentSource: any[] = []
  if (targetId) {
    const service = createServiceRoleClient()
    if (targetType === 'session') {
      const { data: sess } = await service
        .from('townhall_sessions')
        .select('id, name, status, config')
        .eq('id', targetId)
        .eq('org_id', orgId)
        .single()
      if (!sess) return NextResponse.json({ error: 'Session not found in your org' }, { status: 404 })
      const { data: themes } = await service
        .from('townhall_themes')
        .select('id, label, description, question, follow_up_angles, state, source')
        .eq('session_id', targetId)
        .in('state', ['active', 'detected', 'completed'])
      agent = { kind: 'session', ...sess, themes: themes || [] }
      intentSource = themes || []
      const cs = (sess.config as any)?.content_safety
      if (cs && typeof cs === 'object') safetyConfig = { ...CONTENT_SAFETY_DEFAULTS, ...cs }
    } else {
      const { data } = await service
        .from('bots')
        .select('id, name, slug, status, config, system_prompt, knowledge_base, intents, training_urls')
        .eq('id', targetId)
        .eq('org_id', orgId)
        .single()
      if (!data) return NextResponse.json({ error: 'Bot not found in your org' }, { status: 404 })
      agent = { kind: 'bot', ...data }
      intentSource = Array.isArray(data.intents) ? data.intents : []
      const cs = (data.config as any)?.content_safety
      if (cs && typeof cs === 'object') safetyConfig = { ...CONTENT_SAFETY_DEFAULTS, ...cs }
    }
  }

  // ── Pattern + guardrail checks ────────────────────────────────────────
  const skipHits: RuleHit[] = SKIP_PATTERNS.map(function(p, i) {
    return p.test(text) ? { name: SKIP_PATTERN_LABELS[i] || 'rule_' + i, pattern: p.toString() } : null
  }).filter(Boolean) as RuleHit[]

  const inputSafe = isInputSafe(text)
  const outputSafeAsQuestion = isOutputSafe(text)
  const outputClean = isOutputClean(text)
  const refusal = looksLikeAIRefusal(text)
  const cleaned = cleanAiOutput(text)

  const sentiment = scoreSentimentFull(text)
  const bleeped = bleepText(text, safetyConfig)

  // checkMessage tracks strikes per participantId — use a synthetic id so we
  // don't pollute the real strike map.
  const guard = checkMessage('agent-tester:' + Math.random().toString(36).slice(2), text, { safetyConfig })

  // ── Intent matching ───────────────────────────────────────────────────
  // Bots store explicit { keywords[] } per intent; townhall themes don't —
  // we match against label / description / follow_up_angles tokens (a rough
  // proxy for the AI-driven theme detection that runs during live sessions,
  // but enough to surface "this comment touches the `Schools` topic").
  const intents: IntentHit[] = []
  const lower = text.toLowerCase()
  if (intentSource.length > 0) {
    if (agent?.kind === 'bot') {
      for (const it of intentSource) {
        if (!it?.enabled) continue
        const kws: string[] = Array.isArray(it.keywords) ? it.keywords : []
        const hits = kws.filter(function(k: string) { return k && lower.includes(String(k).toLowerCase()) })
        if (hits.length > 0) intents.push({ label: it.label, matched_keywords: hits, url: it.url, message: it.message, source: 'bot_intent' })
      }
    } else {
      // session — match label, description tokens, follow_up_angles
      for (const t of intentSource) {
        const kws = [t.label, ...(Array.isArray(t.follow_up_angles) ? t.follow_up_angles : [])].filter(Boolean)
        const hits = kws.filter(function(k: string) { return k && lower.includes(String(k).toLowerCase()) })
        if (hits.length > 0) intents.push({ label: t.label, matched_keywords: hits, message: t.description || t.question, source: 'townhall_theme' })
      }
    }
  }

  // Build agent summary card (shape unified between bot + session)
  let agentSummary: any = null
  if (agent) {
    if (agent.kind === 'bot') {
      agentSummary = {
        kind: 'bot' as const,
        id: agent.id, name: agent.name, slug: agent.slug, status: agent.status,
        systemPromptPreview: String(agent.system_prompt || '').slice(0, 240),
        systemPromptLength: String(agent.system_prompt || '').length,
        knowledgeBaseLength: String(agent.knowledge_base || '').length,
        intentCount: Array.isArray(agent.intents) ? agent.intents.filter(function(i: any) { return i?.enabled }).length : 0,
        safetyConfig,
      }
    } else {
      agentSummary = {
        kind: 'session' as const,
        id: agent.id, name: agent.name, status: agent.status,
        intentCount: (agent.themes || []).length,
        safetyConfig,
      }
    }
  }

  return NextResponse.json({
    text,
    length: text.length,
    agent: agentSummary,
    // legacy field name kept so any old client still rendering bot card works
    bot: agentSummary?.kind === 'bot' ? agentSummary : null,
    skipHits,
    inputSafe,
    outputSafeAsQuestion,
    outputClean,
    cleaned,
    cleanedDifferent: cleaned !== text,
    refusal,
    sentiment,
    bleeped,
    bleepedDifferent: bleeped !== text,
    guard,
    intents,
  })
}

// GET — list the caller's org's bots AND townhall sessions so the UI picker
// can offer either as a target. Both are "agents" with the same config shape.
export async function GET() {
  const denied = await requireAdmin()
  if (denied) return denied
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: userData } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  const orgId = (userData as any)?.org_id

  const service = createServiceRoleClient()
  const [{ data: bots }, { data: sessions }] = await Promise.all([
    service.from('bots').select('id, name, slug, status').eq('org_id', orgId).order('name', { ascending: true }),
    service.from('townhall_sessions').select('id, name, status').eq('org_id', orgId).order('name', { ascending: true }),
  ])
  return NextResponse.json({ bots: bots || [], sessions: sessions || [] })
}
