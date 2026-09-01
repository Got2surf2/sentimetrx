// handleChatTurn — turn-level tests for the unified chat engine (the ONLY
// engine per docs/CONVERGENCE.md). AI + embedding + usage boundaries are
// mocked; the Supabase service client is a permissive fake that resolves
// every chain with canned per-table data and records inserts.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const callAIMock = vi.fn()
const callAIStreamMock = vi.fn()
vi.mock('@/lib/ai', async (importOriginal) => {
  const real = await importOriginal<Record<string, unknown>>()
  return {
    ...real,
    callAI: (...args: unknown[]) => callAIMock(...args),
    callAIStream: (...args: unknown[]) => callAIStreamMock(...args),
  }
})

const aiConfig = { mode: 'platform' as string, provider: null as string | null, key: null as string | null }
vi.mock('@/lib/aiKey', () => ({
  resolveOrgAiConfig: vi.fn(async () => ({ ...aiConfig })),
}))

vi.mock('@/lib/embeddings', () => ({
  generateEmbedding: vi.fn(async () => new Array(1536).fill(0)),
}))

const logUsageMock = vi.fn()
vi.mock('@/lib/usageLog', () => ({ logUsage: (...args: unknown[]) => logUsageMock(...args) }))
vi.mock('@/lib/log', () => ({ logError: vi.fn() }))

const mirrorTurnsMock = vi.fn(async (..._args: unknown[]) => {})
vi.mock('@/lib/phase3DualWrite', () => ({
  mirrorTurns: (...args: unknown[]) => mirrorTurnsMock(...args),
  mirrorFocusFlagsUpdate: vi.fn(async () => {}),
}))
vi.mock('@/lib/phase3Read', () => ({ isPhase3ReadSafe: () => false }))

import { handleChatTurn, type ChatAgent, type ChatCoreContext } from '@/lib/chatCore'

// ── Permissive fake service client ──────────────────────────────────────
// Any chain (.select().eq().order()… / .insert() / .update()) is awaitable and
// resolves { data, error }. `tables` supplies SELECT results per table name;
// inserts are recorded in `inserts`; `insertError` fails the next insert.
interface Recorded { table: string; rows: unknown }
function makeService(state: {
  tables?: Record<string, unknown[]>
  inserts?: Recorded[]
  insertError?: { message: string } | null
}) {
  const tables = state.tables || {}
  const inserts = (state.inserts = state.inserts || [])
  function chain(table: string, mode: 'select' | 'insert' | 'update'): unknown {
    const proxy: unknown = new Proxy(() => {}, {
      get(_t, prop) {
        if (prop === 'then') {
          const rows = tables[table] || []
          const result =
            mode === 'insert'
              ? { data: null, error: state.insertError || null }
              : { data: rows, error: null }
          const p = Promise.resolve(result)
          return p.then.bind(p)
        }
        if (prop === 'maybeSingle' || prop === 'single') {
          return async () => ({ data: (tables[table] || [])[0] ?? null, error: null })
        }
        if (prop === 'insert') {
          return (rows: unknown) => { inserts.push({ table, rows }); return chain(table, 'insert') }
        }
        if (prop === 'update') return () => chain(table, 'update')
        return () => chain(table, mode)
      },
    })
    return proxy
  }
  return {
    from: (table: string) => chain(table, 'select'),
    rpc: async () => ({ data: [], error: null }),
  }
}

function makeAgent(over: Partial<ChatAgent> = {}): ChatAgent {
  return {
    id: 'bot-1',
    org_id: 'org-1',
    name: 'Ana',
    system_prompt: 'You are Ana, a park-planning feedback agent.',
    deflection_enabled: false,
    focuses: [],
    intents: [],
    ...over,
  }
}

let ipCounter = 0
function makeCtx(agent: ChatAgent, service: ReturnType<typeof makeService>): ChatCoreContext {
  // Unique ip per test — contentGuard strike tracking is keyed by ip and
  // module-global, so a shared ip would leak strikes across tests.
  return { agent, service: service as unknown as ChatCoreContext['service'], ip: '10.0.0.' + ++ipCounter }
}

beforeEach(() => {
  vi.clearAllMocks()
  aiConfig.mode = 'platform'
  aiConfig.provider = null
  aiConfig.key = null
  callAIMock.mockResolvedValue({ text: 'Thanks for sharing that. What stood out most?', usage: { inputTokens: 10, outputTokens: 10 } })
})

const FOCUSES = [
  { slug: 'parking', label: 'Parking', description: 'parking', enabled: true, probe_template: 'By the way — how do you feel about parking?' },
  { slug: 'safety', label: 'Safety', description: 'safety', enabled: true },
]

describe('handleChatTurn — silence probe (trigger: silence)', () => {
  it('skips without a session_id', async () => {
    const service = makeService({})
    const res = await handleChatTurn(makeCtx(makeAgent({ focuses: FOCUSES }), service), { messages: [], trigger: 'silence' })
    expect(res).toEqual({ reply: null, skipped: 'no_session' })
  })

  it('skips when the agent has no enabled focuses', async () => {
    const service = makeService({})
    const res = await handleChatTurn(
      makeCtx(makeAgent({ focuses: [{ slug: 'x', label: 'X', description: '', enabled: false }] }), service),
      { messages: [], trigger: 'silence', session_id: 's1' },
    )
    expect(res).toEqual({ reply: null, skipped: 'no_focuses' })
  })

  it('fires at most once per session', async () => {
    const service = makeService({
      tables: { bot_conversation_turns: [{ content_flags: [], source: 'silence_probe', turn_number: 4 }] },
    })
    const res = await handleChatTurn(makeCtx(makeAgent({ focuses: FOCUSES }), service), { messages: [], trigger: 'silence', session_id: 's1' })
    expect(res).toEqual({ reply: null, skipped: 'already_fired' })
  })

  it('skips when every focus already has a focus: flag in the session', async () => {
    const service = makeService({
      tables: {
        bot_conversation_turns: [
          { content_flags: ['focus:parking'], source: 'normal', turn_number: 0 },
          { content_flags: ['focus:safety'], source: 'normal', turn_number: 1 },
        ],
      },
    })
    const res = await handleChatTurn(makeCtx(makeAgent({ focuses: FOCUSES }), service), { messages: [], trigger: 'silence', session_id: 's1' })
    expect(res).toEqual({ reply: null, skipped: 'all_focuses_covered' })
  })

  it('fires the first unfired focus using its probe_template, appending after the max turn', async () => {
    const state = {
      tables: { bot_conversation_turns: [{ content_flags: ['focus:safety'], source: 'normal', turn_number: 7 }] },
      inserts: [] as Recorded[],
    }
    const service = makeService(state)
    const res = await handleChatTurn(makeCtx(makeAgent({ focuses: FOCUSES }), service), { messages: [], trigger: 'silence', session_id: 's1' })
    expect(res).toEqual({ reply: 'By the way — how do you feel about parking?', _silence: true })
    expect(state.inserts).toHaveLength(1)
    const row = state.inserts[0].rows as Record<string, unknown>
    expect(state.inserts[0].table).toBe('bot_conversation_turns')
    expect(row.turn_number).toBe(8)
    expect(row.source).toBe('silence_probe')
    expect(row.content_flags).toEqual(['silence_probe', 'focus:parking'])
    expect(callAIMock).not.toHaveBeenCalled() // templated nudge — no AI spend
  })

  it('falls back to the generic nudge when the focus has no probe_template', async () => {
    const state = { tables: {}, inserts: [] as Recorded[] }
    const service = makeService(state)
    const res = await handleChatTurn(
      makeCtx(makeAgent({ focuses: [{ slug: 'safety', label: 'Safety', description: '', enabled: true }] }), service),
      { messages: [], trigger: 'silence', session_id: 's1' },
    )
    expect(res._silence).toBe(true)
    expect(res.reply).toBe('Still there? Happy to keep going whenever you are.')
  })

  it('reports insert failure without claiming the probe fired', async () => {
    const service = makeService({ insertError: { message: 'boom' } })
    const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await handleChatTurn(makeCtx(makeAgent({ focuses: FOCUSES }), service), { messages: [], trigger: 'silence', session_id: 's1' })
    consoleErr.mockRestore()
    expect(res).toEqual({ reply: null, skipped: 'insert_failed' })
  })
})

describe('handleChatTurn — org AI gate', () => {
  it("refuses the turn when the org's AI mode is off, before any vendor call", async () => {
    aiConfig.mode = 'off'
    const service = makeService({})
    const res = await handleChatTurn(makeCtx(makeAgent(), service), {
      messages: [{ role: 'user', content: 'Hello there' }],
    })
    expect(res._aiDisabled).toBe(true)
    expect(String(res.reply)).toContain('currently unavailable')
    expect(callAIMock).not.toHaveBeenCalled()
    expect(callAIStreamMock).not.toHaveBeenCalled()
  })
})

describe('handleChatTurn — main turn', () => {
  it('runs a minimal happy-path turn through the advanced-tier AI call', async () => {
    const service = makeService({})
    const res = await handleChatTurn(makeCtx(makeAgent(), service), {
      messages: [{ role: 'user', content: 'I love the new park design, especially the playground.' }],
    })
    expect(res.reply).toBe('Thanks for sharing that. What stood out most?')
    const mainCalls = callAIMock.mock.calls.filter((c) => (c[0] as { tier?: string }).tier === 'advanced')
    expect(mainCalls).toHaveLength(1)
    const arg = mainCalls[0][0] as { system: Array<{ text: string }>; maxTokens: number }
    // The agent's own system prompt must reach the model
    expect(arg.system.map((b) => b.text).join('\n')).toContain('You are Ana, a park-planning feedback agent.')
    expect(arg.maxTokens).toBe(400) // standard-capability knob
    // Standard turn logs as 'chat'
    expect(logUsageMock.mock.calls.some((c) => (c[0] as { event_type?: string }).event_type === 'chat')).toBe(true)
  })

  it('rides the customer key on the main call for a byo-anthropic org', async () => {
    aiConfig.mode = 'byo'
    aiConfig.provider = 'anthropic'
    aiConfig.key = 'sk-customer-key'
    const service = makeService({})
    await handleChatTurn(makeCtx(makeAgent(), service), {
      messages: [{ role: 'user', content: 'Quick thought about the park.' }],
    })
    const mainCall = callAIMock.mock.calls.find((c) => (c[0] as { tier?: string }).tier === 'advanced')
    expect(mainCall).toBeDefined()
    expect((mainCall![0] as { providerConfig?: unknown }).providerConfig).toEqual({ provider: 'anthropic', apiKey: 'sk-customer-key' })
  })

  it('stores the user + assistant turns (T0/T1) when a session_id is present', async () => {
    const state = { tables: {}, inserts: [] as Recorded[] }
    const service = makeService(state)
    await handleChatTurn(makeCtx(makeAgent(), service), {
      messages: [{ role: 'user', content: 'The playground equipment feels dated.' }],
      session_id: 's-store',
    })
    const turnInsert = state.inserts.find((i) => i.table === 'bot_conversation_turns')
    expect(turnInsert).toBeDefined()
    const rows = turnInsert!.rows as Array<Record<string, unknown>>
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ turn_number: 0, role: 'user', content: 'The playground equipment feels dated.', source: 'normal' })
    expect(typeof rows[0].sentiment).toBe('string') // lexicon sentiment travels with the user turn
    expect(rows[1]).toMatchObject({ turn_number: 1, role: 'assistant', content: 'Thanks for sharing that. What stood out most?' })
  })

  it('persists askName (T0/T1) + greeting (T2) on a first turn, numbering user/reply T3/T4', async () => {
    const state = { tables: {}, inserts: [] as Recorded[] }
    const service = makeService(state)
    await handleChatTurn(makeCtx(makeAgent({ config: { askNamePrompt: 'And your name is?' } }), service), {
      messages: [
        { role: 'assistant', content: 'Hi Pat! What brings you to the park survey?' },
        { role: 'user', content: 'The trails mostly.' },
      ],
      session_id: 's-first',
      user_name: 'Pat',
    })
    const rows = (state.inserts.find((i) => i.table === 'bot_conversation_turns')!.rows) as Array<Record<string, unknown>>
    expect(rows.map((r) => [r.turn_number, r.role, r.source])).toEqual([
      [0, 'assistant', 'greeting'],  // askName question
      [1, 'user', 'normal'],         // the collected name
      [2, 'assistant', 'greeting'],  // topical greeting
      [3, 'user', 'normal'],
      [4, 'assistant', 'normal'],
    ])
    expect(rows[0].content).toBe('And your name is?')
    expect(rows[1].content).toBe('Pat')
    expect(rows[3].content).toBe('The trails mostly.')
  })

  it('asks for a shorter message over the standard 1200-char input cap, with no AI call and no [filtered] audit', async () => {
    const state = { tables: {}, inserts: [] as Recorded[] }
    const service = makeService(state)
    const res = await handleChatTurn(makeCtx(makeAgent(), service), {
      messages: [{ role: 'user', content: 'a'.repeat(1300) }],
    })
    expect(String(res.reply)).toContain('shorter message')
    expect(res.ended).toBe(false)
    expect(callAIMock).not.toHaveBeenCalled()
    expect(state.inserts).toHaveLength(0) // over-length is not a conduct violation
  })
})
