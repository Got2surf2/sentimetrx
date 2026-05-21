// lib/botProbeGuards.ts
// Heuristics that suppress server-side probe-enforcement nudges on
// no-content user turns. The chat route forces a "CRITICAL OVERRIDE" probe
// after N turns when a configured detection regex hasn't matched yet. That
// fired even when the user's current message was social filler (greeting,
// thanks, sign-off), which produced jarring "by the way..." pivots on
// turns that had no substance to anchor against.
//
// Related: lib/engagementSignals.ts holds the converse SUBTLE_DISENGAGE
// regex used by the town hall route. The two regexes overlap in a few
// short tokens ("ok", "yeah") but encode different policies: this one is
// "sociable filler, skip the probe"; the other is "possibly disengaged,
// trigger an AI tone check." Keep them separate.

import { countWords } from '@/lib/engagementSignals'

/**
 * Returns true when the user's current message has no substantive content
 * and should not trigger a probe nudge this turn. Conservative by design:
 * any '?' or message > 6 words is treated as substantive.
 */
export function isInfoOnlyMessage(text: string | null | undefined): boolean {
  if (!text) return true
  const trimmed = text.trim()
  if (trimmed.length === 0) return true
  if (/\?/.test(trimmed)) return false

  if (countWords(trimmed) > 6) return false

  // Strip trailing punctuation/emoji clusters before regex compare.
  const normalized = trimmed.toLowerCase().replace(/[\s!.,;:~\-]+$/, '')

  return INFO_ONLY_PATTERNS.test(normalized)
}

// Matched against the lowercased, trim-punct'd message. Each alternative
// is anchored to start; the trailing $ ensures we don't accept partial
// matches like "thanks for the link about <substantive thing>".
const INFO_ONLY_PATTERNS = new RegExp(
  '^(' +
    [
      // Greetings
      'hi', 'hello', 'hey', 'yo', 'sup', 'howdy',
      'hi there', 'hello there', 'hey there',
      'good morning', 'good afternoon', 'good evening', 'good night',
      // Thanks
      'thanks', 'thank you', 'thx', 'ty', 'tysm',
      'thanks so much', 'thank you so much', 'thanks a lot', 'thanks a million',
      'appreciate it', 'appreciate that', 'much appreciated',
      // Acknowledgements
      'ok', 'okay', 'k', 'kk', 'cool', 'nice', 'great', 'awesome',
      'sounds good', 'makes sense', 'fair enough', 'fair point',
      'gotcha', 'got it', 'i see', 'i understand', 'understood',
      'sure', 'yes', 'yeah', 'yep', 'yup', 'no', 'nope', 'nah',
      'right', 'true', 'correct', 'interesting', 'wow', 'huh',
      'haha', 'lol', 'lmao', 'hehe',
      'alright', 'fine', 'good', 'excellent', 'perfect',
      // Sign-offs
      'bye', 'goodbye', 'see ya', 'see you', 'later', 'cya',
      'take care', 'talk soon', 'talk to you later', 'ttyl',
      'np', 'no problem', 'no worries',
    ].join('|') +
  ')$',
  'i'
)
