// @vitest-environment jsdom
//
// LottieLoader — the single shared loading animation (CLAUDE.md: no hand-rolled
// spinners). lottie-web is dynamically imported in an effect; we stub it so the
// component mounts in jsdom and assert the render contract (optional message).

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import LottieLoader from '@/components/ui/LottieLoader'

vi.mock('lottie-web', () => ({
  default: { loadAnimation: () => ({ destroy: () => {} }) },
}))

describe('LottieLoader', () => {
  it('renders the message when provided', () => {
    render(<LottieLoader message="Loading your data…" />)
    expect(screen.getByText('Loading your data…')).toBeTruthy()
  })

  it('renders without a message (no text node)', () => {
    const { container } = render(<LottieLoader />)
    // Only the animation container div is present, no message element.
    expect(container.textContent).toBe('')
  })

  it('honors a custom size on the animation container', () => {
    const { container } = render(<LottieLoader size={200} />)
    const outer = container.firstElementChild as HTMLElement       // flex wrapper
    const inner = outer.firstElementChild as HTMLElement           // ref'd animation box
    expect(inner.style.width).toBe('200px')
    expect(inner.style.height).toBe('200px')
  })
})
