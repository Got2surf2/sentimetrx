// Tests for updateIssueStatus (lib/sentry.ts) — the write path behind the
// /admin/sentry Resolve/Archive buttons. The Sentry token/org/project are
// only set in prod (encrypted Vercel env), so the real PUT is exercised in
// production; here we mock fetch to lock down the request shape (URL, method,
// auth header, body) and the ok / non-ok / unconfigured branches.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { updateIssueStatus } from '@/lib/sentry'

const ENV = { SENTRY_AUTH_TOKEN: 'tok_test', SENTRY_ORG_SLUG: 'datanautix', SENTRY_PROJECT_SLUG: 'javascript-nextjs' }

describe('updateIssueStatus', () => {
  beforeEach(() => {
    process.env.SENTRY_AUTH_TOKEN = ENV.SENTRY_AUTH_TOKEN
    process.env.SENTRY_ORG_SLUG = ENV.SENTRY_ORG_SLUG
    process.env.SENTRY_PROJECT_SLUG = ENV.SENTRY_PROJECT_SLUG
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.SENTRY_AUTH_TOKEN
    delete process.env.SENTRY_ORG_SLUG
    delete process.env.SENTRY_PROJECT_SLUG
  })

  it('PUTs the project-scoped issues endpoint with id, bearer token, and status body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)

    const res = await updateIssueStatus('123456', 'resolved')
    expect(res).toEqual({ ok: true, configured: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    const u = new URL(url)
    expect(u.pathname).toBe('/api/0/projects/datanautix/javascript-nextjs/issues/')
    expect(u.searchParams.get('id')).toBe('123456')
    expect(init.method).toBe('PUT')
    expect(init.headers.Authorization).toBe('Bearer tok_test')
    expect(JSON.parse(init.body)).toEqual({ status: 'resolved' })
  })

  it('maps Archive to Sentry status "ignored"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '' })
    vi.stubGlobal('fetch', fetchMock)

    await updateIssueStatus('999', 'ignored')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ status: 'ignored' })
  })

  it('returns ok:false with the API status/body on a non-2xx response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'forbidden: needs event:write' })
    vi.stubGlobal('fetch', fetchMock)

    const res = await updateIssueStatus('123', 'resolved')
    expect(res.ok).toBe(false)
    expect(res.configured).toBe(true)
    expect(res.reason).toContain('403')
    expect(res.reason).toContain('forbidden')
  })

  it('returns ok:false with a network-error reason when fetch throws', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('ECONNRESET'))
    vi.stubGlobal('fetch', fetchMock)

    const res = await updateIssueStatus('123', 'resolved')
    expect(res.ok).toBe(false)
    expect(res.reason).toContain('ECONNRESET')
  })

  it('reports configured:false without calling fetch when env is missing', async () => {
    delete process.env.SENTRY_AUTH_TOKEN
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await updateIssueStatus('123', 'resolved')
    expect(res).toMatchObject({ ok: false, configured: false })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
