import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { buildKwRegex, lexiconScore, classifySentiment } from '@/lib/themeUtils'
import { autoBucket, bucketKey, TimeBucket } from '@/lib/timeBucket'
import { bleepText } from '@/lib/contentGuard'

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
    .select('participant_id, skipped, user_message, theme_id, source, created_at')
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

  // Per-participant summary for the responses tab
  const participantSummary = Array.from(participants).map(pid => {
    const pTurns = allTurns.filter(t => t.participant_id === pid)
    const pAnswered = pTurns.filter(t => !t.skipped && t.user_message)
    const lastTurn = pTurns[pTurns.length - 1]
    const topics = new Set(pTurns.filter(t => t.theme_id).map(t => t.theme_id))
    const firstTurn = pTurns[0]
    return {
      participant_id: pid,
      turns: pTurns.length,
      answered: pAnswered.length,
      skipped: pTurns.filter(t => t.skipped).length,
      topics: topics.size,
      last_source: lastTurn?.source || null,
      is_complete: lastTurn?.source === 'done' || pTurns.some(t => t.skipped && t.user_message === '[done]'),
      started_at: firstTurn?.created_at || null,
      last_activity: lastTurn?.created_at || null,
    }
  })

  const wantsAnalytics = _req.nextUrl.searchParams.get('analytics') === 'true'

  if (!wantsAnalytics) {
    return NextResponse.json({ session, themes: themes || [], stats, participants: participantSummary })
  }

  // ── Analytics mode: enrich themes with keyword matching, sentiment, quotes ──
  const { data: allTurnsWithText } = await db
    .from('townhall_turns')
    .select('user_message_en, user_message, theme_id, created_at, skipped')
    .eq('session_id', params.id)
    .order('created_at', { ascending: true })

  const safetyConfig = (session.config as any)?.content_safety || {}
  const responsesWithText = (allTurnsWithText || []).filter(t => !t.skipped && (t.user_message_en || t.user_message))
  const allResponseTexts = responsesWithText.map(t => bleepText((t.user_message_en || t.user_message || '').trim(), safetyConfig)).filter(Boolean)

  // Build a lookup: theme_id → response texts (from turns tagged with that theme)
  const themeIdTexts: Record<string, string[]> = {}
  for (const t of responsesWithText) {
    if (t.theme_id) {
      if (!themeIdTexts[t.theme_id]) themeIdTexts[t.theme_id] = []
      themeIdTexts[t.theme_id].push((t.user_message_en || t.user_message || '').trim())
    }
  }

  // Per-theme analytics
  const enrichedThemes = (themes || []).map(function(t: any) {
    const keywords: string[] = t.keywords || []
    const regexes = keywords.slice(0, 15).map(function(kw: string) {
      try { return buildKwRegex(kw) } catch { return null }
    }).filter(Boolean) as RegExp[]

    let matchCount = 0, totalPos = 0, totalNeg = 0
    const matchedQuotes: string[] = []
    const kwFreq: Record<string, number> = {}

    if (regexes.length > 0) {
      // Keyword-based matching (auto-detected themes with keywords)
      for (const text of allResponseTexts) {
        const lower = text.toLowerCase()
        if (regexes.some(function(re) { return re.test(lower) })) {
          matchCount++
          const score = lexiconScore(text)
          totalPos += score.pos
          totalNeg += score.neg
          if (matchedQuotes.length < 20) matchedQuotes.push(text.slice(0, 300))
          for (var ki = 0; ki < keywords.length; ki++) {
            try {
              if (buildKwRegex(keywords[ki]).test(lower)) kwFreq[keywords[ki]] = (kwFreq[keywords[ki]] || 0) + 1
            } catch {}
          }
        }
      }
    } else {
      // Fallback for guide/custom themes without keywords: use turn-level theme_id tagging
      const tagged = themeIdTexts[t.id] || []
      matchCount = tagged.length
      for (const text of tagged) {
        const score = lexiconScore(text)
        totalPos += score.pos
        totalNeg += score.neg
        if (matchedQuotes.length < 20) matchedQuotes.push(text.slice(0, 300))
      }
    }

    // Also include turn-tagged responses not caught by keyword matching
    const taggedTexts = themeIdTexts[t.id] || []
    const quotesSet = new Set(matchedQuotes)
    for (const text of taggedTexts) {
      if (matchedQuotes.length >= 20) break
      const trimmed = text.slice(0, 300)
      if (!quotesSet.has(trimmed)) { matchedQuotes.push(trimmed); quotesSet.add(trimmed); matchCount++ }
    }

    const sentiment = matchCount > 0 ? classifySentiment(totalPos, totalNeg) : (t.sentiment || 'neutral')
    const percentage = allResponseTexts.length > 0 ? Math.round(matchCount / allResponseTexts.length * 100) : 0
    const topKeywords = Object.entries(kwFreq).sort(function(a, b) { return b[1] - a[1] }).slice(0, 10).map(function(e) { return { word: e[0], count: e[1] } })

    return {
      ...t,
      sentiment,
      match_count: matchCount,
      mention_count: matchCount,
      response_count: t.source === 'auto_detected' ? matchCount : t.response_count,
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

  // Responses over time (smart bucketing)
  const bucketParam = _req.nextUrl.searchParams.get('bucket') as TimeBucket | null
  const timestamps = responsesWithText.map(t => new Date(t.created_at))
  const chosenBucket: TimeBucket = bucketParam && ['hour', 'day', 'week', 'month'].includes(bucketParam)
    ? bucketParam
    : timestamps.length >= 2
      ? autoBucket(timestamps[0], timestamps[timestamps.length - 1])
      : 'hour'
  const timeBuckets: Record<string, number> = {}
  for (const t of responsesWithText) {
    const key = bucketKey(t.created_at, chosenBucket)
    timeBuckets[key] = (timeBuckets[key] || 0) + 1
  }
  const responsesOverTime = Object.entries(timeBuckets).sort().map(function(e) { return { bucket: e[0], count: e[1] } })

  // Per-theme frequency over time (keyword-matched, same buckets)
  const activeThemeList = (themes || []).filter((t: any) => t.state !== 'dismissed')
  const themeRegexes: { id: string; label: string; regexes: RegExp[] }[] = activeThemeList.map(function(t: any) {
    const kws: string[] = t.keywords || []
    return {
      id: t.id,
      label: t.label,
      regexes: kws.slice(0, 15).map(function(kw: string) { try { return buildKwRegex(kw) } catch { return null } }).filter(Boolean) as RegExp[],
    }
  })

  // Build sorted bucket keys
  const sortedBuckets = Object.keys(timeBuckets).sort()

  // For each response, check which themes match, bucket by time
  const themeTimeSeries: Record<string, Record<string, number>> = {}
  for (const tr of themeRegexes) themeTimeSeries[tr.id] = {}

  for (const t of responsesWithText) {
    const text = (t.user_message_en || t.user_message || '').toLowerCase()
    const bk = bucketKey(t.created_at, chosenBucket)
    for (const tr of themeRegexes) {
      if (tr.regexes.length > 0) {
        if (tr.regexes.some(function(re) { return re.test(text) })) {
          themeTimeSeries[tr.id][bk] = (themeTimeSeries[tr.id][bk] || 0) + 1
        }
      } else if (t.theme_id === tr.id) {
        // Fallback: use turn-level theme tagging for themes without keywords
        themeTimeSeries[tr.id][bk] = (themeTimeSeries[tr.id][bk] || 0) + 1
      }
    }
  }

  // Format: array of { theme_id, label, series: [{bucket, count}] }
  const topicFrequency = themeRegexes.map(function(tr) {
    return {
      theme_id: tr.id,
      label: tr.label,
      series: sortedBuckets.map(function(bk) { return { bucket: bk, count: themeTimeSeries[tr.id][bk] || 0 } }),
    }
  })

  // Shift detection: flag themes where the latest bucket is ≥2x the per-bucket average
  const shifts: { theme_id: string; label: string; latest: number; avg: number }[] = []
  for (const tf of topicFrequency) {
    if (tf.series.length < 3) continue
    const counts = tf.series.map(function(s) { return s.count })
    const avg = counts.reduce(function(a, b) { return a + b }, 0) / counts.length
    const latest = counts[counts.length - 1]
    if (avg > 0 && latest >= avg * 2 && latest >= 3) {
      shifts.push({ theme_id: tf.theme_id, label: tf.label, latest, avg: Math.round(avg * 10) / 10 })
    }
  }

  return NextResponse.json({
    session,
    themes: enrichedThemes,
    stats,
    analytics: {
      sentiment_breakdown: { positive: overallPos, negative: overallNeg, mixed: overallMixed, neutral: overallNeutral },
      responses_over_time: responsesOverTime,
      topic_frequency: topicFrequency,
      topic_shifts: shifts,
      time_bucket: chosenBucket,
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

  // Handle delete_participants: remove specific participant conversations
  if (body.delete_participants && Array.isArray(body.delete_participants)) {
    const pids: string[] = body.delete_participants
    if (pids.length === 0) return NextResponse.json({ error: 'No participant IDs provided' }, { status: 400 })
    const { count: turnCount } = await db.from('townhall_turns').delete({ count: 'exact' }).eq('session_id', params.id).in('participant_id', pids)
    await db.from('townhall_participant_responses').delete().eq('session_id', params.id).in('participant_id', pids)
    // Recount response_counter
    const { data: distinctParticipants } = await db.from('townhall_turns').select('participant_id').eq('session_id', params.id)
    const uniqueRemaining = new Set((distinctParticipants || []).map(t => t.participant_id)).size
    await db.from('townhall_sessions').update({ response_counter: uniqueRemaining }).eq('id', params.id)

    // Recalculate response_count for all themes and update state accordingly
    const { data: themes } = await db.from('townhall_themes').select('id, response_target, state').eq('session_id', params.id)
    if (themes) {
      for (const theme of themes) {
        const { count } = await db.from('townhall_turns')
          .select('id', { count: 'exact', head: true })
          .eq('session_id', params.id)
          .eq('theme_id', theme.id)
          .not('user_message', 'is', null)
          .eq('skipped', false)
        const newCount = count || 0
        const updates: Record<string, unknown> = { response_count: newCount }
        // Un-complete themes that dropped below target
        if (theme.state === 'completed' && newCount < theme.response_target) {
          updates.state = 'active'
          updates.completed_at = null
        }
        await db.from('townhall_themes').update(updates).eq('id', theme.id)
      }
    }
    return NextResponse.json({ deleted: pids.length, turns_deleted: turnCount ?? 0 })
  }

  // Handle reanalyze: clear all auto-detected themes + re-run detection
  if (body.reanalyze) {
    // Delete all auto-detected themes (keep guide + custom)
    await db.from('townhall_themes').delete().eq('session_id', params.id).eq('source', 'auto_detected')
    // Re-run theme detection
    const { detectThemesForSession } = await import('@/lib/townhallThemeDetection')
    const result = await detectThemesForSession(params.id)
    return NextResponse.json({ reanalyzed: true, ...result })
  }

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
  if (body.reopen) {
    // Reopen from ended — go back to active, preserve started_at, clear ended_at
    updates.status = 'active'
    updates.ended_at = null
  } else if (updates.status === 'active') {
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
      const enabledTopics = session.discussion_guide.filter((t: any) => t.enabled !== false)
      const guideThemes = enabledTopics.map((topic: any, idx: number) => ({
        session_id: params.id,
        label: topic.label,
        description: topic.description || null,
        question: topic.opening_question,
        follow_up_angles: topic.follow_up_angles || [],
        keywords: topic.keywords || [],
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

  // Sync discussion guide changes to townhall_themes for active/paused sessions
  if (updates.discussion_guide && !updates.status) {
    const currentStatus = data?.status
    if (currentStatus === 'active' || currentStatus === 'paused') {
      const guide = updates.discussion_guide as any[]
      if (Array.isArray(guide)) {
        // Fetch existing themes for this session (guide-sourced)
        const { data: existingThemes } = await db
          .from('townhall_themes')
          .select('id, label, state, source')
          .eq('session_id', params.id)

        const existingLabels = new Set((existingThemes || []).map(t => t.label.toLowerCase()))

        // Insert new enabled topics that don't already have a theme
        const newTopics = guide
          .filter((t: any) => t.enabled !== false && t.label.trim() && !existingLabels.has(t.label.toLowerCase().trim()))

        if (newTopics.length > 0) {
          const maxOrder = (existingThemes || []).length
          const newThemes = newTopics.map((topic: any, idx: number) => ({
            session_id: params.id,
            label: topic.label,
            description: topic.description || null,
            question: topic.opening_question || '',
            follow_up_angles: topic.follow_up_angles || [],
            keywords: topic.keywords || [],
            state: 'active',
            source: 'guide',
            response_target: topic.response_target || 30,
            sort_order: maxOrder + idx,
          }))
          await db.from('townhall_themes').insert(newThemes)
        }

        // Pause themes for topics that were disabled in the guide
        const disabledLabels = guide
          .filter((t: any) => t.enabled === false && t.label.trim())
          .map((t: any) => t.label.toLowerCase().trim())

        if (disabledLabels.length > 0) {
          const toDisable = (existingThemes || [])
            .filter(t => t.source === 'guide' && t.state === 'active' && disabledLabels.includes(t.label.toLowerCase()))
          for (const t of toDisable) {
            await db.from('townhall_themes').update({ state: 'paused' }).eq('id', t.id)
          }
        }

        // Re-activate themes for topics that were re-enabled
        const enabledLabels = guide
          .filter((t: any) => t.enabled !== false && t.label.trim())
          .map((t: any) => t.label.toLowerCase().trim())

        const toReactivate = (existingThemes || [])
          .filter(t => t.source === 'guide' && t.state === 'paused' && enabledLabels.includes(t.label.toLowerCase()))
        for (const t of toReactivate) {
          await db.from('townhall_themes').update({ state: 'active' }).eq('id', t.id)
        }

        // Update existing guide themes with current guide data (label, description, keywords, question, target)
        const guideThemes = (existingThemes || []).filter(t => t.source === 'guide')
        for (const theme of guideThemes) {
          // Match by label (case-insensitive) — the guide topic that corresponds to this theme
          const guideTopic = guide.find((g: any) => g.label.toLowerCase().trim() === theme.label.toLowerCase())
          if (guideTopic) {
            await db.from('townhall_themes').update({
              label: guideTopic.label,
              description: guideTopic.description || null,
              question: guideTopic.opening_question || '',
              follow_up_angles: guideTopic.follow_up_angles || [],
              keywords: guideTopic.keywords || [],
              response_target: guideTopic.response_target || 30,
            }).eq('id', theme.id)
          }
        }

        // Remove themes for guide topics that were completely deleted from the guide
        const guideLabelsLower = guide.map((g: any) => g.label.toLowerCase().trim()).filter(Boolean)
        const orphaned = guideThemes.filter(t => !guideLabelsLower.includes(t.label.toLowerCase()))
        for (const t of orphaned) {
          // Don't delete — dismiss so data is preserved, but topic disappears from active view
          await db.from('townhall_themes').update({ state: 'dismissed' }).eq('id', t.id)
        }
      }
    }
  }

  return NextResponse.json(data)
}

// DELETE /api/townhall/sessions/:id — delete session and all related data
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceRoleClient()

  // Delete in order: turns → themes → participant responses → session
  await db.from('townhall_turns').delete().eq('session_id', params.id)
  await db.from('townhall_themes').delete().eq('session_id', params.id)
  await db.from('townhall_participant_responses').delete().eq('session_id', params.id)
  const { error } = await db.from('townhall_sessions').delete().eq('id', params.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ deleted: true })
}
