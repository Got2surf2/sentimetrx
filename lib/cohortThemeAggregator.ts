// lib/cohortThemeAggregator.ts
//
// Phase 5 of the agents x PulseIQ convergence (docs/CONVERGENCE.md § 4
// row 5). Replaces lib/townhallThemeDetection.ts as the live theme-
// detection engine — but operates on the unified substrate:
//
//   reads:  town_halls, town_hall_conversations, conversations,
//           conversation_turns, town_hall_topics
//   writes: town_hall_topics, town_halls.last_theme_detection_at
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
//     through town_hall_conversations → conversations. PulseIQ's
//     `skipped` boolean has no equivalent on conversation_turns; all
//     user turns are candidates.
//   - Writes town_hall_topics with state='pending' (per the CHECK
//     constraint allowing 'active'|'pending'|'completed'|'rejected').
//     Legacy used 'detected' on townhall_themes which had a different
//     CHECK constraint.
//   - Sentiment is not stored on town_hall_topics (the new schema
//     dropped per-topic sentiment in favor of per-turn sentiment on
//     conversation_turns.sentiment). Mention count is preserved.
//   - Cohort config + industry context come from town_halls.cohort_config
//     and the linked agent row, not townhall_sessions.config.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { buildKwRegex, lexiconScore, classifySentiment, evenSample } from '@/lib/themeUtils'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

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

  // 1. Load town hall + linked agent (for org_id, industry/context)
  const { data: townHall } = await supabase
    .from('town_halls')
    .select('id, org_id, bot_id, name, cohort_config, discussion_guide')
    .eq('id', townHallId)
    .single()
  if (!townHall) return { inserted: 0, skipped: 0, error: 'Town hall not found' }

  const { data: agent } = await supabase
    .from('agents')
    .select('id, industry, config, system_prompt, subject, name')
    .eq('id', townHall.bot_id)
    .single()
  // agent can be null only if the FK is broken; treat as soft-fail rather than abort.

  // 2. Fetch all user turns across the town hall's conversations.
  // Two-step query (no nested joins through the join table in
  // supabase-js without RPC): first conversation ids, then turns.
  const { data: linkedConvs } = await supabase
    .from('town_hall_conversations')
    .select('conversation_id')
    .eq('town_hall_id', townHallId)
  const conversationIds = (linkedConvs || []).map(r => r.conversation_id)
  if (conversationIds.length === 0) {
    return { inserted: 0, skipped: 0, error: 'No conversations linked to this town hall yet' }
  }

  const { data: turns } = await supabase
    .from('conversation_turns')
    .select('content, content_en, conversation_id, created_at')
    .in('conversation_id', conversationIds)
    .eq('role', 'user')
    .order('created_at', { ascending: true })

  const allTexts = (turns || [])
    .map(t => (t.content_en || t.content || '').trim())
    .filter(t => t.length >= 20)
  if (allTexts.length < 10) return { inserted: 0, skipped: 0, error: 'Not enough responses yet (need 10+)' }

  // 3. Existing topics for dedup + gap context
  const { data: existingTopics } = await supabase
    .from('town_hall_topics')
    .select('id, label, keywords, state, mention_count')
    .eq('town_hall_id', townHallId)

  const existingKeywords = (existingTopics || []).map(t => ({
    label: t.label,
    keywords: t.keywords || [],
    mention_count: t.mention_count || 0,
  }))
  const existingLabels = existingKeywords.map(t => t.label.toLowerCase())

  // 4. Sample corpus
  const sampled = evenSample(allTexts, Math.min(200, allTexts.length))
  const corpus = sampled.map((t, i) => (i + 1) + '. ' + t.slice(0, 500)).join('\n')

  // 5. Build prompt
  const existingList = existingKeywords.length > 0
    ? '\n\nEXISTING THEMES (do NOT re-detect these):\n' + existingKeywords.map(t => '- ' + t.label + ' (' + t.mention_count + ' mentions, keywords: ' + t.keywords.slice(0, 5).join(', ') + ')').join('\n')
    : ''

  const cohortConfig = (townHall.cohort_config || {}) as any
  const discussionGuide = (townHall.discussion_guide || {}) as any
  const contextNote = discussionGuide?.event_description
    ? '\nEvent: ' + discussionGuide.event_description
    : (cohortConfig?.event_description ? '\nEvent: ' + cohortConfig.event_description : '')
  const industryNote = agent && (agent as any).industry
    ? '\nIndustry: ' + String((agent as any).industry).replace(/_/g, ' ')
    : ''

  const systemFraming = 'You are a qualitative research expert analyzing a live town hall discussion.' + contextNote + industryNote +
    '\n\nIdentify 2-5 NEW emerging themes NOT covered by existing themes. Prioritize topics that participants are raising but that are NOT yet captured as themes — look for under-represented perspectives and less-discussed issues that deserve attention. For each theme provide 8-15 keywords including core terms, synonyms, and informal variants.\n\n' +
    'Return ONLY valid JSON (no markdown, no backticks):\n' +
    '{"themes":[{"name":"Theme Name","description":"One sentence.","keywords":["word1","word2"],"question":"A probing question to ask participants about this theme.","follow_up_angles":["angle1","angle2"],"example_quote":"Best representative quote from the responses."}]}'

  const userPrompt = allTexts.length + ' total responses (' + sampled.length + ' sampled below).' +
    existingList +
    '\n\nRESPONSES:\n' + corpus

  // 6. Call AI
  let aiThemes: any[] = []
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
  } catch (e: any) {
    return { inserted: 0, skipped: 0, error: 'AI error: ' + (e.message || 'unknown') }
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
    // Sentiment isn't a column on town_hall_topics but compute it anyway
    // for the cron's return diagnostic — caller can ignore.
    void classifySentiment(totalPos, totalNeg)

    const { error: insertErr } = await supabase.from('town_hall_topics').insert({
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
      console.error({ at: 'cohortThemeAggregator', msg: 'insert town_hall_topics failed', err: insertErr.message })
      skipped++
    }
  }

  // 8. Update town hall detection timestamp
  await supabase
    .from('town_halls')
    .update({ last_theme_detection_at: new Date().toISOString() })
    .eq('id', townHallId)

  return { inserted, skipped }
}
