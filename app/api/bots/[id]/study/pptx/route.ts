// app/api/bots/[id]/study/pptx/route.ts
// POST — render the Agent Study as a PPTX (the leave-behind export). Renders
// the SAME analysis object the HTML report shows, via buildStudyDeck +
// slideRenderer. Datanautix-branded per the deck-export exception.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { getAgentStudy } from '@/lib/agentStudy'
import { buildStudyDeck } from '@/lib/pptx/agentStudyDeck'
import { renderDeck } from '@/lib/pptx/slideRenderer'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

export async function POST(_req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id: botId } = await props.params
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()
  const { data: bot } = await service.from('agents').select('org_id').eq('id', botId).single()
  if (!bot) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const study = await getAgentStudy(botId)
  if (!study) return NextResponse.json({ error: 'No conversations to analyze' }, { status: 400 })

  const deck = buildStudyDeck(study)
  const buffer = await renderDeck(deck, study.bot.name)
  const fileName = study.bot.name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') + '_Agent_Study.pptx'

  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="' + fileName + '"',
    },
  })
}
