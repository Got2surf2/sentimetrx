// @vitest-environment jsdom
//
// DatanautixAttribution — parent-company attribution on every entry surface.
// Guards the brand contract (CLAUDE.md: "Sentimetrx is a Datanautix product",
// links to datanautix.com, one-word "Datanautix" wordmark) and both variants.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DatanautixAttribution from '@/components/ui/DatanautixAttribution'

describe('DatanautixAttribution', () => {
  it('renders the footer variant with the product line and datanautix.com link', () => {
    render(<DatanautixAttribution />)
    expect(screen.getByText(/Sentimetrx is a/)).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Datanautix' }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('https://www.datanautix.com')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noopener')
  })

  it('renders the compact variant as a single labelled link', () => {
    render(<DatanautixAttribution variant="compact" />)
    const link = screen.getByRole('link') as HTMLAnchorElement
    expect(link.getAttribute('title')).toBe('Sentimetrx is a Datanautix product')
    expect(link.textContent).toContain('Datanautix')
    expect(link.getAttribute('href')).toBe('https://www.datanautix.com')
  })

  it('applies a caller-supplied className', () => {
    const { container } = render(<DatanautixAttribution className="my-class" />)
    expect(container.querySelector('.my-class')).toBeTruthy()
  })
})
