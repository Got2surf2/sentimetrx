// app/api/share/route.ts
// POST — create a shareable link for a study or campaign
// GET  — validate a share token and return data

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { type, target_id, expires_in } = body
  if (!type || !target_id) return NextResponse.json({ error: 'type and target_id required' }, { status: 400 })
  if (!['study', 'campaign'].includes(type)) return NextResponse.json({ error: 'type must be study or campaign' }, { status: 400 })

  // Calculate expiry
  const expiryHours: Record<string, number> = { '24h': 24, '7d': 168, '30d': 720 }
  const hours = expiryHours[expires_in] || 168 // default 7 days
  const expiresAt = new Date(Date.now() + hours * 3600 * 1000)

  const service = createServiceRoleClient()

  const { data, error } = await service
    .from('shared_links')
    .insert({
      type,
      target_id,
      created_by: user.id,
      expires_at: expiresAt.toISOString(),
    })
    .select('token, expires_at')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
  const shareUrl = `${baseUrl}/shared/${data.token}`

  return NextResponse.json({ url: shareUrl, token: data.token, expires_at: data.expires_at }, { status: 201 })
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  const listType = req.nextUrl.searchParams.get('list_type')
  const listTargetId = req.nextUrl.searchParams.get('list_target_id')

  // List active links for a target (requires auth)
  if (listType && listTargetId) {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const service = createServiceRoleClient()
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'

    const { data: links } = await service
      .from('shared_links')
      .select('token, expires_at, created_at')
      .eq('type', listType)
      .eq('target_id', listTargetId)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })

    const items = (links || []).map(l => ({
      url: `${baseUrl}/shared/${l.token}`,
      token: l.token,
      expires_at: l.expires_at,
      created_at: l.created_at,
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

  if (!link) return NextResponse.json({ error: 'Invalid share link' }, { status: 404 })

  if (new Date(link.expires_at) < new Date()) {
    return NextResponse.json({ error: 'This share link has expired' }, { status: 410 })
  }

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

    return NextResponse.json({
      type: 'study', study, responses: responses || [], expires_at: link.expires_at,
      ratingScale, ratingLabel, npsEnabled, experienceEnabled,
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

  return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
}
