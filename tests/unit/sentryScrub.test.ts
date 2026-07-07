import { describe, expect, it } from 'vitest'
import { scrubSentryEvent } from '@/lib/sentryScrub'

describe('scrubSentryEvent', () => {
  it('redacts request.data / body / cookies wholesale', () => {
    const ev = scrubSentryEvent({
      request: {
        data: { response: 'my survey answer mentions alice@example.com' },
        body: 'raw body',
        cookies: { session: 'sess_abc' },
      },
    })!
    expect(ev?.request).toEqual({
      data: '[redacted]',
      body: '[redacted]',
      cookies: '[redacted]',
    })
  })

  it('redacts authorization + cookie headers but keeps other headers', () => {
    const ev = scrubSentryEvent({
      request: {
        headers: {
          'user-agent': 'Mozilla',
          authorization: 'Bearer sk_live_xxx',
          Cookie: 'session=abc',
          'x-org-id': 'org_123',
        },
      },
    })!
    expect(ev.request.headers['user-agent']).toBe('Mozilla')
    expect(ev.request.headers['x-org-id']).toBe('org_123')
    expect(ev.request.headers.authorization).toBe('[redacted]')
    expect(ev.request.headers.Cookie).toBe('[redacted]')
  })

  it('redacts PII key names anywhere in extra / contexts / tags', () => {
    const ev = scrubSentryEvent({
      extra: {
        email: 'a@b.com',
        nested: { phone: '+1 555 123 4567', ok: 'fine' },
      },
      contexts: { user: { apiKey: 'k_secret' } },
      tags: { token: 't1', plain: 'visible' },
    })!
    expect(ev.extra.email).toBe('[redacted]')
    expect(ev.extra.nested.phone).toBe('[redacted]')
    expect(ev.extra.nested.ok).toBe('fine')
    expect(ev.contexts.user.apiKey).toBe('[redacted]')
    expect(ev.tags.token).toBe('[redacted]')
    expect(ev.tags.plain).toBe('visible')
  })

  it('reduces user to {id} only', () => {
    const ev = scrubSentryEvent({
      user: { id: 'u_1', email: 'a@b.com', ip_address: '1.2.3.4', username: 'alice' },
    })!
    expect(ev.user).toEqual({ id: 'u_1' })
  })

  it('drops the Office content-script false positive', () => {
    expect(
      scrubSentryEvent({
        exception: {
          values: [{ value: 'Object Not Found Matching Id:7, MethodName:update, ParamCount:4' }],
        },
      }),
    ).toBe(null)
  })

  it('scrubs email + phone patterns in breadcrumbs.message', () => {
    const ev = scrubSentryEvent({
      breadcrumbs: [
        { category: 'navigation', message: 'visited /u/alice@example.com profile' },
        { category: 'http', message: 'called 555-123-4567' },
      ],
    })!
    expect(ev.breadcrumbs[0].message).toBe('visited /u/[redacted] profile')
    expect(ev.breadcrumbs[1].message).toBe('called [redacted]')
  })

  it('lets clean events through unchanged in shape', () => {
    const ev = scrubSentryEvent({
      message: 'normal error',
      tags: { env: 'production' },
    })!
    expect(ev.message).toBe('normal error')
    expect(ev.tags.env).toBe('production')
  })
})
