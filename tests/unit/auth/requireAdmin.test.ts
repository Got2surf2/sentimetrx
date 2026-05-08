import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}))

import { requireAdmin } from '@/lib/auth/requireAdmin'

describe('requireAdmin', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockFrom.mockReset()
  })

  it('returns 404 when no user is authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await requireAdmin()
    expect(res).not.toBeNull()
    expect(res!.status).toBe(404)
  })

  it('returns 404 when user belongs to a non-admin org', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { organizations: { is_admin_org: false } } }),
        }),
      }),
    })
    const res = await requireAdmin()
    expect(res).not.toBeNull()
    expect(res!.status).toBe(404)
  })

  it('returns null (allow) when user is in an admin org', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: { organizations: { is_admin_org: true } } }),
        }),
      }),
    })
    const res = await requireAdmin()
    expect(res).toBeNull()
  })

  it('returns 404 when the org lookup yields no org', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } } })
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: () => Promise.resolve({ data: null }),
        }),
      }),
    })
    const res = await requireAdmin()
    expect(res).not.toBeNull()
    expect(res!.status).toBe(404)
  })
})
