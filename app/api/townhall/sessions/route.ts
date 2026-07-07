import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
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
  type OrgRel = { is_admin_org: boolean | null }
  type UserOrgRow = { org_id: string | null; organizations: OrgRel | OrgRel[] | null }
  const orgRel = (userData as UserOrgRow | null)?.organizations
  const isAdmin = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org : orgRel?.is_admin_org
  const userOrgId = (userData as UserOrgRow | null)?.org_id ?? null

  const orgFilter = validateOrgFilter(req.nextUrl.searchParams.get('org'))
  const scopeOrgId = isAdmin ? orgFilter : userOrgId

  // Tranche 2 (docs/CONVERGENCE.md § 4.2): the list serves pulseiq_sessions
  // rows projected into the JSON shape the facilitator list UI consumes.
  const sessions = await listTownHallsAsLegacy(db, scopeOrgId)
  if (sessions === null) {
    return serverError(new Error('pulseiq_sessions list query failed'), 'townhall.sessions.list', { orgId: scopeOrgId ?? undefined })
  }

  // Resolve org names for admin per-card display.
  if (sessions.length > 0 && isAdmin) {
    const orgNameMap: Record<string, string> = {}
    const orgIds = Array.from(new Set(sessions.map(s => s.org_id).filter(Boolean)))
    if (orgIds.length > 0) {
      const { data: orgs } = await db.from('organizations').select('id, name').in('id', orgIds)
      ;((orgs || []) as { id: string; name: string }[]).forEach(o => { orgNameMap[o.id] = o.name })
    }
    for (const row of sessions) row.org_name = orgNameMap[row.org_id] || null
  }

  return NextResponse.json(sessions)
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

  // Sessions are born on the unified substrate: pulseiq_sessions + a
  // dedicated agent (the substrate's core idea — a session wraps an agent).
  const orgId = (userData?.org_id || userData?.client_id || '') as string

  // Slug is required on pulseiq_sessions — validate, or derive from name.
  const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/
  let slug: string
  if (body.slug && typeof body.slug === 'string' && body.slug.trim()) {
    slug = body.slug.toLowerCase().trim()
    if (!SLUG_REGEX.test(slug)) {
      return NextResponse.json({ error: 'Link must be 3-50 characters: lowercase letters, numbers, and hyphens only' }, { status: 400 })
    }
  } else {
    const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'pulseiq'
    slug = base + '-' + Math.random().toString(36).slice(2, 7)
  }
  const { data: slugConflict } = await db.from('pulseiq_sessions').select('id').eq('slug', slug).limit(1)
  if ((slugConflict?.length || 0) > 0) {
    return NextResponse.json({ error: 'This link is already taken' }, { status: 409 })
  }

  // Dedicated agent for the session (the substrate's core idea: a session
  // wraps an agent). Built from the wizard's persona-shaped fields.
  //
  // status 'paused' + config.pulseiq_dedicated are deliberate: the public
  // agent widget (/b/[slug]) only serves status='active', so a paused
  // dedicated agent is never publicly chattable outside the session's own
  // lifecycle gates — the PulseIQ chat path resolves it by bot_id and
  // ignores agent status (the SESSION status governs). The marker lets
  // session DELETE distinguish a dedicated agent (safe to remove) from a
  // real linked agent like Sarina (never removed).
  const cfg = config
  const eventDesc = cfg?.context?.event_description || ''
  const agentInsert: Record<string, unknown> = {
    org_id: orgId,
    created_by: user.id,
    name: (cfg?.bot_name || name) + '',
    slug: slug + '-agent',
    status: 'paused',
    config: { pulseiq_dedicated: true },
    personality: 'Warm, curious facilitator' + (cfg?.context?.tone ? ' — tone: ' + cfg.context.tone : '') + '. Keeps questions short and conversational, one at a time. Never lectures.',
    system_prompt: 'You facilitate a live group feedback session' + (eventDesc ? ' about: ' + eventDesc : '') + '. Draw out specific, honest feedback. Keep replies brief.',
    sensitive_topics: cfg?.context?.sensitive_topics || [],
  }
  // agents.slug is globally UNIQUE and survives session deletion history —
  // on collision, retry once with a random suffix (the slug is internal:
  // dedicated agents are never served publicly).
  let agentRow: { id: string } | null = null
  {
    const { data, error: agentErr } = await db.from('agents').insert(agentInsert).select('id').single()
    if (data) agentRow = data
    else if (agentErr && /duplicate key|unique constraint/i.test(agentErr.message || '')) {
      agentInsert.slug = slug + '-agent-' + Math.random().toString(36).slice(2, 7)
      const { data: retry, error: retryErr } = await db.from('agents').insert(agentInsert).select('id').single()
      if (retryErr) return serverError(retryErr, 'townhall.sessions.create.agent', { orgId })
      agentRow = retry
    } else {
      return serverError(agentErr, 'townhall.sessions.create.agent', { orgId })
    }
  }

  // cohort_config = the wizard config with the keys the unified engine
  // reads lifted to top level (legacy nested them under engine.*). The
  // adapter's spread-projection keeps every legacy reader working.
  const engine = (cfg?.engine || {}) as TownHallConfig['engine'] & { standby_message?: string; chill_message?: string }
  const cohortConfig: Record<string, unknown> = {
    ...cfg,
    max_turns_per_participant: engine.max_turns_per_participant ?? 20,
    ...(engine.standby_message ? { standby_message: engine.standby_message } : {}),
    ...(engine.chill_message ? { chill_message: engine.chill_message } : {}),
    ...(engine.theme_detection_every_n_responses ? { theme_detection_every_n_responses: engine.theme_detection_every_n_responses } : {}),
    // Lifted so the cron + chatCore count-trigger (which read the top level)
    // honor the wizard's Organic Topic Discovery setting — without this,
    // "Off" was ignored and detection defaulted to automatic.
    ...(engine.theme_detection_mode ? { theme_detection_mode: engine.theme_detection_mode } : {}),
  }

  const { data, error } = await db
    .from('pulseiq_sessions')
    .insert({
      org_id: orgId,
      bot_id: agentRow!.id,
      created_by: user.id,
      name,
      slug,
      status: 'draft',
      cohort_config: cohortConfig,
      discussion_guide,
    })
    .select('id, slug')
    .single()

  if (error) {
    // Don't strand the just-created agent if the session insert failed.
    await db.from('agents').delete().eq('id', agentRow!.id).eq('org_id', orgId)
    return serverError(error, 'townhall.sessions.create', { orgId: userData?.org_id })
  }

  const { ip, userAgent } = eventContextFromRequest(req)
  await recordUserEvent({
    userId: user.id, orgId: (userData as { org_id?: string | null } | null)?.org_id || null,
    event: 'townhall_created',
    metadata: { session_id: data.id, slug: data.slug, name: body.name },
    ip, userAgent,
  })

  return NextResponse.json(data, { status: 201 })
}
