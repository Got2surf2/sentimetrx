// Ana findings PDF composer: markdown-ish answers become print-grade HTML —
// pipe tables to real <table>s with numeric columns centered (th+td), blockquote
// verbatims, chart blocks to bar rows / SVG lines — with the logic appendix
// (the recreation recipe) and layout following the composed-PDF doctrine
// (break-inside: avoid, no forced per-section page breaks).
import { describe, it, expect } from 'vitest'
import { anaMarkdownToHtml, composeAnaFindingsHtml } from '@/lib/anaPdf'

describe('anaMarkdownToHtml', () => {
  it('converts pipe tables to real tables; numeric COLUMNS centered including their header', () => {
    const html = anaMarkdownToHtml('| Location | Avg |\n|---|---|\n| Clermont | 4.91 |\n| Oviedo | 4.78 |')
    expect(html).toContain('<table class="data">')
    expect(html).toContain('<th>Location</th>')
    expect(html).toContain('<th class="num">Avg</th>')
    expect(html).toContain('<td class="num">4.91</td>')
    expect(html).not.toContain('---')
  })

  it('a text column with one numeric-looking cell stays left-aligned (column-level detection)', () => {
    const html = anaMarkdownToHtml('| Item | Note |\n|---|---|\n| Steak | 949 |\n| Ribs | tough and cold |')
    expect(html).toContain('<td>949</td>')
    expect(html).not.toContain('<th class="num">Note</th>')
  })

  it('renders headings, bullets, blockquotes, and inline bold with escaping', () => {
    const html = anaMarkdownToHtml('### Risks <script>\n- **463** one-star\n> "great salsa" — Kelsea')
    expect(html).toContain('<h3>Risks &lt;script&gt;</h3>')
    expect(html).toContain('<li><strong>463</strong> one-star</li>')
    expect(html).toContain('<blockquote>')
    expect(html).not.toContain('<script>')
  })

  it('renders chart blocks as bar rows / svg lines', () => {
    const bar = anaMarkdownToHtml('```chart\n{"type":"bar","title":"T","data":[["a",2],["b",1]]}\n```')
    expect(bar).toContain('class="chart"')
    expect(bar).toContain('class="bfill"')
    const line = anaMarkdownToHtml('```chart\n{"type":"line","title":"T","data":[["Jan",1],["Feb",2]]}\n```')
    expect(line).toContain('<svg')
    expect(line).toContain('polyline')
  })
})

describe('composeAnaFindingsHtml', () => {
  it('carries masthead, question banner, and the logic appendix; avoids forced breaks', () => {
    const html = composeAnaFindingsHtml({
      datasetName: "Rubio's Coastal Grill",
      generatedAt: new Date('2026-09-02T12:00:00Z'),
      exchanges: [{ question: 'What is upsetting people?', answer: 'Findings here.', logic: ['Ran field_counts on rating → 5 values, exact'] }],
    })
    expect(html).toContain('Analyst Findings')
    expect(html).toContain('Prepared by <b>Ana</b>')
    expect(html).toContain('What is upsetting people?')
    expect(html).toContain('Provenance &mdash; how this was computed')
    expect(html).toContain('field_counts')
    expect(html).toContain('break-inside: avoid')
    expect(html).not.toContain('break-before')
  })
})
