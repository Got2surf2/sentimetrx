// app/api/townhall/simulate/route.ts
// POST — Generate a simulated participant response based on persona profile + bot question + session context

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'

export const dynamic = 'force-dynamic'
export const maxDuration = 15

// Detects when the model returned a safety-style refusal instead of a
// participant response. If a persona's bio/edge/flags ask for something the
// model declines (harassment, sexualization, etc.), the raw refusal text
// would otherwise land in the conversation as a "comment" — which is what
// the user reported seeing on 2026-05-07. Patterns are distinctive enough
// that legit community-meeting responses shouldn't false-positive.
function looksLikeAIRefusal(text: string): boolean {
  const t = text.toLowerCase()
  const patterns = [
    /\bi need to (respectfully )?decline\b/,
    /\bthis roleplay request\b/,
    /\bcan't play (a |this )?character\b/,
    /\beven in a simulated\b/,
    /\bi'd be happy to roleplay as\b/,
    /\bi'm not able to (play|roleplay|continue|simulate)\b/,
    /\bas an ai( language)? model\b/,
    /\bi (can't|cannot) (in good conscience|generate|create|produce|engage with)\b/,
    /\bi (don't|do not) feel comfortable\b/,
    /\bdesigned to harass\b/,
    /\bsexualize interactions\b/,
  ]
  return patterns.some(p => p.test(t))
}

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const { persona, bot_message, session_context, turn_number, language } = body

  if (!persona?.name || !bot_message) {
    return NextResponse.json({ error: 'Missing persona or bot_message' }, { status: 400 })
  }

  const ctx = session_context || {}
  const isLangSwitch = persona.flags?.includes('language-switch') && turn_number >= 3
  const targetLang = isLangSwitch ? (persona.switch_language || 'es') : (language || 'en')

  const prompt = `You are role-playing as a participant in a community discussion. Stay in character.

CHARACTER PROFILE:
- Name/Role: ${persona.name}
- Background: ${persona.bio}
- Attitude: ${persona.attitude || persona.sentiment}
- Communication style: ${persona.style || 'natural, conversational'}
${persona.concerns ? '- Key concerns: ' + persona.concerns : ''}
${persona.edge ? '- Behavioral trait: ' + persona.edge : ''}

SESSION CONTEXT:
${ctx.org_name ? '- Organization: ' + ctx.org_name : ''}
${ctx.event_description ? '- Event: ' + ctx.event_description : ''}
${ctx.topics ? '- Discussion topics: ' + ctx.topics.join(', ') : ''}

The moderator just asked you: "${bot_message}"

This is turn ${turn_number || 1} of your conversation.
${isLangSwitch ? '\nIMPORTANT: Respond in ' + targetLang + ' (you are switching languages mid-conversation). Write naturally in that language.' : ''}
${persona.flags?.includes('curt-detection') ? '\nIMPORTANT: Give very short, disengaged responses (1-5 words). You do not want to be here.' : ''}
${persona.flags?.includes('off-topic-redirect') ? '\nIMPORTANT: Ignore the question and talk about your own pet issue instead. Be persistent about it.' : ''}
${persona.flags?.includes('content-safety') && turn_number >= 3 ? '\nIMPORTANT: Express growing frustration. Use mild profanity (damn, hell, crap, bs). Do NOT use slurs or threats.' : ''}
${persona.flags?.includes('content-safety') && turn_number < 3 && persona.attitude?.includes('hostility') ? '\nIMPORTANT: You are hostile and aggressive from the start. Use profanity freely (damn, hell, crap, bullshit). Escalate each turn.' : ''}
${persona.flags?.includes('sensitive-politics') ? '\nIMPORTANT: Bring up political angles — mention elected officials, campaign donations, backroom deals, government transparency.' : ''}
${persona.flags?.includes('sensitive-discrimination') ? '\nIMPORTANT: Express concerns about demographic changes in coded language — "who these units attract", "neighborhood character", "property crime statistics".' : ''}

RULES:
- Respond as this character would naturally speak (1-3 sentences, casual tone)
- React to the specific question asked, using the session context
- Stay consistent with your attitude and concerns
- Do NOT break character or mention that you are simulating
- Do NOT use quotation marks around your response
- Output ONLY your response, nothing else`

  try {
    const result = await callAI({
      tier: 'fast',
      maxTokens: 200,
      timeoutMs: 5000,
      system: 'You are a role-play actor. Stay in character. Output ONLY the character\'s spoken response.',
      messages: [{ role: 'user', content: prompt }],
    })
    logUsage({ resource_type: 'townhall', event_type: 'simulate' }, result.usage)
    const cleaned = result.text.trim().replace(/^["']|["']$/g, '')
    if (looksLikeAIRefusal(cleaned)) {
      console.warn('[townhall/simulate] AI refusal detected for persona "' + persona.name + '"; substituting fallback. text=' + cleaned.slice(0, 200))
      return NextResponse.json({
        message: persona.flags?.includes('curt-detection') ? 'ok' : 'I think that\'s an important issue for our community.',
        language: targetLang,
        refused: true,
      })
    }
    return NextResponse.json({ message: cleaned, language: targetLang })
  } catch {
    // Fallback: generic response
    return NextResponse.json({
      message: persona.flags?.includes('curt-detection') ? 'ok' : 'I think that\'s an important issue for our community.',
      language: targetLang,
    })
  }
}
