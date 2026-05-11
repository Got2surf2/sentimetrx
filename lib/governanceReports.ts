import 'server-only'

// lib/governanceReports.ts
// Parses the committed weekly governance reports in docs/weekly-reports/
// into typed structures the /admin/governance page can chart and list.
// Authoritative format: the markdown templates the /audit-codebase
// slash command emits — a "Codebase Health Audit" table with 7 rows
// (Secrets, Security, Dependencies, Structure, Tests, Documentation,
// Maintainability) plus a Total line.

import { readdir, readFile } from 'fs/promises'
import path from 'path'

export interface CategoryScore {
  category: string
  score:    number    // 0-10
  weight:   number    // percentage as decimal (0.15 etc)
  weighted: number    // score * weight (mostly informational; total is the truth)
}

export interface WeeklyReport {
  week:        string          // "2026-W19"
  weekNumber:  number          // 19
  year:        number          // 2026
  dateRange:   string | null   // "Week of May 4 to May 10"
  generatedAt: string | null   // ISO timestamp from "**Generated**: ..."
  total:       number | null   // 0-100
  categories:  CategoryScore[]
  prUrl:       string | null   // GitHub PR for this report (if discoverable)
}

const REPORTS_DIR = path.join(process.cwd(), 'docs', 'weekly-reports')

function parseFraction(s: string): number | null {
  // "8/10" → 8 ; "65.0 / 100" → 65 ; tolerates whitespace
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*\/\s*\d+(?:\.\d+)?/)
  return m ? parseFloat(m[1]) : null
}

function parsePercent(s: string): number | null {
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*%/)
  return m ? parseFloat(m[1]) / 100 : null
}

export function parseReport(filename: string, body: string): WeeklyReport | null {
  // Filename: 2026-W19.md (NOT 2026-W19-devlog.md)
  const m = filename.match(/^(\d{4})-W(\d{1,2})\.md$/i)
  if (!m) return null
  const year = parseInt(m[1], 10)
  const weekNumber = parseInt(m[2], 10)
  const week = `${year}-W${String(weekNumber).padStart(2, '0')}`

  // Date range from the H1 ("Week of May 4 to May 10")
  const dateMatch = body.match(/Week of\s+([^)]+?)\)/)
  const dateRange = dateMatch ? dateMatch[1].trim() : null

  // Generated timestamp
  const genMatch = body.match(/\*\*Generated\*\*:\s*([^\n]+)/)
  const generatedAt = genMatch ? genMatch[1].trim() : null

  // Category rows: "| Secrets | 8/10 | 15% | 1.20 |"
  const categories: CategoryScore[] = []
  const expectedCategories = ['Secrets', 'Security', 'Dependencies', 'Structure', 'Tests', 'Documentation', 'Maintainability']
  for (const cat of expectedCategories) {
    const re = new RegExp(`\\|\\s*${cat}\\s*\\|\\s*([^|]+)\\|\\s*([^|]+)\\|\\s*([^|\\n]+)\\|`, 'i')
    const row = body.match(re)
    if (!row) continue
    const score = parseFraction(row[1])
    const weight = parsePercent(row[2])
    const weighted = parseFloat(row[3].trim())
    if (score == null || weight == null) continue
    categories.push({ category: cat, score, weight, weighted: Number.isFinite(weighted) ? weighted : score * weight })
  }

  // Total: row 8 of the table. The leading column is empty so the regex
  // is different: "| **Total** | | **100%** | **65.0 / 100** |"
  let total: number | null = null
  const totalMatch = body.match(/\|\s*\*\*Total\*\*[^\n]*\*\*\s*([\d.]+)\s*\/\s*100/i)
  if (totalMatch) total = parseFloat(totalMatch[1])

  return {
    week,
    year,
    weekNumber,
    dateRange,
    generatedAt,
    total,
    categories,
    // PR URLs aren't embedded in the report; the GitHub PR list is the
    // canonical link. Leave null so the UI can fall back to that.
    prUrl: null,
  }
}

export async function loadAllReports(): Promise<WeeklyReport[]> {
  let files: string[] = []
  try {
    files = await readdir(REPORTS_DIR)
  } catch {
    return []
  }
  // Match `2026-W19.md` but exclude `2026-W19-devlog.md`
  const reportFiles = files.filter(f => /^\d{4}-W\d{1,2}\.md$/i.test(f))
  const reports: WeeklyReport[] = []
  for (const f of reportFiles) {
    try {
      const body = await readFile(path.join(REPORTS_DIR, f), 'utf8')
      const parsed = parseReport(f, body)
      if (parsed) reports.push(parsed)
    } catch {
      /* ignore individual file failures */
    }
  }
  // Oldest first — charts read left-to-right.
  reports.sort((a, b) => (a.year - b.year) || (a.weekNumber - b.weekNumber))
  return reports
}
