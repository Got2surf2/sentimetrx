// lib/languageSwitch.ts
//
// Detects when a participant in a chat / town hall is asking to switch the
// conversation language. Hybrid: fast regex for obvious requests (zero cost),
// AI classifier fallback for ambiguous short messages (only when an AI
// callback is provided).
//
// Extracted from app/api/townhall/chat/route.ts as part of convergence
// Phase 2 (docs/CONVERGENCE.md). Used today only by the town hall route;
// will be wired into the bots route in Phase 3 when both routes share a
// single chat handler.

export const LANG_CODES = ['en','es','fr','de','pt','it','zh','ja','ko','ar','hi','vi','tl','ru','pl']

// Language name → ISO code map for regex matching. Includes native-script
// names so a participant typing "español" or "中文" is recognized without
// the model round-trip.
export const LANG_NAMES: Record<string, string> = {
  english: 'en', spanish: 'es', español: 'es', espanol: 'es',
  french: 'fr', français: 'fr', francais: 'fr',
  german: 'de', deutsch: 'de',
  portuguese: 'pt', português: 'pt', portugues: 'pt',
  italian: 'it', italiano: 'it',
  chinese: 'zh', mandarin: 'zh', '中文': 'zh',
  japanese: 'ja', '日本語': 'ja',
  korean: 'ko', '한국어': 'ko',
  arabic: 'ar', 'العربية': 'ar',
  hindi: 'hi', 'हिन्दी': 'hi',
  vietnamese: 'vi', 'tiếng việt': 'vi',
  filipino: 'tl', tagalog: 'tl',
  russian: 'ru', 'русский': 'ru',
  polish: 'pl', polski: 'pl',
}

// Bilingual confirmation messages — surfaced as the bot's reply when a
// switch is detected, so the participant sees both the language they asked
// for and an English bridge.
export const SWITCH_CONFIRM: Record<string, string> = {
  es: "Sure — switching to Spanish! / ¡Claro — cambiando a español!",
  fr: "Sure — switching to French! / Bien sûr — on passe au français !",
  de: "Sure — switching to German! / Klar — wir wechseln zu Deutsch!",
  pt: "Sure — switching to Portuguese! / Claro — mudando para português!",
  it: "Sure — switching to Italian! / Certo — passiamo all'italiano!",
  zh: "Sure — switching to Chinese! / 好的，切换到中文！",
  ja: "Sure — switching to Japanese! / はい、日本語に切り替えます！",
  ko: "Sure — switching to Korean! / 네, 한국어로 전환합니다!",
  ar: "Sure — switching to Arabic! / !بالطبع — سننتقل إلى العربية",
  hi: "Sure — switching to Hindi! / बिल्कुल — हिंदी में बात करते हैं!",
  vi: "Sure — switching to Vietnamese! / Được — chuyển sang tiếng Việt!",
  tl: "Sure — switching to Filipino! / Sige — lilipat tayo sa Filipino!",
  ru: "Sure — switching to Russian! / Конечно — переключаемся на русский!",
  pl: "Sure — switching to Polish! / Jasne — przechodzimy na polski!",
  en: "Sure — switching back to English!",
}

// System prompt for the AI classifier fallback. The classifier is conservative
// by design (95% confidence floor) so an ambiguous "I think the Spanish
// community needs more support" doesn't get misclassified as a switch request.
export const LANGUAGE_SWITCH_CLASSIFIER_PROMPT = `You are a language-switch classifier for a chat system. The user is mid-conversation with an AI moderator.

Determine if this message is ONLY a request to switch the conversation language.
Return JSON: {"is_switch": true/false, "lang": "ISO code", "confidence": 0-100}

RULES:
- Confidence must be >= 95 to count. Be conservative — err on the side of NOT detecting.
- A message like "español" or "can you speak French?" is a clear switch (confidence 98-100).
- A message like "no hablo inglés" or "je ne parle pas anglais" is a switch (confidence 95+).
- A message that MENTIONS a language but is actually answering a question is NOT a switch. E.g. "I think the Spanish community needs more support" — this talks ABOUT Spanish, not requesting Spanish.
- If the message contains substantive content beyond the language request, it is NOT a pure switch — return is_switch: false.
- Supported languages: ${LANG_CODES.join(', ')}
- Return ONLY the JSON, nothing else.`

/**
 * Fast regex-based detection. No AI call. Catches the most common request
 * shapes instantly: bare language name, "speak X", "can you speak X",
 * "no hablo English"-style negations. Returns the ISO code or null.
 */
export function fastDetectLanguageSwitch(msg: string): string | null {
  const lower = msg.toLowerCase().trim()
  // Pattern 1: Just a language name, optionally with "please" / "por favor" / etc.
  const bareMatch = lower.replace(/\s*(please|por favor|s'il vous plaît|bitte|per favore)\s*/gi, '').trim()
  if (LANG_NAMES[bareMatch]) return LANG_NAMES[bareMatch]

  // Pattern 2: "speak/switch/change to X", "can you speak X", "use X"
  const actionMatch = lower.match(/(?:speak|switch|change|use|talk|respond|write|switch to|change to)\s+(?:in\s+)?(\S+(?:\s+\S+)?)/i)
  if (actionMatch && LANG_NAMES[actionMatch[1].toLowerCase()]) return LANG_NAMES[actionMatch[1].toLowerCase()]

  // Pattern 3: "can you speak X" / "could you speak X" / "please speak X"
  const politeMatch = lower.match(/(?:can you|could you|please)\s+(?:speak|use|switch to|switch)\s+(?:in\s+)?(\S+(?:\s+\S+)?)/i)
  if (politeMatch && LANG_NAMES[politeMatch[1].replace(/[?.!]$/, '').toLowerCase()]) return LANG_NAMES[politeMatch[1].replace(/[?.!]$/, '').toLowerCase()]

  // Pattern 4: "no hablo/speak X" → switch to user's language
  if (/no\s+(hablo|speak|understand)\s+(english|inglés|ingles)/i.test(lower)) return 'es'
  if (/je\s+ne\s+parle\s+pas\s+(anglais|english)/i.test(lower)) return 'fr'
  if (/não\s+falo\s+(inglês|english)/i.test(lower)) return 'pt'
  if (/ich\s+spreche\s+kein\s+(englisch|english)/i.test(lower)) return 'de'

  return null
}

/**
 * Adapter callers pass for the AI fallback. Should send the classifier
 * prompt as system and the user message as user, and return the model's
 * raw text (which is expected to be JSON matching `{is_switch, lang, confidence}`).
 *
 * Returning null or non-JSON is treated as "no switch detected" — the
 * classifier is biased toward false negatives by design.
 */
export type LanguageSwitchAIClassifier = (msg: string) => Promise<string | null>

/**
 * Detect whether a participant message is a request to switch language.
 *
 * - Returns `null` for long messages (>120 chars — those are real responses).
 * - Returns the regex result instantly when a fast pattern matches.
 * - Otherwise, falls back to the AI classifier IF one is provided AND the
 *   message is short enough (<=60 chars) for the call to be worth it.
 * - Confidence floor of 95% on the AI side prevents false positives.
 */
export async function detectLanguageSwitch(
  msg: string,
  aiClassifier?: LanguageSwitchAIClassifier,
): Promise<{ lang: string; confidence: number } | null> {
  if (msg.length > 120) return null

  const fastResult = fastDetectLanguageSwitch(msg)
  if (fastResult) return { lang: fastResult, confidence: 100 }

  if (msg.length > 60) return null
  if (!aiClassifier) return null

  try {
    const raw = await aiClassifier(msg)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (parsed.is_switch && parsed.confidence >= 95 && LANG_CODES.includes(parsed.lang)) {
      return { lang: parsed.lang, confidence: parsed.confidence }
    }
  } catch { /* AI call or parse failed — not a switch */ }

  return null
}
