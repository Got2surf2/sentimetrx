import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// BYOK provider-independence guards (2026-07-15):
// 1. An Anthropic modelOverride ('claude-*') must never reach an OpenAI/Azure
//    request — resolveProvider falls back to that provider's tier default.
// 2. chatCore refuses the turn before any vendor call when the org's AI mode
//    is 'off', and rides the customer key when mode is 'byo' + anthropic.

const resolveOrgAiConfigMock = vi.fn<() => Promise<{ mode: string; provider: string; key: string | undefined }>>(
  async () => ({ mode: 'platform', provider: 'anthropic', key: undefined }),
)
vi.mock('@/lib/usageLog', () => ({ logUsage: vi.fn() }))
vi.mock('@/lib/serviceHealth', () => ({
  recordCreditError: vi.fn(),
  isCreditError: () => false,
}))
vi.mock('@/lib/aiKey', () => ({
  resolveOrgAiConfig: resolveOrgAiConfigMock,
  AIDisabledError: class AIDisabledError extends Error {},
}))

import { callAI } from '@/lib/ai'

function openAIResponse(): Response {
  return new Response(JSON.stringify({
    choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }), { status: 200 })
}

function anthropicResponse(): Response {
  return new Response(JSON.stringify({
    content: [{ type: 'text', text: 'ok' }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 1, output_tokens: 1 },
  }), { status: 200 })
}

describe('modelOverride provider guard', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    resolveOrgAiConfigMock.mockReset()
    resolveOrgAiConfigMock.mockResolvedValue({ mode: 'platform', provider: 'anthropic', key: undefined })
    vi.stubGlobal('fetch', fetchMock)
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })
  afterEach(() => vi.unstubAllGlobals())

  it('drops a claude-* override on an explicit OpenAI providerConfig (tier default instead)', async () => {
    fetchMock.mockResolvedValue(openAIResponse())
    await callAI({
      tier: 'advanced',
      modelOverride: 'claude-opus-4-8',
      providerConfig: { provider: 'openai', apiKey: 'sk-x' },
      messages: [{ role: 'user', content: 'hi' }],
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.model).toBe('gpt-4o')
  })

  it('keeps a claude-* override on the Anthropic provider', async () => {
    fetchMock.mockResolvedValue(anthropicResponse())
    await callAI({
      tier: 'advanced',
      modelOverride: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'hi' }],
    })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.model).toBe('claude-opus-4-8')
  })

  it('drops a claude-* override when the org BYOK redirect lands on OpenAI', async () => {
    // The recordings/analyze landmine: usage.org_id + Anthropic override on a
    // BYO-OpenAI org must resolve to the OpenAI tier default, not 'claude-*'.
    resolveOrgAiConfigMock.mockResolvedValue({ mode: 'byo', provider: 'openai', key: 'sk-customer' })
    fetchMock.mockResolvedValue(openAIResponse())
    await callAI({
      tier: 'advanced',
      modelOverride: 'claude-opus-4-8',
      messages: [{ role: 'user', content: 'hi' }],
      usage: { org_id: 'org-1', resource_type: 'recording', event_type: 'analyze' },
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toContain('openai.com')
    const body = JSON.parse(init.body as string)
    expect(body.model).toBe('gpt-4o')
    expect(init.headers['Authorization']).toBe('Bearer sk-customer')
  })
})

describe('chatCore per-org AI gate', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    resolveOrgAiConfigMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
    process.env.ANTHROPIC_API_KEY = 'test-key'
  })
  afterEach(() => vi.unstubAllGlobals())

  it("refuses the turn with no vendor call when the org's AI mode is 'off'", async () => {
    resolveOrgAiConfigMock.mockResolvedValue({ mode: 'off', provider: 'anthropic', key: undefined })
    const { handleChatTurn } = await import('@/lib/chatCore')
    const agent = { id: 'bot-1', org_id: 'org-1', name: 'Testy', system_prompt: 'x' }
    const result = await handleChatTurn(
      { agent, service: {} as never, ip: '1.2.3.4' } as never,
      { messages: [{ role: 'user', content: 'hello' }] },
    )
    expect(result._aiDisabled).toBe(true)
    expect(String(result.reply)).toMatch(/currently unavailable/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
