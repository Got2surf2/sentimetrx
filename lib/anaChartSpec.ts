// lib/anaChartSpec.ts
// Inline charts in Ana's answers (2026-09-02, owner: "draw charts instead of
// tables where appropriate"). Ana emits a fenced block:
//
//   ```chart
//   {"type":"bar","title":"1-star reviews by location","unit":"reviews",
//    "data":[["San Diego",58],["Chula Vista",44]]}
//   ```
//
// and the panel renders it as a real chart. This module is the PARSER only —
// pure and unit-tested. Malformed blocks degrade to plain text (never a broken
// bubble); an unterminated fence while streaming yields a 'pending' segment.
// Single-series only by design: the product's chart hue carries the series,
// values come verbatim from Ana's query results, and anything richer belongs
// on the Charts tab via the "Open in Charts" handoff.

export interface AnaChartSpec {
  type: 'bar' | 'line'
  title: string
  unit?: string
  data: [string, number][]
}

export type AnaSegment =
  | { kind: 'text'; text: string }
  | { kind: 'chart'; spec: AnaChartSpec }
  | { kind: 'pending' }

const MAX_BAR_ROWS = 12
const MAX_LINE_POINTS = 60

export function parseAnaChartSpec(raw: string): AnaChartSpec | null {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  if (o.type !== 'bar' && o.type !== 'line') return null
  if (typeof o.title !== 'string' || !o.title.trim()) return null
  if (!Array.isArray(o.data) || o.data.length === 0) return null
  const cap = o.type === 'bar' ? MAX_BAR_ROWS : MAX_LINE_POINTS
  const data: [string, number][] = []
  for (const row of o.data.slice(0, cap)) {
    if (!Array.isArray(row) || row.length < 2) return null
    const label = String(row[0])
    const value = Number(row[1])
    if (!Number.isFinite(value)) return null
    data.push([label, value])
  }
  return {
    type: o.type,
    title: o.title.trim().slice(0, 120),
    unit: typeof o.unit === 'string' ? o.unit.slice(0, 40) : undefined,
    data,
  }
}

/** Split answer text into text / chart / pending segments. */
export function splitAnaSegments(text: string): AnaSegment[] {
  const segments: AnaSegment[] = []
  const OPEN = '```chart'
  let rest = text
  while (true) {
    const start = rest.indexOf(OPEN)
    if (start === -1) break
    const before = rest.slice(0, start)
    if (before.trim()) segments.push({ kind: 'text', text: before })
    const bodyStart = start + OPEN.length
    const end = rest.indexOf('```', bodyStart)
    if (end === -1) {
      // Unterminated fence — still streaming (or truncated): placeholder.
      segments.push({ kind: 'pending' })
      return segments
    }
    const raw = rest.slice(bodyStart, end).trim()
    const spec = parseAnaChartSpec(raw)
    if (spec) segments.push({ kind: 'chart', spec })
    else segments.push({ kind: 'text', text: raw })  // degrade to visible text
    rest = rest.slice(end + 3)
  }
  if (rest.trim() || segments.length === 0) segments.push({ kind: 'text', text: rest })
  return segments
}
