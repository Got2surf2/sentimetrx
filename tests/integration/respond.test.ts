import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { NextRequest } from 'next/server'
import { checkRateLimit } from '@/lib/rateLimit'

// Bypass the rate limiter in tests so we never thrash the in-memory bucket.
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ limited: false, remaining: 100 }),
}))

// Mock the audit guard — orthogonal to the schema-validation behaviour we
// want to assert here.
vi.mock('@/lib/contentGuard', () => ({
  auditContent: () => [],
  auditConversationLog: () => [],
}))

// A tiny in-memory Supabase stand-in. Each test installs the chain it needs
// by setting the `behavior` map below.
type QueryResult = { data: unknown; error: { message: string } | null }
type Behavior = {
  studyLookup?: QueryResult
  responseInsert?: QueryResult
  responseUpsert?: QueryResult
  existingDeviceCheck?: { data: unknown[] | null }
}
const behavior: Behavior = {}

interface SupabaseChain {
  select: () => SupabaseChain
  insert: () => unknown
  upsert: () => unknown
  update: () => SupabaseChain
  eq: () => SupabaseChain
  limit: () => SupabaseChain
  single: () => Promise<unknown>
  then: (resolve: (value: unknown) => void) => void
}

vi.mock('@/lib/supabase/server', () => {
  function chainable(): SupabaseChain {
    const obj: SupabaseChain = {
      select: () => obj,
      insert: () => obj,
      upsert: () => obj,
      update: () => obj,
      eq: () => obj,
      limit: () => obj,
      single: () => Promise.resolve(behavior.studyLookup ?? { data: null, error: null }),
      then: (resolve: (value: unknown) => void) => resolve({ data: [], error: null }),
    }
    return obj
  }
  return {
    createServiceRoleClient: () => ({
      from: (table: string) => {
        if (table === 'studies') {
          const obj: SupabaseChain = chainable()
          obj.single = () =>
            Promise.resolve(behavior.studyLookup ?? { data: null, error: { message: 'no study' } })
          return obj
        }
        if (table === 'responses') {
          const obj: SupabaseChain = chainable()
          obj.then = (resolve: (value: unknown) => void) =>
            resolve(behavior.existingDeviceCheck ?? { data: [], error: null })
          obj.upsert = () => ({
            select: () => ({
              single: () =>
                Promise.resolve(
                  behavior.responseUpsert ?? { data: { id: 'r1' }, error: null },
                ),
            }),
          })
          obj.insert = () => ({
            select: () => ({
              single: () =>
                Promise.resolve(
                  behavior.responseInsert ?? { data: { id: 'r1' }, error: null },
                ),
            }),
          })
          return obj
        }
        return chainable()
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    }),
    createClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      from: () => chainable(),
    }),
  }
})

async function loadHandler() {
  return (await import('@/app/api/respond/route')).POST
}

function jsonRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/respond', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/respond (public survey-response endpoint)', () => {
  beforeEach(() => {
    behavior.studyLookup = undefined
    behavior.responseInsert = undefined
    behavior.responseUpsert = undefined
    behavior.existingDeviceCheck = undefined
  })

  it('rejects with 400 when study_guid is missing', async () => {
    const POST = await loadHandler()
    const res = await POST(jsonRequest({ payload: { something: true } }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/missing/i)
  })

  it('rejects with 400 on invalid JSON', async () => {
    const POST = await loadHandler()
    const req = new NextRequest('http://localhost/api/respond', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: 'not json',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })

  it('returns 404 when the study does not exist', async () => {
    behavior.studyLookup = { data: null, error: { message: 'not found' } }
    const POST = await loadHandler()
    const res = await POST(
      jsonRequest({ study_guid: 'does-not-exist', payload: { x: 1 } }),
    )
    expect(res.status).toBe(404)
  })

  it('returns 403 when the study is not active', async () => {
    behavior.studyLookup = {
      data: { id: 's1', client_id: 'c1', status: 'paused', config: {} },
      error: null,
    }
    const POST = await loadHandler()
    const res = await POST(
      jsonRequest({ study_guid: 'g1', payload: { x: 1 } }),
    )
    expect(res.status).toBe(403)
  })
})

// Two-tier rate-limit keying (perf review §7 Brief D) — a venue-NAT crowd
// (one IP, many sessions) must not cross-throttle, while a per-IP backstop
// still stops abuse.
describe('POST /api/respond — rate-limit keying (Brief D)', () => {
  // Typed with the real async signature so mockImplementation knows the
  // callback returns a Promise (untyped vi.fn() infers a void return, which
  // trips @typescript-eslint/no-misused-promises on the per-key impl below).
  const rl = checkRateLimit as unknown as Mock<(key: string, limit?: number, windowMs?: number) => Promise<{ limited: boolean; remaining: number }>>
  beforeEach(() => { rl.mockClear(); rl.mockResolvedValue({ limited: false, remaining: 100 }) })

  it('keys the per-session bucket by (ip, session_id) + a per-IP backstop', async () => {
    const POST = await loadHandler()
    await POST(jsonRequest({ study_guid: 'g1', payload: { x: 1 }, session_id: 'ses_A', status: 'incomplete' }))
    const keys = rl.mock.calls.map(c => c[0])
    // per-session bucket (20/min) + per-IP backstop (600/min)
    expect(rl.mock.calls).toContainEqual(['respond:127.0.0.1:ses_A', 20, 60000])
    expect(rl.mock.calls).toContainEqual(['respond-ip:127.0.0.1', 600, 60000])
    expect(keys).not.toContain('respond:127.0.0.1') // the old flat key is gone
  })

  it('two sessions on the same IP get separate buckets (no cross-throttle)', async () => {
    const POST = await loadHandler()
    await POST(jsonRequest({ study_guid: 'g1', payload: { x: 1 }, session_id: 'ses_A', status: 'incomplete' }))
    await POST(jsonRequest({ study_guid: 'g1', payload: { x: 1 }, session_id: 'ses_B', status: 'incomplete' }))
    const sessionKeys = rl.mock.calls.map(c => c[0]).filter(k => k.startsWith('respond:'))
    expect(sessionKeys).toContain('respond:127.0.0.1:ses_A')
    expect(sessionKeys).toContain('respond:127.0.0.1:ses_B')
  })

  it('per-IP backstop 429s even when the per-session bucket is fine', async () => {
    rl.mockImplementation((key: string) =>
      Promise.resolve({ limited: key.startsWith('respond-ip:'), remaining: 0 }))
    const POST = await loadHandler()
    const res = await POST(jsonRequest({ study_guid: 'g1', payload: { x: 1 }, session_id: 'ses_A', status: 'incomplete' }))
    expect(res.status).toBe(429)
  })

  it('a session-less request falls back to an anon per-session bucket', async () => {
    const POST = await loadHandler()
    await POST(jsonRequest({ study_guid: 'g1', payload: { x: 1 }, status: 'incomplete' }))
    expect(rl.mock.calls).toContainEqual(['respond:127.0.0.1:anon', 20, 60000])
  })
})
