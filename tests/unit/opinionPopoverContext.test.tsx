// @vitest-environment jsdom
// The word-modal Context path, end to end: clicking a cloud word opens the
// modal, the Context tab lists what the word is talked about with, and clicking
// a context word drills into exactly the comments carrying both terms — the
// count the chip promised.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, screen, fireEvent, within } from '@testing-library/react'
import React from 'react'

vi.mock('@/components/ui/LottieLoader', () => ({ default: () => <div data-testid="loader" /> }))

import OpinionPopover from '@/components/analyze/textmine/OpinionPopover'

const ROWS = [
  ...Array.from({ length: 6 }, () => ({ comment: 'The food quality was excellent here.' })),
  ...Array.from({ length: 4 }, () => ({ comment: 'The food was cold and slow to arrive.' })),
  ...Array.from({ length: 20 }, () => ({ comment: 'Lovely room, nothing to report.' })),
]

const flush = async () => { await act(async () => { vi.runAllTimers(); await Promise.resolve() }) }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const open = () =>
  render(<OpinionPopover word="food" rows={ROWS} fields={['comment']} onClose={() => {}} />)

describe('OpinionPopover — Context tab', () => {
  it('offers a Context tab alongside Opinions / Comments / Insights', () => {
    open()
    for (const label of ['Opinions', 'Context', 'Comments']) {
      expect(screen.getByRole('button', { name: label })).toBeTruthy()
    }
  })

  it('lists context words and drills into the comments carrying both terms', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Context' }))
    await flush()

    // "quality" shares a sentence with "food" in 6 comments.
    const chip = screen.getByText('quality').closest('button')!
    expect(chip.textContent).toContain('6')

    fireEvent.click(chip)

    // Lands on Comments, scoped to the pair, with the promised count.
    expect(screen.getByText(/6 comments containing "food" \+ "quality"/)).toBeTruthy()
    expect(screen.getByText('food + quality')).toBeTruthy()
  })

  it('highlights the aspect word and the context word differently', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Context' }))
    await flush()
    fireEvent.click(screen.getByText('quality').closest('button')!)

    // The modal renders through a portal, so query the document, not the container.
    const marks = Array.from(document.body.querySelectorAll('mark'))
    const food = marks.find(m => m.textContent === 'food')!
    const quality = marks.find(m => m.textContent === 'quality')!
    expect(food).toBeTruthy()
    expect(quality).toBeTruthy()
    expect(food.getAttribute('style')).not.toBe(quality.getAttribute('style'))
  })

  it('clearing the context chip restores the full comment list', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Context' }))
    await flush()
    fireEvent.click(screen.getByText('quality').closest('button')!)
    expect(screen.getByText(/6 comments/)).toBeTruthy()

    fireEvent.click(within(screen.getByText('food + quality')).getByTitle('Clear context word'))
    // All 10 comments mention "food" again.
    expect(screen.getByText(/10 comments containing "food"/)).toBeTruthy()
  })
})

// ── Which denominator the percentage is against (2026-08-17) ────────────────
// The modal stated its share against the WHOLE dataset ("1% of comments") even
// when opened from inside a theme — not the question a reader is asking. They
// want the word's share OF THAT THEME. `themeScope` switches the denominator,
// and the label must always NAME it so the figure can't be misread.
//
// The same text appears twice (header pill + stats row), which is the point:
// both derive from one `share` memo, so they cannot disagree. Hence getAllByText.
describe('OpinionPopover — which denominator the percentage is against', () => {
  // "food" matches 10 of the 30 text-bearing rows → 33% dataset-wide.
  const MENTIONS = 10
  const ALL_WITH_TEXT = 30

  const openWith = async (themeScope?: { label: string; count: number }) => {
    render(
      <OpinionPopover
        word="food" rows={ROWS} fields={['comment']}
        themeScope={themeScope}
        onClose={() => {}}
      />,
    )
    await flush()
  }

  it('states the dataset share, and names it, with no theme scope', async () => {
    await openWith()
    const pct = Math.round((MENTIONS / ALL_WITH_TEXT) * 100) // 33
    // Both readouts agree — one derivation, two render sites.
    expect(screen.getAllByText(new RegExp(pct + '% of comments')).length).toBeGreaterThanOrEqual(2)
  })

  it('states the share OF THE THEME when opened inside one', async () => {
    // 10/40 = 25%, vs 33% dataset-wide — deliberately different, so this test
    // cannot pass against the old behaviour.
    await openWith({ label: 'Food Quality', count: 40 })
    expect(screen.getAllByText(/25% of Food Quality/).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/% of comments/)).toBeNull()
  })

  it('reconciles with the theme card and rounds like pctOfThis', async () => {
    // The theme card prints `theme.count` as "N comments"; passing that same
    // number is what makes this % reconcile with it. 10/80 = 12.5 → 13.
    await openWith({ label: 'Pacing', count: 80 })
    expect(screen.getAllByText(/13% of Pacing/).length).toBeGreaterThanOrEqual(2)
  })

  it('falls back to the dataset share on a zero theme count (never divides by zero)', async () => {
    await openWith({ label: 'Empty Theme', count: 0 })
    expect(screen.getAllByText(/33% of comments/).length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByText(/of Empty Theme/)).toBeNull()
  })
})
