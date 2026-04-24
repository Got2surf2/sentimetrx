// app/api/bots/[id]/conversations/reviews/route.ts
// GET — list scheduled review results for a bot

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Verify ownership
  const { data: bot } = await supabase.from('bots').select('id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })

  const { data: reviews } = await supabase
    .from('bot_conversation_reviews')
    .select('id, reviewed_at, since, session_count, turn_count, report, theme_drift')
    .eq('bot_id', params.id)
    .order('reviewed_at', { ascending: false })
    .limit(20)

  return NextResponse.json({ reviews: reviews || [] })
}
