// app/api/bots/[id]/readout/pptx/route.ts
// POST — render the Agent Conversation Readout as a PPTX (the leave-behind for a
// town hall / campaign stakeholder). Renders the SAME readout object the HTML
// page + PDF show, via buildReadoutDeck + slideRenderer. Datanautix-branded.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { getAgentReadout } from '@/lib/agentReadout'
import { buildReadoutDeck } from '@/lib/pptx/agentReadoutDeck'
import { renderDeck } from '@/lib/pptx/slideRenderer'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

function fileStem(title: string): string {
  return (title || 'Agent_Readout').replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').slice(0, 80) || 'Agent_Readout'
}

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: botId } = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('org_id, name').eq('id', botId).single()
  if (!bot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const readout = await getAgentReadout(botId)
  if (!readout) return NextResponse.json({ error: 'No conversations to analyze' }, { status: 400 })

  const deck = buildReadoutDeck(readout)
  const buffer = await renderDeck(deck, bot.name)
  const fileName = fileStem(readout.title) + '.pptx'

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="' + fileName + '"',
    },
  })
}
