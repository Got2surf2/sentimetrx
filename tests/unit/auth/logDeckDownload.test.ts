import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockUserSelect = vi.fn()
const mockServiceInsert = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: mockUserSelect,
        }),
      }),
    }),
  }),
  createServiceRoleClient: () => ({
    from: () => ({ insert: mockServiceInsert }),
  }),
}))

import { logDeckDownload } from '@/lib/auth/logDeckDownload'

describe('logDeckDownload (fire-and-forget)', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockUserSelect.mockReset()
    mockServiceInsert.mockReset()
  })

  it('inserts a log row with user + org context when the user is signed in', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockUserSelect.mockResolvedValue({ data: { org_id: 'o1' } })
    mockServiceInsert.mockResolvedValue({ error: null })

    await expect(logDeckDownload('pitch-deck', 'short')).resolves.toBeUndefined()

    expect(mockServiceInsert).toHaveBeenCalledWith({
      deck_name: 'pitch-deck',
      deck_variant: 'short',
      user_id: 'u1',
      org_id: 'o1',
    })
  })

  it('inserts a log row with nulls when no user is signed in', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    mockServiceInsert.mockResolvedValue({ error: null })

    await expect(logDeckDownload('rollup-deck')).resolves.toBeUndefined()

    expect(mockServiceInsert).toHaveBeenCalledWith({
      deck_name: 'rollup-deck',
      deck_variant: null,
      user_id: null,
      org_id: null,
    })
  })

  it('never throws when the database insert fails', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockUserSelect.mockResolvedValue({ data: { org_id: 'o1' } })
    mockServiceInsert.mockRejectedValue(new Error('network down'))

    await expect(logDeckDownload('pitch-deck')).resolves.toBeUndefined()
  })

  it('never throws when getUser itself blows up', async () => {
    mockGetUser.mockRejectedValue(new Error('auth service offline'))
    await expect(logDeckDownload('pitch-deck')).resolves.toBeUndefined()
  })
})
