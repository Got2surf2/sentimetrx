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
})
