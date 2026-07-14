import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// AGENT_TIERS Phase 3 — callAIStream: raw-SSE parsing of the Anthropic
// Messages stream (text deltas + tool_use blocks) and the non-Anthropic
// fallback. fetch is mocked at the global level; no vendor call is made.

vi.mock('@/lib/usageLog', () => ({ logUsage: vi.fn() }))
vi.mock('@/lib/serviceHealth', () => ({
  recordCreditError: vi.fn(),
  isCreditError: () => false,
}))
vi.mock('@/lib/aiKey', () => ({
  resolveOrgAiConfig: vi.fn(async () => ({ mode: 'platform' })),
  AIDisabledError: class AIDisabledError extends Error {},
}))

import { callAIStream } from '@/lib/ai'

/** Encode a list of Anthropic stream events as an SSE response body. */
function sseResponse(events: Array<Record<string, unknown>>): Response {
  const payload = events
    .map((ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
    .join('')
  return new Response(payload, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

const TEXT_EVENTS: Array<Record<string, unknown>> = [
  { type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 40, cache_creation_input_tokens: 10 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hello ' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'world' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
  { type: 'message_stop' },
]

const TOOL_EVENTS: Array<Record<string, unknown>> = [
  { type: 'message_start', message: { usage: { input_tokens: 200 } } },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me check.' } },
  { type: 'content_block_stop', index: 0 },
  { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'toolu_1', name: 'search_knowledge' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"query":' } },
  { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"opening hours"}' } },
  { type: 'content_block_stop', index: 1 },
  { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 30 } },
  { type: 'message_stop' },
]

describe('callAIStream — Anthropic SSE parsing', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })
  afterEach(() => vi.unstubAllGlobals())

  it('streams text deltas in order and assembles the full text', async () => {
    fetchMock.mockResolvedValue(sseResponse(TEXT_EVENTS))
    const deltas: string[] = []
    const r = await callAIStream({
      tier: 'advanced',
      messages: [{ role: 'user', content: 'hi' }],
      onTextDelta: (t) => deltas.push(t),
    })
    expect(deltas).toEqual(['Hello ', 'world'])
    expect(r.text).toBe('Hello world')
    expect(r.stopReason).toBe('end_turn')
    expect(r.toolUses).toEqual([])
    expect(r.contentBlocks).toEqual([{ type: 'text', text: 'Hello world' }])
    expect(r.usage).toMatchObject({ input_tokens: 100, output_tokens: 5, cache_read_tokens: 40, cache_creation_tokens: 10 })
  })

  it('sets stream:true and passes tools in the request body', async () => {
    fetchMock.mockResolvedValue(sseResponse(TEXT_EVENTS))
    await callAIStream({
      tier: 'advanced',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [{ name: 't', description: 'd', input_schema: { type: 'object' } }],
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.stream).toBe(true)
    expect(body.tools).toHaveLength(1)
    expect(body.tools[0].name).toBe('t')
  })

  it('parses tool_use blocks from input_json_delta fragments and preserves block order', async () => {
    fetchMock.mockResolvedValue(sseResponse(TOOL_EVENTS))
    const r = await callAIStream({ tier: 'advanced', messages: [{ role: 'user', content: 'hi' }] })
    expect(r.stopReason).toBe('tool_use')
    expect(r.toolUses).toEqual([{ id: 'toolu_1', name: 'search_knowledge', input: { query: 'opening hours' } }])
    expect(r.contentBlocks).toEqual([
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 'toolu_1', name: 'search_knowledge', input: { query: 'opening hours' } },
    ])
  })

  it('survives SSE frames split across arbitrary chunk boundaries', async () => {
    // Serve the same event payload one byte at a time.
    const payload = TEXT_EVENTS.map((ev) => `data: ${JSON.stringify(ev)}\n\n`).join('')
    const bytes = new TextEncoder().encode(payload)
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const b of bytes) controller.enqueue(new Uint8Array([b]))
        controller.close()
      },
    })
    fetchMock.mockResolvedValue(new Response(stream, { status: 200 }))
    const r = await callAIStream({ tier: 'advanced', messages: [{ role: 'user', content: 'hi' }] })
    expect(r.text).toBe('Hello world')
  })

  it('throws on an in-stream error event', async () => {
    fetchMock.mockResolvedValue(sseResponse([
      { type: 'message_start', message: { usage: { input_tokens: 1 } } },
      { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
    ]))
    await expect(
      callAIStream({ tier: 'advanced', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toThrow('Overloaded')
  })

  it('throws with status on a non-2xx response', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { message: 'rate limited' } }), { status: 429 }))
    await expect(
      callAIStream({ tier: 'advanced', messages: [{ role: 'user', content: 'hi' }] }),
    ).rejects.toMatchObject({ message: 'rate limited', status: 429 })
  })
})

describe('callAIStream — non-Anthropic fallback', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('degrades to non-streaming callAI with no tools on an OpenAI provider', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: 'plain answer' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 3 },
    }), { status: 200 }))
    const deltas: string[] = []
    const r = await callAIStream({
      tier: 'advanced',
      messages: [{ role: 'user', content: 'hi' }],
      providerConfig: { provider: 'openai', apiKey: 'sk-x' },
      tools: [{ name: 't', description: 'd', input_schema: { type: 'object' } }],
      onTextDelta: (t) => deltas.push(t),
    })
    expect(r.text).toBe('plain answer')
    expect(r.toolUses).toEqual([])
    expect(deltas).toEqual(['plain answer'])
    // The OpenAI request body must not carry stream or tools.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.stream).toBeUndefined()
    expect(body.tools).toBeUndefined()
  })
})
