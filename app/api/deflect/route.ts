// app/api/deflect/route.ts
// AI-powered question/off-topic detection and contextual deflection

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

interface DeflectRequest {
  studyName:    string
  orgName?:     string
  questionAsked: string   // the bot's question the respondent was answering
  answer:       string    // the respondent's answer (may be a question or off-topic)
  linkText:     string    // e.g. "our website"
  linkUrl:      string    // e.g. "https://example.com/faq"
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  const rl = checkRateLimit('deflect:' + ip, 10, 60000)
  if (rl.limited) return NextResponse.json({ deflection: null }, { status: 429 })

  let body: DeflectRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { studyName, orgName, questionAsked, answer, linkText, linkUrl } = body

  if (!answer || answer.trim().length < 3) {
    return NextResponse.json({ deflection: null })
  }

  const systemPrompt = `You are a friendly feedback survey bot for "${studyName}"${orgName ? ` (run by ${orgName})` : ''}. You can ONLY collect feedback — you cannot answer questions about the organization.

A respondent was asked: "${questionAsked}"
They replied: "${answer}"

If they gave normal feedback (opinion, experience, suggestion, even if brief): respond with exactly NONE

If they asked a question, requested information, or went off-topic: respond with a SHORT, warm message (max 30 words) that:
- Acknowledges what they said
- Explains you're just collecting feedback
- Includes {{LINK}} where they can find answers

CRITICAL RULES:
- Output ONLY the message the respondent will see, or NONE
- Do NOT include any analysis, reasoning, classification, or thinking
- Do NOT start with phrases like "The respondent is..." or "Yes, they are..."
- Do NOT use dashes or separators between thoughts
- Just write the friendly redirect message directly
- Use {{LINK}} exactly once`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 100,
        system:     systemPrompt,
        messages: [{ role: 'user', content: 'Analyze the respondent\'s reply and respond accordingly.' }],
      }),
    })

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`)
    }

    const data = await response.json()
    let text = data.content?.[0]?.text?.trim() || 'NONE'

    if (text === 'NONE' || text.length < 5) {
      return NextResponse.json({ deflection: null })
    }

    // Strip any leaked reasoning — if the model included analysis before the actual message
    // Look for common patterns: "--- actual message" or "The respondent... --- message"
    if (text.includes('---')) text = text.split('---').pop()!.trim()
    if (text.includes('—')) {
      const parts = text.split('—')
      // If the first part looks like analysis (contains classification words), take the last part
      if (/respondent|question|off-topic|asking|seeking|classify|redirect|pushback/i.test(parts[0])) {
        text = parts.slice(1).join('—').trim()
      }
    }
    // Strip leading analysis sentences like "Yes, they are asking..." or "The respondent is..."
    text = text.replace(/^(Yes,?\s+)?(The respondent|They are|This is)[^.!?]*[.!?]\s*/gi, '')

    if (!text || text.length < 5 || text === 'NONE') {
      return NextResponse.json({ deflection: null })
    }

    // Replace {{LINK}} placeholder with actual link markup
    const deflection = text.replace('{{LINK}}', `<a href="${linkUrl}" target="_blank" rel="noopener noreferrer">${linkText}</a>`)

    return NextResponse.json({ deflection })

  } catch (err) {
    console.error('Deflect API error:', err)
    return NextResponse.json({ deflection: null })
  }
}
