import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { mirrorTurns, mirrorFocusFlagsUpdate, mirrorDeleteSession } from '@/lib/phase3DualWrite'

type MockResult = { data: unknown; error: unknown }
interface MockBuilder {
  eq(col: string, val: unknown): MockBuilder
  select(): MockBuilder
  single(): Promise<MockResult>
  maybeSingle(): Promise<MockResult>
  then(onF: (r: MockResult) => void): void
}

// Minimal Supabase client mock — captures the call chain and lets each test
// assert which tables were touched and with what filters.
function buildMockService() {
  const calls: { table: string; verb: string; payload?: unknown; filters?: Record<string, unknown> }[] = []

  function makeBuilder(table: string, verb: string, payload?: unknown) {
    const filters: Record<string, unknown> = {}
    const builder: MockBuilder = {
      eq(col: string, val: unknown) { filters[col] = val; return builder },
      select() { return builder },
      single() {
        calls.push({ table, verb, payload, filters })
        if (table === 'conversations' && (verb === 'upsert' || verb === 'select')) {
          return Promise.resolve({ data: { id: 'mock-conv-id' }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      maybeSingle() {
        calls.push({ table, verb, payload, filters })
        if (table === 'conversations' && verb === 'select') {
          return Promise.resolve({ data: { id: 'mock-conv-id' }, error: null })
        }
        return Promise.resolve({ data: null, error: null })
      },
      then(onF: (r: MockResult) => void) {
        // Terminal — fires when the builder is awaited without .select()/.single()
        calls.push({ table, verb, payload, filters })
        onF({ data: null, error: null })
      },
    }
    return builder
  }

  const service = {
    from(table: string) {
      return {
        upsert(payload: unknown) { return makeBuilder(table, 'upsert', payload) },
        insert(payload: unknown) { return makeBuilder(table, 'insert', payload) },
        update(payload: unknown) { return makeBuilder(table, 'update', payload) },
        delete() { return makeBuilder(table, 'delete') },
        select() { return makeBuilder(table, 'select') },
      }
    },
  }
  return { service: service as unknown as SupabaseClient, calls }
}

describe('phase3DualWrite — flag gating', () => {
  const original = process.env.DUAL_WRITE_PHASE3
  afterEach(() => {
    if (original === undefined) delete process.env.DUAL_WRITE_PHASE3
    else process.env.DUAL_WRITE_PHASE3 = original
  })

  it('mirrorTurns is a no-op when DUAL_WRITE_PHASE3 is unset', async () => {
    delete process.env.DUAL_WRITE_PHASE3
    const { service, calls } = buildMockService()
    await mirrorTurns(service, { botId: 'b', orgId: 'o', sessionId: 's', rows: [{ bot_id: 'b', session_id: 's', turn_number: 0, role: 'user', content: 'hi' }] })
    expect(calls.length).toBe(0)
  })

  it('mirrorTurns is a no-op when DUAL_WRITE_PHASE3 is "false"', async () => {
    process.env.DUAL_WRITE_PHASE3 = 'false'
    const { service, calls } = buildMockService()
    await mirrorTurns(service, { botId: 'b', orgId: 'o', sessionId: 's', rows: [{ bot_id: 'b', session_id: 's', turn_number: 0, role: 'user', content: 'hi' }] })
    expect(calls.length).toBe(0)
  })

  it('mirrorFocusFlagsUpdate is a no-op when flag is off', async () => {
    delete process.env.DUAL_WRITE_PHASE3
    const { service, calls } = buildMockService()
    await mirrorFocusFlagsUpdate(service, { botId: 'b', sessionId: 's', turnNumber: 1, flags: ['focus:x'] })
    expect(calls.length).toBe(0)
  })

  it('mirrorDeleteSession is a no-op when flag is off', async () => {
    delete process.env.DUAL_WRITE_PHASE3
    const { service, calls } = buildMockService()
    await mirrorDeleteSession(service, { botId: 'b', sessionId: 's' })
    expect(calls.length).toBe(0)
  })
})

describe('phase3DualWrite — wiring (flag ON)', () => {
  const original = process.env.DUAL_WRITE_PHASE3
  beforeEach(() => { process.env.DUAL_WRITE_PHASE3 = 'true' })
  afterEach(() => {
    if (original === undefined) delete process.env.DUAL_WRITE_PHASE3
    else process.env.DUAL_WRITE_PHASE3 = original
  })

  it('mirrorTurns upserts conversations then inserts conversation_turns', async () => {
    const { service, calls } = buildMockService()
    await mirrorTurns(service, {
      botId: 'bot-1', orgId: 'org-1', sessionId: 'sess-1', language: 'en',
      rows: [
        { bot_id: 'bot-1', session_id: 'sess-1', turn_number: 0, role: 'user', content: 'hi', language: 'en' },
        { bot_id: 'bot-1', session_id: 'sess-1', turn_number: 1, role: 'assistant', content: 'hello back', language: 'en' },
      ],
    })

    expect(calls[0].table).toBe('conversations')
    expect(calls[0].verb).toBe('upsert')
    expect((calls[0].payload as Record<string, unknown>).bot_id).toBe('bot-1')
    expect((calls[0].payload as Record<string, unknown>).session_id).toBe('sess-1')
    expect((calls[0].payload as Record<string, unknown>).org_id).toBe('org-1')

    const turnCall = calls.find(c => c.table === 'conversation_turns' && c.verb === 'insert')
    expect(turnCall).toBeTruthy()
    const turns = turnCall!.payload as Record<string, unknown>[]
    expect(turns.length).toBe(2)
    expect(turns[0].conversation_id).toBe('mock-conv-id')
    expect(turns[0].org_id).toBe('org-1')
    expect(turns[0].turn_number).toBe(0)
    expect(turns[1].turn_number).toBe(1)
  })

  it('mirrorTurns drops rows with null or empty content', async () => {
    const { service, calls } = buildMockService()
    await mirrorTurns(service, {
      botId: 'bot-1', orgId: 'org-1', sessionId: 'sess-1',
      rows: [
        { bot_id: 'bot-1', session_id: 'sess-1', turn_number: 0, role: 'user', content: null },
        { bot_id: 'bot-1', session_id: 'sess-1', turn_number: 1, role: 'assistant', content: '' },
        { bot_id: 'bot-1', session_id: 'sess-1', turn_number: 2, role: 'assistant', content: 'real content' },
      ],
    })
    const turnCall = calls.find(c => c.table === 'conversation_turns' && c.verb === 'insert')
    expect(turnCall).toBeTruthy()
    const turns = turnCall!.payload as Record<string, unknown>[]
    expect(turns.length).toBe(1)
    expect(turns[0].turn_number).toBe(2)
  })

  it('mirrorFocusFlagsUpdate looks up conversation_id then updates turn by turn_number', async () => {
    const { service, calls } = buildMockService()
    await mirrorFocusFlagsUpdate(service, { botId: 'bot-1', sessionId: 'sess-1', turnNumber: 3, flags: ['focus:a', 'focus:b'] })

    expect(calls[0].table).toBe('conversations')
    expect(calls[0].verb).toBe('select')
    expect(calls[0].filters?.bot_id).toBe('bot-1')
    expect(calls[0].filters?.session_id).toBe('sess-1')

    const updateCall = calls.find(c => c.table === 'conversation_turns' && c.verb === 'update')
    expect(updateCall).toBeTruthy()
    expect((updateCall!.payload as Record<string, unknown>).content_flags).toEqual(['focus:a', 'focus:b'])
    expect(updateCall!.filters?.conversation_id).toBe('mock-conv-id')
    expect(updateCall!.filters?.turn_number).toBe(3)
  })

  it('mirrorDeleteSession deletes conversations by (bot_id, session_id)', async () => {
    const { service, calls } = buildMockService()
    await mirrorDeleteSession(service, { botId: 'bot-1', sessionId: 'sess-1' })

    expect(calls.length).toBe(1)
    expect(calls[0].table).toBe('conversations')
    expect(calls[0].verb).toBe('delete')
    expect(calls[0].filters?.bot_id).toBe('bot-1')
    expect(calls[0].filters?.session_id).toBe('sess-1')
  })
})
