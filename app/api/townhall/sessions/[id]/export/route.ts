// app/api/townhall/sessions/[id]/export/route.ts
// GET ?format=csv|xlsx|themes|json — export Town Hall responses + themes + demo/psycho data
// XLSX bundles responses + themes into separate sheets; CSV emits one or the other.

import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { lexiconScore, classifySentiment } from '@/lib/themeUtils'
import { dataResponse, type Sheet } from '@/lib/xlsxExport'
import { projectHallAsSession, resolveTownHall, fetchTopicsAsThemes, fetchTurnsAsLegacy, fetchAllRows } from '@/lib/townHallAdapter'

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

  // Tranche 2 (docs/CONVERGENCE.md § 4.2): pulseiq_sessions only (uuid or
  // slug) — the legacy townhall_sessions leg is retired. Sessions, themes
  // and turns are projected into the legacy shapes the sheet builders and
  // json consumers already understand.
  const hall = await resolveTownHall(db, params.id)
  if (!hall) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!isAdmin && hall.org_id !== orgId) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  const projected = projectHallAsSession(hall)
  const session: { name: string; status: string; config: any; started_at: string | null; ended_at: string | null } = {
    name: projected.name,
    status: projected.status,
    config: projected.config,
    started_at: projected.started_at,
    ended_at: projected.ended_at,
  }

  // Fetch themes (legacy-projected pulseiq_topics)
  const themes = await fetchTopicsAsThemes(db, hall.id, hall.org_id)

  const themeMap: Record<string, string> = {}
  for (const t of themes) themeMap[t.id] = t.label

  // Round-based pacing: per-theme round + the round's tasting-item name, so
  // exports can group/label by item. Inert (no extra columns) in open mode.
  const roundsMode = session.config?.pacing_mode === 'rounds'
  const roundItems: Record<number, string> = {}
  for (const r of (session.config?.rounds || [])) if (r?.number != null) roundItems[r.number] = r.item_name || ''
  const themeRound: Record<string, number | null> = {}
  for (const t of themes) themeRound[t.id] = t.round_number ?? null

  // Fetch all turns, projected into the legacy townhall_turns row shape.
  const turns = await fetchTurnsAsLegacy(db, hall.id, hall.org_id)

  // Fetch participant post-session responses (phase-3 storage column)
  const { data: postResponses } = await db
    .from('townhall_participant_responses')
    .select('participant_id, psychographics, demographics, submitted_at')
    .eq('town_hall_id', hall.id)

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

  if (turns.length === 0 && format !== 'json') {
    return new NextResponse('No responses to export\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
  }

  if (format === 'csv' || format === 'xlsx') {
    const safeName = (session.name || 'townhall').replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const date = new Date().toISOString().slice(0, 10)
    const responses = buildResponsesSheet(turns, themeMap, demoMap, psychoMap, demoKeyArr, psychoKeyArr, roundsMode ? { themeRound, roundItems } : null)
    if (format === 'xlsx') {
      // XLSX bundles both responses and theme summary into one workbook.
      const themesSheet = buildThemesSheet(themes || [], turns, roundsMode ? roundItems : null)
      return dataResponse('xlsx', safeName + '-export-' + date, [responses, themesSheet])
    }
    return dataResponse('csv', safeName + '-responses-' + date, [responses])
  }

  if (format === 'themes') {
    const safeName = (session.name || 'townhall').replace(/[^a-z0-9]/gi, '-').toLowerCase()
    const date = new Date().toISOString().slice(0, 10)
    return dataResponse('csv', safeName + '-themes-' + date, [buildThemesSheet(themes || [], turns, roundsMode ? roundItems : null)])
  }

  if (format === 'json') {
    // Built from conversation_turns below (flags + sentiment + personas).
    // The legacy-turns seeding loop is gone (tranche 2) — `turns` is now
    // itself a projection of conversation_turns, so seeding from it would
    // double-count every exchange.
    const participants: Record<string, any[]> = {}

    const phase3PersonaByParticipant: Record<string, { name: string | null; persona: any }> = {}
    {
        // Pull conversations linked to this town hall (paged — PostgREST
        // caps a single select at 1000 rows regardless of .limit())
        const linkRows = await fetchAllRows<any>((from, to) => db
          .from('pulseiq_session_conversations')
          .select('conversation_id, conversations!inner(id, session_id, participant_id, org_id, bot_id)')
          .eq('town_hall_id', hall.id)
          .eq('org_id', hall.org_id)
          .order('conversation_id', { ascending: true })
          .range(from, to), 5000)
        const convs = linkRows
          .map(r => Array.isArray(r.conversations) ? r.conversations[0] : r.conversations)
          .filter(Boolean)

        if (convs.length > 0) {
          const convById: Record<string, any> = {}
          for (const c of convs) convById[c.id] = c

          // All turns across the hall's conversations, via the stamped
          // town_hall_id column — the old `.in(conversation_id, convIds)`
          // broke at a few hundred participants on URL length. The link
          // fetch above stays for participant/persona attribution (convById).
          // Paged — the unbounded select was silently capped at 1000 rows.
          const cts = await fetchAllRows<any>((from, to) => db
            .from('conversation_turns')
            .select('id, conversation_id, turn_number, role, content, content_en, language, source, content_flags, sentiment, sentiment_score, topic_id, skipped, created_at')
            .eq('town_hall_id', hall.id)
            .eq('org_id', hall.org_id)
            .order('conversation_id', { ascending: true })
            .order('turn_number', { ascending: true })
            .range(from, to), 50000)

          // Topic label lookup
          const topicIds = Array.from(new Set(cts.map(c => c.topic_id).filter(Boolean)))
          const topicLabel: Record<string, string> = {}
          if (topicIds.length > 0) {
            const { data: thts } = await db.from('pulseiq_topics').select('id, label').in('id', topicIds)
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
          for (const r of cts) {
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
            let exchangeNo = 0
            for (const ct of sortedTurns) {
              if (ct.role === 'assistant') {
                pendingAssistant = ct
                continue
              }
              // user turn — pair with most recent assistant. `turn` counts
              // exchanges (1,2,3,…), matching the legacy export semantics.
              exchangeNo += 1
              participants[pid].push({
                turn: exchangeNo,
                bot: pendingAssistant?.content || '',
                user: ct.content,
                user_en: ct.content_en,
                language: ct.language,
                topic: ct.topic_id ? (topicLabel[ct.topic_id] || null) : null,
                source: pendingAssistant?.source ?? ct.source,
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
      themes: (themes || []).map(t => ({ id: t.id, label: t.label, source: t.source, state: t.state, sentiment: t.sentiment, keywords: t.keywords, ...(roundsMode ? { round: (t as any).round_number ?? null, item: (t as any).round_number != null ? (roundItems[(t as any).round_number] || null) : null } : {}) })),
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
  // Non-null only in round-based pacing — adds round + tasting-item columns.
  rounds: { themeRound: Record<string, number | null>; roundItems: Record<number, string> } | null,
): Sheet {
  const headers = [
    'participant_id',
    'turn_number',
    ...(rounds ? ['round', 'item'] : []),
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
    const round = rounds && t.theme_id ? rounds.themeRound[t.theme_id] ?? null : null

    return [
      t.participant_id,
      t.turn_number,
      ...(rounds ? [round ?? '', round != null ? (rounds.roundItems[round] || '') : ''] : []),
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

function buildThemesSheet(themes: any[], turns: any[], roundItems: Record<number, string> | null): Sheet {
  // One row per theme with aggregated stats
  const themeTurnCounts: Record<string, number> = {}
  for (const t of turns) {
    if (t.theme_id && !t.skipped) {
      themeTurnCounts[t.theme_id] = (themeTurnCounts[t.theme_id] || 0) + 1
    }
  }
  const totalResponses = turns.filter(t => !t.skipped && t.user_message).length

  // In round-based pacing, group the sheet by round (item) for the per-item roll-up.
  const ordered = roundItems
    ? [...themes].sort((a, b) => (a.round_number ?? 1e9) - (b.round_number ?? 1e9))
    : themes

  const headers = [
    ...(roundItems ? ['round', 'item'] : []),
    'theme', 'source', 'state', 'sentiment', 'response_count', 'percentage', 'keywords',
  ]
  const rows = ordered.map(t => {
    const count = themeTurnCounts[t.id] || 0
    const pct = totalResponses > 0 ? Math.round(count / totalResponses * 100) : 0
    return [
      ...(roundItems ? [t.round_number ?? '', t.round_number != null ? (roundItems[t.round_number] || '') : ''] : []),
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
