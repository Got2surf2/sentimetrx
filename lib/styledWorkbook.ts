import 'server-only'

// lib/styledWorkbook.ts
// Client-grade styled .xlsx builder (exceljs) for the agent workbook export.
// Takes the same { name, headers, rows } Sheet shape the SheetJS path uses, so
// callers can swap in styling without reshaping their data. Kept separate from
// lib/xlsxExport.ts (SheetJS) on purpose — the other spreadsheet exports
// (Town Hall, the single-shape bot exports) stay on the lightweight path; only
// this deliverable pays the exceljs weight for bold/fills/borders/wrap, which
// the free SheetJS build can't write.

import ExcelJS from 'exceljs'
import type { Sheet } from '@/lib/xlsxExport'

// Brand accent (the app's teal, #0F7173) + neutrals, in exceljs ARGB.
const TEAL = 'FF0F7173'
const HEADER_TEXT = 'FFFFFFFF'
const ZEBRA = 'FFEFF5F5'
const BORDER = 'FFE2E8E8'
const TITLE_TEXT = 'FF0F7173'

const thin = { style: 'thin' as const, color: { argb: BORDER } }
const ALL_BORDERS = { top: thin, left: thin, bottom: thin, right: thin }

function safeName(name: string): string {
  return (name || 'Sheet').replace(/[\\/?*[\]:]/g, '_').slice(0, 31)
}

// Column widths from content: longest cell (or header) per column, clamped so a
// chatty answer column doesn't blow the sheet out. Wrapped text handles the rest.
function colWidths(headers: string[], rows: unknown[][]): number[] {
  return headers.map((h, c) => {
    let max = String(h ?? '').length
    for (const r of rows) {
      const len = String(r[c] ?? '').length
      if (len > max) max = len
    }
    return Math.max(10, Math.min(60, max + 2))
  })
}

// The Summary tab is a key/value layout, not a table — style it as a titled
// sheet (no filter, no zebra) so it reads like a cover page.
function styleSummary(ws: ExcelJS.Worksheet, sheet: Sheet) {
  ws.columns = [{ width: 42 }, { width: 30 }]
  const title = ws.getRow(1)
  title.getCell(1).value = sheet.headers[0] || 'Summary'
  title.getCell(1).font = { bold: true, size: 16, color: { argb: TITLE_TEXT } }
  title.height = 24
  ws.addRow([]) // spacer under the title (headers[1] is blank for Summary)
  for (const r of sheet.rows) {
    const row = ws.addRow(r as any[])
    const label = String(r[0] ?? '')
    const isSection = label !== '' && !label.startsWith('  ') && (r[1] === '' || r[1] == null)
    if (isSection) {
      row.getCell(1).font = { bold: true, size: 12, color: { argb: 'FF374151' } }
    } else {
      row.getCell(1).font = { color: { argb: 'FF6B7280' } }
      row.getCell(2).font = { bold: true, color: { argb: 'FF111827' } }
      // Left-align so numeric values (128) line up with text values (88%)
      // instead of floating to the right edge of the column.
      row.getCell(2).alignment = { horizontal: 'left' }
    }
  }
}

function styleTable(ws: ExcelJS.Worksheet, sheet: Sheet) {
  const widths = colWidths(sheet.headers, sheet.rows)
  ws.columns = widths.map(w => ({ width: w }))

  const header = ws.addRow(sheet.headers)
  header.height = 22
  header.eachCell(cell => {
    cell.font = { bold: true, color: { argb: HEADER_TEXT }, size: 11 }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TEAL } }
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true }
    cell.border = ALL_BORDERS
  })

  sheet.rows.forEach((r, i) => {
    const row = ws.addRow(r as any[])
    const zebra = i % 2 === 1
    row.eachCell({ includeEmpty: true }, cell => {
      cell.alignment = { vertical: 'top', wrapText: true }
      cell.border = ALL_BORDERS
      if (zebra) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ZEBRA } }
    })
  })

  // Freeze the header + filter dropdowns across the full header span.
  ws.views = [{ state: 'frozen', ySplit: 1 }]
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.headers.length },
  }
}

export async function buildStyledWorkbook(sheets: Sheet[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Sentimetrx'
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(safeName(sheet.name))
    if (sheet.name === 'Summary') styleSummary(ws, sheet)
    else styleTable(ws, sheet)
  }
  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf as ArrayBuffer)
}
