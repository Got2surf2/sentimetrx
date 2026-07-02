import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import type { TownHallConfig, TownHallGuideTopic } from '@/lib/types'
import { validateOrgFilter } from '@/lib/orgValidate'
import { recordUserEvent, eventContextFromRequest } from '@/lib/userEvents'
import { listTownHallsAsLegacy } from '@/lib/townHallAdapter'
import { serverError } from '@/lib/apiError'

// GET /api/townhall/sessions — list sessions.
// Non-admin: scoped to user's org. Admin: all orgs by default, narrowed to
// ?org=<id> when supplied (Phase E filter UI).
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = createServiceRoleClient()

  const { data: userData } = await db
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org : (orgRel as any)?.is_admin_org
  const userOrgId = (userData as any)?.org_id as string | null

  const orgFilter = validateOrgFilter(req.nextUrl.searchParams.get('org'))
  const scopeOrgId = isAdmin ? orgFilter : userOrgId

  let q = db
    .from('townhall_sessions')
    .select('id, org_id, name, slug, status, config, discussion_guide, response_counter, started_at, ended_at, created_at, created_by')
    .order('created_at', { ascending: false })
  if (scopeOrgId) q = q.eq('org_id', scopeOrgId)

  const { data, error } = await q
  if (error) return serverError(error, 'townhall.sessions.list', { orgId: scopeOrgId ?? undefined })

  // Get participant + response counts per session. Aggregated in Postgres so it
  // can't silently undercount: the previous approach fetched every turn via
  // .in(...) (capped at 1000 rows) and tallied in JS, so an org with >1000 turns
  // across its listed sessions got wrong numbers. RPC mirrors sql/038.
  const sessionIds = (data || []).map(s => s.id)
  let stats: Record<string, { participants: number; responses: number }> = {}
  if (sessionIds.length > 0) {
    const { data: countRows, error: countErr } = await db
      .rpc('townhall_session_counts_for_ids', { p_session_ids: sessionIds })
    if (!countErr && countRows) {
      for (const r of countRows as { session_id: string; participants: number; responses: number }[]) {
        stats[r.session_id] = { participants: Number(r.participants), responses: Number(r.responses) }
      }
    } else {
      // Fallback if the RPC isn't present yet (pre-sql/146): the old JS tally.
      // Still 1000-row-capped, but no worse than before — remove once applied.
      const { data: turnData } = await db
        .from('townhall_turns')
        .select('session_id, participant_id, skipped, user_message')
        .in('session_id', sessionIds)
      for (const sid of sessionIds) {
        const sessionTurns = (turnData || []).filter(t => t.session_id === sid)
        stats[sid] = {
          participants: new Set(sessionTurns.map(t => t.participant_id)).size,
          responses: sessionTurns.filter(t => !t.skipped && t.user_message).length,
        }
      }
    }
  }

  // Resolve org names for admin per-card display.
  let orgNameMap: Record<string, string> = {}
  if (isAdmin) {
    const orgIds = Array.from(new Set((data || []).map((s: any) => s.org_id).filter(Boolean)))
    if (orgIds.length > 0) {
      const { data: orgs } = await db.from('organizations').select('id, name').in('id', orgIds)
      ;(orgs || []).forEach((o: any) => { orgNameMap[o.id] = o.name })
    }
  }

  const enriched = (data || []).map(s => ({
    ...s,
    participants: stats[s.id]?.participants || 0,
    turns: stats[s.id]?.responses || 0,
    org_name: isAdmin ? (orgNameMap[(s as any).org_id] || null) : null,
  }))

  // Phase 5 commit 6: surface new-substrate town_halls rows alongside
  // legacy townhall_sessions. Same JSON shape — facilitator list UI
  // doesn't need to know which substrate a row came from.
  // docs/CONVERGENCE.md § 4 Phase 5 + docs/CONVERGENCE.md § 10 changelog.
  const newSubstrate = await listTownHallsAsLegacy(db, scopeOrgId)
  if (newSubstrate.length > 0 && isAdmin) {
    // Admin view shows org name per row — fetch any orgs we haven't already.
    const newOrgIds = Array.from(new Set(newSubstrate.map(s => s.org_id).filter(Boolean)))
    const missing = newOrgIds.filter(id => !orgNameMap[id])
    if (missing.length > 0) {
      const { data: moreOrgs } = await db.from('organizations').select('id, name').in('id', missing)
      ;(moreOrgs || []).forEach((o: any) => { orgNameMap[o.id] = o.name })
    }
    for (const row of newSubstrate) row.org_name = orgNameMap[row.org_id] || null
  }

  const merged = [...enriched, ...newSubstrate].sort((a, b) =>
    (b.created_at || '') > (a.created_at || '') ? 1 : -1
  )

  return NextResponse.json(merged)
}

// POST /api/townhall/sessions — create a new session
export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
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

  if (error) return serverError(error, 'townhall.sessions.create', { orgId: userData?.org_id })

  const { ip, userAgent } = eventContextFromRequest(req)
  await recordUserEvent({
    userId: user.id, orgId: (userData as { org_id?: string | null } | null)?.org_id || null,
    event: 'townhall_created',
    metadata: { session_id: data.id, slug: data.slug, name: body.name },
    ip, userAgent,
  })

  return NextResponse.json(data, { status: 201 })
}
