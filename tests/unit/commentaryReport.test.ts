// Tests for the shared Commentary section renderer (lib/commentaryReport.ts) —
// used by both the Agent Study report and the Town Hall report. Lock the
// clustering, ordering, escaping, and empty-state contract.

import { describe, it, expect } from 'vitest'
import { renderCommentaryHtml, type CommentaryItem } from '@/lib/commentaryReport'

describe('renderCommentaryHtml', () => {
  it('returns empty string when there are no usable comments', () => {
    expect(renderCommentaryHtml([])).toBe('')
    expect(renderCommentaryHtml([{ quote: '   ' }, { quote: '' }])).toBe('')
  })

  it('renders a heading with the total comment count', () => {
    const html = renderCommentaryHtml([{ quote: 'a' }, { quote: 'b' }])
    expect(html).toContain('Commentary')
    expect(html).toContain('· 2 comments')
  })

  it('singularizes the count for one comment', () => {
    expect(renderCommentaryHtml([{ quote: 'lonely' }])).toContain('· 1 comment')
    expect(renderCommentaryHtml([{ quote: 'lonely' }])).not.toContain('1 comments')
  })

  it('clusters by topic, largest cluster first, General last', () => {
    const items: CommentaryItem[] = [
      { quote: 'g1', topic: null },
      { quote: 'f1', topic: 'Funding' },
      { quote: 'f2', topic: 'Funding' },
      { quote: 's1', topic: 'Safety' },
    ]
    const html = renderCommentaryHtml(items)
    const iFunding = html.indexOf('Funding')
    const iSafety = html.indexOf('Safety')
    const iGeneral = html.indexOf('General')
    expect(iFunding).toBeGreaterThan(-1)
    expect(iFunding).toBeLessThan(iSafety)   // 2 beats 1
    expect(iSafety).toBeLessThan(iGeneral)   // un-topiced bucket always last
    expect(html).toContain('Funding <span style="color:#64748b;font-weight:600">· 2</span>')
  })

  it('escapes quote, speaker, and topic', () => {
    const html = renderCommentaryHtml([
      { quote: 'we need <b>action</b> & "now"', speaker: 'A & B', topic: '<x>' },
    ])
    expect(html).toContain('&lt;b&gt;action&lt;/b&gt; &amp; &quot;now&quot;')
    expect(html).toContain('A &amp; B')
    expect(html).toContain('&lt;x&gt;')
    expect(html).not.toContain('<b>action</b>')
  })

  it('colours the sentiment dot by polarity', () => {
    expect(renderCommentaryHtml([{ quote: 'q', sentiment: 'positive' }])).toContain('#059669')
    expect(renderCommentaryHtml([{ quote: 'q', sentiment: 'negative' }])).toContain('#dc2626')
    // neutral / mixed / unknown share the muted dot
    expect(renderCommentaryHtml([{ quote: 'q', sentiment: 'mixed' }])).toContain('#cbd5e1')
    expect(renderCommentaryHtml([{ quote: 'q' }])).toContain('#cbd5e1')
  })

  it('uses the supplied accent colour for the quote rule', () => {
    const html = renderCommentaryHtml([{ quote: 'q', topic: 'T' }], { accent: '#123456' })
    expect(html).toContain('#123456')
  })
})
