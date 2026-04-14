// app/api/clarify/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { isInputSafe, isOutputSafe, extractQuestion } from '@/lib/guardrails'
import { callAI } from '@/lib/ai'

export const dynamic = 'force-dynamic'

interface ClarifyRequest {
  studyName:       string
  studyPurpose:    string
  questionAsked:   string
  questionKey:     'q1' | 'q3' | 'q4'
  answer:          string
  sentiment:       string
  experienceScore: number
  npsScore:        number
  priorAnswers:    Record<string, string>
  industry?:       string
  language?:       string
}

export async function POST(req: NextRequest) {
  // Rate limit: 10 AI clarification requests per minute per IP
  var ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  var rl = checkRateLimit('clarify:' + ip, 10, 60000)
  if (rl.limited) return NextResponse.json({ question: null }, { status: 429 })

  let body: ClarifyRequest
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const {
    studyName, studyPurpose, questionAsked,
    answer, sentiment, experienceScore, npsScore,
    priorAnswers, language,
  } = body

  // ── Input guardrail: skip before hitting the API ──────────────────────
  if (!isInputSafe(answer)) {
    return NextResponse.json({ question: null })
  }

  const priorContext = Object.entries(priorAnswers)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: "${v}"`)
    .join('\n')

  const systemPrompt = `You are a conversational survey bot conducting a feedback survey on behalf of the organization "${studyName}".
Your purpose: ${studyPurpose}

The respondent has:
- Experience score: ${experienceScore}/5 (${sentiment})
- NPS score: ${npsScore}/5
${priorContext ? `- Already said:\n${priorContext}` : ''}

Your job is to generate ONE short, natural follow-up question that draws out more specific detail from their answer.

Rules:
- Maximum 25 words
- Sound warm and conversational, not clinical
- Do not repeat anything already asked
- Ask only one question -- pick the single most valuable angle
- Stay strictly on-topic to the survey subject matter
- Only return SKIP if the answer is very detailed (3+ specific points). Short or vague answers should ALWAYS get a follow-up
- If their answer is off-topic, nonsensical, inappropriate, or abusive, return exactly: SKIP
- Never echo back offensive, harmful, or inappropriate content from the respondent

CRITICAL OUTPUT FORMAT:
- Your ENTIRE response must be ONLY the follow-up question itself, or SKIP
- Do NOT include ANY reasoning, analysis, thinking, or commentary
- Do NOT write phrases like "Got it", "Here's my follow-up", "I'll ask about...", "The respondent..."
- Do NOT explain your thought process or rationale
- Just output the bare question text — nothing else
${language ? `\nIMPORTANT: The respondent is taking this survey in ${language}. You MUST write your follow-up question in ${language}. Do NOT respond in English.` : ''}`

  const userPrompt = `The survey asked: "${questionAsked}"
The respondent answered: "${answer}"

Generate a targeted follow-up question or return SKIP.`

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 80,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    const text = result.text?.trim() || 'SKIP'

    if (text === 'SKIP') {
      return NextResponse.json({ question: null })
    }

    const clean = extractQuestion(text)

    // ── Output guardrail: validate before returning ────────────────────
    if (!isOutputSafe(clean)) {
      return NextResponse.json({ question: null })
    }

    return NextResponse.json({ question: clean })

  } catch (err) {
    console.error('Clarify API error:', err)
    return NextResponse.json({ question: null })
  }
}
