import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { TownHallConfig, TownHallGuideTopic } from '@/lib/types'

// GET /api/townhall/sessions — list sessions for current user's org
export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceRoleClient()

  const { data, error } = await db
    .from('townhall_sessions')
    .select('id, name, slug, status, config, discussion_guide, response_counter, started_at, ended_at, created_at, created_by')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Get participant + turn counts per session
  const sessionIds = (data || []).map(s => s.id)
  let stats: Record<string, { participants: number; turns: number }> = {}
  if (sessionIds.length > 0) {
    const { data: turnData } = await db
      .from('townhall_turns')
      .select('session_id, participant_id')
      .in('session_id', sessionIds)

    for (const sid of sessionIds) {
      const sessionTurns = (turnData || []).filter(t => t.session_id === sid)
      const uniqueParticipants = new Set(sessionTurns.map(t => t.participant_id))
      stats[sid] = { participants: uniqueParticipants.size, turns: sessionTurns.length }
    }
  }

  const enriched = (data || []).map(s => ({
    ...s,
    participants: stats[s.id]?.participants || 0,
    turns: stats[s.id]?.turns || 0,
  }))

  return NextResponse.json(enriched)
}

// POST /api/townhall/sessions — create a new session
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceRoleClient()

  const { data: userData } = await db
    .from('users')
    .select('client_id, org_id')
    .eq('id', user.id)
    .single()

  let body: { name: string; slug?: string; config: TownHallConfig; discussion_guide: TownHallGuideTopic[] }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { name, config, discussion_guide } = body
  if (!name || !config || !discussion_guide) {
    return NextResponse.json({ error: 'Missing required fields: name, config, discussion_guide' }, { status: 400 })
  }

  // Validate slug if provided
  let slug: string | null = null
  if (body.slug && typeof body.slug === 'string' && body.slug.trim()) {
    slug = body.slug.toLowerCase().trim()
    const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/
    if (!SLUG_REGEX.test(slug)) {
      return NextResponse.json({ error: 'Link must be 3-50 characters: lowercase letters, numbers, and hyphens only' }, { status: 400 })
    }
    const { data: conflict } = await db.from('townhall_sessions').select('id').eq('slug', slug).limit(1)
    if (conflict && conflict.length > 0) {
      return NextResponse.json({ error: 'This link is already taken' }, { status: 409 })
    }
  }

  const insertData: Record<string, unknown> = {
    org_id: userData?.org_id || userData?.client_id || '',
    created_by: user.id,
    name,
    config,
    discussion_guide,
    status: 'setup',
  }
  if (slug) insertData.slug = slug

  const { data, error } = await db
    .from('townhall_sessions')
    .insert(insertData)
    .select('id, slug')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
