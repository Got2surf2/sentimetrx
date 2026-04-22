// app/api/deflect/route.ts
// AI-powered question/off-topic detection and contextual deflection

import { NextRequest, NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'
import { callAI } from '@/lib/ai'
import { cleanDeflectResponse } from '@/lib/guardrails'

export const dynamic = 'force-dynamic'

interface DeflectRequest {
  studyName:    string
  orgName?:     string
  questionAsked: string   // the bot's question the respondent was answering
  answer:       string    // the respondent's answer (may be a question or off-topic)
  linkText?:    string    // e.g. "our website" — optional
  linkUrl?:     string    // e.g. "https://example.com/faq" — optional
  customMessage?: string  // user-written deflection instruction or exact message
  language?:    string    // language code for non-English surveys
  testing?:     boolean   // testing mode: return debug reasoning
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

  const { studyName, orgName, questionAsked, answer, linkText, linkUrl, customMessage, language } = body
  const hasLink = !!(linkUrl && linkUrl.trim())

  if (!answer || answer.trim().length < 3) {
    return NextResponse.json({ deflection: null })
  }

  // If the user provided a custom message, use it directly (still need AI to detect if deflection is needed)
  const linkInstruction = hasLink
    ? `- Includes {{LINK}} where they can find answers\n- Use {{LINK}} exactly once`
    : `- Do NOT include any links or URLs`

  const customInstruction = customMessage?.trim()
    ? `\nIMPORTANT — Use this as your deflection message (adapt it naturally to what they said): "${customMessage.trim()}"`
    : ''

  const systemPrompt = `You are analyzing a respondent's reply in a feedback survey to decide if they went off-topic.

The survey question was: "${questionAsked}"
The respondent replied: "${answer}"

DECISION:
- If they gave ANY form of feedback — opinions, complaints, praise, suggestions, stories, emotions, even if brief, tangential, or passionate — respond with exactly: NONE
- Rhetorical questions count as feedback (e.g. "Why can't they just fix it?" = complaint, not a question needing an answer)
- Only deflect if they are CLEARLY asking for information, requesting help, or talking about something completely unrelated to the survey topic

If deflection IS needed, write a SHORT (max 25 words), natural, human-sounding message that:
- Feels like a real person, not a corporate bot
- Gently steers back to the survey without being dismissive
${hasLink ? linkInstruction : '- Do NOT include any links or URLs'}
${customInstruction}

RULES:
- Output ONLY the redirect message, or NONE — nothing else
- No analysis, no reasoning, no classification text
- Do NOT mention the bot name, organization name, or survey name
- NEVER mention "Datanautix", "sentimetrx", or any platform/tool names
- Do NOT say "I'm just a survey bot" or "I'm just collecting feedback" — too robotic
- Be warm and conversational, like a friendly interviewer
${language ? `\nIMPORTANT: The respondent is taking this survey in ${language}. You MUST write your deflection message in ${language}. Do NOT respond in English.` : ''}
${body.testing ? `\nDEBUG MODE — Think step by step. Before your response, explain your reasoning (is this feedback or a question? what signals did you notice? why are you deflecting or not?). Then write a line containing exactly "---RESPONSE---" and your actual response (NONE or the deflection message) after it.` : ''}`

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: body.testing ? 400 : 100,
      system: systemPrompt,
      messages: [{ role: 'user', content: 'Analyze the respondent\'s reply and respond accordingly.' }],
    })

    const cleaned = cleanDeflectResponse(result.text || '', !!body.testing)

    if (!cleaned.deflection) {
      return NextResponse.json({ deflection: null, ...(body.testing ? { _debug: ['DEFLECT CHECK: AI returned NONE — response is on-topic feedback, no deflection needed', ...(cleaned.thinking.length ? ['AI REASONING:', ...cleaned.thinking] : [])] } : {}) })
    }

    let text = cleaned.deflection

    // Replace {{LINK}} placeholder with actual link markup (if link configured)
    // Sanitize linkUrl and linkText to prevent XSS
    const safeUrl = (linkUrl || '').replace(/["<>]/g, '').replace(/^javascript:/i, '')
    const safeText = (linkText || 'our website').replace(/[<>&"]/g, (c: string) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c] || c))
    const deflection = hasLink
      ? text.replace('{{LINK}}', `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer">${safeText}</a>`)
      : text.replace(/\{\{LINK\}\}/g, '')

    const debugInfo = body.testing ? [
      'DEFLECT TRIGGERED: Respondent went off-topic',
      'AI raw: "' + (result.text?.trim() || '').slice(0, 200) + '"',
      'After cleanup: "' + deflection.slice(0, 200) + '"',
      ...(cleaned.thinking.length ? ['AI REASONING:', ...cleaned.thinking] : []),
    ] : undefined

    return NextResponse.json({ deflection, ...(debugInfo ? { _debug: debugInfo } : {}) })

  } catch (err) {
    console.error('Deflect API error:', err)
    return NextResponse.json({ deflection: null })
  }
}
