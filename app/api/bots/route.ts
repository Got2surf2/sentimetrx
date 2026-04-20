// app/api/bots/route.ts
// GET  — list bots for the authenticated user's org
// POST — create a new bot

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function getOrgId(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function GET() {
  const supabase = createClient()
  const auth = await getOrgId(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('bots')
    .select('id, name, slug, status, config, conversation_count, created_at, updated_at')
    .eq('org_id', auth.orgId)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ bots: data })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const auth = await getOrgId(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { name, slug, config, system_prompt, knowledge_base, training_urls } = body

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
    org_id: auth.orgId,
    name,
    slug,
    config: config || {},
    system_prompt: system_prompt || '',
    knowledge_base: knowledge_base || '',
    training_urls: training_urls || [],
    status: 'draft',
    created_by: auth.userId,
  }).select('id, name, slug, status').single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
