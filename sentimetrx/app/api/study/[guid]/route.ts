import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

// GET /api/study/[guid]
// Called server-side by the survey page to load study config.
// Uses service role to bypass RLS — the survey is public but
// we validate the study is active before returning anything.
// The response is consumed server-side; config never reaches the browser.

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

  // Return only what the widget needs — never expose internal IDs
  return NextResponse.json({
    guid:      study.guid,
    bot_name:  study.bot_name,
    bot_emoji: study.bot_emoji,
    config:    study.config,
  })
}
