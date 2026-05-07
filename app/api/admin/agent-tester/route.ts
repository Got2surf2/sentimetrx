// app/api/admin/agent-tester/route.ts
// POST — Run a piece of text through every guardrail / moderation /
// classifier we have, return a structured report of what triggered.
// Used by /admin/agent-tester to give a single-screen view of what an
// agent would flag, route, or sanitize for any given input.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { resolveOrg } from '@/lib/resolveOrg'
import {
  SKIP_PATTERNS, isInputSafe, isOutputSafe, isOutputClean,
  cleanAiOutput, looksLikeAIRefusal,
} from '@/lib/guardrails'
import { checkMessage, scoreSentimentFull, bleepText, CONTENT_SAFETY_DEFAULTS } from '@/lib/contentGuard'

export const dynamic = 'force-dynamic'
export const maxDuration = 10

interface RuleHit { name: string; pattern: string }
interface IntentHit { label: string; matched_keywords: string[]; url?: string; message?: string }

const SKIP_PATTERN_LABELS = ['profanity', 'violence', 'sexual', 'slurs', 'urls']

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgData = resolveOrg((userData as any)?.organizations) as any
  if (!orgData?.is_admin_org) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = (userData as any)?.org_id

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  const text: string = String(body?.text || '').trim()
  const botId: string | null = body?.botId || null
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })
  if (text.length > 2000) return NextResponse.json({ error: 'text too long (max 2000 chars)' }, { status: 400 })

  // ── Optionally load the bot to apply its config + intents ─────────────
  let bot: any = null
  let safetyConfig = CONTENT_SAFETY_DEFAULTS
  if (botId) {
    const service = createServiceRoleClient()
    const { data } = await service
      .from('bots')
      .select('id, name, slug, status, config, system_prompt, knowledge_base, intents, training_urls')
      .eq('id', botId)
      .eq('org_id', orgId)
      .single()
    if (!data) return NextResponse.json({ error: 'Bot not found in your org' }, { status: 404 })
    bot = data
    const cs = (bot.config as any)?.content_safety
    if (cs && typeof cs === 'object') safetyConfig = { ...CONTENT_SAFETY_DEFAULTS, ...cs }
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

  // ── Intent matching against bot.intents ───────────────────────────────
  const intents: IntentHit[] = []
  if (bot?.intents && Array.isArray(bot.intents)) {
    const lower = text.toLowerCase()
    for (const it of bot.intents) {
      if (!it?.enabled) continue
      const kws: string[] = Array.isArray(it.keywords) ? it.keywords : []
      const hits = kws.filter(function(k: string) {
        return k && lower.includes(String(k).toLowerCase())
      })
      if (hits.length > 0) intents.push({ label: it.label, matched_keywords: hits, url: it.url, message: it.message })
    }
  }

  return NextResponse.json({
    text,
    length: text.length,
    bot: bot ? {
      id: bot.id, name: bot.name, slug: bot.slug, status: bot.status,
      systemPromptPreview: String(bot.system_prompt || '').slice(0, 240),
      systemPromptLength: String(bot.system_prompt || '').length,
      knowledgeBaseLength: String(bot.knowledge_base || '').length,
      intentCount: Array.isArray(bot.intents) ? bot.intents.filter(function(i: any) { return i?.enabled }).length : 0,
      safetyConfig,
    } : null,
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

// GET — list the caller's org's bots so the UI's picker has something to show.
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgData = resolveOrg((userData as any)?.organizations) as any
  if (!orgData?.is_admin_org) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const orgId = (userData as any)?.org_id

  const service = createServiceRoleClient()
  const { data: bots } = await service
    .from('bots')
    .select('id, name, slug, status')
    .eq('org_id', orgId)
    .order('name', { ascending: true })
  return NextResponse.json({ bots: bots || [] })
}
