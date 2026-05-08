import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse, NextRequest } from 'next/server'

// Control the gate from the test. We're verifying the routes:
//   1) call requireAdmin and respect its 404
//   2) on success, return PPTX bytes with the right content-type
const requireAdminMock = vi.fn()

vi.mock('@/lib/auth/requireAdmin', () => ({
  requireAdmin: () => requireAdminMock(),
}))

vi.mock('@/lib/auth/logDeckDownload', () => ({
  logDeckDownload: vi.fn().mockResolvedValue(undefined),
}))

// Each deck route calls GET — pitch/architecture/engineering take no args,
// rollup expects a NextRequest. Loaders are dynamic so the mocks above are
// installed before the route module is imported.
async function loadGetHandlers() {
  const pitch = (await import('@/app/api/pitch-deck/route')).GET
  const architecture = (await import('@/app/api/architecture-deck/route')).GET
  const engineering = (await import('@/app/api/engineering-reality-deck/route')).GET
  const rollup = (await import('@/app/api/rollup-deck/route')).GET
  return { pitch, architecture, engineering, rollup }
}

describe('admin-only deck routes', () => {
  beforeEach(() => {
    requireAdminMock.mockReset()
  })

  describe('anonymous → 404', () => {
    beforeEach(() => {
      requireAdminMock.mockResolvedValue(new NextResponse('Not Found', { status: 404 }))
    })

    it('pitch-deck returns 404', async () => {
      const { pitch } = await loadGetHandlers()
      const res = await pitch()
      expect(res.status).toBe(404)
    })

    it('architecture-deck returns 404', async () => {
      const { architecture } = await loadGetHandlers()
      const res = await architecture()
      expect(res.status).toBe(404)
    })

    it('engineering-reality-deck returns 404', async () => {
      const { engineering } = await loadGetHandlers()
      const res = await engineering()
      expect(res.status).toBe(404)
    })

    it('rollup-deck returns 404', async () => {
      const { rollup } = await loadGetHandlers()
      const req = new NextRequest('http://localhost/api/rollup-deck')
      const res = await rollup(req)
      expect(res.status).toBe(404)
    })
  })

  describe('admin → PPTX bytes', () => {
    beforeEach(() => {
      requireAdminMock.mockResolvedValue(null)
    })

    // PPTX generation involves zipping a number of slides; give the slow
    // decks a generous ceiling so a busy CI runner doesn't false-fail.
    const PPTX_TIMEOUT_MS = 45_000

    it(
      'pitch-deck returns a pptx for an admin',
      async () => {
        const { pitch } = await loadGetHandlers()
        const res = await pitch()
        expect(res.status).toBe(200)
        const ct = res.headers.get('content-type') || ''
        expect(ct).toContain('officedocument.presentationml.presentation')
      },
      PPTX_TIMEOUT_MS,
    )

    it(
      'architecture-deck returns a pptx for an admin',
      async () => {
        const { architecture } = await loadGetHandlers()
        const res = await architecture()
        expect(res.status).toBe(200)
        const ct = res.headers.get('content-type') || ''
        expect(ct).toContain('officedocument.presentationml.presentation')
      },
      PPTX_TIMEOUT_MS,
    )

    it(
      'engineering-reality-deck returns a pptx for an admin',
      async () => {
        const { engineering } = await loadGetHandlers()
        const res = await engineering()
        expect(res.status).toBe(200)
        const ct = res.headers.get('content-type') || ''
        expect(ct).toContain('officedocument.presentationml.presentation')
      },
      PPTX_TIMEOUT_MS,
    )

    it(
      'rollup-deck returns a pptx for an admin',
      async () => {
        const { rollup } = await loadGetHandlers()
        const req = new NextRequest('http://localhost/api/rollup-deck?length=short')
        const res = await rollup(req)
        expect(res.status).toBe(200)
        const ct = res.headers.get('content-type') || ''
        expect(ct).toContain('officedocument.presentationml.presentation')
      },
      PPTX_TIMEOUT_MS,
    )
  })
})
