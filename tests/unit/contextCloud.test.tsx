// @vitest-environment jsdom
// Renders the Context view end-to-end: the cloud paints after its deferred
// compute, the Frequency/Distinctive toggle swaps the ranking, and clicking a
// word hands the caller the word it displayed. Guards the wiring the pure
// collocation tests can't see.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, screen, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('@/components/ui/LottieLoader', () => ({ default: () => <div data-testid="loader" /> }))

import ContextCloud from '@/components/analyze/textmine/ContextCloud'

// "quality" is the distinctive partner of food; "place" is everywhere.
const ROWS = [
  ...Array.from({ length: 8 }, () => ({ comment: 'The food quality was excellent at this place.' })),
  ...Array.from({ length: 8 }, () => ({ comment: 'The food was cold at this place.' })),
  ...Array.from({ length: 40 }, () => ({ comment: 'Nice place to sit.' })),
]
const FIELDS = ['comment']
const TARGETS = ['food']

const flush = async () => { await act(async () => { vi.runAllTimers(); await Promise.resolve() }) }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('ContextCloud', () => {
  it('shows the loader first, then the cloud', async () => {
    render(<ContextCloud rows={ROWS} fields={FIELDS} targets={TARGETS} termLabel="food" />)
    expect(screen.getByTestId('loader')).toBeTruthy()
    await flush()
    expect(screen.queryByTestId('loader')).toBeNull()
    expect(screen.getByText('quality')).toBeTruthy()
    expect(screen.getByText('cold')).toBeTruthy()
  })

  it('never renders the target as its own context word', async () => {
    render(<ContextCloud rows={ROWS} fields={FIELDS} targets={TARGETS} termLabel="food" />)
    await flush()
    expect(screen.queryByText('food')).toBeNull()
  })

  it('hands the clicked word back to the caller', async () => {
    const onSelect = vi.fn()
    render(<ContextCloud rows={ROWS} fields={FIELDS} targets={TARGETS} termLabel="food" onSelect={onSelect} />)
    await flush()
    fireEvent.click(screen.getByText('quality').closest('button')!)
    expect(onSelect).toHaveBeenCalledWith('quality')
  })

  it('the Distinctive toggle reranks — "place" leads by frequency, not by association', async () => {
    const { container } = render(<ContextCloud rows={ROWS} fields={FIELDS} targets={TARGETS} termLabel="food" />)
    await flush()
    const words = () => Array.from(container.querySelectorAll('button'))
      .map(b => b.firstChild?.textContent || '')
      .filter(w => w && w !== 'Frequency' && w !== 'Distinctive')

    expect(words()[0]).toBe('place') // 16 comments — the most frequent partner
    fireEvent.click(screen.getByText('Distinctive'))
    expect(words()[0]).not.toBe('place') // ...but it is in every comment, so not distinctive
  })

  it('renders the count badge, which is the comment count', async () => {
    render(<ContextCloud rows={ROWS} fields={FIELDS} targets={TARGETS} termLabel="food" />)
    await flush()
    // "quality" appears alongside "food" in exactly 8 comments.
    const chip = screen.getByText('quality').closest('button')!
    expect(chip.textContent).toContain('8')
  })

  it('shows an honest empty state when the term has no context', async () => {
    render(<ContextCloud rows={[{ comment: 'Nothing relevant here.' }]} fields={FIELDS} targets={TARGETS} termLabel="food" />)
    await flush()
    expect(screen.getByText(/Not enough context to show/)).toBeTruthy()
  })
})
