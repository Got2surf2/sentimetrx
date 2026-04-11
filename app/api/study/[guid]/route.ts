import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const revalidate = 0

const noCache = {
  'Cache-Control':     'no-store, no-cache, must-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Vercel-CDN-Cache-Control': 'no-store',
  'Surrogate-Control': 'no-store',
  'Pragma':            'no-cache',
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { guid: string } }
) {
  const { guid } = params

  if (!guid || typeof guid !== 'string') {
    return NextResponse.json({ error: 'Missing study guid' }, { status: 400, headers: noCache })
  }

  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('studies')
    .select('id, guid, bot_name, bot_emoji, status, config, name, org_id')
    .eq('guid', guid)
    .limit(1)

  if (error || !data || data.length === 0) {
    return NextResponse.json({ error: 'Study not found' }, { status: 404, headers: noCache })
  }

  const study = data[0]

  if (study.status !== 'active') {
    return NextResponse.json({ error: 'Study is not active' }, { status: 403, headers: noCache })
  }

  // Fetch org name for AI prompt context
  let orgName = ''
  if (study.org_id) {
    const { data: org } = await supabase
      .from('organizations')
      .select('name')
      .eq('id', study.org_id)
      .single()
    if (org) orgName = org.name
  }

  return NextResponse.json({
    guid:      study.guid,
    name:      study.name,
    bot_name:  study.bot_name,
    bot_emoji: study.bot_emoji,
    config:    study.config,
    org_name:  orgName,
  }, { headers: noCache })
}
