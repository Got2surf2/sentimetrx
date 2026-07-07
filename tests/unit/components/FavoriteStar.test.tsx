// @vitest-environment jsdom
//
// FavoriteStar — shared favorite toggle (bots/surveys/datasets/recordings).
// Covers the a11y state contract, the optimistic toggle + POST /api/favorites
// wiring, and the re-sync when the parent hydrates initialFavorited late.

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { FavoriteStar } from '@/components/ui/FavoriteStar'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: true,
    json: async () => ({ favorited: true }),
  })) as unknown as typeof fetch)
})

describe('FavoriteStar', () => {
  it('reflects the initial favorited state via aria-pressed + label', () => {
    render(<FavoriteStar resourceType="bot" resourceId="b1" initialFavorited={false} />)
    const btn = screen.getByRole('button')
    expect(btn.getAttribute('aria-pressed')).toBe('false')
    expect(btn.getAttribute('aria-label')).toBe('Add to favorites')
  })

  it('optimistically toggles and POSTs to /api/favorites on click', async () => {
    const fetchMock = global.fetch as unknown as Mock
    render(<FavoriteStar resourceType="dataset" resourceId="ds9" initialFavorited={false} />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('true'))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/favorites')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ resource_type: 'dataset', resource_id: 'ds9' })
  })

  it('reverts the optimistic state when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })) as unknown as typeof fetch)
    render(<FavoriteStar resourceType="bot" resourceId="b2" initialFavorited={false} />)
    const btn = screen.getByRole('button')
    fireEvent.click(btn)
    // flips true optimistically, then reverts to false on the non-ok response
    await waitFor(() => expect(btn.getAttribute('aria-pressed')).toBe('false'))
  })

  it('re-syncs when the parent hydrates initialFavorited after mount', () => {
    const { rerender } = render(
      <FavoriteStar resourceType="bot" resourceId="b3" initialFavorited={false} />,
    )
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
    rerender(<FavoriteStar resourceType="bot" resourceId="b3" initialFavorited={true} />)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })
})
