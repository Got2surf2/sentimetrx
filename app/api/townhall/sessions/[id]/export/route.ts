// app/api/townhall/sessions/[id]/export/route.ts
// GET ?format=csv|xlsx|themes|json — export Town Hall responses + themes + demo/psycho data
// XLSX bundles responses + themes into separate sheets; CSV emits one or the other.

import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { NextRequest, NextResponse } from 'next/server'
import { lexiconScore, classifySentiment } from '@/lib/themeUtils'
import { dataResponse, type Sheet } from '@/lib/xlsxExport'
import { projectHallAsSession } from '@/lib/townHallAdapter'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cross-org gate: the session lookups below use the service role (bypasses
  // RLS) across both substrates. Capture the owning org_id from whichever path
  // resolves and verify the caller before exporting. Admin-org may export any.
  const { orgId, isAdmin } = await getCallerOrgContext(supabase)

  const db = createServiceRoleClient()
  const format = req.nextUrl.searchParams.get('format') || 'csv'

  // Fetch session — try legacy townhall_sessions first, then fall back
  // to the phase-3 town_halls table (projected into legacy shape so the
  // downstream code stays substrate-agnostic). Pure phase-3 sessions
  // like NOWOCATS have no townhall_sessions row at all, so without this
  // fallback the magnifying-glass conversation modal silently 404s.
  let session: { name: string; status: string; config: any; started_at: string | null; ended_at: string | null } | null = null
  let sessionOrgId: string | null = null
  {
    const { data } = await db
      .from('townhall_sessions')
      .select('name, status, config, started_at, ended_at, org_id')
      .eq('id', params.id)
      .maybeSingle()
    if (data) { session = data as any; sessionOrgId = (data as any).org_id ?? null }
  }
  let purePhase3 = false
  if (!session) {
    const isUUID = /^[0-9a-f-]{36}$/i.test(params.id)
    let hall: any = null
    if (isUUID) {
      const { data } = await db.from('town_halls').select('*').eq('id', params.id).maybeSingle()
      if (data) hall = data
    }
    if (!hall) {
      const { data } = await db.from('town_halls').select('*').eq('slug', params.id.toLowerCase()).maybeSingle()
      if (data) hall = data
    }
    if (hall) {
      const projected = projectHallAsSession(hall)
      session = {
        name: projected.name,
        status: projected.status,
        config: projected.config,
        started_at: projected.started_at,
        ended_at: projected.ended_at,
      }
      sessionOrgId = hall.org_id ?? null
      purePhase3 = true
    }
  }

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!isAdmin && sessionOrgId !== orgId) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Fetch themes
  const { data: themes } = await db
    .from('townhall_themes')
    .select('id, label, source, state, sentiment, keywords')
    .eq('session_id', params.id)
    .order('sort_order', { ascending: true })

  const themeMap: Record<string, string> = {}
  for (const t of themes || []) themeMap[t.id] = t.label

  // Fetch all turns
  const { data: turnsData } = await db
    .from('townhall_turns')
    .select('participant_id, turn_number, bot_message, user_message, user_message_en, language, theme_id, theme_label, source, skipped, created_at')
    .eq('session_id', params.id)
    .order('created_at', { ascending: true })
    .range(0, 49999)
  // Phase-3 sessions don't populate townhall_turns. Coerce null → [] so
  // the downstream pairing/grouping code (which used to be guarded by
  // the empty-turns early return) stays well-typed without a sea of
  // ?. checks.
  const turns = turnsData || []

  // Fetch participant post-session responses
  const { data: postResponses } = await db
    .from('townhall_participant_responses')
    .select('participant_id, psychographics, demographics, submitted_at')
    .eq('session_id', params.id)

  const demoMap: Record<string, Record<string, unknown>> = {}
  const psychoMap: Record<string, Record<string, unknown>> = {}
  const allDemoKeys = new Set<string>()
  const allPsychoKeys = new Set<string>()

  for (const pr of postResponses || []) {
    if (pr.demographics) {
      demoMap[pr.participant_id] = pr.demographics
      Object.keys(pr.demographics).forEach(k => allDemoKeys.add(k))
    }
    if (pr.psychographics) {
      psychoMap[pr.participant_id] = pr.psychographics
      Object.keys(pr.psychographics).forEach(k => allPsychoKeys.add(k))
    }
  }

  const demoKeyArr = Array.from(allDemoKeys).sort()
  const psychoKeyArr = Array.from(allPsychoKeys).sort()

  // Skip the empty-turns short-circuit for phase-3 sessions — they don't
  // populate townhall_turns at all; their data lives in conversation_turns
  // and is pulled in the json branch below.
  if ((!turns || turns.length === 0) && !purePhase3) {
    return new NextResponse('No responses to export\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
  }

  if (format === 'csv' || format === 'xlsx') {
    const safeName = (session.name || 'townhall').replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const date = new Date().toISOString().slice(0, 10)
    const responses = buildResponsesSheet(turns, themeMap, demoMap, psychoMap, demoKeyArr, psychoKeyArr)
    if (format === 'xlsx') {
      // XLSX bundles both responses and theme summary into one workbook.
      const themesSheet = buildThemesSheet(themes || [], turns)
      return dataResponse('xlsx', safeName + '-export-' + date, [responses, themesSheet])
    }
    return dataResponse('csv', safeName + '-responses-' + date, [responses])
  }

  if (format === 'themes') {
    const safeName = (session.name || 'townhall').replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const date = new Date().toISOString().slice(0, 10)
    return dataResponse('csv', safeName + '-themes-' + date, [buildThemesSheet(themes || [], turns)])
  }

  if (format === 'json') {
    // Group turns into conversation threads by participant
    const participants: Record<string, any[]> = {}
    for (const t of turns) {
      if (!participants[t.participant_id]) participants[t.participant_id] = []
      participants[t.participant_id].push({
        turn: t.turn_number,
        bot: t.bot_message,
        user: t.user_message,
        user_en: t.user_message_en,
        language: t.language,
        topic: t.theme_label || themeMap[t.theme_id] || null,
        source: t.source,
        skipped: t.skipped,
        time: t.created_at,
        // bot_flags + user_flags are populated by the phase-3 branch below
        // and stay null for legacy substrate sessions (which don't store
        // content_flags per turn).
        bot_flags: null,
        user_flags: null,
        user_sentiment: null,
        user_sentiment_score: null,
      })
    }

    // ── Phase-3 augmentation ────────────────────────────────────────
    // If THIS session is a town_halls (phase-3) slug/id, append its
    // conversations alongside legacy data. The chat handler emits to
    // both substrates when both flags are on; this keeps the export
    // unified regardless of which path the data came from.
    // Note: the gate above uses townhall_sessions only, so a pure
    // phase-3 session (no legacy row) returns "No responses" at line 74.
    // That's a separate bug for pure phase-3 town halls — handled here.

    const phase3PersonaByParticipant: Record<string, { name: string | null; persona: any }> = {}
    {
      // Look up phase-3 town hall (slug-or-uuid). Reuses the adapter's
      // resolver semantics inline to avoid a wider refactor.
      const isUUID = /^[0-9a-f-]{36}$/i.test(params.id)
      let hall: any = null
      if (isUUID) {
        const { data } = await db.from('town_halls').select('*').eq('id', params.id).maybeSingle()
        if (data) hall = data
      }
      if (!hall) {
        const { data } = await db.from('town_halls').select('*').eq('slug', params.id.toLowerCase()).maybeSingle()
        if (data) hall = data
      }

      if (hall) {
        // Pull conversations linked to this town hall
        const { data: linkRows } = await db
          .from('town_hall_conversations')
          .select('conversation_id, conversations!inner(id, session_id, participant_id, org_id, bot_id)')
          .eq('town_hall_id', hall.id)
          .eq('org_id', hall.org_id)
          .limit(5000)
        const convs = ((linkRows || []) as any[])
          .map(r => Array.isArray(r.conversations) ? r.conversations[0] : r.conversations)
          .filter(Boolean)

        if (convs.length > 0) {
          const convIds = convs.map((c: any) => c.id)
          const convById: Record<string, any> = {}
          for (const c of convs) convById[c.id] = c

          // All turns across linked conversations
          const { data: cts } = await db
            .from('conversation_turns')
            .select('id, conversation_id, turn_number, role, content, content_en, language, source, content_flags, sentiment, sentiment_score, topic_id, skipped, created_at')
            .in('conversation_id', convIds)
            .eq('org_id', hall.org_id)
            .order('conversation_id', { ascending: true })
            .order('turn_number', { ascending: true })

          // Topic label lookup
          const topicIds = Array.from(new Set(((cts || []) as any[]).map(c => c.topic_id).filter(Boolean)))
          const topicLabel: Record<string, string> = {}
          if (topicIds.length > 0) {
            const { data: thts } = await db.from('town_hall_topics').select('id, label').in('id', topicIds)
            for (const t of (thts || [])) topicLabel[(t as any).id] = (t as any).label
          }

          // Persona/name lookup keyed on (bot_id, session_id) via agent_session_personas
          const sessionIds = Array.from(new Set(convs.map((c: any) => c.session_id)))
          const { data: ps } = await db
            .from('agent_session_personas')
            .select('bot_id, session_id, name, persona, demographics')
            .eq('bot_id', hall.bot_id)
            .in('session_id', sessionIds)
          const personaBySession: Record<string, any> = {}
          for (const p of (ps || [])) personaBySession[(p as any).session_id] = p

          // Pair turns into {bot, user} per turn_number-pair, per
          // participant. Each conversation_turns row is a SINGLE turn
          // (user OR assistant). Pair the user turn with the
          // immediately-preceding assistant turn in the same
          // conversation (same algorithm as bot-level analyze).
          const byConv: Record<string, any[]> = {}
          for (const r of (cts || []) as any[]) {
            if (!byConv[r.conversation_id]) byConv[r.conversation_id] = []
            byConv[r.conversation_id].push(r)
          }

          for (const convId of Object.keys(byConv)) {
            const c = convById[convId]
            if (!c) continue
            const pid = c.participant_id || c.session_id
            if (!participants[pid]) participants[pid] = []
            const sortedTurns = byConv[convId].sort((a: any, b: any) => a.turn_number - b.turn_number)
            let pendingAssistant: any = null
            for (const ct of sortedTurns) {
              if (ct.role === 'assistant') {
                pendingAssistant = ct
                continue
              }
              // user turn — pair with most recent assistant
              participants[pid].push({
                turn: ct.turn_number,
                bot: pendingAssistant?.content || '',
                user: ct.content,
                user_en: ct.content_en,
                language: ct.language,
                topic: ct.topic_id ? (topicLabel[ct.topic_id] || null) : null,
                source: ct.source,
                skipped: !!ct.skipped,
                time: ct.created_at,
                bot_flags: Array.isArray(pendingAssistant?.content_flags) ? pendingAssistant.content_flags : null,
                user_flags: Array.isArray(ct.content_flags) ? ct.content_flags : null,
                user_sentiment: ct.sentiment || null,
                user_sentiment_score: typeof ct.sentiment_score === 'number' ? ct.sentiment_score : null,
              })
              pendingAssistant = null
            }
          }

          // Capture persona by participant for the per-conversation
          // emit below. Same persona is keyed via session_id → look
          // up the participant via conv.
          for (const c of convs) {
            const pid = c.participant_id || c.session_id
            const p = personaBySession[c.session_id]
            if (p) phase3PersonaByParticipant[pid] = { name: (p as any).name || null, persona: (p as any).persona || null }
          }
        }
      }
    }

    const conversations = Object.entries(participants).map(([pid, pTurns]) => {
      const lastUserMsg = [...pTurns].reverse().find(t => t.user)?.user || ''
      const participantEnded = lastUserMsg.includes('[Done') || lastUserMsg.includes('[done]')
      const pp = phase3PersonaByParticipant[pid]
      return {
        participant_id: pid,
        session_id: params.id,
        session_name: session.name,
        participant_ended: participantEnded,
        turns: pTurns,
        demographics: demoMap[pid] || null,
        psychographics: psychoMap[pid] || null,
        // Phase-3 enrichments — null when participant came from legacy substrate.
        name: pp?.name || null,
        persona: pp?.persona || null,
      }
    })

    const payload = {
      session: {
        name: session.name,
        status: session.status,
        started_at: session.started_at,
        ended_at: session.ended_at,
        config: session.config,
      },
      themes: (themes || []).map(t => ({ id: t.id, label: t.label, source: t.source, state: t.state, sentiment: t.sentiment, keywords: t.keywords })),
      conversations,
      summary: {
        participants: Object.keys(participants).length,
        // Sum user-turn count across all participants. For phase-3 sessions
        // `turns` (the legacy townhall_turns query) is empty; the real count
        // is on the per-participant entries built from conversation_turns.
        total_turns: Object.values(participants).reduce((s: number, ts: any[]) => s + ts.filter(t => t.user).length, 0),
        answered: Object.values(participants).reduce((s: number, ts: any[]) => s + ts.filter(t => !t.skipped && t.user).length, 0),
      },
    }

    const blob = JSON.stringify(payload, null, 2)
    return new NextResponse(blob, {
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="${(session.name || 'townhall').replace(/[^a-z0-9]/gi, '_')}_conversations.json"`,
      },
    });
  }

  return NextResponse.json({ error: 'Unsupported format. Use ?format=csv, ?format=xlsx, ?format=themes, or ?format=json' }, { status: 400 })
}

function buildResponsesSheet(
  turns: any[],
  themeMap: Record<string, string>,
  demoMap: Record<string, Record<string, unknown>>,
  psychoMap: Record<string, Record<string, unknown>>,
  demoKeyArr: string[],
  psychoKeyArr: string[],
): Sheet {
  const headers = [
    'participant_id',
    'turn_number',
    'theme',
    'source',
    'bot_message',
    'user_message',
    'user_message_en',
    'language',
    'sentiment',
    'skipped',
    'timestamp',
    ...demoKeyArr.map(k => 'demo_' + k),
    ...psychoKeyArr.map(k => 'psycho_' + k),
  ]

  const rows = turns.map(t => {
    const text = t.user_message_en || t.user_message || ''
    const score = text ? lexiconScore(text) : { pos: 0, neg: 0 }
    const sentiment = text ? classifySentiment(score.pos, score.neg) : ''
    const demo = demoMap[t.participant_id] || {}
    const psycho = psychoMap[t.participant_id] || {}

    return [
      t.participant_id,
      t.turn_number,
      t.theme_label || (t.theme_id ? themeMap[t.theme_id] || '' : ''),
      t.source || '',
      t.bot_message || '',
      t.user_message || '',
      t.user_message_en || '',
      t.language || '',
      sentiment,
      t.skipped ? 'yes' : 'no',
      t.created_at || '',
      ...demoKeyArr.map(k => demo[k] || ''),
      ...psychoKeyArr.map(k => psycho[k] || ''),
    ]
  })

  return { name: 'Responses', headers, rows }
}

function buildThemesSheet(themes: any[], turns: any[]): Sheet {
  // One row per theme with aggregated stats
  const themeTurnCounts: Record<string, number> = {}
  for (const t of turns) {
    if (t.theme_id && !t.skipped) {
      themeTurnCounts[t.theme_id] = (themeTurnCounts[t.theme_id] || 0) + 1
    }
  }
  const totalResponses = turns.filter(t => !t.skipped && t.user_message).length

  const headers = ['theme', 'source', 'state', 'sentiment', 'response_count', 'percentage', 'keywords']
  const rows = themes.map(t => {
    const count = themeTurnCounts[t.id] || 0
    const pct = totalResponses > 0 ? Math.round(count / totalResponses * 100) : 0
    return [
      t.label,
      t.source,
      t.state,
      t.sentiment || '',
      count,
      pct + '%',
      (t.keywords || []).join('; '),
    ]
  })

  return { name: 'Themes', headers, rows }
}
