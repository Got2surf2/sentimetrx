// app/api/clarify/route.ts

import { NextRequest, NextResponse } from 'next/server'

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
}

// ── Input guardrail ────────────────────────────────────────────────────────
// Rough signal patterns that suggest the answer is off-topic or harmful.
// If any match, skip clarification entirely rather than sending to the API.
const SKIP_PATTERNS = [
  /\b(fuck|shit|cunt|bitch|asshole|bastard)\b/i,         // profanity
  /\b(kill|murder|rape|bomb|attack|shoot)\b/i,           // violence
  /\b(nude|naked|sex|porn|dick|cock|pussy|tits)\b/i,     // sexual
  /\b(n[i1]gg|sp[i1]c|ch[i1]nk|k[i1]ke|f[a4]gg)\w*/i,  // slurs (common variants)
  /https?:\/\//i,                                         // URLs (spam/phishing)
  /.{600,}/,                                              // extremely long (>600 chars)
]

function isAnswerSafe(answer: string): boolean {
  if (!answer || answer.trim().length < 2) return false
  return !SKIP_PATTERNS.some(pattern => pattern.test(answer))
}

// ── Output guardrail ───────────────────────────────────────────────────────
// Validate the generated question before returning it to the client.
function isOutputSafe(text: string): boolean {
  if (!text || text.length < 5 || text.length > 200) return false
  // Must look like a question (contain a question word or end with ?)
  const looksLikeQuestion = /\?$/.test(text) || /\b(what|why|how|which|who|when|could|can|would|tell|describe)\b/i.test(text)
  if (!looksLikeQuestion) return false
  // Must not echo back problematic content
  if (SKIP_PATTERNS.some(p => p.test(text))) return false
  return true
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

  // ── Input guardrail: skip before hitting the API ──────────────────────
  if (!isAnswerSafe(answer)) {
    return NextResponse.json({ question: null })
  }

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

Your job is to generate ONE short, natural follow-up question that draws out more specific detail from their answer.

Rules:
- Maximum 25 words
- Sound warm and conversational, not clinical
- Do not repeat anything already asked
- Ask only one question -- pick the single most valuable angle
- Stay strictly on-topic to the survey subject matter
- If their answer already has enough detail, return exactly: SKIP
- If their answer is off-topic, nonsensical, inappropriate, or abusive, return exactly: SKIP
- Never echo back offensive, harmful, or inappropriate content from the respondent
- Respond with ONLY the question or SKIP -- no preamble, no quotes`

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
        model:      'claude-haiku-4-5-20251001',
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

    if (text === 'SKIP') {
      return NextResponse.json({ question: null })
    }

    const clean = text.replace(/^["']|["']$/g, '').trim()

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
