// @vitest-environment jsdom
//
// SentryDigest — the /admin/sentry triage list. Covers the client wiring that
// the server-side unit test can't: issues render, clicking Resolve/Archive
// POSTs {id,status} to /api/admin/sentry/issues, the row is optimistically
// removed on success, and a failed call surfaces an error banner (row stays).
// This is the behavioral check the real Sentry API can't provide locally
// (creds are prod-only).

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import SentryDigest from '@/components/admin/SentryDigest'

const ISSUE = {
  id: '42', shortId: 'JAVASCRIPT-NEXTJS-D', title: 'column agents.research_probes does not exist',
  culprit: 'GET /api/cron/bot-conversation-review', level: 'error', status: 'unresolved',
  count: 196, userCount: 0, firstSeen: new Date().toISOString(), lastSeen: new Date().toISOString(),
  permalink: 'https://sentry.io/x/42/',
}

function mockGetThen(postImpl: () => Promise<unknown>) {
  const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
    if (init?.method === 'POST') return postImpl()
    return { ok: true, json: async () => ({ ok: true, configured: true, fetchedAt: new Date().toISOString(), total: 1, issues: [ISSUE] }) }
  })
  vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch)
  return fetchMock as unknown as Mock
}

describe('SentryDigest triage actions', () => {
  beforeEach(() => { vi.unstubAllGlobals() })

  it('renders the issue and its Resolve/Archive buttons', async () => {
    mockGetThen(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    render(<SentryDigest />)
    await screen.findByText(ISSUE.title)
    expect(screen.getByRole('button', { name: 'Resolve' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Archive' })).toBeTruthy()
  })

  it('POSTs {id,status:resolved} and removes the row on success', async () => {
    const fetchMock = mockGetThen(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    render(<SentryDigest />)
    await screen.findByText(ISSUE.title)

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    await waitFor(() => expect(screen.queryByText(ISSUE.title)).toBeNull())

    const postCall = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')
    expect(postCall).toBeDefined()
    expect(postCall![0]).toBe('/api/admin/sentry/issues')
    expect(JSON.parse(postCall![1].body)).toEqual({ id: '42', status: 'resolved' })
  })

  it('maps Archive to status:ignored', async () => {
    const fetchMock = mockGetThen(async () => ({ ok: true, json: async () => ({ ok: true }) }))
    render(<SentryDigest />)
    await screen.findByText(ISSUE.title)

    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(screen.queryByText(ISSUE.title)).toBeNull())
    const postCall = fetchMock.mock.calls.find(c => c[1]?.method === 'POST')
    expect(postCall).toBeDefined()
    expect(JSON.parse(postCall![1].body)).toEqual({ id: '42', status: 'ignored' })
  })

  it('keeps the row and shows an error banner when the update fails', async () => {
    mockGetThen(async () => ({ ok: false, status: 502, json: async () => ({ ok: false, reason: 'Sentry API 403: forbidden' }) }))
    render(<SentryDigest />)
    await screen.findByText(ISSUE.title)

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }))
    await screen.findByText('Sentry API 403: forbidden')
    expect(screen.queryByText(ISSUE.title)).not.toBeNull() // row survives
  })
})
