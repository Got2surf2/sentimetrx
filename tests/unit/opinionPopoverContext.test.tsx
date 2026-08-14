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
