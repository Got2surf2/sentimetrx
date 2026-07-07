// lib/cohortThemeAggregator.ts
//
// Phase 5 of the agents x PulseIQ convergence (docs/CONVERGENCE.md § 4
// row 5). Replaces lib/townhallThemeDetection.ts as the live theme-
// detection engine — but operates on the unified substrate:
//
//   reads:  pulseiq_sessions, pulseiq_session_conversations, conversations,
//           conversation_turns, pulseiq_topics
//   writes: pulseiq_topics, pulseiq_sessions.last_theme_detection_at
//
// The legacy detector is preserved for any sessions still on the old
// schema; both run side-by-side from the cron during transition.
//
// Behaviorally a 1:1 port of detectThemesForSession: sample user turns,
// AI-classify into themes, dedup by label/keyword overlap, score
// mention count, insert new topics with source='auto_detected'.
//
// Differences vs the legacy version:
//   - Reads conversation_turns.content_en (with content fallback) joined
//     through pulseiq_session_conversations → conversations. PulseIQ's
//     `skipped` boolean has no equivalent on conversation_turns; all
//     user turns are candidates.
//   - Writes pulseiq_topics with state='pending' (per the CHECK
//     constraint allowing 'active'|'pending'|'completed'|'rejected').
//     Legacy used 'detected' on townhall_themes which had a different
//     CHECK constraint.
//   - Sentiment is not stored on pulseiq_topics (the new schema
//     dropped per-topic sentiment in favor of per-turn sentiment on
//     conversation_turns.sentiment). Mention count is preserved.
//   - Cohort config + industry context come from pulseiq_sessions.cohort_config
//     (industry: cohort_config.industry — legacy config.industry parity).

import { createServiceRoleClient } from '@/lib/supabase/server'
import { fetchAllRows } from '@/lib/townHallAdapter'
import { buildKwRegex, lexiconScore, classifySentiment, evenSample } from '@/lib/themeUtils'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { logError } from '@/lib/log'

function keywordOverlap(existing: string[], candidate: string[]): number {
  if (!existing.length || !candidate.length) return 0
  const existingSet = new Set(existing.map(k => k.toLowerCase()))
  const matches = candidate.filter(k => existingSet.has(k.toLowerCase())).length
  return matches / Math.max(candidate.length, 1)
}

/**
 * Detect emerging themes across a town hall's conversations.
 * Mirrors detectThemesForSession but on the new schema.
 */
export async function detectThemesForTownHall(townHallId: string): Promise<{ inserted: number; skipped: number; error?: string }> {
  const supabase = createServiceRoleClient()

  // 1. Load town hall (org_id, config, guide)
  const { data: townHall, error: townHallErr } = await supabase
    .from('pulseiq_sessions')
    .select('id, org_id, bot_id, name, cohort_config, discussion_guide')
    .eq('id', townHallId)
    .single()
  if (townHallErr) void logError('cohortThemeAggregator.detectThemesForTownHall', townHallErr)
  if (!townHall) return { inserted: 0, skipped: 0, error: 'Town hall not found' }

  // 2. Fetch all user turns across the town hall's conversations, via the
  // stamped conversation_turns.town_hall_id column — the old two-step hop
  // through pulseiq_session_conversations passed every conversation id in
  // the URL and broke at a few hundred participants. The link table is
  // still checked (cheap existence probe) so the "no conversations yet"
  // and "not enough responses" cases keep their distinct messages.
  const { data: linkedConvs, error: linkedConvsErr } = await supabase
    .from('pulseiq_session_conversations')
    .select('conversation_id')
    .eq('town_hall_id', townHallId)
    .limit(1)
  if (linkedConvsErr) void logError('cohortThemeAggregator.detectThemesForTownHall', linkedConvsErr, { orgId: townHall.org_id })
  if ((linkedConvs || []).length === 0) {
    return { inserted: 0, skipped: 0, error: 'No conversations linked to this town hall yet' }
  }

  const turns = await fetchAllRows<{ content: string | null; content_en: string | null; conversation_id: string; created_at: string }>((from, to) => supabase
    .from('conversation_turns')
    .select('content, content_en, conversation_id, created_at')
    .eq('town_hall_id', townHallId)
    .eq('role', 'user')
    .order('created_at', { ascending: true })
    .order('id', { ascending: true })
    .range(from, to))

  const allTexts = turns
    .map(t => (t.content_en || t.content || '').trim())
    .filter(t => t.length >= 20)
  if (allTexts.length < 10) return { inserted: 0, skipped: 0, error: 'Not enough responses yet (need 10+)' }

  // 3. Existing topics for dedup + gap context
  const { data: existingTopics, error: existingTopicsErr } = await supabase
    .from('pulseiq_topics')
    .select('id, label, keywords, state, mention_count')
    .eq('town_hall_id', townHallId)
  if (existingTopicsErr) void logError('cohortThemeAggregator.detectThemesForTownHall', existingTopicsErr, { orgId: townHall.org_id })

  const existingKeywords = (existingTopics || []).map(t => ({
    label: t.label,
    keywords: t.keywords || [],
    mention_count: t.mention_count || 0,
  }))
  const existingLabels = existingKeywords.map(t => t.label.toLowerCase())

  // Pending-pool cap: detection APPENDS pending topics and nothing else
  // drains them (a facilitator promotes or dismisses manually), so without
  // a ceiling a long/busy session mints topics forever — one load-tested
  // session reached 405 pending (2026-07-04), and label/keyword dedup can't
  // stop AI synonym variants. A facilitator with 30 unreviewed themes needs
  // review, not more detection. Checked BEFORE the AI call to skip the spend.
  const PENDING_POOL_CAP = 30
  const pendingCount = (existingTopics || []).filter(t => t.state === 'pending').length
  if (pendingCount >= PENDING_POOL_CAP) {
    return { inserted: 0, skipped: 0, error: 'Pending theme pool is full (' + pendingCount + '/' + PENDING_POOL_CAP + ') — review pending themes before detecting more' }
  }

  // 4. Sample corpus
  const sampled = evenSample(allTexts, Math.min(200, allTexts.length))
  const corpus = sampled.map((t, i) => (i + 1) + '. ' + t.slice(0, 500)).join('\n')

  // 5. Build prompt
  const existingList = existingKeywords.length > 0
    ? '\n\nEXISTING THEMES (do NOT re-detect these):\n' + existingKeywords.map(t => '- ' + t.label + ' (' + t.mention_count + ' mentions, keywords: ' + t.keywords.slice(0, 5).join(', ') + ')').join('\n')
    : ''

  const cohortConfig = (townHall.cohort_config || {}) as {
    industry?: string
    event_description?: string
    default_response_target?: number
  }
  const discussionGuide = (townHall.discussion_guide || {}) as { event_description?: string }
  const contextNote = discussionGuide?.event_description
    ? '\nEvent: ' + discussionGuide.event_description
    : (cohortConfig?.event_description ? '\nEvent: ' + cohortConfig.event_description : '')
  // Industry context lives on the session's own config (legacy parity:
  // townhall_sessions.config.industry → cohort_config.industry). An earlier
  // version selected a nonexistent agents.industry column, which errored on
  // every cron scan and meant the note NEVER rendered.
  const industryNote = cohortConfig?.industry
    ? '\nIndustry: ' + String(cohortConfig.industry).replace(/_/g, ' ')
    : ''

  const systemFraming = 'You are a qualitative research expert analyzing a live town hall discussion.' + contextNote + industryNote +
    '\n\nIdentify 2-5 NEW emerging themes NOT covered by existing themes. Prioritize topics that participants are raising but that are NOT yet captured as themes — look for under-represented perspectives and less-discussed issues that deserve attention. For each theme provide 8-15 keywords including core terms, synonyms, and informal variants.\n\n' +
    'Return ONLY valid JSON (no markdown, no backticks):\n' +
    '{"themes":[{"name":"Theme Name","description":"One sentence.","keywords":["word1","word2"],"question":"A probing question to ask participants about this theme.","follow_up_angles":["angle1","angle2"],"example_quote":"Best representative quote from the responses."}]}'

  const userPrompt = allTexts.length + ' total responses (' + sampled.length + ' sampled below).' +
    existingList +
    '\n\nRESPONSES:\n' + corpus

  // 6. Call AI
  interface AiTheme {
    name?: string
    description?: string
    keywords?: string[]
    question?: string
    follow_up_angles?: string[]
    example_quote?: string
  }
  let aiThemes: AiTheme[] = []
  try {
    const result = await callAI({
      tier: 'standard',
      maxTokens: 4000,
      timeoutMs: 20000,
      system: [{ type: 'text', text: systemFraming, cache: true }],
      messages: [{ role: 'user', content: userPrompt }],
    })
    // resource_type 'townhall' kept to stay within the existing UsageContext
    // enum and to keep PulseIQ events grouped together for accounting,
    // regardless of which schema backs the row. Adding a new 'town_hall'
    // enum value would just split the same product line in reports.
    logUsage({ org_id: townHall.org_id, resource_type: 'townhall', resource_id: townHallId, event_type: 'theme_detect' }, result.usage)
    const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const parsed = JSON.parse(raw)
    aiThemes = parsed.themes || []
  } catch (e: unknown) {
    return { inserted: 0, skipped: 0, error: 'AI error: ' + (e instanceof Error ? e.message : 'unknown') }
  }

  // 7. Dedup + score + insert
  let inserted = 0
  let skipped = 0
  const defaultResponseTarget: number = (cohortConfig?.default_response_target) || 30

  for (const t of aiThemes) {
    const name = (t.name || '').trim()
    const keywords: string[] = (t.keywords || []).filter((k: string) => k && k.trim())
    if (!name || keywords.length < 3) { skipped++; continue }

    if (existingLabels.includes(name.toLowerCase())) { skipped++; continue }

    const hasOverlap = existingKeywords.some(ex => keywordOverlap(ex.keywords, keywords) > 0.5)
    if (hasOverlap) { skipped++; continue }

    const regexes = keywords.slice(0, 10).map(kw => {
      try { return buildKwRegex(kw) } catch { return null }
    }).filter(Boolean) as RegExp[]

    let mentionCount = 0
    let totalPos = 0
    let totalNeg = 0
    for (const text of allTexts) {
      const lower = text.toLowerCase()
      if (regexes.some(re => re.test(lower))) {
        mentionCount++
        const score = lexiconScore(text)
        totalPos += score.pos
        totalNeg += score.neg
      }
    }
    // Sentiment isn't a column on pulseiq_topics but compute it anyway
    // for the cron's return diagnostic — caller can ignore.
    void classifySentiment(totalPos, totalNeg)

    const { error: insertErr } = await supabase.from('pulseiq_topics').insert({
      org_id: townHall.org_id,
      town_hall_id: townHallId,
      label: name,
      description: t.description || '',
      question: t.question || 'Tell us more about ' + name + '.',
      follow_up_angles: (t.follow_up_angles || []).slice(0, 5),
      keywords,
      source: 'auto_detected',
      state: 'pending',
      response_target: defaultResponseTarget,
      mention_count: mentionCount,
      example_quote: (t.example_quote || '').slice(0, 500),
      detected_at: new Date().toISOString(),
    })

    if (!insertErr) {
      inserted++
      existingKeywords.push({ label: name, keywords, mention_count: mentionCount })
      existingLabels.push(name.toLowerCase())
    } else {
      console.error({ at: 'cohortThemeAggregator', msg: 'insert pulseiq_topics failed', err: insertErr.message })
      skipped++
    }
  }

  // 8. Update town hall detection timestamp
  await supabase
    .from('pulseiq_sessions')
    .update({ last_theme_detection_at: new Date().toISOString() })
    .eq('id', townHallId)

  return { inserted, skipped }
}
