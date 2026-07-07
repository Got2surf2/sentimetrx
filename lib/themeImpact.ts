// lib/themeImpact.ts
// Shared theme impact / key driver analysis.
// Client-safe — works in both browser (ChartsModule) and server (PPTX export).

import { buildKwRegex } from './themeUtils'
import { olsRegression, type RegressionResult } from './statsUtils'

type RegressionCoef = RegressionResult['coefs'][number]

export interface ThemeImpactInput {
  themes: { id: string; name: string; keywords: string[] }[]
  rows: Record<string, unknown>[]
  scoreField: string
  textFields: string[]     // OE field keys
  scoreRemapping?: Record<string, number>  // for categorical → numeric
  rowKeyMap?: Record<string, string>       // normalized → actual key map
}

export interface ThemeImpactResult {
  themeName: string
  themeId: string
  coefficient: number      // regression coefficient
  pValue: number
  significant: boolean     // p < 0.05
  ci: [number, number] | null
  mentions: number
  avgScore: number         // average score when theme present
  delta: number            // avgScore - overallAvg (simple comparison)
}

export interface ImpactAnalysis {
  impacts: ThemeImpactResult[]
  intercept: number
  rSquared: number
  adjustedR2: number
  overallAvg: number
  n: number
  fieldLabel?: string      // which OE field this is for
}

function resolveKey(field: string, rowKeyMap?: Record<string, string>): string {
  if (!rowKeyMap) return field
  const norm = field.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return rowKeyMap[norm] || field
}

/**
 * Run theme impact regression on rows.
 * Returns null if insufficient data.
 */
export function computeThemeImpact(input: ThemeImpactInput, fieldLabel?: string): ImpactAnalysis | null {
  const { themes, rows, scoreField, textFields, scoreRemapping, rowKeyMap } = input
  if (!themes.length || !rows.length || rows.length < 30) return null

  // Pre-compile theme regexes
  const themeRegexes = themes.map(t =>
    (t.keywords || []).filter(Boolean).map(buildKwRegex)
  )

  const scoreKey = resolveKey(scoreField, rowKeyMap)
  const textKeys = textFields.map(f => resolveKey(f, rowKeyMap))

  const yVals: number[] = []
  const xRows: number[][] = []
  const tCounts: number[] = new Array(themes.length).fill(0)
  const tScoreSums: number[] = new Array(themes.length).fill(0)
  let allScoreSum = 0

  for (const row of rows) {
    // Get score
    let y: number
    const rawVal = row[scoreKey]
    if (scoreRemapping && scoreRemapping[String(rawVal)]) {
      y = scoreRemapping[String(rawVal)]
    } else {
      y = parseFloat(String(rawVal ?? ''))
    }
    if (isNaN(y)) continue

    // Get text
    let text = ''
    for (const tk of textKeys) {
      const v = row[tk]
      if (v != null && String(v).trim()) text += ' ' + String(v).trim()
    }
    text = text.toLowerCase().trim()
    if (!text) continue

    // Theme indicators
    const indicators: number[] = []
    for (let ti = 0; ti < themeRegexes.length; ti++) {
      const matched = themeRegexes[ti].length > 0 && themeRegexes[ti].some(re => re.test(text))
      indicators.push(matched ? 1 : 0)
      if (matched) { tCounts[ti]++; tScoreSums[ti] += y }
    }

    yVals.push(y)
    xRows.push(indicators)
    allScoreSum += y
  }

  if (yVals.length < 30) return null
  const overallAvg = allScoreSum / yVals.length

  // Filter to themes with 5+ mentions
  const validIdx: number[] = []
  for (let ti = 0; ti < themes.length; ti++) {
    if (tCounts[ti] >= 5) validIdx.push(ti)
  }
  if (validIdx.length < 2) return null

  const filteredX = xRows.map(row => validIdx.map(ti => row[ti]))
  const tNames = validIdx.map(ti => themes[ti].name)

  const result = olsRegression(yVals, filteredX, tNames)
  if (!result || !result.coefs) return null

  const interceptCoef = result.coefs.find((c: RegressionCoef) => c.name === 'Intercept')

  const impacts: ThemeImpactResult[] = result.coefs
    .filter((c: RegressionCoef) => c.name !== 'Intercept')
    .map((c: RegressionCoef, idx: number) => {
      const ti = validIdx[idx]
      const avgWhenPresent = tCounts[ti] > 0 ? tScoreSums[ti] / tCounts[ti] : overallAvg
      return {
        themeId: themes[ti].id,
        themeName: c.name,
        coefficient: Math.round(c.beta * 1000) / 1000,
        pValue: Math.round(c.p * 10000) / 10000,
        significant: c.p < 0.05,
        ci: c.ci ? [Math.round(c.ci[0] * 1000) / 1000, Math.round(c.ci[1] * 1000) / 1000] as [number, number] : null,
        mentions: tCounts[ti],
        avgScore: Math.round(avgWhenPresent * 100) / 100,
        delta: Math.round((avgWhenPresent - overallAvg) * 1000) / 1000,
      }
    })
    .sort((a: ThemeImpactResult, b: ThemeImpactResult) => Math.abs(b.coefficient) - Math.abs(a.coefficient))

  return {
    impacts,
    intercept: interceptCoef ? Math.round(interceptCoef.beta * 1000) / 1000 : overallAvg,
    rSquared: Math.round(result.R2 * 10000) / 10000,
    adjustedR2: Math.round(result.R2adj * 10000) / 10000,
    overallAvg: Math.round(overallAvg * 100) / 100,
    n: yVals.length,
    fieldLabel,
  }
}
