// lib/pdf.ts
//
// Shared PDF DESIGN SYSTEM — the single source of truth for fonts, colours,
// spacing, typographic scale, section/card/pill layout, and the keep-together
// pagination rule that every PDF template must follow (memory:
// feedback_pdf_template_rules; docs/ENGINEERING.md §6). Pure string builders, no
// server-only deps, so renderers stay testable. Pair with `brandedPdfChrome`
// (lib/htmlToPdf) for the per-page header/footer.
//
// A renderer composes content with the helpers here and wraps it in pdfDoc();
// it never re-declares fonts/colours/heading styles — change them ONCE here and
// every PDF updates.

// ── Design tokens ────────────────────────────────────────────────────────────
export const PDF = {
  font: `-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif`,
  // Brand primaries (datanautix): teal + orange, per CLAUDE.md.
  teal: '#0f766e',
  orange: '#c2410c',
  // Neutrals
  ink: '#0f172a',
  body: '#334155',
  mute: '#64748b',
  faint: '#94a3b8',
  line: '#e2e8f0',
  panel: '#f8fafc',
  // Type scale (px)
  size: { h1: 26, h2: 17, h3: 15, body: 14, small: 12, tiny: 11, micro: 10 },
} as const

export type SentTone = 'positive' | 'negative' | 'neutral' | 'mixed'

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
export const pdfEsc = esc

// ── Base stylesheet — every PDF includes this exactly once ───────────────────
export function pdfBaseStyles(): string {
  const P = PDF
  return (
    `*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
    `body{font-family:${P.font};color:${P.ink};margin:0;background:#fff;font-size:${P.size.body}px;line-height:1.5}` +
    `.wrap{max-width:760px;margin:0 auto;padding:8px 0 28px}` +
    `h1{font-size:${P.size.h1}px;font-weight:800;color:${P.ink};margin:0}` +
    `.h2{font-size:${P.size.h2}px;font-weight:800;color:${P.ink};border-bottom:1px solid ${P.line};padding-bottom:6px;margin:0 0 12px}` +
    `h3{font-size:${P.size.h3}px;font-weight:800;color:${P.ink};margin:0}` +
    `.eyebrow{font-size:${P.size.tiny}px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${P.faint};margin-bottom:6px}` +
    `.sub{font-size:${P.size.small}px;color:${P.mute};margin:6px 0 0}` +
    `p{margin:0}` +
    // Pagination standard: titles never orphan; cards never split.
    `h1,.h2,h3{break-after:avoid;page-break-after:avoid}` +
    `.keep{break-inside:avoid;page-break-inside:avoid}` +
    `.card{break-inside:avoid;page-break-inside:avoid;border:1px solid ${P.line};border-radius:12px;padding:12px 14px;margin-bottom:12px}` +
    `.muted{color:${P.mute}}.faint{color:${P.faint}}`
  )
}

// ── Layout helpers ───────────────────────────────────────────────────────────

const SENT_PALETTE: Record<string, [string, string]> = {
  positive: ['#059669', '#ecfdf5'], negative: ['#dc2626', '#fef2f2'],
  mixed: ['#b45309', '#fffbeb'], neutral: ['#475569', '#f1f5f9'],
}
export function pdfSentPill(s: string | null | undefined): string {
  const v = (s || '').toLowerCase()
  if (!v) return ''
  const [fg, bg] = SENT_PALETTE[v] || SENT_PALETTE.neutral
  return `<span style="font-size:${PDF.size.micro}px;font-weight:700;color:${fg};background:${bg};border-radius:5px;padding:1px 7px;text-transform:capitalize">${esc(v)}</span>`
}

export function pdfPill(label: string, opts: { fg?: string; bg?: string } = {}): string {
  return `<span style="font-size:${PDF.size.micro}px;font-weight:700;color:${opts.fg || PDF.mute};background:${opts.bg || '#f1f5f9'};border-radius:5px;padding:1px 7px;white-space:nowrap">${esc(label)}</span>`
}

// A section: heading + body, with the heading wrapped together with `keepWith`
// (its first content block) so the title never lands alone at a page bottom.
export function pdfSection(title: string, body: string, opts: { keepWith?: string; margin?: string } = {}): string {
  const head = opts.keepWith !== undefined
    ? `<div class="keep"><h2 class="h2">${esc(title)}</h2>${opts.keepWith}</div>`
    : `<h2 class="h2">${esc(title)}</h2>`
  return `<section style="margin:${opts.margin || '24px'} 0 0">${head}${body}</section>`
}

export function pdfKpiGrid(items: Array<{ value: string | number; label: string }>): string {
  return (
    `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px">` +
    items.map(k =>
      `<div style="background:${PDF.panel};border-radius:10px;padding:12px 14px">` +
      `<div style="font-size:24px;font-weight:800;color:${PDF.ink}">${esc(String(k.value))}</div>` +
      `<div style="font-size:${PDF.size.tiny}px;font-weight:600;color:${PDF.mute};margin-top:2px">${esc(k.label)}</div></div>`).join('') +
    `</div>`
  )
}

// The cover header (in-body) — eyebrow + title + subtitle, datanautix wordmark right.
const DN = `<span style="font-weight:800;font-size:17px;letter-spacing:-0.3px;white-space:nowrap"><span style="color:#0F7173">data</span><span style="color:#E8632A">nautix</span></span>`
export function pdfCoverHeader(opts: { eyebrow: string; title: string; subtitle?: string }): string {
  return (
    `<header style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">` +
    `<div><div class="eyebrow">${esc(opts.eyebrow)}</div><h1>${esc(opts.title)}</h1>` +
    (opts.subtitle ? `<p class="sub">${esc(opts.subtitle)}</p>` : '') + `</div>${DN}</header>`
  )
}

// Full self-contained HTML document with the standard base styles + wrapper.
export function pdfDoc(opts: { title: string; body: string; extraCss?: string }): string {
  return (
    `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.title)}</title>` +
    `<style>${pdfBaseStyles()}${opts.extraCss || ''}</style></head>` +
    `<body><div class="wrap">${opts.body}</div></body></html>`
  )
}
