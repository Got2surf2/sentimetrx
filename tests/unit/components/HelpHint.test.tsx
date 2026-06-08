// @vitest-environment jsdom
//
// HelpHint — click-to-reveal help popover (AI-independent, used across TextMine).
// Covers the open/close interaction contract: hidden by default, toggles on the
// ? button, closes on Escape.

import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import HelpHint from '@/components/analyze/textmine/HelpHint'

describe('HelpHint', () => {
  it('hides the popover until the button is clicked', () => {
    render(<HelpHint title="What is a theme?">Themes group related comments.</HelpHint>)
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Help: What is a theme\?/ }))
    const tip = screen.getByRole('tooltip')
    expect(tip.textContent).toContain('What is a theme?')
    expect(tip.textContent).toContain('Themes group related comments.')
  })

  it('toggles closed on a second click', () => {
    render(<HelpHint title="T">body</HelpHint>)
    const btn = screen.getByRole('button', { name: /Help: T/ })
    fireEvent.click(btn)
    expect(screen.queryByRole('tooltip')).not.toBeNull()
    fireEvent.click(btn)
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('closes on Escape', () => {
    render(<HelpHint title="T">body</HelpHint>)
    fireEvent.click(screen.getByRole('button', { name: /Help: T/ }))
    expect(screen.queryByRole('tooltip')).not.toBeNull()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('tooltip')).toBeNull()
  })
})
