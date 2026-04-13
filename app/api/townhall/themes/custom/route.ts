import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/townhall/themes/custom — facilitator pushes a custom question
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { session_id: string; label: string; question: string; response_target?: number }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { session_id, label, question, response_target } = body
  if (!session_id || !label || !question) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const db = createServiceRoleClient()

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
