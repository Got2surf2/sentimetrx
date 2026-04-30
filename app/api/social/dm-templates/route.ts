// app/api/social/dm-templates/route.ts
// GET  — list DM templates
// POST — create/update DM template
// Stored as alert_rules with rule_type = 'dm_template'

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function getAuth(supabase: ReturnType<typeof createClient>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('users').select('org_id').eq('id', user.id).single()
  return { userId: user.id, orgId: data?.org_id as string | null }
}

export async function GET() {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('social_alert_rules')
    .select('*')
    .eq('org_id', auth.orgId)
    .eq('rule_type', 'dm_template')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ templates: data || [] })
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const auth = await getAuth(supabase)
  if (!auth?.orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { intent, name, message } = await req.json()
  if (!intent || !message) return NextResponse.json({ error: 'intent and message are required' }, { status: 400 })

  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('social_alert_rules')
    .insert({
      org_id: auth.orgId,
      rule_type: 'dm_template',
      config: { intent, name: name || intent, message },
      enabled: true,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
