// app/api/clarify/route.ts
// AI-powered clarifying question generation using Claude
// Called when a respondent gives a short answer that warrants follow-up

import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface ClarifyRequest {
  studyName:     string
  studyPurpose:  string   // greeting text gives the bot's framing
  questionAsked: string   // the exact question the respondent answered
  questionKey:   'q1' | 'q3' | 'q4'
  answer:        string   // the respondent's short answer
  sentiment:     string   // promoter / passive / detractor
  experienceScore: number
  npsScore:      number
  priorAnswers:  Record<string, string>  // q1/q3 answers already given
  industry?:     string
}

export async function POST(req: NextRequest) {
  let body: ClarifyRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    studyName, studyPurpose, questionAsked,
    answer, sentiment, experienceScore, npsScore,
    priorAnswers,
  } = body

  // Build context summary from prior answers
  const priorContext = Object.entries(priorAnswers)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: "${v}"`)
    .join('\n')

  const systemPrompt = `You are a conversational survey bot conducting a feedback survey for "${studyName}".
Your purpose: ${studyPurpose}

The respondent has:
- Experience score: ${experienceScore}/5 (${sentiment})
- NPS score: ${npsScore}/5
${priorContext ? `- Already said:\n${priorContext}` : ''}

Your job is to generate ONE short, natural follow-up question that draws out more specific detail from their answer. Rules:
- Maximum 25 words
- Sound warm and conversational, not clinical
- Don't repeat anything already asked
- Don't ask multiple questions — pick the single most valuable angle
- If their answer already has enough detail, return exactly: SKIP
- Respond with ONLY the question or SKIP — no preamble, no quotes, no punctuation at the end`

  const userPrompt = `The survey asked: "${questionAsked}"
The respondent answered: "${answer}"

Generate a targeted follow-up question or return SKIP.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',  // fast + cheap for this use case
        max_tokens: 80,
        system:     systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    })

    if (!response.ok) {
      throw new Error(`Anthropic API error: ${response.status}`)
    }

    const data = await response.json()
    const text = data.content?.[0]?.text?.trim() || 'SKIP'

    if (text === 'SKIP' || text.length < 5) {
      return NextResponse.json({ question: null })
    }

    // Clean up any accidental quotes or trailing punctuation issues
    const clean = text.replace(/^["']|["']$/g, '').trim()
    return NextResponse.json({ question: clean })

  } catch (err) {
    console.error('Clarify API error:', err)
    // Fall through gracefully — caller will use fallback
    return NextResponse.json({ question: null })
  }
}
