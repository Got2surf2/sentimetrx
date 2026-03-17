// lib/themeUtils.ts
// Client-safe pure utilities for theme matching, counting, and text utilities.
// No server-only imports. Safe to use in browser components.

export interface Theme {
  id: string
  name: string
  description: string
  keywords: string[]
  sentiment: string
  count: number
  percentage: number
  ciLow?: number
  ciHigh?: number
  relatedThemes: string[]
}

export interface ThemeModel {
  themes: Theme[]
  summary: string
  fieldName: string
  fieldNames?: string[]
  themeSource?: string | null
  themeLibName?: string | null
  samplingInfo?: { sampled: number; total: number } | null
}

export interface TextSegment {
  text: string
  matched: boolean
}

// Stem-aware keyword regex (no global flag -- avoids lastIndex bug on repeated test())
function buildKwRegex(kw: string): RegExp {
  const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp('(?<![a-z])' + esc + '\\w*', 'i')
}

export function commentMatchesTheme(text: string, theme: Theme): boolean {
  if (!theme || !theme.keywords || !theme.keywords.length) return false
  const t = text.toLowerCase()
  return theme.keywords.some(function(kw) {
    return buildKwRegex(kw).test(t)
  })
}

// Wilson score interval — lower and upper bounds at 95% confidence
function wilsonCI(count: number, total: number): { ciLow: number; ciHigh: number } {
  if (total === 0) return { ciLow: 0, ciHigh: 0 }
  const z = 1.96
  const p = count / total
  const z2 = z * z
  const denom = 1 + z2 / total
  const centre = p + z2 / (2 * total)
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
  const lo = Math.max(0, (centre - spread) / denom)
  const hi = Math.min(1, (centre + spread) / denom)
  return { ciLow: Math.round(lo * 100), ciHigh: Math.round(hi * 100) }
}

export function recountThemes(
  themes: Theme[],
  rows: Record<string, unknown>[],
  field: string | string[]
): Theme[] {
  const fields = Array.isArray(field) ? field : [field]
  const nonEmpty = rows.filter(function(r) {
    return fields.some(function(f) {
      return String(r[f] || '').trim().length > 0
    })
  })
  return themes.map(function(t) {
    const count = nonEmpty.filter(function(r) {
      const text = fields.map(function(f) { return String(r[f] || '') }).join(' ')
      return commentMatchesTheme(text, t)
    }).length
    const pct = nonEmpty.length > 0 ? Math.round(count / nonEmpty.length * 100) : 0
    const ci = wilsonCI(count, nonEmpty.length)
    return { ...t, count, percentage: pct, ciLow: ci.ciLow, ciHigh: ci.ciHigh }
  })
}

export function sampleSize95(n: number): number {
  const Z = 1.96, p = 0.5, e = 0.05
  const n0 = (Z * Z * p * (1 - p)) / (e * e)
  return n <= n0 ? n : Math.ceil(n0 * n / (n0 + n - 1))
}

export function evenSample<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr
  const step = arr.length / n
  return Array.from({ length: n }, function(_, i) {
    return arr[Math.floor(i * step)]
  })
}

// Returns text split into matched/unmatched keyword segments for highlighting
export function highlightKeywords(text: string, keywords: string[]): TextSegment[] {
  if (!keywords || !keywords.length) return [{ text, matched: false }]
  const parts: TextSegment[] = []
  let remaining = text
  let guard = 0
  while (remaining.length > 0 && guard < 2000) {
    guard++
    let earliest = -1
    let earliestEnd = -1
    for (let ki = 0; ki < keywords.length; ki++) {
      const kw = keywords[ki]
      if (!kw) continue
      const esc = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const re = new RegExp('(?<![a-z])' + esc + '\\w*', 'i')
      const m = remaining.match(re)
      if (m && m.index !== undefined) {
        if (earliest === -1 || m.index < earliest) {
          earliest = m.index
          earliestEnd = m.index + m[0].length
        }
      }
    }
    if (earliest === -1) {
      parts.push({ text: remaining, matched: false })
      break
    }
    if (earliest > 0) parts.push({ text: remaining.slice(0, earliest), matched: false })
    parts.push({ text: remaining.slice(earliest, earliestEnd), matched: true })
    remaining = remaining.slice(earliestEnd)
  }
  return parts
}

// Sentiment display helpers
export function sentColor(s: string): string {
  const map: Record<string, string> = {
    positive: '#16a34a',
    negative: '#dc2626',
    mixed: '#d97706',
    neutral: '#6b7280',
  }
  return map[s] || '#6b7280'
}

export function sentBg(s: string): string {
  const map: Record<string, string> = {
    positive: '#f0fdf4',
    negative: '#fef2f2',
    mixed: '#fffbeb',
    neutral: '#f9fafb',
  }
  return map[s] || '#f9fafb'
}

// Ana THEME_PALETTE -- 20 unique colours for theme cards (no repeats up to 20 themes)
export const THEME_PALETTE = [
  { bg: '#fff0e6', border: '#e8622a', text: '#b84a18', light: '#ffe4d0' },
  { bg: '#eff6ff', border: '#2563eb', text: '#1d4ed8', light: '#dbeafe' },
  { bg: '#f0fdf4', border: '#16a34a', text: '#15803d', light: '#bbf7d0' },
  { bg: '#f5f3ff', border: '#7c3aed', text: '#6d28d9', light: '#ddd6fe' },
  { bg: '#fff7ed', border: '#ea580c', text: '#c2410c', light: '#fed7aa' },
  { bg: '#fdf4ff', border: '#a21caf', text: '#86198f', light: '#f5d0fe' },
  { bg: '#f0fdfa', border: '#0d9488', text: '#0f766e', light: '#99f6e4' },
  { bg: '#fefce8', border: '#ca8a04', text: '#a16207', light: '#fef08a' },
  // Extended: 8 more unique hues
  { bg: '#fdf2f8', border: '#db2777', text: '#be185d', light: '#fbcfe8' },
  { bg: '#ecfeff', border: '#0891b2', text: '#0e7490', light: '#a5f3fc' },
  { bg: '#fef2f2', border: '#dc2626', text: '#b91c1c', light: '#fecaca' },
  { bg: '#f0f9ff', border: '#0284c7', text: '#075985', light: '#bae6fd' },
  { bg: '#ecfdf5', border: '#059669', text: '#047857', light: '#a7f3d0' },
  { bg: '#fffbeb', border: '#d97706', text: '#92400e', light: '#fde68a' },
  { bg: '#f5f3ff', border: '#6366f1', text: '#4338ca', light: '#c7d2fe' },
  { bg: '#fff1f2', border: '#e11d48', text: '#be123c', light: '#fecdd3' },
  { bg: '#f0fdfa', border: '#14b8a6', text: '#0d9488', light: '#5eead4' },
  { bg: '#faf5ff', border: '#9333ea', text: '#7e22ce', light: '#d8b4fe' },
  { bg: '#f7fee7', border: '#65a30d', text: '#4d7c0f', light: '#bef264' },
  { bg: '#fff7ed', border: '#f97316', text: '#c2410c', light: '#fdba74' },
]

export function getThemeColor(idx: number) {
  return THEME_PALETTE[idx % THEME_PALETTE.length]
}

// Row text helpers
export function getRowText(row: Record<string, unknown>, fields: string[]): string {
  return fields.map(function(f) { return String(row[f] || '') }).join(' ').trim()
}
