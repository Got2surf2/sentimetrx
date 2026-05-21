import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/townhall/themes/custom — facilitator pushes a custom question
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { session_id: string; label: string; question: string; response_target?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { session_id, label, question, response_target } = body
  if (!session_id || !label || !question) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const db = createServiceRoleClient()

  // Phase-3 substrate first: if session_id matches a town_halls row, the
  // custom theme is a town_hall_topics insert. Map 'custom' source →
  // 'manual' (the value town_hall_topics_source_check accepts).
  const { data: hall } = await db.from('town_halls').select('id, org_id').eq('id', session_id).maybeSingle()
  if (hall) {
    const { data, error } = await db
      .from('town_hall_topics')
      .insert({
        town_hall_id: (hall as any).id,
        org_id:       (hall as any).org_id,
        label,
        description: null,
        question,
        state: 'active',
        source: 'manual',
        response_target: response_target || 30,
        approved_at: new Date().toISOString(),
      })
      .select('*')
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data, { status: 201 })
  }

  const { data, error } = await db
    .from('townhall_themes')
    .insert({
      session_id,
      label,
      description: null,
      question,
      state: 'active',
      source: 'custom',
      response_target: response_target || 30,
      approved_at: new Date().toISOString(),
    })
    .select('*')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}
