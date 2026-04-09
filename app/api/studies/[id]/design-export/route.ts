// app/api/studies/[id]/design-export/route.ts
// Server-side generation of study design summary PPTX

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { generateStudyDesignPptx } from '@/lib/export/studyDesignPptx'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: study } = await supabase
    .from('studies')
    .select('id, name, bot_name, bot_emoji, guid, slug, config')
    .eq('id', params.id)
    .single()

  if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

  const surveyUrl = `https://sentimetrx-staging.vercel.app/s/${study.slug || study.guid}`

  const pptx = generateStudyDesignPptx({
    studyName: study.name,
    botName:   study.bot_name,
    botEmoji:  study.bot_emoji,
    surveyUrl,
    config:    study.config,
  })

  const rawBuffer = await pptx.write({ outputType: 'nodebuffer' })
  const fileName = study.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_design.pptx'

  return new NextResponse(rawBuffer as any, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
