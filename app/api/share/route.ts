// app/api/share/route.ts
// POST   — create a shareable link for a study, campaign, or townhall session
// GET    — validate a share token and return data, or list active links
// DELETE — revoke a share link by token

import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { recordUserEvent, eventContextFromRequest } from '@/lib/userEvents'

export const dynamic = 'force-dynamic'

type ShareType = 'study' | 'campaign' | 'townhall' | 'conversation' | 'analytics'

async function getUserOrg(service: ReturnType<typeof createServiceRoleClient>, userId: string) {
  const { data: userData } = await service
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', userId)
    .single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!(orgRel as any)?.is_admin_org
  const orgId = (userData as any)?.org_id as string | null
  return { orgId, isAdmin }
}

// Returns the org_id that owns the share target, or null if the target is unknown.
// For `conversation`, target_id is either a bot id (bot conversations page) or a
// response id (study response sharing); we try both.
async function resolveTargetOrgId(service: ReturnType<typeof createServiceRoleClient>, type: ShareType, targetId: string): Promise<string | null> {
  if (type === 'study') {
    const { data } = await service.from('studies').select('org_id').eq('id', targetId).single()
    return (data as any)?.org_id ?? null
  }
  if (type === 'campaign') {
    const { data } = await service.from('campaigns').select('org_id').eq('id', targetId).single()
    return (data as any)?.org_id ?? null
  }
  if (type === 'townhall') {
    const { data } = await service.from('townhall_sessions').select('org_id').eq('id', targetId).single()
    return (data as any)?.org_id ?? null
  }
  if (type === 'analytics') {
    const { data } = await service.from('datasets').select('org_id').eq('id', targetId).single()
    return (data as any)?.org_id ?? null
  }
  if (type === 'conversation') {
    const { data: bot } = await service.from('bots').select('org_id').eq('id', targetId).maybeSingle()
    if ((bot as any)?.org_id) return (bot as any).org_id as string
    const { data: resp } = await service
      .from('responses')
      .select('studies(org_id)')
      .eq('id', targetId)
      .maybeSingle()
    const s = (resp as any)?.studies
    const orgId = Array.isArray(s) ? s[0]?.org_id : s?.org_id
    return orgId ?? null
  }
  return null
}

async function gateShareTarget(service: ReturnType<typeof createServiceRoleClient>, userId: string, type: ShareType, targetId: string): Promise<{ ok: true; targetOrgId: string } | { ok: false; status: number; error: string }> {
  const { orgId, isAdmin } = await getUserOrg(service, userId)
  if (!orgId) return { ok: false, status: 401, error: 'Unauthorized' }
  const targetOrg = await resolveTargetOrgId(service, type, targetId)
  if (!targetOrg) return { ok: false, status: 404, error: 'Target not found' }
  if (!isAdmin && targetOrg !== orgId) return { ok: false, status: 403, error: 'Forbidden' }
  return { ok: true, targetOrgId: targetOrg }
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 30 share links per hour per user. Anyone clicking around will never
  // hit this; an attacker who steals a session and tries to flood public
  // share URLs gets stopped quickly.
  const rl = await checkRateLimit('share:create:' + user.id, 30, 60 * 60 * 1000)
  if (rl.limited) return NextResponse.json({ error: 'Too many share links — try again later' }, { status: 429 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { type, target_id, expires_in } = body
  if (!type || !target_id) return NextResponse.json({ error: 'type and target_id required' }, { status: 400 })
  if (!['study', 'campaign', 'townhall', 'conversation', 'analytics'].includes(type)) return NextResponse.json({ error: 'type must be study, campaign, townhall, conversation, or analytics' }, { status: 400 })

  const service = createServiceRoleClient()

  const gate = await gateShareTarget(service, user.id, type as ShareType, String(target_id))
  if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

  // For conversation shares, store the rendered HTML in metadata. If the caller
  // is a superadmin and passed an additional html_labeled (the same chat with
  // intent/sentiment/action annotations), store that too — the shared page
  // surfaces a Plain | Labeled toggle when html_labeled is present.
  if (type === 'conversation' && body.html) {
    const expiryHours2: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720 }
    const hours2 = expiryHours2[expires_in] || 168
    const expiresAt2 = new Date(Date.now() + hours2 * 3600 * 1000)
    let html_labeled: string | undefined
    if (body.html_labeled) {
      const { data: caller } = await service.from('users').select('is_superadmin').eq('id', user.id).single()
      if ((caller as any)?.is_superadmin === true) html_labeled = String(body.html_labeled)
    }
    const meta: Record<string, unknown> = { html: body.html }
    if (html_labeled) meta.html_labeled = html_labeled
    const { data: convData, error: convErr } = await service
      .from('shared_links')
      .insert({ type: 'conversation', target_id, org_id: gate.targetOrgId, created_by: user.id, expires_at: expiresAt2.toISOString(), metadata: meta })
      .select('token, expires_at')
      .single()
    if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 })
    const baseUrl2 = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
    {
      const { ip, userAgent } = eventContextFromRequest(req)
      await recordUserEvent({ userId: user.id, orgId: gate.targetOrgId, event: 'share_created', metadata: { type: 'conversation', target_id }, ip, userAgent })
    }
    return NextResponse.json({ url: `${baseUrl2}/shared/conversation/${convData.token}`, token: convData.token, expires_at: convData.expires_at }, { status: 201 })
  }

  // For analytics shares, store filter criteria in metadata
  if (type === 'analytics' && body.metadata) {
    const expiryHours2: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720 }
    const hours2 = expiryHours2[expires_in] || 168
    const expiresAt2 = new Date(Date.now() + hours2 * 3600 * 1000)
    const { data: aData, error: aErr } = await service
      .from('shared_links')
      .insert({ type: 'analytics', target_id, org_id: gate.targetOrgId, created_by: user.id, expires_at: expiresAt2.toISOString(), metadata: body.metadata })
      .select('token, expires_at')
      .single()
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })
    const baseUrl2 = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
    {
      const { ip, userAgent } = eventContextFromRequest(req)
      await recordUserEvent({ userId: user.id, orgId: gate.targetOrgId, event: 'share_created', metadata: { type: 'analytics', target_id }, ip, userAgent })
    }
    return NextResponse.json({ url: `${baseUrl2}/shared/${aData.token}`, token: aData.token, expires_at: aData.expires_at }, { status: 201 })
  }

  // Calculate expiry
  const expiryHours: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720 }
  const hours = expiryHours[expires_in] || 168 // default 7 days
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000)

  const { data, error } = await service
    .from('shared_links')
    .insert({
      type,
      target_id,
      org_id: gate.targetOrgId,
      created_by: user.id,
      expires_at: expiresAt.toISOString(),
    })
    .select('token, expires_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
  const shareUrl = `${baseUrl}/shared/${data.token}`

  {
    const { ip, userAgent } = eventContextFromRequest(req)
    await recordUserEvent({ userId: user.id, orgId: gate.targetOrgId, event: 'share_created', metadata: { type, target_id }, ip, userAgent })
  }

  return NextResponse.json({ url: shareUrl, token: data.token, expires_at: data.expires_at }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const listType = req.nextUrl.searchParams.get('list_type')
  const listTargetId = req.nextUrl.searchParams.get('list_target_id')

  // List active links for a target (requires auth + access to the target)
  if (listType && listTargetId) {
    const supabase = createClient()
    const user = await getAuthUser(supabase)
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = createServiceRoleClient()

    if (!['study', 'campaign', 'townhall', 'conversation', 'analytics'].includes(listType)) {
      return NextResponse.json({ error: 'invalid list_type' }, { status: 400 })
    }
    const gate = await gateShareTarget(service, user.id, listType as ShareType, listTargetId)
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status })

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'

    const { data: links } = await service
      .from('shared_links')
      .select('token, expires_at, created_at, last_accessed_at')
      .eq('type', listType)
      .eq('target_id', listTargetId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    const items = (links || []).map(l => ({
      url: `${baseUrl}/shared/${l.token}`,
      token: l.token,
      expires_at: l.expires_at,
      created_at: l.created_at,
      last_accessed_at: l.last_accessed_at,
    }))

    return NextResponse.json({ links: items })
  }

  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const service = createServiceRoleClient()

  const { data: link } = await service
    .from('shared_links')
    .select('*')
    .eq('token', token)
    .single()

  if (!link) {
    return new NextResponse(JSON.stringify({ error: 'Invalid share link' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, no-cache, must-revalidate' },
    })
  }

  if (new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This share link has expired' }, { status: 410 })
  }

  // Record access timestamp (fire-and-forget)
  service.from('shared_links').update({ last_accessed_at: new Date().toISOString() }).eq('token', token).then(() => {})

  // Fetch the data based on type
  if (link.type === 'study') {
    const { data: study } = await service
      .from('studies')
      .select('id, name, bot_name, bot_emoji, status, config')
      .eq('id', link.target_id)
      .single()

    if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

    // Fetch response stats
    const { data: responses } = await service
      .from('responses')
      .select('sentiment, experience_score, nps_score, status, completed_at, duration_sec')
      .eq('study_id', link.target_id)

    // Extract config details for intelligent labeling
    const config = study.config || {}
    const ratingScale = config.ratingScale || []
    const ratingLabel = config.experienceRatingLabel || null
    const npsEnabled = config.npsEnabled !== false
    const experienceEnabled = config.experienceEnabled !== false
    const ratingPrompt = config.ratingPrompt || null
    const npsPrompt = config.npsPrompt || null

    // Fetch themes from dataset_state (pre-computed, no raw text exposed)
    let themesSummary: any[] = []
    const { data: dsRow } = await service
      .from('datasets')
      .select('id')
      .eq('study_id', link.target_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()
    if (dsRow) {
      const { data: stateRow } = await service
        .from('dataset_state')
        .select('theme_model')
        .eq('dataset_id', dsRow.id)
        .single()
      const tm = stateRow?.theme_model as any
      if (tm?.themes?.length > 0) {
        const totalCount = (responses || []).length
        themesSummary = tm.themes.map((t: any) => ({
          name: t.name,
          description: t.description || '',
          keywords: (t.keywords || []).slice(0, 6),
          sentiment: t.sentiment || 'neutral',
          count: t.count || 0,
          percentage: t.percentage || (totalCount > 0 ? Math.round((t.count || 0) / totalCount * 100) : 0),
          avgRating: t.avgRating ?? null,
          ratingDelta: t.ratingDelta ?? null,
        }))
      }
    }

    return NextResponse.json({
      type: 'study', study, responses: responses || [], expires_at: link.expires_at,
      ratingScale, ratingLabel, npsEnabled, experienceEnabled, ratingPrompt, npsPrompt,
      themes: themesSummary,
    })
  }

  if (link.type === 'campaign') {
    const { data: campaign } = await service
      .from('campaigns')
      .select('id, name, status, target_responses, study_url, created_at')
      .eq('id', link.target_id)
      .single()

    if (!campaign) return NextResponse.json({ error: 'Campaign not found' }, { status: 404 })

    const { data: respondents } = await service
      .from('campaign_respondents')
      .select('status')
      .eq('campaign_id', link.target_id)

    const counts = { total: 0, pending: 0, sent: 0, opened: 0, clicked: 0, completed: 0, bounced: 0, unsubscribed: 0 }
    for (const r of (respondents || [])) {
      counts.total++
      const s = r.status as keyof typeof counts
      if (s in counts) counts[s]++
    }

    return NextResponse.json({ type: 'campaign', campaign, stats: counts, expires_at: link.expires_at })
  }

  if (link.type === 'townhall') {
    const { data: session } = await service.from('townhall_sessions').select('id, name, status, config, started_at, ended_at').eq('id', link.target_id).single()
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
    const cfg = session.config as any

    // Fetch themes (non-dismissed)
    const { data: themes } = await service.from('townhall_themes').select('id, label, description, source, state, keywords, sentiment, response_count, response_target, mention_count, example_quote').eq('session_id', link.target_id).neq('state', 'dismissed').order('response_count', { ascending: false })

    // Fetch turn stats (aggregated only — no individual data)
    const { data: turns } = await service.from('townhall_turns').select('participant_id, skipped, user_message').eq('session_id', link.target_id)
    const allTurns = turns || []
    const participants = new Set(allTurns.map((t: any) => t.participant_id))
    const answered = allTurns.filter((t: any) => !t.skipped && t.user_message)
    const totalResponses = answered.length
    const avgWords = totalResponses > 0 ? Math.round(answered.reduce((s: number, t: any) => s + (t.user_message?.split(/\s+/).length || 0), 0) / totalResponses) : 0

    return NextResponse.json({
      type: 'townhall',
      session: { name: session.name, bot_emoji: cfg?.bot_emoji || '', status: session.status, started_at: session.started_at, ended_at: session.ended_at },
      themes: (themes || []).map((t: any) => ({
        label: t.label, source: t.source, state: t.state, keywords: t.keywords || [],
        sentiment: t.sentiment || 'neutral', response_count: t.response_count || 0,
        percentage: totalResponses > 0 ? Math.round((t.mention_count || t.response_count || 0) / totalResponses * 100) : 0,
        example_quote: t.example_quote || '',
      })),
      stats: { participants: participants.size, responses: totalResponses, avg_words: avgWords },
      expires_at: link.expires_at,
    })
  }

  if (link.type === 'analytics') {
    // Return minimal info — the heavy lifting is done by /api/share/analytics
    return NextResponse.json({
      type: 'analytics',
      metadata: link.metadata,
      expires_at: link.expires_at,
    })
  }

  return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
}

export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'token required' }, { status: 400 })

  const service = createServiceRoleClient()

  // Look up the share before deleting so we can authorize the revoke.
  const { data: existing } = await service
    .from('shared_links')
    .select('id, type, target_id, created_by')
    .eq('token', token)
    .single()

  if (!existing) return NextResponse.json({ error: 'Link not found' }, { status: 404 })

  // Allow revoke if the user created the share, or if they have access to the
  // underlying target (org match or admin). Without this, any authed user
  // could enumerate tokens and revoke any other org's links.
  const { orgId, isAdmin } = await getUserOrg(service, user.id)
  let allowed = isAdmin || existing.created_by === user.id
  if (!allowed && orgId) {
    const targetOrg = await resolveTargetOrgId(service, existing.type as ShareType, existing.target_id as string)
    if (targetOrg && targetOrg === orgId) allowed = true
  }
  if (!allowed) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { error } = await service
    .from('shared_links')
    .delete()
    .eq('token', token)

  if (error) {
    console.error({ at: 'share', msg: "delete error", err: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted: true })
}
