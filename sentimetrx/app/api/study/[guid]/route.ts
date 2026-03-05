import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'  // never cache — status can change at any time

export async function GET(
  _req: NextRequest,
  { params }: { params: { guid: string } }
) {
  const { guid } = params

  if (!guid || typeof guid !== 'string') {
    return NextResponse.json({ error: 'Missing study guid' }, { status: 400 })
  }

  const supabase = createServiceRoleClient()

  const { data: study, error } = await supabase
    .from('studies')
    .select('id, guid, bot_name, bot_emoji, status, config, name')
    .eq('guid', guid)
    .single()

  if (error || !study) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404 })
  }

  if (study.status !== 'active') {
    return NextResponse.json({ error: 'Study is not active' }, { status: 403 })
  }

  return NextResponse.json({
    guid:      study.guid,
    bot_name:  study.bot_name,
    bot_emoji: study.bot_emoji,
    config:    study.config,
  })
}
