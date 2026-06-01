// @vitest-environment jsdom
//
// tests/unit/components/BrandTagInput.test.tsx
//
// First component test (the audit's "zero component tests" gap). BrandTagInput
// is the shared brand-tag autocomplete on dataset-create forms: a controlled
// text input backed by a <datalist> of the org's existing brands fetched from
// /api/brands. We pin the render contract, the onChange wiring, and the
// best-effort autocomplete population.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import BrandTagInput from '@/components/analyze/BrandTagInput'

beforeEach(() => {
  // Module-level cache in the component persists across renders; a resolved
  // fetch on first mount fills it. Mock it to a known brand list every test.
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ brands: ['Capital Grille', 'Ruth\'s Chris'] }),
  })) as any)
})

describe('BrandTagInput', () => {
  it('renders the label, placeholder, hint, and current value', () => {
    render(<BrandTagInput value="Acme" onChange={() => {}} hint="my hint" />)
    expect(screen.getByText('Brand (optional)')).toBeTruthy()
    expect(screen.getByText('my hint')).toBeTruthy()
    const input = screen.getByPlaceholderText('e.g. Capital Grille') as HTMLInputElement
    expect(input.value).toBe('Acme')
  })

  it('calls onChange with the new value on input', () => {
    const onChange = vi.fn()
    render(<BrandTagInput value="" onChange={onChange} />)
    const input = screen.getByPlaceholderText('e.g. Capital Grille') as HTMLInputElement
    // fireEvent.change drives React's synthetic onChange on a controlled input.
    fireEvent.change(input, { target: { value: 'Fleming' } })
    expect(onChange).toHaveBeenCalledWith('Fleming')
  })

  it('populates the datalist from /api/brands (best-effort autocomplete)', async () => {
    const { container } = render(<BrandTagInput value="" onChange={() => {}} />)
    await waitFor(() => {
      const options = container.querySelectorAll('datalist option')
      expect(options.length).toBeGreaterThan(0)
    })
    const values = Array.from(container.querySelectorAll('datalist option')).map(o => (o as HTMLOptionElement).value)
    expect(values).toContain('Capital Grille')
  })

  it('hides the label when label="" is passed', () => {
    render(<BrandTagInput value="" onChange={() => {}} label="" />)
    expect(screen.queryByText('Brand (optional)')).toBeNull()
  })
})
