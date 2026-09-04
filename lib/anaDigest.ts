// Dataset digest — the "since you last looked" heads-up delta that leads
// Ana's opening briefing (owner surface decision 2026-09-04: start in the
// briefing; converges with the future shoulder tap as the scheduled vs
// threshold-triggered modes of one system).
//
// This is a DELTA report, not a summary (summaries are Data Story's job).
// Every figure is diffed IN CODE between two stored snapshots — the model
// is told to lead with them, never to recompute them. Theme figures are the
// stored theme model's own cached match counts (the same numbers the theme
// cards display), so every line is recreatable inside the platform. We
// deliberately report COUNT deltas, not share deltas: the cards' displayed
// percentages use the substantive-comments base (2026-08-18), which isn't
// stored in the snapshot — a share computed against rowCount here would
// reconcile with nothing on screen.

export interface VisitSnapshot {
  rowCount: number
  // Only themes with a real cached count — a theme whose count hasn't been
  // computed yet is untracked rather than stored as a fake 0.
  themeCounts: Record<string, number>
  // Which question's framework the counts belong to (theme sets are
  // per-field); counts across different sets are not comparable.
  themeFieldKey: string
}

interface ThemeLike {
  name?: string
  label?: string
  count?: number
}

export function buildVisitSnapshot(rowCount: number, themes: ThemeLike[], themeFieldKey: string): VisitSnapshot {
  const themeCounts: Record<string, number> = {}
  themes.forEach(function (t) {
    const name = t.name || t.label
    if (name && typeof t.count === 'number') themeCounts[name] = t.count
  })
  return { rowCount, themeCounts, themeFieldKey }
}

const MAX_THEME_LINES = 4

function agoLabel(prevAtIso: string, now: Date): string {
  const ms = now.getTime() - new Date(prevAtIso).getTime()
  const days = Math.floor(ms / 86400000)
  if (days <= 0) return 'earlier today'
  if (days === 1) return '1 day ago'
  return days + ' days ago'
}

// Returns the system-prompt block for the briefing turn, or null when there
// is no previous snapshot to diff against (first visit).
export function buildDigest(prev: VisitSnapshot | null, curr: VisitSnapshot, prevAtIso: string, now?: Date): string | null {
  if (!prev) return null
  const ago = agoLabel(prevAtIso, now || new Date())
  const lines: string[] = []

  const rowDelta = curr.rowCount - prev.rowCount
  if (rowDelta > 0) {
    lines.push('- Rows: ' + prev.rowCount.toLocaleString() + ' → ' + curr.rowCount.toLocaleString() +
      ' (+' + rowDelta.toLocaleString() + ' new since the last visit ' + ago + ')')
  } else if (rowDelta < 0) {
    lines.push('- Rows: ' + prev.rowCount.toLocaleString() + ' → ' + curr.rowCount.toLocaleString() +
      ' (' + rowDelta.toLocaleString() + ' since the last visit ' + ago + ' — rows were removed or re-synced)')
  } else {
    lines.push('- Rows: unchanged at ' + curr.rowCount.toLocaleString() + ' since the last visit ' + ago)
  }

  // Theme deltas only when both snapshots describe the same framework.
  if (prev.themeFieldKey === curr.themeFieldKey) {
    const moves: Array<{ name: string; from: number; to: number }> = []
    Object.keys(curr.themeCounts).forEach(function (name) {
      const from = prev.themeCounts[name]
      if (typeof from === 'number' && from !== curr.themeCounts[name]) {
        moves.push({ name, from, to: curr.themeCounts[name] })
      }
    })
    moves.sort(function (a, b) { return Math.abs(b.to - b.from) - Math.abs(a.to - a.from) })
    moves.slice(0, MAX_THEME_LINES).forEach(function (m) {
      const d = m.to - m.from
      lines.push('- Theme "' + m.name + '": ' + m.from.toLocaleString() + ' → ' + m.to.toLocaleString() +
        ' matches (' + (d > 0 ? '+' : '') + d.toLocaleString() + ')')
    })
    if (moves.length > MAX_THEME_LINES) {
      lines.push('- (' + (moves.length - MAX_THEME_LINES) + ' more theme count changes not listed)')
    }
    Object.keys(curr.themeCounts).forEach(function (name) {
      if (!(name in prev.themeCounts)) {
        lines.push('- New theme since the last visit: "' + name + '" (' + curr.themeCounts[name].toLocaleString() + ' matches)')
      }
    })
    Object.keys(prev.themeCounts).forEach(function (name) {
      if (!(name in curr.themeCounts)) {
        lines.push('- Theme removed since the last visit: "' + name + '"')
      }
    })
  }

  return '\n\nSINCE THE ANALYST’S LAST VISIT (computed by the platform from stored state — exact figures, not estimates; LEAD the briefing with these deltas and do NOT recompute them):\n' +
    lines.join('\n') +
    '\nIf only the row line is present and rows are unchanged, say in one short line that nothing has changed since their last visit ' + ago + ', then give your normal read.'
}
