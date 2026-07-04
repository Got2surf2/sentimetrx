// Tests for the nightly org-snapshot cron's time-budgeted continuation
// (app/api/cron/org-snapshot/route.ts, ARCHITECTURE.md D16b). Load-bearing
// semantics: orgs process in deterministic id order; the loop bails at
// TIME_BUDGET_MS (but never before the first org, so the cursor always
// advances); the bail fires a self-invocation with ?after=<last-org-id>&hop=N
// + the CRON_SECRET bearer via waitUntil; hop > 20 is refused; and every hop
// fails loudly (non-2xx + logError) for its own slice without blocking the
// continuation for the orgs after it. Per-org dump work is mocked — this is
// orchestration only; nothing here touches S3 or a real database.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

const SECRET = 'test-cron-secret-0123456789abcdef' // ≥16 chars for checkCronAuth
const BASE = 'https://cron-test.example'

// Org fixture — ids deliberately unsorted to prove the route orders by id.
let orgRows: Array<{ id: string; name: string | null }> = []

function makeServiceMock() {
  return {
    from(_table: string) {
      const state = { gt: null as string | null }
      const builder = {
        select() { return builder },
        gt(_col: string, v: string) { state.gt = v; return builder },
        order(_col: string, _o?: unknown) {
          let out = [...orgRows].sort((a, b) => (a.id < b.id ? -1 : 1))
          if (state.gt !== null) out = out.filter(r => r.id > state.gt!)
          return Promise.resolve({ data: out, error: null })
        },
      }
      return builder
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({ createServiceRoleClient: () => makeServiceMock() }))
vi.mock('@/lib/backupS3', () => ({ s3SnapshotStore: () => ({ fake: 'store' }) }))

// Per-org dump: tests control elapsed time (fake clock) and failures per org.
const dumpMock = vi.fn()
vi.mock('@/lib/orgSnapshotV2', () => ({
  dumpOrgSnapshotV2: (db: unknown, orgId: string, store: unknown) => dumpMock(db, orgId, store),
}))

const logErrorMock = vi.fn()
vi.mock('@/lib/log', () => ({
  logError: async (where: string, err: unknown, fields?: Record<string, unknown>) => { logErrorMock(where, err, fields) },
}))

// waitUntil: record the promise so tests can prove the continuation was
// deferred (not awaited before the response) and settle it afterwards.
let waitUntilPromises: Promise<unknown>[] = []
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => { waitUntilPromises.push(p) } }))

const fetchMock = vi.fn()

function okDump(msPerOrg = 0, fetchErrors: Record<string, string> = {}) {
  dumpMock.mockImplementation(async (_db: unknown, orgId: string) => {
    if (msPerOrg > 0) vi.advanceTimersByTime(msPerOrg)
    return {
      manifestKey: 'org-snapshots/' + orgId + '/2026/07/04/v2/manifest.json',
      meta: { snapshot_version: 2, org_id: orgId, org_name: null, taken_at: 't', table_row_counts: { users: 1 }, fetch_errors: fetchErrors, tables: [], total_bytes: 100 },
    }
  })
}

function req(params: Record<string, string> = {}, auth: string | null = 'Bearer ' + SECRET) {
  const url = new URL(BASE + '/api/cron/org-snapshot')
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v)
  return new NextRequest(url, auth ? { headers: { authorization: auth } } : undefined)
}

async function loadGet() {
  return (await import('@/app/api/cron/org-snapshot/route')).GET
}

beforeEach(() => {
  vi.useFakeTimers()
  process.env.CRON_SECRET = SECRET
  process.env.NEXT_PUBLIC_BASE_URL = BASE
  orgRows = []
  dumpMock.mockReset()
  logErrorMock.mockClear()
  waitUntilPromises = []
  fetchMock.mockReset()
  fetchMock.mockResolvedValue({ ok: true, status: 200 })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('cron/org-snapshot — time-budgeted continuation', () => {
  it('processes every org in id order in one hop when the budget holds; no continuation', async () => {
    orgRows = [{ id: 'org-c', name: 'C' }, { id: 'org-a', name: 'A' }, { id: 'org-b', name: 'B' }]
    okDump(1_000) // 3 orgs × 1s — well under budget
    const res = await (await loadGet())(req())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.ok).toBe(true)
    expect(body.orgs_total).toBe(3)
    expect(body.orgs_remaining).toBe(0)
    expect(body.continued).toBe(false)
    expect(body.results.map((r: { org_id: string }) => r.org_id)).toEqual(['org-a', 'org-b', 'org-c'])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(logErrorMock).not.toHaveBeenCalled()
  })

  it('bails at the budget and re-invokes itself via waitUntil with the cursor + hop + CRON_SECRET', async () => {
    orgRows = Array.from({ length: 5 }, (_, i) => ({ id: 'org-' + i, name: 'Org ' + i }))
    okDump(100_000) // 100s/org → org-0,1 fit; org-2 crosses 240s after processing; bail before org-3
    const res = await (await loadGet())(req())
    const body = await res.json()

    expect(res.status).toBe(200) // this hop's slice all succeeded
    expect(body.orgs_total).toBe(3)
    expect(body.orgs_remaining).toBe(2)
    expect(body.continued).toBe(true)
    expect(body.next_after).toBe('org-2')
    expect(dumpMock).toHaveBeenCalledTimes(3)

    // Continuation went through waitUntil (deferred), not awaited inline.
    expect(waitUntilPromises.length).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }]
    expect(calledUrl).toBe(BASE + '/api/cron/org-snapshot?after=org-2&hop=1')
    expect(init.headers.authorization).toBe('Bearer ' + SECRET)
    await Promise.all(waitUntilPromises)
    expect(logErrorMock).not.toHaveBeenCalled() // child hop reported 200
  })

  it('a continuation hop resumes strictly after the cursor', async () => {
    orgRows = Array.from({ length: 5 }, (_, i) => ({ id: 'org-' + i, name: null }))
    okDump()
    const res = await (await loadGet())(req({ after: 'org-2', hop: '1' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.hop).toBe(1)
    expect(body.results.map((r: { org_id: string }) => r.org_id)).toEqual(['org-3', 'org-4'])
    expect(body.continued).toBe(false)
  })

  it('always processes at least one org per hop, so the cursor strictly advances even when every org overruns the budget', async () => {
    orgRows = [{ id: 'org-a', name: null }, { id: 'org-b', name: null }]
    okDump(300_000) // a single org blows the whole budget
    const res = await (await loadGet())(req())
    const body = await res.json()

    expect(dumpMock).toHaveBeenCalledTimes(1)
    expect(body.results.map((r: { org_id: string }) => r.org_id)).toEqual(['org-a'])
    expect(body.continued).toBe(true)
    expect(body.next_after).toBe('org-a') // advanced past org-a — the next hop starts at org-b
    expect(fetchMock.mock.calls[0][0]).toContain('after=org-a&hop=1')
  })

  it('refuses hop > 20 with a loud 500 and does no work (runaway-chain breaker)', async () => {
    orgRows = [{ id: 'org-a', name: null }]
    okDump()
    const res = await (await loadGet())(req({ hop: '21', after: 'x' }))

    expect(res.status).toBe(500)
    expect(dumpMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
    // serverError routes through logError — the refusal is loud.
    expect(logErrorMock).toHaveBeenCalledWith('cron.orgSnapshot.hopCap', expect.anything(), expect.anything())
  })

  it('at the hop cap with orgs remaining, fails loudly instead of firing a doomed continuation', async () => {
    orgRows = [{ id: 'org-a', name: null }, { id: 'org-b', name: null }]
    okDump(300_000) // bail after org-a with org-b remaining
    const res = await (await loadGet())(req({ hop: '20' }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.continued).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(body.results.find((r: { org_id: string }) => r.org_id === 'org-b')?.error).toContain('hop cap')
    expect(logErrorMock).toHaveBeenCalledWith('cron.orgSnapshot.hopCap', expect.anything(), expect.objectContaining({ hop: 20, orgs_remaining: 1 }))
  })

  it('a failed org in the slice → 500 + Sentry for THIS hop, but the continuation still fires for the rest', async () => {
    orgRows = Array.from({ length: 3 }, (_, i) => ({ id: 'org-' + i, name: null }))
    dumpMock.mockImplementation(async (_db: unknown, orgId: string) => {
      vi.advanceTimersByTime(150_000) // 2 orgs fit the budget, 1 remains
      if (orgId === 'org-0') throw new Error('S3 exploded')
      return { manifestKey: 'k', meta: { snapshot_version: 2, org_id: orgId, org_name: null, taken_at: 't', table_row_counts: {}, fetch_errors: {}, tables: [], total_bytes: 1 } }
    })
    const res = await (await loadGet())(req())
    const body = await res.json()

    expect(res.status).toBe(500) // fail-loud preserved per slice
    expect(body.ok).toBe(false)
    expect(body.orgs_failed).toBe(1)
    expect(body.results[0].error).toBe('S3 exploded')
    expect(body.results[1].error).toBeUndefined() // later org unaffected
    // slice failure is loud even when nobody reads a continuation hop's response
    expect(logErrorMock).toHaveBeenCalledWith('cron.orgSnapshot.run', expect.anything(), expect.objectContaining({ hop: 0, orgs_failed: 1 }))
    // ...and the failure does not strand the remaining orgs
    expect(body.continued).toBe(true)
    expect(fetchMock.mock.calls[0][0]).toContain('after=org-1&hop=1')
  })

  it('incomplete snapshots (fetch_errors) still fail the hop, exactly as before', async () => {
    orgRows = [{ id: 'org-a', name: null }]
    okDump(0, { conversations: 'read timeout' })
    const res = await (await loadGet())(req())
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.results[0].error).toContain('incomplete snapshot: conversations')
    expect(body.results[0].fetch_errors).toEqual({ conversations: 'read timeout' })
  })

  it('a continuation hop that never ran (non-2xx) is reported via logError', async () => {
    orgRows = [{ id: 'org-a', name: null }, { id: 'org-b', name: null }]
    okDump(300_000)
    fetchMock.mockResolvedValue({ ok: false, status: 401 })
    await (await loadGet())(req())

    await Promise.all(waitUntilPromises)
    expect(logErrorMock).toHaveBeenCalledWith('cron.orgSnapshot.continuation', expect.anything(), expect.objectContaining({ hop: 1, after: 'org-a' }))
  })

  it('rejects unauthenticated requests before doing anything', async () => {
    orgRows = [{ id: 'org-a', name: null }]
    okDump()
    const res = await (await loadGet())(req({}, 'Bearer wrong-secret-aaaaaaaaaaaaaaaaa'))
    expect(res.status).toBe(401)
    expect(dumpMock).not.toHaveBeenCalled()
  })
})
