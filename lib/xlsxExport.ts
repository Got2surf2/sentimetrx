// lib/xlsxExport.ts
// Shared utilities for exporting tabular data as CSV or XLSX from API routes.
// Routes pass a `format` (from ?format=csv|xlsx) and one or more sheets,
// and get back a ready-to-return NextResponse with the right Content-Type
// and Content-Disposition headers.
//
// CSV is single-sheet by nature — when exporting multi-sheet data as CSV,
// only the first sheet's rows are emitted. XLSX preserves all sheets.

import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'

export type ExportFormat = 'csv' | 'xlsx'

export interface Sheet {
  name: string
  headers: string[]
  rows: unknown[][]
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v).trim()
  return /[,"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function buildCsv(headers: string[], rows: unknown[][]): string {
  return [
    headers.map(csvEscape).join(','),
    ...rows.map(r => r.map(csvEscape).join(',')),
  ].join('\n')
}

export function buildXlsx(sheets: Sheet[]): Buffer {
  const wb = XLSX.utils.book_new()
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet([s.headers, ...s.rows])
    // Excel sheet names are max 31 chars and can't contain certain symbols.
    const safeName = (s.name || 'Sheet').replace(/[\\/?*[\]:]/g, '_').slice(0, 31)
    XLSX.utils.book_append_sheet(wb, ws, safeName)
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}

/**
 * Build a NextResponse for either CSV or XLSX output. Pass one sheet for
 * CSV-compatible exports; XLSX may include multiple sheets.
 *
 * filenameBase is sanitized (lowercased, non-alphanumerics → '-') and the
 * appropriate extension is appended.
 */
export function dataResponse(
  format: ExportFormat,
  filenameBase: string,
  sheets: Sheet[],
): NextResponse {
  const safe = (filenameBase || 'export').replace(/[^a-z0-9-_]/gi, '-').toLowerCase()
  if (format === 'xlsx') {
    // Build a fresh ArrayBuffer copy so it satisfies the strict Web Response BodyInit
    // (the Node Buffer's underlying ArrayBufferLike isn't assignable directly).
    const buf = buildXlsx(sheets)
    const ab = new ArrayBuffer(buf.byteLength)
    new Uint8Array(ab).set(buf)
    return new NextResponse(ab, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="' + safe + '.xlsx"',
      },
    })
  }
  // CSV: emit the first sheet only.
  const s = sheets[0] || { name: 'Sheet1', headers: [], rows: [] }
  const csv = buildCsv(s.headers, s.rows)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + safe + '.csv"',
    },
  })
}

/** Parse and clamp a ?format= query value to a known export format. */
export function parseExportFormat(raw: string | null | undefined, fallback: ExportFormat = 'csv'): ExportFormat {
  return raw === 'xlsx' ? 'xlsx' : raw === 'csv' ? 'csv' : fallback
}
