// app/api/bots/[id]/focuses-suggest/route.ts
// POST — propose a focus list by analyzing the bot's system prompt.
// The editor renders the suggestions for the bot owner to review + accept;
// nothing is saved here. Save happens on the bot PATCH when the owner clicks
// "Save Agent" in the editor.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { suggestFocusesFromPrompt } from '@/lib/focusClassifier'
import { logUsage } from '@/lib/usageLog'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

interface Params { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  if (!userData?.org_id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  type OrgRel = { is_admin_org: boolean | null }
  const orgRel = (userData as { organizations?: OrgRel | OrgRel[] | null })?.organizations
  const isAdmin = Array.isArray(orgRel) ? !!orgRel[0]?.is_admin_org : !!orgRel?.is_admin_org

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('id, org_id, system_prompt').eq('id', params.id).single()
  if (!bot || (!isAdmin && bot.org_id !== userData.org_id)) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })

  if (!bot.system_prompt || bot.system_prompt.length < 100) {
    return NextResponse.json({ error: 'System prompt too short to analyze' }, { status: 400 })
  }

  const result = await suggestFocusesFromPrompt(bot.system_prompt)
  if (result.usage) {
    logUsage({ org_id: bot.org_id, resource_type: 'bot', resource_id: bot.id, event_type: 'focus_suggest' }, result.usage)
  }

  return NextResponse.json({ focuses: result.focuses })
}
