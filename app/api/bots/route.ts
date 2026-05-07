// app/api/bots/route.ts
// GET  — list bots. Non-admin: scoped to user's org. Admin: all orgs by
//        default, narrowed to ?org=<id> when supplied (Phase E filter UI).
// POST — create a new bot

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { validateOrgFilter } from '@/lib/orgValidate'

export const dynamic = 'force-dynamic'

async function getUserContext(supabase: ReturnType<typeof createClient>) {
  const user = await getAuthUser(supabase)
  if (!user) return null
  const { data } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = data?.organizations
  const isAdmin = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org : (orgRel as any)?.is_admin_org
  return { userId: user.id, orgId: (data as any)?.org_id as string | null, isAdmin: !!isAdmin }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!ctx.isAdmin && !ctx.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const orgFilter = validateOrgFilter(req.nextUrl.searchParams.get('org'))
  // Admin: all orgs unless ?org=<id> narrows. Non-admin: locked to own org.
  // Garbage UUIDs in the filter fall through to "all orgs" instead of 500ing.
  const scopeOrgId = ctx.isAdmin ? orgFilter : ctx.orgId

  const service = createServiceRoleClient()
  let q = service
    .from('bots')
    .select('id, org_id, name, slug, status, config, conversation_count, last_session_at, created_at, updated_at')
    .order('created_at', { ascending: false })
  if (scopeOrgId) q = q.eq('org_id', scopeOrgId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Compute live session counts from conversation turns
  const botIds = (data || []).map(function(b: any) { return b.id })
  const sessionCounts: Record<string, number> = {}

  if (botIds.length > 0) {
    const { data: turns } = await service
      .from('bot_conversation_turns')
      .select('bot_id, session_id')
      .in('bot_id', botIds)

    if (turns) {
      const seen: Record<string, Set<string>> = {}
      for (const t of turns) {
        if (!seen[t.bot_id]) seen[t.bot_id] = new Set()
        seen[t.bot_id].add(t.session_id)
      }
      for (const [bid, sessions] of Object.entries(seen)) {
        sessionCounts[bid] = sessions.size
      }
    }
  }

  // Resolve org names for admin per-card display.
  let orgNameMap: Record<string, string> = {}
  if (ctx.isAdmin) {
    const orgIds = Array.from(new Set((data || []).map((b: any) => b.org_id).filter(Boolean)))
    if (orgIds.length > 0) {
      const { data: orgs } = await service.from('organizations').select('id, name').in('id', orgIds)
      ;(orgs || []).forEach((o: any) => { orgNameMap[o.id] = o.name })
    }
  }

  const enriched = (data || []).map(function(b: any) {
    return {
      ...b,
      conversation_count: sessionCounts[b.id] || 0,
      org_name: ctx.isAdmin ? (orgNameMap[b.org_id] || null) : null,
    }
  })

  return NextResponse.json({ bots: enriched })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, slug, config, system_prompt, knowledge_base, training_urls, personality, faq, facts, guardrails, subject, negative_content_mode, opponents, contrast_mode } = body

  if (!name || !slug) {
    return NextResponse.json({ error: 'Name and slug are required' }, { status: 400 })
  }

  // Validate slug format
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
    return NextResponse.json({ error: 'Slug must be 3-50 chars, lowercase, hyphens only' }, { status: 400 })
  }

  // Check slug uniqueness
  const service = createServiceRoleClient()
  const { data: existing } = await service.from('bots').select('id').eq('slug', slug).limit(1)
  if (existing && existing.length > 0) {
    return NextResponse.json({ error: 'This URL is already taken' }, { status: 409 })
  }

  const { data, error } = await service.from('bots').insert({
    org_id: ctx.orgId,
    name,
    slug,
    config: config || {},
    system_prompt: system_prompt || '',
    personality: personality || '',
    knowledge_base: knowledge_base || '',
    training_urls: training_urls || [],
    faq: faq || [],
    facts: facts || [],
    guardrails: guardrails || [],
    subject: subject || '',
    negative_content_mode: negative_content_mode || 'deflect',
    opponents: opponents || [],
    contrast_mode: contrast_mode || 'user_triggered',
    status: 'draft',
    created_by: ctx.userId,
  }).select('id, name, slug, status').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
