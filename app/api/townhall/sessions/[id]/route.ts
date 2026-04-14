import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { buildKwRegex, lexiconScore, classifySentiment } from '@/lib/themeUtils'

// GET /api/townhall/sessions/:id — get session with themes + stats (+ analytics if ?analytics=true)
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use service role to bypass RLS (auth already verified above)
  const db = createServiceRoleClient()

  const { data: session, error } = await db
    .from('townhall_sessions')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Fetch themes
  const { data: themes } = await db
    .from('townhall_themes')
    .select('*')
    .eq('session_id', params.id)
    .order('sort_order', { ascending: true })

  // Fetch turn stats
  const { data: turns } = await db
    .from('townhall_turns')
    .select('participant_id, skipped, user_message, theme_id, source')
    .eq('session_id', params.id)

  const allTurns = turns || []
  const participants = new Set(allTurns.map(t => t.participant_id))
  const answered = allTurns.filter(t => !t.skipped && t.user_message)
  const avgWords = answered.length > 0
    ? Math.round(answered.reduce((sum, t) => sum + (t.user_message?.split(/\s+/).length || 0), 0) / answered.length)
    : 0

  // Post-session response count
  const { count: responseCount } = await db
    .from('townhall_participant_responses')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', params.id)

  const stats = {
    joined: participants.size,
    total_turns: allTurns.length,
    answered: answered.length,
    skipped: allTurns.filter(t => t.skipped).length,
    skip_rate: allTurns.length > 0 ? Math.round((allTurns.filter(t => t.skipped).length / allTurns.length) * 100) : 0,
    avg_words: avgWords,
    avg_turns: participants.size > 0 ? +(allTurns.length / participants.size).toFixed(1) : 0,
    survey_responses: responseCount || 0,
  }

  const wantsAnalytics = _req.nextUrl.searchParams.get('analytics') === 'true'

  if (!wantsAnalytics) {
    return NextResponse.json({ session, themes: themes || [], stats })
  }

  // ── Analytics mode: enrich themes with keyword matching, sentiment, quotes ──
  const { data: allTurnsWithText } = await db
    .from('townhall_turns')
    .select('user_message_en, user_message, theme_id, created_at, skipped')
    .eq('session_id', params.id)
    .order('created_at', { ascending: true })

  const responsesWithText = (allTurnsWithText || []).filter(t => !t.skipped && (t.user_message_en || t.user_message))
  const allResponseTexts = responsesWithText.map(t => (t.user_message_en || t.user_message || '').trim()).filter(Boolean)

  // Per-theme analytics
  const enrichedThemes = (themes || []).map(function(t: any) {
    const keywords: string[] = t.keywords || []
    const regexes = keywords.slice(0, 15).map(function(kw: string) {
      try { return buildKwRegex(kw) } catch { return null }
    }).filter(Boolean) as RegExp[]

    let matchCount = 0, totalPos = 0, totalNeg = 0
    const matchedQuotes: string[] = []
    const kwFreq: Record<string, number> = {}

    for (const text of allResponseTexts) {
      const lower = text.toLowerCase()
      if (regexes.length > 0 && regexes.some(function(re) { return re.test(lower) })) {
        matchCount++
        const score = lexiconScore(text)
        totalPos += score.pos
        totalNeg += score.neg
        if (matchedQuotes.length < 5) matchedQuotes.push(text.slice(0, 300))
        // Count individual keyword hits
        for (var ki = 0; ki < keywords.length; ki++) {
          try {
            if (buildKwRegex(keywords[ki]).test(lower)) kwFreq[keywords[ki]] = (kwFreq[keywords[ki]] || 0) + 1
          } catch {}
        }
      }
    }

    const sentiment = matchCount > 0 ? classifySentiment(totalPos, totalNeg) : (t.sentiment || 'neutral')
    const percentage = allResponseTexts.length > 0 ? Math.round(matchCount / allResponseTexts.length * 100) : 0
    const topKeywords = Object.entries(kwFreq).sort(function(a, b) { return b[1] - a[1] }).slice(0, 10).map(function(e) { return { word: e[0], count: e[1] } })

    return {
      ...t,
      sentiment,
      match_count: matchCount,
      percentage,
      example_quotes: matchedQuotes,
      top_keywords: topKeywords,
    }
  })

  // Overall sentiment breakdown
  let overallPos = 0, overallNeg = 0, overallNeutral = 0, overallMixed = 0
  for (const text of allResponseTexts) {
    const score = lexiconScore(text)
    const sent = classifySentiment(score.pos, score.neg)
    if (sent === 'positive') overallPos++
    else if (sent === 'negative') overallNeg++
    else if (sent === 'mixed') overallMixed++
    else overallNeutral++
  }

  // Responses over time (hourly buckets)
  const buckets: Record<string, number> = {}
  for (const t of responsesWithText) {
    const hr = new Date(t.created_at).toISOString().slice(0, 13) + ':00'
    buckets[hr] = (buckets[hr] || 0) + 1
  }
  const responsesOverTime = Object.entries(buckets).sort().map(function(e) { return { bucket: e[0], count: e[1] } })

  return NextResponse.json({
    session,
    themes: enrichedThemes,
    stats,
    analytics: {
      sentiment_breakdown: { positive: overallPos, negative: overallNeg, mixed: overallMixed, neutral: overallNeutral },
      responses_over_time: responsesOverTime,
      total_responses: allResponseTexts.length,
    },
  })
}

// PATCH /api/townhall/sessions/:id — update session config or status
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Use service role to bypass RLS (auth already verified above)
  const db = createServiceRoleClient()

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  // Handle restart: reset to setup, clear all turns and themes
  if (body.restart) {
    await db.from('townhall_turns').delete().eq('session_id', params.id)
    await db.from('townhall_themes').delete().eq('session_id', params.id)
    const { data, error } = await db
      .from('townhall_sessions')
      .update({ status: 'setup', started_at: null, ended_at: null, response_counter: 0 })
      .eq('id', params.id)
      .select('id, status, started_at, ended_at')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Validate slug if provided
  if (body.slug !== undefined) {
    if (body.slug) {
      const slug = String(body.slug).toLowerCase().trim()
      const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/
      if (!SLUG_REGEX.test(slug)) {
        return NextResponse.json({ error: 'Link must be 3-50 characters: lowercase letters, numbers, and hyphens only' }, { status: 400 })
      }
      const { data: conflict } = await db.from('townhall_sessions').select('id').eq('slug', slug).neq('id', params.id).limit(1)
      if (conflict && conflict.length > 0) {
        return NextResponse.json({ error: 'This link is already taken' }, { status: 409 })
      }
      body.slug = slug
    } else {
      body.slug = null
    }
  }

  // Only allow updating specific fields
  const allowed = ['name', 'config', 'discussion_guide', 'status', 'slug']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // Handle status transitions
  if (updates.status === 'active') {
    updates.started_at = new Date().toISOString()
  } else if (updates.status === 'ended') {
    updates.ended_at = new Date().toISOString()
  }

  const { data, error } = await db
    .from('townhall_sessions')
    .update(updates)
    .eq('id', params.id)
    .select('id, status, started_at, ended_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // When starting a session, seed the discussion guide topics into townhall_themes
  if (updates.status === 'active') {
    const { data: session } = await db
      .from('townhall_sessions')
      .select('discussion_guide, config')
      .eq('id', params.id)
      .single()

    if (session?.discussion_guide && Array.isArray(session.discussion_guide)) {
      const guideThemes = session.discussion_guide.map((topic: any, idx: number) => ({
        session_id: params.id,
        label: topic.label,
        description: topic.description || null,
        question: topic.opening_question,
        follow_up_angles: topic.follow_up_angles || [],
        state: 'active',
        source: 'guide',
        response_target: topic.response_target || session.config?.engine?.default_response_target || 30,
        sort_order: idx,
      }))

      if (guideThemes.length > 0) {
        await db.from('townhall_themes').insert(guideThemes)
      }
    }
  }

  return NextResponse.json(data)
}
