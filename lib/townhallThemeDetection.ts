// lib/townhallThemeDetection.ts
// Server-side live theme detection for Town Hall sessions.
// Analyzes accumulated English responses to discover emerging themes.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { buildKwRegex, lexiconScore, classifySentiment, evenSample } from '@/lib/themeUtils'
import { callAI } from '@/lib/ai'

// Check keyword overlap ratio between two keyword sets
function keywordOverlap(existing: string[], candidate: string[]): number {
  if (!existing.length || !candidate.length) return 0
  const existingSet = new Set(existing.map(k => k.toLowerCase()))
  const matches = candidate.filter(k => existingSet.has(k.toLowerCase())).length
  return matches / Math.max(candidate.length, 1)
}

/**
 * Detect emerging themes for a Town Hall session.
 * Fetches responses, samples, calls Claude, deduplicates, scores sentiment, inserts new themes.
 */
export async function detectThemesForSession(sessionId: string): Promise<{ inserted: number; skipped: number; error?: string }> {
  const supabase = createServiceRoleClient()
  // AI provider is resolved automatically from env vars by callAI()

  // 1. Fetch session config
  const { data: session } = await supabase
    .from('townhall_sessions')
    .select('id, config')
    .eq('id', sessionId)
    .single()
  if (!session) return { inserted: 0, skipped: 0, error: 'Session not found' }

  // 2. Fetch all English responses (non-skipped, non-null)
  const { data: turns } = await supabase
    .from('townhall_turns')
    .select('user_message_en, user_message, theme_id')
    .eq('session_id', sessionId)
    .eq('skipped', false)
    .not('user_message_en', 'is', null)
    .order('created_at', { ascending: true })

  const allTexts = (turns || []).map(t => (t.user_message_en || t.user_message || '').trim()).filter(t => t.length >= 20)
  if (allTexts.length < 10) return { inserted: 0, skipped: 0, error: 'Not enough responses yet (need 10+)' }

  // 3. Fetch existing themes with keywords + mention counts for deduplication & gap analysis
  const { data: existingThemes } = await supabase
    .from('townhall_themes')
    .select('id, label, keywords, state, mention_count')
    .eq('session_id', sessionId)

  const existingKeywords = (existingThemes || []).map(t => ({
    label: t.label,
    keywords: t.keywords || [],
    mention_count: t.mention_count || 0,
  }))
  const existingLabels = existingKeywords.map(t => t.label.toLowerCase())

  // 4. Sample corpus (cap at 200 for prompt size)
  const sampled = evenSample(allTexts, Math.min(200, allTexts.length))
  const corpus = sampled.map((t, i) => (i + 1) + '. ' + t.slice(0, 500)).join('\n')

  // 5. Build prompt — include existing themes so AI avoids re-detecting
  const existingList = existingKeywords.length > 0
    ? '\n\nEXISTING THEMES (do NOT re-detect these):\n' + existingKeywords.map(t => '- ' + t.label + ' (' + t.mention_count + ' mentions, keywords: ' + t.keywords.slice(0, 5).join(', ') + ')').join('\n')
    : ''

  const config = session.config as any
  const contextNote = config?.context?.event_description ? '\nEvent: ' + config.context.event_description : ''
  const industryNote = config?.industry ? '\nIndustry: ' + config.industry.replace(/_/g, ' ') : ''

  const prompt = 'You are a qualitative research expert analyzing a live town hall discussion.' + contextNote + industryNote +
    '\n\n' + allTexts.length + ' total responses (' + sampled.length + ' sampled below).' +
    existingList +
    '\n\nRESPONSES:\n' + corpus +
    '\n\nIdentify 2-5 NEW emerging themes NOT covered by existing themes. Prioritize topics that participants are raising but that are NOT yet captured as themes — look for under-represented perspectives and less-discussed issues that deserve attention. For each theme provide 8-15 keywords including core terms, synonyms, and informal variants.\n\n' +
    'Return ONLY valid JSON:\n' +
    '{"themes":[{"name":"Theme Name","description":"One sentence.","keywords":["word1","word2"],"question":"A probing question to ask participants about this theme.","follow_up_angles":["angle1","angle2"],"example_quote":"Best representative quote from the responses."}]}'

  // 6. Call AI for theme detection
  let aiThemes: any[] = []
  try {
    const result = await callAI({
      tier: 'standard',
      maxTokens: 4000,
      timeoutMs: 20000,
      system: 'You are a qualitative research expert. Return ONLY raw JSON — no markdown, no backticks.',
      messages: [{ role: 'user', content: prompt }],
    })
    const raw = result.text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
    const parsed = JSON.parse(raw)
    aiThemes = parsed.themes || []
  } catch (e: any) {
    return { inserted: 0, skipped: 0, error: 'AI error: ' + (e.message || 'unknown') }
  }

  // 7. Deduplicate + score + insert
  let inserted = 0
  let skipped = 0

  for (const t of aiThemes) {
    const name = (t.name || '').trim()
    const keywords: string[] = (t.keywords || []).filter((k: string) => k && k.trim())
    if (!name || keywords.length < 3) { skipped++; continue }

    // Check label duplicate
    if (existingLabels.includes(name.toLowerCase())) { skipped++; continue }

    // Check keyword overlap with any existing theme
    const hasOverlap = existingKeywords.some(ex => keywordOverlap(ex.keywords, keywords) > 0.5)
    if (hasOverlap) { skipped++; continue }

    // Compute mention count + sentiment from matched responses
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
    const sentiment = mentionCount > 0 ? classifySentiment(totalPos, totalNeg) : 'neutral'

    // Insert as auto_detected theme
    const { error: insertErr } = await supabase.from('townhall_themes').insert({
      session_id: sessionId,
      label: name,
      description: t.description || '',
      question: t.question || 'Tell us more about ' + name + '.',
      follow_up_angles: (t.follow_up_angles || []).slice(0, 5),
      keywords,
      sentiment,
      source: 'auto_detected',
      state: 'detected',
      response_target: (config?.engine?.default_response_target) || 30,
      mention_count: mentionCount,
      example_quote: (t.example_quote || '').slice(0, 500),
      detected_at: new Date().toISOString(),
    })

    if (!insertErr) {
      inserted++
      // Add to existing list so subsequent themes in this batch don't duplicate
      existingKeywords.push({ label: name, keywords })
      existingLabels.push(name.toLowerCase())
    } else {
      skipped++
    }
  }

  // 8. Update session detection timestamp
  await supabase
    .from('townhall_sessions')
    .update({ last_theme_detection_at: new Date().toISOString() })
    .eq('id', sessionId)

  return { inserted, skipped }
}
