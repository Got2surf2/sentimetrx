// @vitest-environment jsdom
// The theme-modal Context path. The load-bearing assertion is the last one:
// drilling into a context word narrows the SAMPLE COMMENTS but must leave the
// theme's headline mention count and % alone, so the number in the header
// keeps meaning one thing regardless of what's been clicked.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, screen, fireEvent } from '@testing-library/react'
import React from 'react'

vi.mock('@/components/ui/LottieLoader', () => ({ default: () => <div data-testid="loader" /> }))

import ThemePopover from '@/components/analyze/textmine/ThemePopover'

const ROWS = [
  ...Array.from({ length: 6 }, () => ({ comment: 'The steak quality was excellent here.' })),
  ...Array.from({ length: 4 }, () => ({ comment: 'The pasta was cold and slow to arrive.' })),
  ...Array.from({ length: 10 }, () => ({ comment: 'Lovely room, nothing to report.' })),
]

const THEME = { id: 't1', name: 'Food', keywords: ['steak', 'pasta'] }

const flush = async () => { await act(async () => { vi.runAllTimers(); await Promise.resolve() }) }

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

const open = () =>
  render(<ThemePopover theme={THEME} rows={ROWS} fields={['comment']} onClose={() => {}} />)

describe('ThemePopover — Context tab', () => {
  it('offers a Context tab and pools every keyword in the theme', async () => {
    open()
    fireEvent.click(screen.getByRole('button', { name: 'Context' }))
    await flush()
    // "quality" rides with steak (6); "cold" rides with pasta (4).
    expect(screen.getByText('quality').closest('button')!.textContent).toContain('6')
    expect(screen.getByText('cold').closest('button')!.textContent).toContain('4')
  })

  it('drilling a context word narrows the samples but NOT the theme headline', async () => {
    open()
    // 10 of 20 comments match the theme.
    expect(screen.getByText('10 mentions')).toBeTruthy()
    expect(screen.getByText(/50% of comments/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Context' }))
    await flush()
    fireEvent.click(screen.getByText('quality').closest('button')!)

    // Samples narrowed to the 6 carrying the pair...
    expect(screen.getByText('Food + quality')).toBeTruthy()
    expect(screen.getByText('6 comments')).toBeTruthy()
    expect(screen.getByText('Sample comments (6)')).toBeTruthy()

    // ...while the theme's own numbers are untouched.
    expect(screen.getByText('10 mentions')).toBeTruthy()
    expect(screen.getByText(/50% of comments/)).toBeTruthy()
  })
})
