import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  }),
}))

// next/headers cookies(): a controllable jar (null = outside a request scope,
// which requireAdmin tolerates by evaluating with no cookie).
let jar: { get: (k: string) => { value: string } | undefined; set: (k: string, v: string) => void } | null = null
const setCookie = vi.fn()
vi.mock('next/headers', () => ({ cookies: async () => { if (!jar) throw new Error('outside request scope'); return jar } }))
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { encodeStamp, ADMIN_IDLE_MS } from '@/lib/auth/adminSession'

describe('requireAdmin', () => {
  beforeEach(() => {
    mockGetUser.mockReset()
    mockFrom.mockReset()
    jar = null; setCookie.mockReset()
  })

  it('returns 404 when no user is authenticated', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const res = await requireAdmin()
    expect(res).not.toBeNull()
    expect(res!.status).toBe(404)
  })

  it('returns 404 when user belongs to a non-admin org', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', last_sign_in_at: new Date().toISOString() } } })
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
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', last_sign_in_at: new Date().toISOString() } } })
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
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', last_sign_in_at: new Date().toISOString() } } })
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

  // ── Session policy (SECURITY.md §3, ratified 2026-09-15) ───────────────────
  const adminOrg = () => mockFrom.mockReturnValue({ select: () => ({ eq: () => ({ single: () => Promise.resolve({ data: { organizations: { is_admin_org: true } } }) }) }) })
  const withJar = (cookie?: string) => { jar = { get: (k) => (k === 'sx_admin_session' && cookie ? { value: cookie } : undefined), set: setCookie } }
  const KEY = process.env.AI_KEY_ENC_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

  it('admin whose sign-in is older than 30 min and has no stamp → 401 idle (cookie stripping cannot extend a session)', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', last_sign_in_at: new Date(Date.now() - ADMIN_IDLE_MS - 60_000).toISOString() } } })
    adminOrg(); withJar()
    const res = await requireAdmin()
    expect(res?.status).toBe(401)
    expect(await res!.json()).toMatchObject({ reason: 'idle' })
  })
  it('admin with a valid, recently-seen stamp → allowed and the stamp is refreshed', async () => {
    const start = Date.now() - 3 * 3_600_000
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', last_sign_in_at: new Date(start).toISOString() } } })
    adminOrg(); withJar(encodeStamp(start, Date.now() - 5 * 60_000, KEY))
    expect(await requireAdmin()).toBeNull()
    expect(setCookie).toHaveBeenCalledWith('sx_admin_session', expect.stringMatching(/^\d+\.\d+\./), expect.objectContaining({ httpOnly: true }))
  })
  it('admin active all day but past 24 h from session start → 401 max', async () => {
    const start = Date.now() - 25 * 3_600_000
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', last_sign_in_at: new Date(start).toISOString() } } })
    adminOrg(); withJar(encodeStamp(start, Date.now() - 60_000, KEY))
    const res = await requireAdmin()
    expect(res?.status).toBe(401)
    expect(await res!.json()).toMatchObject({ reason: 'max' })
  })
  it('touch:false checks without refreshing the stamp (heartbeats do not count as activity)', async () => {
    const start = Date.now() - 60_000
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1', last_sign_in_at: new Date(start).toISOString() } } })
    adminOrg(); withJar(encodeStamp(start, start, KEY))
    expect(await requireAdmin({ touch: false })).toBeNull()
    const [, value] = setCookie.mock.calls[0] as [string, string]
    expect(value.split('.')[1]).toBe(String(start))
  })
})
