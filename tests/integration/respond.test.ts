import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

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
