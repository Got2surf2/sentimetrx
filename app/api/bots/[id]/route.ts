// app/api/bots/[id]/route.ts
// GET    — fetch a single bot
// PATCH  — update bot config/content
// DELETE — delete a bot

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

async function getAuth(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('bots')
    .select('*')
    .eq('id', params.id)
    .eq('org_id', auth.orgId)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const allowed = ['name', 'slug', 'status', 'config', 'system_prompt', 'personality', 'knowledge_base', 'training_urls', 'review_interval_hours', 'next_review_at', 'faq', 'facts', 'guardrails', 'subject', 'negative_content_mode']
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() }
  for (const key of allowed) {
    if (body[key] !== undefined) updates[key] = body[key]
  }

  // Validate slug if changing
  if (updates.slug) {
    if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(updates.slug as string)) {
      return NextResponse.json({ error: 'Invalid slug format' }, { status: 400 })
    }
    const service = createServiceRoleClient()
    const { data: existing } = await service.from('bots').select('id').eq('slug', updates.slug as string).neq('id', params.id).limit(1)
    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'This URL is already taken' }, { status: 409 })
    }
  }

  const { error } = await supabase
    .from('bots')
    .update(updates)
    .eq('id', params.id)
    .eq('org_id', auth.orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabase
    .from('bots')
    .delete()
    .eq('id', params.id)
    .eq('org_id', auth.orgId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
