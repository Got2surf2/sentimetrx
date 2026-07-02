// app/api/studies/[id]/design-export/route.ts
// Server-side generation of study design summary PPTX

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { generateStudyDesignPptx } from '@/lib/export/studyDesignPptx'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: study } = await supabase
    .from('studies')
    .select('id, name, bot_name, bot_emoji, guid, slug, config')
    .eq('id', params.id)
    .single()

  if (!study) return NextResponse.json({ error: 'Study not found' }, { status: 404 })

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
  const surveyUrl = `${baseUrl}/s/${study.slug || study.guid}`

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
