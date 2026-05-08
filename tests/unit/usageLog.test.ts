import { describe, it, expect, vi, beforeEach } from 'vitest'

const insertSpy = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createServiceRoleClient: () => ({
    from: () => ({ insert: insertSpy }),
  }),
}))

import { logUsage } from '@/lib/usageLog'

describe('logUsage (non-blocking)', () => {
  beforeEach(() => {
    insertSpy.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('skips entirely when no usage is provided', () => {
    logUsage({ resource_type: 'system', event_type: 'chat' }, undefined)
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('skips when token counts are all zero', () => {
    logUsage(
      { resource_type: 'system', event_type: 'chat' },
      {
        input_tokens: 0,
        output_tokens: 0,
        cache_read_tokens: 0,
        cache_creation_tokens: 0,
        model: 'm',
        provider: 'anthropic',
        tier: 'fast',
      },
    )
    expect(insertSpy).not.toHaveBeenCalled()
  })

  it('inserts when tokens are non-zero — and never throws on insert error', () => {
    insertSpy.mockReturnValue(
      Promise.resolve({ error: { message: 'rls denied' } }),
    )

    expect(() =>
      logUsage(
        { resource_type: 'bot', resource_id: 'b1', event_type: 'chat' },
        {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          model: 'claude-haiku',
          provider: 'anthropic',
          tier: 'fast',
        },
      ),
    ).not.toThrow()

    expect(insertSpy).toHaveBeenCalledTimes(1)
  })

  it('never throws when the supabase client itself blows up', () => {
    insertSpy.mockImplementation(() => {
      throw new Error('boom')
    })
    expect(() =>
      logUsage(
        { resource_type: 'bot', event_type: 'chat' },
        {
          input_tokens: 1,
          output_tokens: 1,
          cache_read_tokens: 0,
          cache_creation_tokens: 0,
          model: 'm',
          provider: 'anthropic',
          tier: 'fast',
        },
      ),
    ).not.toThrow()
  })
})
