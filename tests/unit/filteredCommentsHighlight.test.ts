// FilteredCommentsPanel.highlightTerms — the shared Comments view's highlight
// pass (sql/196 made dimensions highlightable). Terms (theme keywords, entity
// aliases) match on WORD BOUNDARIES; dimension-evidence phrases match WITHOUT
// them, because the classifier's evidence is a fixed-width window that can cut
// mid-word — anchoring would silently drop exactly the highlight the
// consistency fix exists to show.
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { highlightTerms } from '@/components/analyze/textmine/FilteredCommentsPanel'

function marks(nodes: React.ReactNode): string[] {
  if (!Array.isArray(nodes)) return []
  return nodes
    .filter((n): n is React.ReactElement<{ children: string }> => typeof n === 'object' && n !== null && 'props' in n)
    .map(n => n.props.children)
}

describe('highlightTerms', () => {
  it('highlights terms on word boundaries only', () => {
    const out = marks(highlightTerms('The service was servicey fast', ['service']))
    expect(out).toEqual(['service']) // not "servicey"
  })

  it('highlights an evidence phrase even when its window starts mid-word', () => {
    const text = 'Honestly the service was terrible and slow tonight'
    const out = marks(highlightTerms(text, [], ['rvice was terrible and']))
    expect(out).toEqual(['rvice was terrible and'])
  })

  it('an evidence phrase wins over a keyword inside it (no double-marking)', () => {
    const text = 'The waiter was rude to us'
    const out = marks(highlightTerms(text, ['rude'], ['waiter was rude to']))
    expect(out).toEqual(['waiter was rude to'])
  })

  it('terms and phrases both highlight in one pass', () => {
    const text = 'Great food but the wait was long'
    const out = marks(highlightTerms(text, ['food'], ['wait was long']))
    expect(out).toEqual(['food', 'wait was long'])
  })

  it('returns plain text when nothing to highlight', () => {
    expect(highlightTerms('hello world', [], [])).toBe('hello world')
  })

  it('a keyword with a palette marks in its theme colors; others keep the amber default', () => {
    const pal = { bg: '#eff6ff', border: '#2563eb', text: '#1d4ed8', light: '#dbeafe' }
    const nodes = highlightTerms('Slow service but great food', ['service', 'food'], [], { service: pal })
    if (!Array.isArray(nodes)) throw new Error('expected nodes')
    const markEls = nodes.filter((n): n is React.ReactElement<{ children: string; style: Record<string, string> }> =>
      typeof n === 'object' && n !== null && 'props' in n)
    expect(markEls.map(m => m.props.children)).toEqual(['service', 'food'])
    expect(markEls[0].props.style.color).toBe('#1d4ed8')            // theme palette
    expect(markEls[0].props.style.borderBottom).toContain('#2563eb')
    expect(markEls[1].props.style.color).toBe('#854d0e')            // amber default
  })

  it('palette lookup is case-insensitive against the matched text', () => {
    const pal = { bg: '#f0fdf4', border: '#16a34a', text: '#15803d' }
    const nodes = highlightTerms('SERVICE was fine', ['service'], [], { service: pal })
    if (!Array.isArray(nodes)) throw new Error('expected nodes')
    const markEl = nodes.find((n): n is React.ReactElement<{ style: Record<string, string> }> =>
      typeof n === 'object' && n !== null && 'props' in n)
    expect(markEl!.props.style.color).toBe('#15803d')
  })
})
