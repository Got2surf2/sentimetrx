// Tests for lib/log.ts — the shared structured logger. The load-bearing
// guarantees: (1) error events reach Sentry tagged with where / request_id /
// org_id so a tenant's x-request-id joins to the event, (2) it never throws
// even if Sentry or the request-id lookup fails.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const captureException = vi.fn()
let requestId: string | null = 'req-abc123'

vi.mock('@sentry/nextjs', () => ({ captureException: (...a: unknown[]) => captureException(...a) }))
vi.mock('@/lib/requestContext', () => ({ getRequestId: async () => requestId }))

import { logError, logWarn } from '@/lib/log'

beforeEach(() => { captureException.mockClear(); requestId = 'req-abc123' })

describe('logError', () => {
  it('captures to Sentry with where / request_id / org_id tags', async () => {
    await logError('bots.list', new Error('boom'), { orgId: 'org-1', datasetId: 'd1' })
    expect(captureException).toHaveBeenCalledTimes(1)
    const [errArg, opts] = captureException.mock.calls[0] as [Error, { tags: Record<string, string>; extra: Record<string, unknown> }]
    expect(errArg).toBeInstanceOf(Error)
    expect(opts.tags).toMatchObject({ where: 'bots.list', request_id: 'req-abc123', org_id: 'org-1' })
    // non-reserved fields ride along as extra, not tags
    expect(opts.extra).toEqual({ datasetId: 'd1' })
  })

  it('omits request_id / org_id tags when unavailable', async () => {
    requestId = null
    await logError('cron.job', new Error('x'))
    const [, opts] = captureException.mock.calls[0] as [Error, { tags: Record<string, string> }]
    expect(opts.tags).toEqual({ where: 'cron.job' })
  })

  it('wraps a non-Error into an Error before capturing', async () => {
    await logError('x', { code: '23505', message: 'dup' })
    const [errArg] = captureException.mock.calls[0] as [Error]
    expect(errArg).toBeInstanceOf(Error)
  })

  it('prefixes the synthesized message with `where` so an empty-message object still says what failed', async () => {
    await logError('signalStats.resolveDatasetIds', { message: '' }, { datasetId: 'ds1' })
    const [errArg, opts] = captureException.mock.calls[0] as [Error, { extra: Record<string, unknown> }]
    // Title carries the operation instead of a context-free {"message":""}.
    expect(errArg.message).toBe('signalStats.resolveDatasetIds: {"message":""}')
    // The specific dataset rides along in extra data.
    expect(opts.extra).toMatchObject({ datasetId: 'ds1' })
  })

  it('leaves a real Error instance message untouched (no where prefix)', async () => {
    await logError('bots.list', new Error('boom'))
    const [errArg] = captureException.mock.calls[0] as [Error]
    expect(errArg.message).toBe('boom')
  })

  it('never throws when Sentry capture throws', async () => {
    captureException.mockImplementationOnce(() => { throw new Error('sentry down') })
    await expect(logError('x', new Error('y'))).resolves.toBeUndefined()
  })
})

describe('logWarn', () => {
  it('does not capture to Sentry', async () => {
    await logWarn('x', 'heads up', { orgId: 'org-1' })
    expect(captureException).not.toHaveBeenCalled()
  })
})
