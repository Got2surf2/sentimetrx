// app/api/townhall/sessions/[id]/export/route.ts
// GET ?format=csv — export Town Hall responses + themes + demo/psycho data

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { lexiconScore, classifySentiment } from '@/lib/themeUtils'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceRoleClient()
  const format = req.nextUrl.searchParams.get('format') || 'csv'

  // Fetch session
  const { data: session } = await db
    .from('townhall_sessions')
    .select('name, status, config, started_at, ended_at')
    .eq('id', params.id)
    .single()

  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  // Fetch themes
  const { data: themes } = await db
    .from('townhall_themes')
    .select('id, label, source, state, sentiment, keywords')
    .eq('session_id', params.id)
    .order('sort_order', { ascending: true })

  const themeMap: Record<string, string> = {}
  for (const t of themes || []) themeMap[t.id] = t.label

  // Fetch all turns
  const { data: turns } = await db
    .from('townhall_turns')
    .select('participant_id, turn_number, bot_message, user_message, user_message_en, language, theme_id, source, skipped, created_at')
    .eq('session_id', params.id)
    .order('created_at', { ascending: true })
    .range(0, 49999)

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

  if (!turns || turns.length === 0) {
    return new NextResponse('No responses to export\n', { status: 200, headers: { 'Content-Type': 'text/csv' } })
  }

  if (format === 'csv') {
    return buildCsv(session, turns, themeMap, demoMap, psychoMap, demoKeyArr, psychoKeyArr)
  }

  if (format === 'themes') {
    return buildThemesCsv(session, themes || [], turns)
  }

  return NextResponse.json({ error: 'Unsupported format. Use ?format=csv or ?format=themes' }, { status: 400 })
}

function esc(v: unknown): string {
  const s = v == null ? '' : String(v).trim()
  return /[,"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function buildCsv(
  session: any,
  turns: any[],
  themeMap: Record<string, string>,
  demoMap: Record<string, Record<string, unknown>>,
  psychoMap: Record<string, Record<string, unknown>>,
  demoKeyArr: string[],
  psychoKeyArr: string[],
) {
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
      esc(t.participant_id),
      esc(t.turn_number),
      esc(t.theme_id ? themeMap[t.theme_id] || '' : ''),
      esc(t.source || ''),
      esc(t.bot_message || ''),
      esc(t.user_message || ''),
      esc(t.user_message_en || ''),
      esc(t.language || ''),
      esc(sentiment),
      esc(t.skipped ? 'yes' : 'no'),
      esc(t.created_at || ''),
      ...demoKeyArr.map(k => esc(demo[k] || '')),
      ...psychoKeyArr.map(k => esc(psycho[k] || '')),
    ].join(',')
  })

  const csv = [headers.join(','), ...rows].join('\n')
  const safeName = (session.name || 'townhall').replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}-responses-${date}.csv"`,
    },
  })
}

function buildThemesCsv(session: any, themes: any[], turns: any[]) {
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
      esc(t.label),
      esc(t.source),
      esc(t.state),
      esc(t.sentiment || ''),
      esc(count),
      esc(pct + '%'),
      esc((t.keywords || []).join('; ')),
    ].join(',')
  })

  const csv = [headers.join(','), ...rows].join('\n')
  const safeName = (session.name || 'townhall').replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeName}-themes-${date}.csv"`,
    },
  })
}
