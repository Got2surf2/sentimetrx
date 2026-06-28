// Tests for the shared source-summary renderer (lib/sourceSummary.ts) — the
// "what was presented" section shared by the Town Hall report (meeting
// presentation) and the Agent Study report (KB summary). Lock the empty-state,
// the optional-field handling, and escaping.

import { describe, it, expect } from 'vitest'
import { renderSourceSummaryHtml, type SourceSummary } from '@/lib/sourceSummary'

describe('renderSourceSummaryHtml', () => {
  it('returns empty string when there is no overview and no items', () => {
    expect(renderSourceSummaryHtml(null)).toBe('')
    expect(renderSourceSummaryHtml({ overview: '', items: [] })).toBe('')
  })

  it('renders the supplied heading and overview', () => {
    const html = renderSourceSummaryHtml({ overview: 'Two neutral sentences.', items: [] }, { heading: 'Knowledge Base' })
    expect(html).toContain('Knowledge Base')
    expect(html).toContain('Two neutral sentences.')
  })

  it('renders item title, attribution, body, figures, and refs', () => {
    const s: SourceSummary = {
      overview: 'ov',
      items: [{
        title: 'Budget Overview',
        attribution: 'CFO Jane Doe',
        body: 'The FY26 budget grows 4%.',
        figures: [{ label: 'Total', value: '$4.2M' }],
        refs: 'Slides 3, 4',
      }],
    }
    const html = renderSourceSummaryHtml(s, { heading: 'Meeting Notes' })
    expect(html).toContain('Budget Overview')
    expect(html).toContain('CFO Jane Doe')
    expect(html).toContain('The FY26 budget grows 4%.')
    expect(html).toContain('$4.2M')
    expect(html).toContain('Slides 3, 4')
  })

  it('omits optional fields cleanly when absent (agent KB item: title + body only)', () => {
    const html = renderSourceSummaryHtml(
      { overview: 'ov', items: [{ title: 'Hours & Location', body: 'Open 9–5.' }] },
      { heading: 'Knowledge Base' },
    )
    expect(html).toContain('Hours &amp; Location')
    expect(html).toContain('Open 9–5.')
    // no presenter/refs/figure chrome leaked
    expect(html).not.toContain('Slide')
  })

  it('escapes title, body, attribution, and figures', () => {
    const html = renderSourceSummaryHtml({
      overview: 'a & b <c>',
      items: [{ title: '<t>', attribution: 'A & B', body: 'x < y', figures: [{ label: '<l>', value: '"v"' }] }],
    })
    expect(html).toContain('a &amp; b &lt;c&gt;')
    expect(html).toContain('&lt;t&gt;')
    expect(html).toContain('A &amp; B')
    expect(html).toContain('x &lt; y')
    expect(html).toContain('&lt;l&gt;')
    expect(html).toContain('&quot;v&quot;')
  })

  it('renders the caption when supplied', () => {
    const html = renderSourceSummaryHtml({ overview: 'ov', items: [] }, { caption: 'Neutral AI summary.' })
    expect(html).toContain('Neutral AI summary.')
  })
})
