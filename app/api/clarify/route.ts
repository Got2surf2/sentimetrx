// app/api/clarify/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { isInputSafe, isOutputSafe, extractQuestion } from '@/lib/guardrails'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface ClarifyRequest {
  studyName:       string
  studyPurpose:    string
  studyGuid?:      string                 // public guid — lets server attribute usage to the study
  questionAsked:   string
  questionKey:     'q1' | 'q3' | 'q4'
  answer:          string
  sentiment:       string
  experienceScore: number
  npsScore:        number
  priorQA:         Array<{ question: string; answer: string }>
  industry?:       string
  language?:       string
  testing?:        boolean
}

export async function POST(req: NextRequest) {
  // Rate limit: 10 AI clarification requests per minute per IP
  var ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
  var rl = await checkRateLimit('clarify:' + ip, 10, 60000)
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
    priorQA, language,
  } = body

  // ── Input guardrail: skip before hitting the API ──────────────────────
  if (!isInputSafe(answer)) {
    return NextResponse.json({ question: null })
  }

  // Resolve study by guid (best-effort) so usage rolls up under the study.
  let studyOrgId: string | undefined
  let studyId: string | undefined
  if (body.studyGuid && typeof body.studyGuid === 'string') {
    try {
      const svc = createServiceRoleClient()
      const { data: studyRow } = await svc
        .from('studies').select('id, org_id').eq('guid', body.studyGuid).maybeSingle()
      if (studyRow) {
        studyId = studyRow.id as string
        studyOrgId = studyRow.org_id as string
      }
    } catch { /* swallow; usage logging is best-effort */ }
  }

  const priorContext = (priorQA || [])
    .filter(p => p && p.answer)
    .map(p => p.question ? `Q: "${p.question}"\n  A: "${p.answer}"` : `- "${p.answer}"`)
    .join('\n')

  const systemPrompt = `You are a conversational survey bot conducting a feedback survey on behalf of the organization "${studyName}".
Your purpose: ${studyPurpose}

The respondent has:
- Experience score: ${experienceScore}/5 (${sentiment})
- NPS score: ${npsScore}/5
${priorContext ? `\nThe respondent has ALREADY answered these earlier questions in this same survey — this detail is captured, do NOT ask them to repeat or expand on any of it:\n${priorContext}` : ''}

Your job is to generate ONE short, natural follow-up question that draws out more specific detail from their answer.

Rules:
- Maximum 25 words
- Sound warm and conversational, not clinical
- Do not repeat anything already asked
- Ask only one question -- pick the single most valuable angle
- Stay strictly on-topic to the survey subject matter
- If the answer only refers back to something already covered in the earlier answers above (e.g. "just the slow pacing I mentioned earlier", "same issue as before"), that detail is ALREADY captured — return exactly: SKIP. Never ask them to re-explain or add more to a point they already made earlier.
- Only return SKIP if the answer is very detailed (3+ specific points) OR it only restates earlier feedback. Otherwise short or vague answers should get a follow-up
- If their answer is off-topic, nonsensical, inappropriate, or abusive, return exactly: SKIP
- Never echo back offensive, harmful, or inappropriate content from the respondent
- NEVER mention "Datanautix", "sentimetrx", or any platform/tool names — only reference "${studyName}" as the organization

CRITICAL OUTPUT FORMAT:
- Your ENTIRE response must be ONLY the follow-up question itself, or SKIP
- Do NOT include ANY reasoning, analysis, thinking, or commentary
- Do NOT write phrases like "Got it", "Here's my follow-up", "I'll ask about...", "The respondent..."
- Do NOT explain your thought process or rationale
- Just output the bare question text — nothing else
${language ? `\nIMPORTANT: The respondent is taking this survey in ${language}. You MUST write your follow-up question in ${language}. Do NOT respond in English.` : ''}
${body.testing ? `\nDEBUG MODE — Think step by step. Before your response, explain your reasoning (what you noticed about the answer, why you chose this follow-up angle, what you considered). Then write a line containing exactly "---RESPONSE---" and your actual follow-up question (or SKIP) after it.` : ''}`

  const userPrompt = `The survey asked: "${questionAsked}"
The respondent answered: "${answer}"

Generate a targeted follow-up question or return SKIP.`

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: body.testing ? 400 : 80,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    })

    logUsage({
      org_id:        studyOrgId,
      resource_type: studyId ? 'study' : 'system',
      resource_id:   studyId,
      event_type:    'clarify',
    }, result.usage)

    let rawText = result.text?.trim() || 'SKIP'
    let aiThinking: string[] = []

    // Parse verbose thinking if present
    if (body.testing && rawText.includes('---RESPONSE---')) {
      const [thinkingPart, responsePart] = rawText.split('---RESPONSE---')
      aiThinking = thinkingPart.trim().split('\n').filter(Boolean)
      rawText = responsePart.trim()
    }

    const text = rawText

    if (text === 'SKIP') {
      return NextResponse.json({ question: null, ...(body.testing ? { _debug: ['AI returned SKIP — response was sufficient, no clarification needed', ...(aiThinking.length ? ['AI REASONING:', ...aiThinking] : [])] } : {}) })
    }

    const clean = extractQuestion(text)

    // ── Output guardrail: validate before returning ────────────────────
    if (!isOutputSafe(clean)) {
      return NextResponse.json({ question: null, ...(body.testing ? { _debug: ['AI generated a response but it failed the output safety guardrail', 'AI raw: "' + text.slice(0, 200) + '"', ...(aiThinking.length ? ['AI REASONING:', ...aiThinking] : [])] } : {}) })
    }

    const debug = body.testing ? [
      'CLARIFIER FIRED on "' + body.questionKey + '"',
      'Sentiment: ' + body.sentiment + ' | Rating: ' + body.experienceScore + '/5 | NPS: ' + body.npsScore + '/5',
      'Answer length: ' + body.answer.split(/\s+/).length + ' words',
      'AI raw: "' + text.slice(0, 200) + '"',
      ...(aiThinking.length ? ['AI REASONING:', ...aiThinking] : []),
    ] : undefined

    return NextResponse.json({ question: clean, ...(debug ? { _debug: debug } : {}) })

  } catch (err) {
    console.error('Clarify API error:', err)
    return NextResponse.json({ question: null })
  }
}
