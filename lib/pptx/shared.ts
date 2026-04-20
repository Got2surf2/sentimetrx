// lib/pptx/shared.ts
// Shared PPTX generation utilities used across signal-tiers-deck,
// townhall export, and datasets export routes.

// ── Datanautix brand palette ─────────────────────────────────────────────────
// Core colors shared by all PPTX routes.
export const DN = {
  navy:       '0D2B45',
  teal:       '0F7173',
  tealLight:  '4DBFC1',
  orange:     'E85A1A',
  orangeLight:'F07040',
  gold:       'E8B84B',
  white:      'FFFFFF',
  slate:      '8FA3AE',
  slateLight: 'E8EDEF',
  slateCard:  'F4F7F8',
  divider:    'D4DDE2',
  green:      '059669',
  greenLight: 'D1FAE5',
  amber:      'D97706',
  amberLight: 'FEF3C7',
  red:        'DC2626',
  redLight:   'FEE2E2',
}

// ── Layout constants ─────────────────────────────────────────────────────────
export const W   = 13.33  // slide width
export const H   = 7.5    // slide height
export const HH  = 0.9    // header height
export const CY  = 1.05   // content start Y
export const PAD = 0.42   // horizontal padding
export const FY  = H - 0.28 // footer Y position

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Full-slide background fill */
export function bgFill(slide: any, pptx: any, color = DN.slateCard) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color }, line: { width: 0 } })
}

/** Datanautix wordmark logo in top-right of header */
export function logo(slide: any) {
  slide.addText(
    [
      { text: 'data', options: { color: DN.orangeLight, bold: true, italic: true } },
      { text: 'nautix', options: { color: DN.tealLight, bold: true, italic: true } },
    ],
    { x: W - 2.3, y: 0.1, w: 2.1, h: HH - 0.18, fontSize: 15, valign: 'middle', align: 'right' }
  )
}

/** Truncate string with ellipsis */
export function trunc(s: string, n: number) {
  return !s ? '' : s.length > n ? s.slice(0, n - 1) + '\u2026' : s
}
