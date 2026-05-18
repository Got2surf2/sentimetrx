import 'server-only'

// lib/specDriftReports.ts
// Parses the committed weekly spec-drift reports in docs/weekly-reports/
// (YYYY-WXX-drift.md) into typed structures the
// /admin/control-reports/spec-drift page can chart and list.
// Authoritative format: the markdown that scripts/spec-drift.ts emits
// with --write-weekly — see renderWeeklyMarkdown.

import { readdir, readFile } from 'fs/promises'
import path from 'path'

export interface DriftedSpec {
  spec:           string  // e.g. "docs/SECURITY.md"
  codeCommits:    number  // commits touching mapped code paths
}

export interface WeeklyDriftReport {
  week:        string          // "2026-W21"
  weekNumber:  number          // 21
  year:        number          // 2026
  dateRange:   string | null   // "May 18 to May 24"
  generatedAt: string | null   // ISO timestamp from "**Generated**: ..."
  sinceRef:    string | null   // short SHA from "**Since ref**: `abc1234`"
  commitsInRange: number | null

  specsTracked: number | null
  drifted:      number | null
  updated:      number | null
  clean:        number | null
  driftRate:    number | null  // percent, 0-100

  driftedSpecs: DriftedSpec[]
}

const REPORTS_DIR = path.join(process.cwd(), 'docs', 'weekly-reports')

function parseSummaryRow(body: string, label: string): number | null {
  // "| Drifted (code changed, spec not updated) | **0** |"
  // Match the label up to the next "|" and pull the first number out of the value cell.
  const escaped = label.replace(/[.+^${}()|[\]\\?*]/g, '\\$&')
  const re = new RegExp(`\\|\\s*${escaped}[^|]*\\|\\s*\\**\\s*([\\d.]+)`, 'i')
  const m = body.match(re)
  return m ? parseFloat(m[1]) : null
}

function parseDriftRate(body: string): number | null {
  const m = body.match(/\|\s*Drift rate[^|]*\|\s*([\d.]+)\s*%/i)
  return m ? parseFloat(m[1]) : null
}

function parseDriftedSpecs(body: string): DriftedSpec[] {
  // The renderer emits a "## Drift detail" section with per-spec H3s
  //   ### ⚠️ `docs/CAMPAIGNS.md`
  //   2 commits touched code mapped to this spec; the spec itself was not edited.
  const out: DriftedSpec[] = []
  const blocks = body.split(/^### ⚠️ /m).slice(1)
  for (const blk of blocks) {
    const specMatch = blk.match(/^`([^`]+)`/)
    const countMatch = blk.match(/(\d+)\s+commits?\s+touched code/i)
    if (specMatch && countMatch) {
      out.push({ spec: specMatch[1], codeCommits: parseInt(countMatch[1], 10) })
    }
  }
  return out
}

export function parseDriftReport(filename: string, body: string): WeeklyDriftReport | null {
  // Filename: 2026-W21-drift.md
  const m = filename.match(/^(\d{4})-W(\d{1,2})-drift\.md$/i)
  if (!m) return null
  const year = parseInt(m[1], 10)
  const weekNumber = parseInt(m[2], 10)
  const week = `${year}-W${String(weekNumber).padStart(2, '0')}`

  // Date range from H1: "Week of May 18 to May 24)"
  const dateMatch = body.match(/Week of\s+([^)]+?)\)/)
  const dateRange = dateMatch ? dateMatch[1].trim() : null

  const genMatch = body.match(/\*\*Generated\*\*:\s*([^\n]+)/)
  const generatedAt = genMatch ? genMatch[1].trim() : null

  const refMatch = body.match(/\*\*Since ref\*\*:\s*`([^`]+)`\s*—\s*(\d+)\s+commits/i)
  const sinceRef = refMatch ? refMatch[1] : null
  const commitsInRange = refMatch ? parseInt(refMatch[2], 10) : null

  return {
    week,
    year,
    weekNumber,
    dateRange,
    generatedAt,
    sinceRef,
    commitsInRange,
    specsTracked: parseSummaryRow(body, 'Specs tracked'),
    drifted:      parseSummaryRow(body, 'Drifted'),
    updated:      parseSummaryRow(body, 'Updated'),
    clean:        parseSummaryRow(body, 'Clean'),
    driftRate:    parseDriftRate(body),
    driftedSpecs: parseDriftedSpecs(body),
  }
}

export async function loadAllDriftReports(): Promise<WeeklyDriftReport[]> {
  let files: string[] = []
  try {
    files = await readdir(REPORTS_DIR)
  } catch {
    return []
  }
  const reportFiles = files.filter(f => /^\d{4}-W\d{1,2}-drift\.md$/i.test(f))
  const reports: WeeklyDriftReport[] = []
  for (const f of reportFiles) {
    try {
      const body = await readFile(path.join(REPORTS_DIR, f), 'utf8')
      const parsed = parseDriftReport(f, body)
      if (parsed) reports.push(parsed)
    } catch {
      /* ignore individual file failures */
    }
  }
  reports.sort((a, b) => (a.year - b.year) || (a.weekNumber - b.weekNumber))
  return reports
}
