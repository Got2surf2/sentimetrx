// lib/recordings/panel.ts
//
// "Is this speaker an organizer?" — matches a quote's speaker against the
// meeting's panel roster (recordings.setup_inputs.panel). Community-voice
// analysis (commentary, quotes, themes, sentiment) must EXCLUDE panel/organizer
// speech, the same way agent analysis only counts the human's turns and ignores
// the bot's own. Panel *answers* stay attached to their Q&A pair (the official
// response); panel *statements* and any panel-authored content are dropped from
// community surfaces.
//
// Pure + deterministic. Matching is normalized (case/punctuation/whitespace) and
// tolerant of middle initials — "Hatem A. Abou-Senna" matches "Hatem Abou-Senna"
// — by requiring the panel name's first AND last token to appear in the
// candidate. Conservative on purpose: a false exclusion (dropping a real
// community member) is worse than a rare miss, so partial/single-name matches
// don't trigger.

import type { PanelMember } from '@/lib/recordings/types'

function tokens(s: string | null | undefined): string[] {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[.,'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(t => t.length > 1) // drop single-letter middle initials
}

/**
 * True when `name` belongs to someone on the `panel` roster. Empty/absent name
 * or roster → false (nothing excluded), so a meeting with no roster filtered is
 * left untouched rather than over-filtered.
 */
export function isPanelMember(name: string | null | undefined, panel: PanelMember[] | null | undefined): boolean {
  if (!name || !panel || panel.length === 0) return false
  const cand = new Set(tokens(name))
  if (cand.size === 0) return false
  for (const p of panel) {
    const pt = tokens(p?.name)
    if (pt.length === 0) continue
    const first = pt[0]
    const last = pt[pt.length - 1]
    // Single-token roster name → that token must appear; multi-token → both the
    // first and last (surname) must appear in the candidate.
    if (cand.has(first) && cand.has(last)) return true
  }
  return false
}
