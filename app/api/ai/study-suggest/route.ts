// app/api/ai/study-suggest/route.ts
// POST — given a plain-text description of a study's purpose, returns AI-generated
// starter values that pre-populate the study creator wizard.

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 30

const VALID_INDUSTRIES = [
  'healthcare', 'hospitality', 'casual_dining', 'fine_dining', 'fast_food',
  'travel_tourism', 'political', 'media_entertainment', 'performing_arts',
  'saas_software', 'retail_ecommerce', 'financial_services', 'education',
  'higher_education', 'hr_employee', 'sports', 'nonprofit', 'automotive_repair', 'other',
]

const SYSTEM_PROMPT = `You are a study design assistant helping create conversational AI feedback surveys.

Given a description of what the user wants to learn, return a JSON object with EXACTLY these fields:

{
  "name": "concise study name (4-7 words)",
  "bot_name": "friendly first name for the AI interviewer — warm and fitting for the context (e.g. Aria, Sam, Maya, Riley, Jordan)",
  "bot_emoji": "a single emoji fitting the industry (e.g. 🏥 for healthcare, 💼 for HR, 🍽️ for dining)",
  "industry": "exact key from: healthcare | hospitality | casual_dining | fine_dining | fast_food | travel_tourism | political | media_entertainment | performing_arts | saas_software | retail_ecommerce | financial_services | education | higher_education | hr_employee | sports | nonprofit | automotive_repair | other",
  "greeting": "warm, conversational 1–2 sentence opening from the bot introducing themselves and the survey purpose. Use the bot_name naturally.",
  "npsEnabled": true or false — include NPS (recommend to a friend) only if appropriate for the context,
  "npsPrompt": "NPS question text if npsEnabled is true, otherwise omit",
  "ratingPrompt": "experience rating prompt — always required, conversational and specific to the context",
  "promoterQ1": "brief empathetic follow-up for happy respondents (rating 4-5), e.g. 'What stood out most to you?'",
  "passiveQ1": "brief follow-up for neutral respondents (rating 3), e.g. 'What could we do a bit better?'",
  "detractorQ1": "brief empathetic follow-up for unhappy respondents (rating 1-2), e.g. 'We're sorry — what went wrong?'",
  "q3": "primary open-ended question — the most important thing you want to learn. Conversational tone.",
  "q4Enabled": true or false — include a second open-ended question only if there's genuinely a second angle worth exploring,
  "q4": "second open-ended question if q4Enabled is true, otherwise omit"
}

Rules:
- ALL text must be warm, conversational, and human — never clinical or corporate
- bot_name should feel natural for the industry and context
- Return ONLY valid JSON — no markdown, no explanation, no other text
- greeting must address the respondent as "you" and mention the purpose naturally
- Keep questions under 20 words each
- npsEnabled should be false for internal HR/employee surveys and political research`

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const description: string = (body.description || '').trim()

  if (!description || description.length < 10) {
    return NextResponse.json({ error: 'Description too short' }, { status: 400 })
  }
  if (description.length > 1000) {
    return NextResponse.json({ error: 'Description too long' }, { status: 400 })
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'AI not configured' }, { status: 500 })

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     SYSTEM_PROMPT,
        messages: [{
          role:    'user',
          content: `Study description: "${description}"\n\nGenerate starter values for this study.`,
        }],
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      console.error('[study-suggest] Anthropic error:', err)
      return NextResponse.json({ error: 'AI request failed' }, { status: 502 })
    }

    const data   = await response.json()
    const raw    = data.content?.[0]?.text?.trim() || ''

    // Strip any accidental markdown fences
    const jsonStr = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim()

    let suggestion: Record<string, unknown>
    try {
      suggestion = JSON.parse(jsonStr)
    } catch {
      console.error('[study-suggest] JSON parse failed:', jsonStr.slice(0, 200))
      return NextResponse.json({ error: 'AI returned invalid response' }, { status: 502 })
    }

    // Validate + sanitize industry key
    const industry = VALID_INDUSTRIES.includes(suggestion.industry as string)
      ? (suggestion.industry as string)
      : 'other'

    // Build safe response — only return known fields
    const result = {
      name:         String(suggestion.name        || '').slice(0, 100),
      bot_name:     String(suggestion.bot_name    || '').slice(0, 40),
      bot_emoji:    String(suggestion.bot_emoji   || '💬').slice(0, 4),
      industry,
      greeting:     String(suggestion.greeting    || '').slice(0, 400),
      npsEnabled:   suggestion.npsEnabled !== false,
      npsPrompt:    String(suggestion.npsPrompt   || '').slice(0, 200),
      ratingPrompt: String(suggestion.ratingPrompt || '').slice(0, 200),
      promoterQ1:   String(suggestion.promoterQ1  || '').slice(0, 200),
      passiveQ1:    String(suggestion.passiveQ1   || '').slice(0, 200),
      detractorQ1:  String(suggestion.detractorQ1 || '').slice(0, 200),
      q3:           String(suggestion.q3          || '').slice(0, 300),
      q4Enabled:    suggestion.q4Enabled === true,
      q4:           String(suggestion.q4          || '').slice(0, 300),
    }

    return NextResponse.json({ suggestion: result })

  } catch (err: any) {
    console.error('[study-suggest] error:', err)
    return NextResponse.json({ error: 'Failed to generate suggestions' }, { status: 500 })
  }
}
