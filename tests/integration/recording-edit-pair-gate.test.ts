// tests/integration/recording-edit-pair-gate.test.ts
//
// PATCH /api/recordings/[id]/extractions/[extractionId] — hand-edit a Q&A pair's
// display text (§3.5d). Asserts: same-tenant gate (404 cross-org), only qa_pairs
// editable, edited_* written, and a side cleared (null) reverts to AI. The AI
// polished + verbatim are never touched.

import { describe, it, expect, beforeEach, vi } from 'vitest'

const ctx = {
  callerOrg: 'orgA',
  rowOrg: 'orgA',
  unitType: 'qa_pair',
}
let updatedPayload: any = null

vi.mock('@/lib/supabase/server', () => {
  const builder = (table: string): any => {
    const b: any = { _table: table, _eqs: {} as Record<string, string> }
    for (const m of ['select', 'order']) b[m] = () => b
    b.eq = (col: string, val: string) => { b._eqs[col] = val; return b }
    b.single = async () => {
      if (table === 'users') return { data: { org_id: ctx.callerOrg }, error: null }
      if (table === 'recording_extractions') {
        // Cross-org: the row read pairs org_id; mismatch → no row.
        if (b._eqs.org_id && b._eqs.org_id !== ctx.rowOrg) return { data: null, error: null }
        return { data: { id: 'e1', org_id: ctx.rowOrg, unit_type: ctx.unitType, payload: { question: 'V q', answer: 'V a', polished_question: 'AI q', polished_answer: 'AI a', question_typology: 'ask' } }, error: null }
      }
      return { data: null, error: null }
    }
    b.update = (vals: any) => { updatedPayload = vals.payload; return b }
    return b
  }
  return {
    createClient: async () => ({ from: (t: string) => builder(t) }),
    createServiceRoleClient: () => ({ from: (t: string) => builder(t) }),
    getAuthUser: async () => ({ id: 'u1' }),
  }
})

import * as route from '@/app/api/recordings/[id]/extractions/[extractionId]/route'

function patch(body: any) {
  const req = new Request('http://t/x', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return route.PATCH(req, { params: Promise.resolve({ id: 'r1', extractionId: 'e1' }) })
}

beforeEach(() => { updatedPayload = null; ctx.rowOrg = 'orgA'; ctx.unitType = 'qa_pair' })

describe('PATCH recording extraction — hand-edit gate', () => {
  it('writes edited_* and stamps edited_at', async () => {
    const res = await patch({ edited_question: 'My fix', edited_answer: 'Better answer' })
    expect(res.status).toBe(200)
    expect(updatedPayload.edited_question).toBe('My fix')
    expect(updatedPayload.edited_answer).toBe('Better answer')
    expect(typeof updatedPayload.edited_at).toBe('string')
    // AI + verbatim untouched.
    expect(updatedPayload.polished_question).toBe('AI q')
    expect(updatedPayload.question).toBe('V q')
  })

  it('clearing both sides (null) reverts to AI and drops the stamp', async () => {
    const res = await patch({ edited_question: null, edited_answer: '' })
    expect(res.status).toBe(200)
    expect(updatedPayload.edited_question).toBeNull()
    expect(updatedPayload.edited_answer).toBeNull()
    expect(updatedPayload.edited_at).toBeNull()
  })

  it('404s on a cross-org extraction (same-tenant gate)', async () => {
    ctx.rowOrg = 'orgB'
    const res = await patch({ edited_question: 'x' })
    expect(res.status).toBe(404)
    expect(updatedPayload).toBeNull()
  })

  it('rejects non-qa_pair rows', async () => {
    ctx.unitType = 'action_item'
    const res = await patch({ edited_question: 'x' })
    expect(res.status).toBe(400)
    expect(updatedPayload).toBeNull()
  })

  it('400s when no editable field is provided', async () => {
    const res = await patch({ foo: 'bar' })
    expect(res.status).toBe(400)
  })
})
