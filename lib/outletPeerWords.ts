// lib/outletPeerWords.ts
//
// The plain-words vocabulary the outlet deep-dive uses for peer standing, shared
// by the on-screen "Deeper analysis" tabs and the composed PDF. Pure formatting,
// no imports — the point is that the two surfaces cannot drift apart on how a
// percentile or a month is worded. If you change a phrase here it changes in
// both places, which is the intent.

export const pct1 = (n: number) => `${(n * 100).toFixed(1)}%`

// Exemplar labels carry the brand prefix ("Rubio's … — Laguna Niguel, CA"); the
// brand is already the page/document eyebrow, so show just the location half.
export function locOnly(label: string): string {
  const i = label.indexOf(' — ')
  return i >= 0 ? label.slice(i + 3) : label
}

// How far into the worst tail an outlet sits on a theme, in plain words.
export const rankWord = (p: number) =>
  p >= 90 ? 'bottom 10%' : p >= 75 ? 'bottom 25%' : `worse than ${Math.round(p)}% of locations`

// The mirror of rankWord for a top-quartile standing.
export const topWord = (p: number) => (p <= 10 ? 'top 10%' : 'top 25%')

// "2026-05" → "May '26" for a trend axis.
export function monthLabel(m: string): string {
  const [y, mo] = m.split('-')
  const names = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${names[Number(mo)] || mo} '${y.slice(2)}`
}
