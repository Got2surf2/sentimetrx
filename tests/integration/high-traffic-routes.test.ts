/**
 * High-traffic API route integration tests — always-on, mocked Supabase + AI.
 *
 * Coverage focus: validation, rate-limit, and not-found error paths on the
 * public-facing endpoints that take the most traffic. We mock at the module
 * boundary (rateLimit, ai, contentGuard, supabase/server) following the
 * pattern in respond.test.ts and decks.test.ts. Happy paths that depend on
 * the AI provider are intentionally out of scope — testing Anthropic's API
 * is Anthropic's job.
 *
 * Routes covered:
 *  - /api/clara-chat, /api/nora-chat, /api/bot-chat — three near-identical
 *    chat endpoints with the same validation shape
 *  - /api/townhall/chat — dual rate-limited venue chat endpoint
 *  - /api/study/[guid] — public survey loader
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Module-level mocks (must be set up before route imports) ───────────────

// Rate limiter — flip to limited:true to exercise the 429 path. Some routes
// call checkRateLimit twice (per-participant + per-IP); track call count so
// per-call results can be set independently.
const rateLimitResults: Array<{ limited: boolean; remaining: number }> = []
const checkRateLimit = vi.fn().mockImplementation(async () => {
  return rateLimitResults.shift() ?? { limited: false, remaining: 100 }
})
vi.mock('@/lib/rateLimit', () => ({ checkRateLimit }))

// AI / usage log — no-op so no real network call. Routes are tested for
// validation/error paths, not the AI happy path.
vi.mock('@/lib/ai', () => ({
  callAI: vi.fn().mockResolvedValue({ text: 'mocked', usage: {}, stopReason: 'end_turn' }),
}))
vi.mock('@/lib/usageLog', () => ({
  logUsage: vi.fn().mockResolvedValue(undefined),
  setUsageContext: vi.fn(),
}))

// Content guard — default safe; flip the next response to test the unsafe
// branch. Includes scoreSentimentFull because townhall/chat imports it.
const contentGuardNext = { safe: true as boolean, warning: '' as string, nudge: false as boolean }
vi.mock('@/lib/contentGuard', () => ({
  checkMessage: vi.fn(() => ({ safe: contentGuardNext.safe, warning: contentGuardNext.warning, nudge: contentGuardNext.nudge })),
  scoreSentimentFull: vi.fn(() => ({ score: 0, label: 'neutral' })),
}))

// Townhall-only deps — no-op
vi.mock('@/lib/guardrails', () => ({
  isOutputClean: () => true,
  cleanAiOutput: (s: string) => s,
  cleanDeflectResponse: (s: string) => s,
  looksLikeAIRefusal: () => false,
}))
vi.mock('@/lib/townhallThemeDetection', () => ({
  detectThemesForSession: vi.fn().mockResolvedValue(undefined),
}))

// Direct @supabase/supabase-js mock for the magic-link route, which
// constructs its own anon client rather than going through @/lib/supabase.
// `otpBehavior` controls the next signInWithOtp outcome.
const otpBehavior: { mode: 'success' | 'error' | 'throw' } = { mode: 'success' }
const otpCalls: Array<{ email: string }> = []
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: {
      signInWithOtp: vi.fn(async (args: { email: string }) => {
        otpCalls.push({ email: args.email })
        if (otpBehavior.mode === 'throw') throw new Error('boom')
        if (otpBehavior.mode === 'error') {
          return { data: null, error: { message: 'Signups not allowed for otp', status: 422, code: 'otp_disabled' } }
        }
        return { data: { user: null, session: null }, error: null }
      }),
    },
  }),
}))

// Supabase — used by study/[guid] (lookup) and townhall/chat (session lookup).
// Each test installs the row it needs via the `behavior` map.
type SupabaseBehavior = {
  studyByGuid?: { data: any[] | null; error: any }
  townhallSession?: { data: any; error: any }
}
const supaBehavior: SupabaseBehavior = {}

vi.mock('@/lib/supabase/server', () => {
  function chain(): any {
    const obj: any = {
      select: () => obj,
      eq: () => obj,
      not: () => obj,
      order: () => obj,
      limit: () => Promise.resolve(supaBehavior.studyByGuid ?? { data: [], error: null }),
      single: () => Promise.resolve({ data: null, error: { message: 'no row' } }),
      update: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }),
      insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'r1' }, error: null }) }) }),
    }
    return obj
  }
  return {
    createServiceRoleClient: () => ({
      from: (table: string) => {
        if (table === 'studies') {
          const obj = chain()
          obj.limit = () =>
            Promise.resolve(supaBehavior.studyByGuid ?? { data: [], error: null })
          return obj
        }
        if (table === 'townhall_sessions') {
          const obj = chain()
          obj.single = () =>
            Promise.resolve(supaBehavior.townhallSession ?? { data: null, error: { message: 'not found' } })
          return obj
        }
        if (table === 'organizations') {
          const obj = chain()
          obj.single = () => Promise.resolve({ data: { name: 'Test Org' }, error: null })
          return obj
        }
        return chain()
      },
    }),
    createClient: () => ({
      auth: { getUser: () => Promise.resolve({ data: { user: null } }) },
      from: () => chain(),
    }),
  }
})

// ── Helpers ────────────────────────────────────────────────────────────────

function jsonReq(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body: JSON.stringify(body),
  })
}

function rawReq(url: string, body: string): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
    body,
  })
}

// ── Chat-route shape (clara/nora/bot are near-identical) ───────────────────

const chatRoutes = [
  { name: 'clara-chat', loader: () => import('@/app/api/clara-chat/route').then(m => m.POST) },
  { name: 'nora-chat',  loader: () => import('@/app/api/nora-chat/route').then(m => m.POST) },
  { name: 'bot-chat',   loader: () => import('@/app/api/bot-chat/route').then(m => m.POST) },
]

beforeEach(() => {
  rateLimitResults.length = 0
  contentGuardNext.safe = true
  contentGuardNext.warning = ''
  contentGuardNext.nudge = false
  supaBehavior.studyByGuid = undefined
  supaBehavior.townhallSession = undefined
  otpBehavior.mode = 'success'
  otpCalls.length = 0
})

for (const route of chatRoutes) {
  describe('POST /api/' + route.name, () => {
    it('returns 429 when the IP rate limit is exceeded', async () => {
      rateLimitResults.push({ limited: true, remaining: 0 })
      const POST = await route.loader()
      const res = await POST(jsonReq('http://localhost/api/' + route.name, { messages: [{ role: 'user', content: 'hi' }] }))
      expect(res.status).toBe(429)
    })

    it('returns 400 on invalid JSON', async () => {
      const POST = await route.loader()
      const res = await POST(rawReq('http://localhost/api/' + route.name, 'not json'))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/invalid json/i)
    })

    it('returns 400 when messages is missing', async () => {
      const POST = await route.loader()
      const res = await POST(jsonReq('http://localhost/api/' + route.name, { something: 'else' }))
      expect(res.status).toBe(400)
      const body = await res.json()
      expect(body.error).toMatch(/messages/i)
    })

    it('returns 400 when messages is an empty array', async () => {
      const POST = await route.loader()
      const res = await POST(jsonReq('http://localhost/api/' + route.name, { messages: [] }))
      expect(res.status).toBe(400)
    })
  })
}

// ── /api/townhall/chat ──────────────────────────────────────────────────────

describe('POST /api/townhall/chat', () => {
  async function loadHandler() {
    return (await import('@/app/api/townhall/chat/route')).POST
  }

  it('returns 400 on invalid JSON', async () => {
    const POST = await loadHandler()
    const res = await POST(rawReq('http://localhost/api/townhall/chat', '{not json'))
    expect(res.status).toBe(400)
  })

  it('returns 400 when session_id is missing', async () => {
    const POST = await loadHandler()
    const res = await POST(jsonReq('http://localhost/api/townhall/chat', {
      participant_id: 'p1', message: 'hi', turn_number: 1, theme_id: null,
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/session_id|participant_id/i)
  })

  it('returns 400 when participant_id is missing', async () => {
    const POST = await loadHandler()
    const res = await POST(jsonReq('http://localhost/api/townhall/chat', {
      session_id: 's1', message: 'hi', turn_number: 1, theme_id: null,
    }))
    expect(res.status).toBe(400)
  })

  it('returns 429 when the per-participant rate limit fires', async () => {
    rateLimitResults.push({ limited: true, remaining: 0 })
    const POST = await loadHandler()
    const res = await POST(jsonReq('http://localhost/api/townhall/chat', {
      session_id: 's1', participant_id: 'p1', message: 'hi', turn_number: 1, theme_id: null,
    }))
    expect(res.status).toBe(429)
  })

  it('returns 429 when the per-IP venue rate limit fires (per-participant passes first)', async () => {
    rateLimitResults.push({ limited: false, remaining: 19 }) // per-participant ok
    rateLimitResults.push({ limited: true,  remaining: 0  }) // per-IP throttled
    const POST = await loadHandler()
    const res = await POST(jsonReq('http://localhost/api/townhall/chat', {
      session_id: 's1', participant_id: 'p1', message: 'hi', turn_number: 1, theme_id: null,
    }))
    expect(res.status).toBe(429)
  })

  it('returns 404 when the session is not found', async () => {
    supaBehavior.townhallSession = { data: null, error: { message: 'not found' } }
    const POST = await loadHandler()
    const res = await POST(jsonReq('http://localhost/api/townhall/chat', {
      session_id: '11111111-1111-1111-1111-111111111111',
      participant_id: 'p1', message: 'hi', turn_number: 1, theme_id: null,
    }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toMatch(/not found/i)
  })
})

// ── /api/study/[guid] ───────────────────────────────────────────────────────

describe('GET /api/study/[guid]', () => {
  async function loadHandler() {
    return (await import('@/app/api/study/[guid]/route')).GET
  }

  it('returns 400 when guid is empty', async () => {
    const GET = await loadHandler()
    const req = new NextRequest('http://localhost/api/study/')
    const res = await GET(req, { params: { guid: '' } })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/guid/i)
  })

  it('returns 404 when no study matches the guid', async () => {
    supaBehavior.studyByGuid = { data: [], error: null }
    const GET = await loadHandler()
    const req = new NextRequest('http://localhost/api/study/missing')
    const res = await GET(req, { params: { guid: 'missing' } })
    expect(res.status).toBe(404)
  })

  it('returns 403 when the study is not active (draft / paused / closed)', async () => {
    supaBehavior.studyByGuid = {
      data: [{ id: 's1', guid: 'g1', bot_name: 'Bot', bot_emoji: '💬', status: 'draft', config: {}, name: 'Test', org_id: null }],
      error: null,
    }
    const GET = await loadHandler()
    const req = new NextRequest('http://localhost/api/study/g1')
    const res = await GET(req, { params: { guid: 'g1' } })
    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/not active/i)
  })

  it('returns the study payload when active', async () => {
    supaBehavior.studyByGuid = {
      data: [{ id: 's1', guid: 'g1', bot_name: 'Bot', bot_emoji: '💬', status: 'active', config: { greeting: 'hi' }, name: 'Test', org_id: 'org1' }],
      error: null,
    }
    const GET = await loadHandler()
    const req = new NextRequest('http://localhost/api/study/g1')
    const res = await GET(req, { params: { guid: 'g1' } })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.guid).toBe('g1')
    expect(body.bot_name).toBe('Bot')
    expect(body.config?.greeting).toBe('hi')
  })
})

// ── /api/auth/magic-link ───────────────────────────────────────────────────
//
// The whole point of this route is the uniform response: every code path —
// success, Supabase 422, throw, missing email, invalid JSON, rate-limited —
// must produce status 200 with `{ ok: true }`. Anything else leaks
// information an attacker could use to enumerate accounts.

describe('POST /api/auth/magic-link', () => {
  async function loadHandler() {
    return (await import('@/app/api/auth/magic-link/route')).POST
  }

  function magicReq(body: unknown): NextRequest {
    return new NextRequest('http://localhost/api/auth/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.0.0.1' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })
  }

  async function assertUniform(res: Response) {
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ ok: true })
  }

  it('returns 200 ok when signInWithOtp succeeds (known user)', async () => {
    otpBehavior.mode = 'success'
    const POST = await loadHandler()
    const res = await POST(magicReq({ email: 'real@example.com' }))
    await assertUniform(res)
    expect(otpCalls).toHaveLength(1)
  })

  it('returns 200 ok when signInWithOtp returns the 422 enumeration error (unknown user)', async () => {
    otpBehavior.mode = 'error'
    const POST = await loadHandler()
    const res = await POST(magicReq({ email: 'unknown@example.com' }))
    await assertUniform(res)
    expect(otpCalls).toHaveLength(1)
  })

  it('returns 200 ok when signInWithOtp throws unexpectedly', async () => {
    otpBehavior.mode = 'throw'
    const POST = await loadHandler()
    const res = await POST(magicReq({ email: 'real@example.com' }))
    await assertUniform(res)
  })

  it('returns 200 ok when the body is missing email', async () => {
    const POST = await loadHandler()
    const res = await POST(magicReq({ redirectTo: 'https://example.com' }))
    await assertUniform(res)
    expect(otpCalls).toHaveLength(0)
  })

  it('returns 200 ok when the body is invalid JSON', async () => {
    const POST = await loadHandler()
    const res = await POST(magicReq('not json'))
    await assertUniform(res)
    expect(otpCalls).toHaveLength(0)
  })

  it('returns 200 ok when the IP is rate-limited (no 429 leak)', async () => {
    rateLimitResults.push({ limited: true, remaining: 0 })
    const POST = await loadHandler()
    const res = await POST(magicReq({ email: 'real@example.com' }))
    await assertUniform(res)
    expect(otpCalls).toHaveLength(0)
  })
})
