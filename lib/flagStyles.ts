// lib/flagStyles.ts
// Shared rendering helper for conversation_turns.content_flags pills.
// Pure (no React deps) so it works in any UI module + tests + scripts.
//
// Conventions:
//   - 'focus:<slug>'  — assistant-side; what the bot's reply covered.
//                       Teal. Set by lib/focusClassifier.classifyResponseFocuses.
//   - 'topic:<slug>'  — user-side; what the user actually talked about.
//                       Amber. Set by lib/probeFocusClassifier (BOTS § 9.x.1).
//                       Used to detect matched vs mismatched prompt↔response.
//   - 'entity:<slug>' — user-side; KB-extracted entity mentioned in the turn.
//                       Emerald. Set by lib/entityMentionDetector (BOTS § 9.y).
//                       String match against bot-scoped entity_catalog.
//   - 'intent:<LABEL>'— user-side action intent. Blue.
//   - 'safety:<flag>' / 'outside_scope' / 'profanity' / etc. — content guard.
//                       Yellow / red palette depending on severity.

export interface FlagStyle {
  bg: string
  color: string
  label: string
}

const FIXED: Record<string, FlagStyle> = {
  profanity:     { bg: '#FEF3C7', color: '#92400E', label: 'Profanity' },
  insult:        { bg: '#FEF3C7', color: '#92400E', label: 'Insult' },
  slur:          { bg: '#FEE2E2', color: '#dc2626', label: 'Slur' },
  threat:        { bg: '#FEE2E2', color: '#dc2626', label: 'Threat' },
  sexual:        { bg: '#FEE2E2', color: '#dc2626', label: 'Sexual' },
  spam:          { bg: '#F3F4F6', color: '#6b7280', label: 'Spam' },
  outside_scope: { bg: '#EDE9FE', color: '#7c3aed', label: 'Off-topic' },
}

/** True for the fixed safety/scope flag set — useful for filter UIs
 *  that don't want to enumerate every dynamic focus:/topic:/intent:
 *  tag as a button. */
export function isFixedFlag(f: string): boolean {
  return f in FIXED
}

export function getFlagStyle(f: string): FlagStyle {
  if (FIXED[f]) return FIXED[f]
  if (f.startsWith('intent:')) {
    return { bg: '#DBEAFE', color: '#1D4ED8', label: f.replace('intent:', '').replace(/_/g, ' ') }
  }
  if (f.startsWith('focus:')) {
    return { bg: '#ECFEFF', color: '#0E7B7B', label: f.replace('focus:', '').replace(/[-_]/g, ' ') }
  }
  if (f.startsWith('topic:')) {
    return { bg: '#FEF3C7', color: '#B45309', label: f.replace('topic:', '').replace(/[-_]/g, ' ') }
  }
  if (f.startsWith('entity:')) {
    return { bg: '#D1FAE5', color: '#047857', label: f.replace('entity:', '').replace(/[-_]/g, ' ') }
  }
  return { bg: '#F3F4F6', color: '#6b7280', label: f }
}
