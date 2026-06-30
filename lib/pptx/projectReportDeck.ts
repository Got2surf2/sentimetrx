// lib/pptx/projectReportDeck.ts
//
// Render a COLLECTION project report (community synthesis OR competitive /
// brand-360 comparison) to a Datanautix-branded PPTX, via the shared cream
// renderDeck — the deck counterpart to the HTML/PDF project reports. Pure
// mapping: ProjectBuilt model → DeckSpec.slides → renderDeck. No I/O.

import { renderDeck, type DeckSpec, type SlideSpec } from './slideRenderer'
import type { ProjectReportModel, ProjectTheme } from '@/lib/projectReport'
import type { CompareReportModel, CompareRow } from '@/lib/projectCompare'
import type { ProjectBuilt } from '@/lib/projectReportLoad'

const cap = (s?: string | null) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : '')
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

// Split a synthesized paragraph into ≤max bullet lines (sentence/newline aware).
function toBullets(text: string, max = 6): string[] {
  if (!text) return []
  const byLine = text.split(/\n+/).map(s => s.trim()).filter(Boolean)
  const parts = byLine.length > 1
    ? byLine
    : text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“])/).map(s => s.trim()).filter(s => s.length > 1)
  return parts.slice(0, max).map(s => trunc(s, 220))
}

// ── Community synthesis deck ──────────────────────────────────────────────────
function communitySlides(m: ProjectReportModel): SlideSpec[] {
  const slides: SlideSpec[] = []

  slides.push({
    type: 'kpi_grid', title: 'At a Glance', subtitle: 'Coverage across this collection’s community sources',
    kpis: [
      { value: m.totals.sources.toLocaleString(), label: 'Sources', sub: `${m.totals.townHalls} town hall${m.totals.townHalls === 1 ? '' : 's'} · ${m.totals.agents} agent${m.totals.agents === 1 ? '' : 's'}` },
      { value: m.totals.qa.toLocaleString(), label: 'Questions answered', sub: 'across all sources' },
      { value: m.totals.comments.toLocaleString(), label: 'Community comments', sub: 'voices synthesized' },
    ],
    insight: m.execSummary ? trunc(m.execSummary, 320) : undefined,
  })

  const execBullets = toBullets(m.execSummary)
  if (execBullets.length) slides.push({ type: 'bullets', title: 'Executive Summary', subtitle: 'What the community is telling us', bullets: execBullets })

  if (m.themes.length) {
    slides.push({ type: 'section', title: 'Themes', subtitle: 'What surfaced across the community, ranked by volume', eyebrow: 'Themes' })
    const top = [...m.themes].sort((a, b) => b.count - a.count).slice(0, 12)
    slides.push({
      type: 'table', title: 'Themes — Across the Collection', subtitle: `Top ${top.length} by volume · sources contributing`,
      columns: ['Theme', 'Items', 'Sentiment', 'Sources'],
      rows: top.map((t: ProjectTheme) => [trunc(t.title, 40), String(t.count), cap(t.sentiment) || '—', String(t.sources.length)]),
    })
    // Representative quotes for the top few themes.
    for (const t of top.slice(0, 3)) {
      const quotes = [
        ...t.qa.map(q => ({ text: q.answer || q.question, attribution: q.source })),
        ...t.commentary.map(c => ({ text: c.quote, attribution: c.speaker ? `${c.speaker} · ${c.source}` : c.source })),
      ].filter(q => q.text && q.text.trim().length > 0).slice(0, 4)
      if (quotes.length) slides.push({
        type: 'quotes', title: trunc(t.title, 50), subtitle: `${t.count} item${t.count === 1 ? '' : 's'} · ${t.sources.length} source${t.sources.length === 1 ? '' : 's'}`,
        quotes: quotes.map(q => ({ text: trunc(q.text, 240), attribution: q.attribution })),
        insight: t.summary || undefined,
      })
    }
  }

  if (m.entities.length) {
    slides.push({
      type: 'entity_grid', title: 'Who & What Came Up', subtitle: 'Named entities across the collection, by mentions',
      entities: m.entities.slice(0, 20).map(e => ({ name: e.name, mentions: e.mentions })),
    })
  }

  slides.push({ type: 'bullets', title: 'How This Report Was Made', bullets: toBullets(m.method, 6) })
  return slides
}

// ── Competitive / brand-360 comparison deck ──────────────────────────────────
function sigMark(sig?: CompareRow['cells'][string]['sig']): string {
  return sig === 'up' ? ' ▲' : sig === 'down' ? ' ▼' : ''
}
function cellText(row: CompareRow, col: string): string {
  const c = row.cells[col]
  if (!c || !c.present) return '—'
  return (c.pct != null ? `${c.pct}%` : String(c.count)) + sigMark(c.sig)
}

function matrixSlide(title: string, subtitle: string, rows: CompareRow[], cols: { name: string; focus: boolean }[]): SlideSpec {
  return {
    type: 'table', title, subtitle,
    columns: ['Theme', ...cols.map(c => (c.focus ? `★ ${trunc(c.name, 16)}` : trunc(c.name, 18)))],
    rows: rows.slice(0, 12).map(r => [trunc(r.theme, 32), ...cols.map(c => cellText(r, c.name))]),
  }
}

function compareSlides(m: CompareReportModel): SlideSpec[] {
  const slides: SlideSpec[] = []
  const cols = m.columns.map(c => ({ name: c.name, focus: c.name === m.primary }))
  const isCompetitive = m.purpose === 'competitive'

  slides.push({
    type: 'kpi_grid', title: 'At a Glance', subtitle: isCompetitive ? 'Head-to-head field' : 'One brand, triangulated across sources',
    kpis: [
      { value: String(m.columns.length), label: isCompetitive ? 'Competitors' : 'Sources', sub: m.primary ? `focus: ${trunc(m.primary, 24)}` : 'no single focus' },
      { value: String(m.rows.length), label: 'Shared themes', sub: 'aligned across every member' },
      ...(m.dimensionRows.length ? [{ value: String(m.dimensionRows.length), label: 'Dimensions', sub: 'ABSA sub-aspects compared' }] : []),
    ],
    insight: m.execSummary ? trunc(m.execSummary, 320) : undefined,
  })

  const execBullets = toBullets(m.execSummary)
  if (execBullets.length) slides.push({ type: 'bullets', title: 'Executive Summary', subtitle: m.primary ? `Deep-dive: ${m.primary}` : undefined, bullets: execBullets })

  if (m.rows.length) {
    slides.push({ type: 'section', title: 'Themes', subtitle: 'Each cell = that member’s share of reviews on the theme (normalized)', eyebrow: 'Comparison' })
    slides.push(matrixSlide(
      'Themes — Comparison Matrix',
      `% of each member’s reviews citing the theme${isCompetitive ? ' · ▲▼ = significantly higher/lower than focus' : ''}`,
      m.rows, cols,
    ))
  }

  if (m.dimensionRows.length) {
    slides.push(matrixSlide(
      'Dimensions — Comparison Matrix',
      `ABSA sub-aspects · % of each member’s reviews${isCompetitive ? ' · ▲▼ vs focus' : ''}`,
      m.dimensionRows, cols,
    ))
  }

  // Rating-over-time deltas (competitive) — the chart itself stays in HTML/PDF;
  // here we surface the recent-vs-prior movement as a compact table.
  const tr = m.competitorTrends
  if (tr && tr.deltas.length >= 2) {
    slides.push({
      type: 'table', title: 'Rating Over Time', subtitle: 'Recent average vs the prior window — who is climbing, who is sliding',
      columns: ['Member', 'Recent ★', 'vs prior'],
      rows: tr.deltas.map(d => [
        (d.focus ? '★ ' : '') + trunc(d.name, 30),
        d.recentAvg != null ? d.recentAvg.toFixed(2) : '—',
        d.delta == null ? '—' : d.delta === 0 ? '– flat' : d.delta > 0 ? `▲ +${d.delta.toFixed(2)}` : `▼ ${d.delta.toFixed(2)}`,
      ]),
    })
  }

  slides.push({ type: 'bullets', title: 'How This Report Was Made', bullets: toBullets(m.method, 6) })
  return slides
}

/** Render a built collection project model to a Datanautix PPTX buffer. */
export async function renderProjectReportDeck(built: Extract<ProjectBuilt, { ok: true }>): Promise<Buffer> {
  const isCommunity = built.kind === 'community'
  const subtitle = isCommunity
    ? 'Community Synthesis Report'
    : built.purpose === 'competitive' ? 'Competitive Analysis' : 'Brand 360 Report'
  const deck: DeckSpec = {
    title: built.name,
    subtitle,
    preparedBy: 'Datanautix',
    slides: isCommunity ? communitySlides(built.model) : compareSlides(built.model),
  }
  return renderDeck(deck, built.name)
}
