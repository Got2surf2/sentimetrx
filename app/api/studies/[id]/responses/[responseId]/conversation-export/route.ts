// app/api/studies/[id]/responses/[responseId]/conversation-export/route.ts
// Render a single response's conversation as a branded PPTX slide

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import PptxGenJS from 'pptxgenjs'

export const dynamic = 'force-dynamic'

// Datanautix brand palette
const DN = {
  teal: '0F7173', tealLight: '1DA39A', navy: '0D2B45',
  gold: 'E8B84B', orange: 'E85A1A', orangeLight: 'F07040',
  slate: '8FA3AE', white: 'FFFFFF', ink: '0D2B45',
  slateCard: 'F4F7F8', divider: 'D4DDE2',
}

const W = 13.33, H = 7.5, PAD = 0.42, HH = 0.9, FY = H - 0.28

interface ConvMsg { who: 'bot' | 'user'; text: string; ai?: boolean }

function buildConversationFromPayload(payload: any, config: any, botName: string): ConvMsg[] {
  const msgs: ConvMsg[] = []
  const oe = payload?.openEnded || {}

  if (config?.greeting) msgs.push({ who: 'bot', text: config.greeting })
  msgs.push({ who: 'bot', text: 'Are you ready to share your feedback?' })
  msgs.push({ who: 'user', text: 'Yes, let\'s go! 👍' })

  if (payload?.experienceRating?.score != null) {
    if (config?.ratingPrompt) msgs.push({ who: 'bot', text: config.ratingPrompt })
    msgs.push({ who: 'user', text: `${payload.experienceRating.label || ''} (${payload.experienceRating.score}/5)` })
  }
  if (payload?.npsRecommend?.score != null) {
    if (config?.npsPrompt) msgs.push({ who: 'bot', text: config.npsPrompt })
    msgs.push({ who: 'user', text: `${payload.npsRecommend.label || ''} (${payload.npsRecommend.score}/5)` })
  }

  for (const qKey of ['q1', 'q3', 'q4'] as const) {
    const answer = oe[qKey]
    if (!answer) continue
    const prompt = qKey === 'q1' ? (config?.promoterQ1 || config?.passiveQ1 || config?.detractorQ1) : (config as any)?.[qKey]
    if (prompt) msgs.push({ who: 'bot', text: prompt })
    const parts = answer.split(' [+ ')
    msgs.push({ who: 'user', text: parts[0] })
    if (parts.length > 1) {
      msgs.push({ who: 'bot', text: '(clarifier follow-up)', ai: true })
      msgs.push({ who: 'user', text: parts[1].replace(/\]$/, '') })
    }
  }

  if (payload?.customAnswers && config?.questions) {
    for (const q of config.questions.filter((q: any) => q.type !== 'hidden' && q.enabled !== false)) {
      const ans = payload.customAnswers[q.id]
      if (ans != null) {
        msgs.push({ who: 'bot', text: q.prompt })
        const t = Array.isArray(ans) ? ans.join(', ') : String(ans)
        if (t) msgs.push({ who: 'user', text: t })
      }
    }
  }

  const psycho = payload?.psychographics || {}
  const bank = config?.psychographicBank || []
  for (const [key, val] of Object.entries(psycho).filter(([, v]) => v)) {
    const bq = bank.find((b: any) => b.key === key)
    if (bq) msgs.push({ who: 'bot', text: bq.q })
    msgs.push({ who: 'user', text: val as string })
  }

  return msgs
}

export async function GET(req: NextRequest, { params }: { params: { id: string; responseId: string } }) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ data: study }, { data: response }] = await Promise.all([
    supabase.from('studies').select('name, bot_name, bot_emoji, config').eq('id', params.id).single(),
    supabase.from('responses').select('id, payload, sentiment, experience_score, nps_score, completed_at, duration_sec').eq('id', params.responseId).single(),
  ])

  if (!study || !response) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const msgs: ConvMsg[] = response.payload?.conversationLog?.length > 0
    ? response.payload.conversationLog
    : buildConversationFromPayload(response.payload, study.config, study.bot_name)

  // ── Build PPTX ──────────────────────────────────────────────────────────────
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = `${study.name} — Conversation`

  const theme = (study.config as any)?.theme || {}
  const primaryHex = (theme.primaryColor || '#00b4d8').replace('#', '')
  const bgHex = (theme.backgroundColor || '#0a1628').replace('#', '')

  const slide = pptx.addSlide()

  // Background
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: DN.slateCard }, line: { width: 0 } })

  // Header with branding
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.06, fill: { color: DN.gold }, line: { width: 0 } })
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: W, h: HH - 0.06, fill: { color: DN.navy }, line: { width: 0 } })
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: 0.07, h: HH - 0.06, fill: { color: DN.teal }, line: { width: 0 } })
  slide.addText(`${study.bot_emoji} ${study.bot_name}  —  Conversation Replay`, {
    x: PAD, y: 0.1, w: W - PAD * 2 - 2.4, h: 0.5, fontSize: 17, bold: true, color: DN.white, valign: 'middle',
  })

  const meta = [
    response.sentiment ? response.sentiment.charAt(0).toUpperCase() + response.sentiment.slice(1) : null,
    response.experience_score ? `Exp: ${response.experience_score}/5` : null,
    response.nps_score ? `NPS: ${response.nps_score}/5` : null,
    response.completed_at ? new Date(response.completed_at).toLocaleDateString() : null,
    response.duration_sec ? `${response.duration_sec}s` : null,
  ].filter(Boolean).join('  ·  ')

  slide.addText(meta, { x: PAD, y: 0.56, w: W - PAD * 2 - 2.4, h: 0.32, fontSize: 9, color: DN.tealLight, valign: 'middle' })

  // Logo
  slide.addText(
    [
      { text: 'data', options: { color: DN.orangeLight, bold: true, italic: true } },
      { text: 'nautix', options: { color: DN.tealLight, bold: true, italic: true } },
    ],
    { x: W - 2.3, y: 0.1, w: 2.1, h: HH - 0.18, fontSize: 15, valign: 'middle', align: 'right' }
  )

  // ── Render conversation bubbles ─────────────────────────────────────────────
  // Layout: two columns to fit more on one slide
  const COL_W = (W - PAD * 3) / 2
  const START_Y = 1.05
  const MAX_Y = FY - 0.15
  let col = 0
  let y = START_Y

  for (const msg of msgs) {
    const colX = PAD + col * (COL_W + PAD)
    const isUser = msg.who === 'user'
    const textLen = msg.text.length
    const bubbleH = textLen > 120 ? 0.5 : textLen > 60 ? 0.38 : 0.28
    const bubbleW = Math.min(COL_W * 0.82, Math.max(1.2, textLen * 0.055 + 0.4))

    // Check if we need to move to next column or stop
    if (y + bubbleH > MAX_Y) {
      if (col === 0) { col = 1; y = START_Y }
      else break // no more room
    }

    const bubbleX = isUser ? colX + COL_W - bubbleW : colX + (msg.who === 'bot' ? 0.25 : 0)

    // Avatar for bot messages
    if (!isUser) {
      slide.addText(study.bot_emoji, {
        x: colX, y, w: 0.22, h: 0.22, fontSize: 7, align: 'center', valign: 'middle',
      })
    }

    // Bubble
    slide.addShape(pptx.ShapeType.roundRect, {
      x: bubbleX, y, w: bubbleW, h: bubbleH,
      fill: { color: isUser ? primaryHex : DN.white },
      line: isUser ? { width: 0 } : { color: DN.divider, width: 0.5 },
      rectRadius: 0.08,
    })
    slide.addText(msg.text, {
      x: bubbleX + 0.08, y, w: bubbleW - 0.16, h: bubbleH,
      fontSize: 7, color: isUser ? DN.white : DN.ink, valign: 'middle', wrap: true,
    })

    // AI badge
    if (msg.ai) {
      slide.addShape(pptx.ShapeType.roundRect, {
        x: bubbleX + 0.02, y: y + bubbleH - 0.02, w: 0.28, h: 0.13,
        fill: { color: DN.teal }, line: { width: 0 }, rectRadius: 0.04,
      })
      slide.addText('Ana', {
        x: bubbleX + 0.02, y: y + bubbleH - 0.02, w: 0.28, h: 0.13,
        fontSize: 5, bold: true, color: DN.white, align: 'center', valign: 'middle',
      })
      y += 0.1
    }

    y += bubbleH + 0.06
  }

  // Footer
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: FY - 0.02, w: W, h: 0.015, fill: { color: DN.teal }, line: { width: 0 } })
  slide.addText('datanautix.com  ·  ' + study.name, {
    x: PAD, y: FY, w: W * 0.5, h: 0.26, fontSize: 7.5, color: DN.slate, valign: 'middle',
  })
  slide.addText('Proprietary and Confidential', {
    x: W * 0.35, y: FY, w: W * 0.3, h: 0.26, fontSize: 7.5, color: DN.slate, valign: 'middle', align: 'center',
  })

  const rawBuffer = await pptx.write({ outputType: 'nodebuffer' })
  const fileName = study.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_conversation.pptx'

  return new NextResponse(rawBuffer as any, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
