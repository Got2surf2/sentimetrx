// lib/csv.ts
// CSV / TSV / SurveyMonkey parsing for dataset uploads.
//
// Extracted from app/analyze/new/UploadClient.tsx (2026-09-01). The client
// parser toggled `inQ` on every `"` and never emitted one, so interior quote
// marks were silently dropped — 2,796 of 125,897 prod ANES rows had verbatim
// text mangled. It also split on newlines BEFORE parsing, so a quoted field
// containing a line break broke its row in two. This parser walks the whole
// text once (RFC4180): `""` inside a quoted field is a literal quote, and
// separators inside quotes are data, not structure.

/**
 * Parse CSV text into records of trimmed field strings.
 * Handles: BOM, CRLF/CR/LF line endings, `""` escaped quotes, and commas or
 * newlines inside quoted fields. Blank lines are skipped; a row of empty
 * fields (`,,`) is kept, matching the previous upload behavior.
 */
export function parseCSVRecords(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n')
  const records: string[][] = []
  let row: string[] = []
  let field = ''
  let inQ = false

  function endField() { row.push(field.trim()); field = '' }
  function endRow() {
    endField()
    // A blank line parses as one empty field — skip it. `,,` parses as
    // several empty fields and is kept.
    if (row.length > 1 || row[0] !== '') records.push(row)
    row = []
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (inQ) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }
        else inQ = false
      } else field += ch
    } else if (ch === '"') inQ = true
    else if (ch === ',') endField()
    else if (ch === '\n' || ch === '\r') endRow()
    else field += ch
  }
  endRow()
  return records
}

/** Parse CSV text into row objects keyed by the first record's headers. */
export function parseCSV(text: string): Record<string, unknown>[] {
  const records = parseCSVRecords(text)
  if (records.length < 2) return []
  const headers = records[0]
  return records.slice(1).map(function(vals) {
    const row: Record<string, unknown> = {}
    headers.forEach(function(h, i) { row[h] = vals[i] ?? '' })
    return row
  })
}

export function parseTSV(text: string): Record<string, unknown>[] {
  const lines = text.trim().split('\n').filter(function(l) { return l.trim() })
  if (lines.length < 2) return []
  const headers = lines[0].split('\t').map(function(h) { return h.trim() })
  return lines.slice(1).map(function(line) {
    const vals = line.split('\t')
    const row: Record<string, unknown> = {}
    headers.forEach(function(h, i) { row[h] = vals[i] ?? '' })
    return row
  })
}

// ── SurveyMonkey detection & parsing ──────────────────────────────────────
// SM exports carry TWO header rows: the question on row 1 (blank for matrix
// continuations) and the answer-option sub-label on row 2.

const SM_META_COLS = ['respondent id', 'collector id', 'start date', 'end date', 'ip address', 'email address', 'first name', 'last name', 'custom data']
const SM_SUB_NOISE = ['', 'response', 'open-ended response', 'other (please specify)', 'comment']

export function isSurveyMonkeyCSV(text: string): boolean {
  const records = parseCSVRecords(text)
  if (records.length < 3) return false
  const row1 = records[0]
  const row2 = records[1]
  if (row1.length !== row2.length) return false

  // Check 1: first column looks like SM metadata
  const firstLower = (row1[0] || '').toLowerCase().trim()
  const hasSmMeta = SM_META_COLS.some(function(m) { return firstLower.includes(m) })

  // Check 2: row1 has duplicate headers (matrix questions)
  const seen = new Set<string>()
  let dupeCount = 0
  row1.forEach(function(h) {
    const lh = h.toLowerCase().trim()
    if (lh && seen.has(lh)) dupeCount++
    seen.add(lh)
  })

  // Check 3: row2 mostly has short/noise sub-labels, not full data
  let noiseCount = 0
  row2.forEach(function(v) {
    if (SM_SUB_NOISE.includes(v.toLowerCase().trim())) noiseCount++
  })
  const row2IsSubHeader = noiseCount > row2.length * 0.3

  return (hasSmMeta && row2IsSubHeader) || (dupeCount >= 2 && row2IsSubHeader) || (hasSmMeta && dupeCount >= 2)
}

export function parseSurveyMonkeyCSV(text: string): { rows: Record<string, unknown>[]; mergedHeaders: string[] } {
  const records = parseCSVRecords(text)
  if (records.length < 3) return { rows: [], mergedHeaders: [] }

  const row1 = records[0]
  const row2 = records[1]

  // Merge the two header rows into one clean set of column names
  const headers: string[] = []
  let lastParent = ''
  const colCounts: Record<string, number> = {}

  for (let c = 0; c < row1.length; c++) {
    let parent = (row1[c] || '').trim()
    const sub = (row2[c] || '').trim()
    const subLower = sub.toLowerCase()

    // Track the parent for matrix continuation (blank row1 = same question)
    if (parent) lastParent = parent
    else parent = lastParent

    let merged = ''
    if (!sub || SM_SUB_NOISE.includes(subLower) || sub === parent) {
      // No meaningful sub-label — just use parent
      merged = parent
    } else {
      // Combine parent + sub for matrix items
      merged = parent + ' - ' + sub
    }

    // Deduplicate: if we've seen this header, append a number
    if (!merged) merged = 'Column ' + (c + 1)
    if (colCounts[merged]) {
      colCounts[merged]++
      merged = merged + ' (' + colCounts[merged] + ')'
    } else {
      colCounts[merged] = 1
    }

    headers.push(merged)
  }

  // Parse data rows (skip first 2 header rows)
  const rows = records.slice(2).map(function(vals) {
    const row: Record<string, unknown> = {}
    headers.forEach(function(h, i) { row[h] = vals[i] ?? '' })
    return row
  })

  return { rows: rows, mergedHeaders: headers }
}
