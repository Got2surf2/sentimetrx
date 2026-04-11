// POST /api/translate-responses
// Public endpoint — translates survey responses back to English on submission.
// Called client-side when autoTranslateResponses is enabled and lang !== 'en'.

import { NextRequest, NextResponse } from 'next/server'
import { SUPPORTED_LANGUAGES } from '@/lib/types'
import { checkRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Rate limit: 10 requests per minute per IP (prevents abuse of paid AI endpoint)
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  const rl = checkRateLimit('translate-resp:' + ip, 10, 60000)
  if (rl.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }

  const { texts, customTexts, fromLanguage } = body
  if (!fromLanguage || fromLanguage === 'en') {
    return NextResponse.json({ texts: {}, customTexts: {} })
  }

  // Cap input size to prevent abuse
  const allTexts: Record<string, string> = { ...(texts || {}), ...(customTexts || {}) }
  const totalChars = Object.values(allTexts).join('').length
  if (totalChars > 10000) {
    return NextResponse.json({ error: 'Input too large' }, { status: 400 })
  }

  const langName = SUPPORTED_LANGUAGES.find(l => l.code === fromLanguage)?.name || fromLanguage

  if (Object.keys(allTexts).length === 0) {
    return NextResponse.json({ texts: {}, customTexts: {} })
  }

  const prompt = `Translate the following survey responses from ${langName} to English.
Return a JSON object with the exact same keys but with English translations.
These are open-ended survey responses — preserve the respondent's tone and meaning faithfully.
Do not add interpretation or commentary, just translate.

Responses:
${JSON.stringify(allTexts, null, 2)}

Return ONLY valid JSON, no markdown, no explanation.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 4000,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    if (!response.ok) throw new Error('Anthropic API error: ' + response.status)

    const data = await response.json()
    let text = data.content?.[0]?.text?.trim() || ''
    text = text.replace(/^```json?\n?/, '').replace(/\n?```$/, '').trim()

    const parsed = JSON.parse(text)

    // Split back into texts and customTexts
    const resultTexts: Record<string, string> = {}
    const resultCustom: Record<string, string> = {}
    const textKeys = new Set(Object.keys(texts || {}))
    for (const [k, v] of Object.entries(parsed)) {
      if (textKeys.has(k)) {
        resultTexts[k] = v as string
      } else {
        resultCustom[k] = v as string
      }
    }

    return NextResponse.json({ texts: resultTexts, customTexts: resultCustom })
  } catch (err: any) {
    console.error('Response translation error:', err)
    return NextResponse.json({ texts: {}, customTexts: {} })
  }
}
