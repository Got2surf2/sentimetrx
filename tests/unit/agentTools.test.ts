import { describe, it, expect, vi } from 'vitest'

// AGENT_TIERS Phase 3 — the Super Agent tool loop: tool surface, executor
// safety rails (host allowlist, redirect re-check, negative-chunk holdout),
// and the bounded agentic loop.

import { buildAgentTools, makeToolExecutor, runAgentToolLoop, agentToolLabel, MAX_TOOL_ROUNDS, type ChatStreamEvent } from '@/lib/agentTools'
import type { AIStreamResult } from '@/lib/ai'

describe('buildAgentTools', () => {
  it('offers fetch_page only when official domains exist', () => {
    expect(buildAgentTools(new Set()).map(t => t.name)).toEqual(['search_knowledge'])
    expect(buildAgentTools(new Set(['example.org'])).map(t => t.name)).toEqual(['search_knowledge', 'fetch_page'])
  })
})

describe('makeToolExecutor — search_knowledge', () => {
  const hosts = new Set<string>()

  it('formats matching chunks and holds out negative-sentiment ones', async () => {
    const runRetrieval = vi.fn(async () => [
      { title: 'Hours', content: 'Open 9-5', metadata: null },
      { title: 'Criticism', content: 'bad stuff', metadata: { sentiment: 'negative' } },
    ])
    const exec = makeToolExecutor({ runRetrieval, allowedHosts: hosts })
    const out = await exec('search_knowledge', { query: 'when are you open' })
    expect(out).toContain('### Hours')
    expect(out).toContain('Open 9-5')
    expect(out).not.toContain('bad stuff')
  })

  it('reports no matches and rejects empty queries', async () => {
    const exec = makeToolExecutor({ runRetrieval: async () => [], allowedHosts: hosts })
    expect(await exec('search_knowledge', { query: 'x' })).toBe('No matching knowledge found for that query.')
    expect(await exec('search_knowledge', {})).toBe('Error: empty query.')
  })
})

describe('makeToolExecutor — fetch_page allowlist', () => {
  const runRetrieval = async () => null
  const hosts = new Set(['example.org'])

  it('rejects off-domain, non-http, and malformed URLs without fetching', async () => {
    const fetchImpl = vi.fn()
    const exec = makeToolExecutor({ runRetrieval, allowedHosts: hosts, fetchImpl: fetchImpl as unknown as typeof fetch })
    expect(await exec('fetch_page', { url: 'https://evil.com/page' })).toMatch(/^Error: that URL is not on this agent/)
    expect(await exec('fetch_page', { url: 'ftp://example.org/x' })).toBe('Error: only http(s) URLs are allowed.')
    expect(await exec('fetch_page', { url: 'not a url' })).toBe('Error: invalid URL.')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('allows exact host and subdomains, returns extracted text', async () => {
    const fetchImpl = vi.fn(async (u: string) => new Response('<html><body><p>Concert tonight at 8pm</p></body></html>', { status: 200 }))
    const exec = makeToolExecutor({ runRetrieval, allowedHosts: hosts, fetchImpl: fetchImpl as unknown as typeof fetch })
    const out = await exec('fetch_page', { url: 'https://www.example.org/events' })
    expect(out).toContain('Concert tonight at 8pm')
    expect(out).toContain('fetched just now')
  })

  it('rejects a response that redirected off the official domains', async () => {
    const redirected = new Response('<html><body>elsewhere</body></html>', { status: 200 })
    Object.defineProperty(redirected, 'url', { value: 'https://tracker.evil.com/landing' })
    const exec = makeToolExecutor({ runRetrieval, allowedHosts: hosts, fetchImpl: (async () => redirected) as unknown as typeof fetch })
    expect(await exec('fetch_page', { url: 'https://example.org/out' })).toBe('Error: the page redirected off the official domains.')
  })

  it('surfaces HTTP failures and timeouts as error strings, never throws', async () => {
    const exec404 = makeToolExecutor({ runRetrieval, allowedHosts: hosts, fetchImpl: (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch })
    expect(await exec404('fetch_page', { url: 'https://example.org/gone' })).toBe('Error: page returned HTTP 404.')
    const execBoom = makeToolExecutor({ runRetrieval, allowedHosts: hosts, fetchImpl: (async () => { throw new Error('timeout') }) as unknown as typeof fetch })
    expect(await execBoom('fetch_page', { url: 'https://example.org/slow' })).toBe('Error: the page could not be fetched (timeout or network error).')
  })

  it('rejects unknown tools', async () => {
    const exec = makeToolExecutor({ runRetrieval, allowedHosts: hosts })
    expect(await exec('rm_rf', {})).toBe('Error: unknown tool.')
  })
})

describe('agentToolLabel', () => {
  it('labels fetch_page with the target host and search generically', () => {
    expect(agentToolLabel({ id: '1', name: 'fetch_page', input: { url: 'https://www.example.org/x' } })).toBe('Checking www.example.org…')
    expect(agentToolLabel({ id: '1', name: 'fetch_page', input: {} })).toBe('Checking the website…')
    expect(agentToolLabel({ id: '2', name: 'search_knowledge', input: { query: 'q' } })).toBe('Searching the knowledge base…')
  })
})

// Helpers to script model turns for the loop tests.
function textTurn(text: string): AIStreamResult {
  return { text, stopReason: 'end_turn', toolUses: [], contentBlocks: text ? [{ type: 'text', text }] : [], usage: undefined }
}
function toolTurn(text: string, calls: Array<{ id: string; name: string; input: Record<string, unknown> }>): AIStreamResult {
  return {
    text,
    stopReason: 'tool_use',
    toolUses: calls,
    contentBlocks: [...(text ? [{ type: 'text' as const, text }] : []), ...calls.map(c => ({ type: 'tool_use' as const, ...c }))],
    usage: undefined,
  }
}

describe('runAgentToolLoop', () => {
  it('passes straight through when the model answers in text', async () => {
    const callOnce = vi.fn(async () => textTurn('plain answer'))
    const r = await runAgentToolLoop({ messages: [{ role: 'user', content: 'hi' }], callOnce, executeTool: vi.fn() })
    expect(r).toMatchObject({ text: 'plain answer', rounds: 0, stopReason: 'end_turn' })
    expect(callOnce).toHaveBeenCalledTimes(1)
  })

  it('executes one round, replays blocks + tool_result, and assembles text with paragraph breaks', async () => {
    const messages: Parameters<typeof runAgentToolLoop>[0]['messages'] = [{ role: 'user', content: 'when is the concert?' }]
    const events: ChatStreamEvent[] = []
    const callOnce = vi.fn()
      .mockResolvedValueOnce(toolTurn('Let me check.', [{ id: 't1', name: 'fetch_page', input: { url: 'https://example.org/events' } }]))
      .mockResolvedValueOnce(textTurn('Tonight at 8pm.'))
    const executeTool = vi.fn(async () => 'Live content: concert at 8pm')
    const r = await runAgentToolLoop({ messages, callOnce, executeTool, emit: (ev) => events.push(ev) })

    expect(r.text).toBe('Let me check.\n\nTonight at 8pm.')
    expect(r.rounds).toBe(1)
    expect(executeTool).toHaveBeenCalledWith('fetch_page', { url: 'https://example.org/events' })
    // Conversation replay: assistant blocks verbatim, then ONE user message of tool_results.
    expect(messages).toHaveLength(3)
    expect(messages[1]).toEqual({ role: 'assistant', content: [
      { type: 'text', text: 'Let me check.' },
      { type: 'tool_use', id: 't1', name: 'fetch_page', input: { url: 'https://example.org/events' } },
    ] })
    expect(messages[2]).toEqual({ role: 'user', content: [
      { type: 'tool_result', tool_use_id: 't1', content: 'Live content: concert at 8pm' },
    ] })
    // Stream saw a paragraph break then the tool status.
    expect(events).toEqual([
      { type: 'delta', text: '\n\n' },
      { type: 'tool', name: 'fetch_page', label: 'Checking example.org…' },
    ])
  })

  it('marks executor error strings as is_error tool_results', async () => {
    const messages: Parameters<typeof runAgentToolLoop>[0]['messages'] = [{ role: 'user', content: 'x' }]
    const callOnce = vi.fn()
      .mockResolvedValueOnce(toolTurn('', [{ id: 't1', name: 'fetch_page', input: { url: 'https://evil.com' } }]))
      .mockResolvedValueOnce(textTurn('Sorry, I could not check.'))
    const r = await runAgentToolLoop({ messages, callOnce, executeTool: async () => 'Error: that URL is not allowed.' })
    const results = messages[2].content as Array<{ is_error?: boolean }>
    expect(results[0].is_error).toBe(true)
    expect(r.text).toBe('Sorry, I could not check.')
  })

  it('enforces the round budget and forces a text answer via tool_choice none', async () => {
    const relentless = (n: number) => toolTurn('', [{ id: 't' + n, name: 'search_knowledge', input: { query: 'again' } }])
    let call = 0
    const toolChoices: Array<Record<string, unknown> | undefined> = []
    const callOnce = vi.fn(async (_msgs: unknown, toolChoice?: Record<string, unknown>) => {
      toolChoices.push(toolChoice)
      call++
      // Keeps demanding tools forever; only a forced tool_choice ends it.
      return toolChoice?.type === 'none' ? textTurn('final answer') : relentless(call)
    })
    const executeTool = vi.fn(async () => 'some knowledge')
    const r = await runAgentToolLoop({ messages: [{ role: 'user', content: 'x' }], callOnce, executeTool })

    // Rounds 1..MAX execute tools; round MAX+1 gets budget-exhausted errors +
    // a forced text answer. Executor ran only within budget.
    expect(r.text).toBe('final answer')
    expect(r.rounds).toBe(MAX_TOOL_ROUNDS + 1)
    expect(executeTool).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS)
    expect(toolChoices[toolChoices.length - 1]).toEqual({ type: 'none' })
    expect(callOnce).toHaveBeenCalledTimes(MAX_TOOL_ROUNDS + 2)
  })

  it('reports per-round usage for every non-final round', async () => {
    const usages: unknown[] = []
    const callOnce = vi.fn()
      .mockResolvedValueOnce({ ...toolTurn('', [{ id: 't1', name: 'search_knowledge', input: { query: 'a' } }]), usage: { output_tokens: 11 } })
      .mockResolvedValueOnce({ ...textTurn('done'), usage: { output_tokens: 22 } })
    await runAgentToolLoop({ messages: [{ role: 'user', content: 'x' }], callOnce, executeTool: async () => 'k', onRoundUsage: (u) => usages.push(u) })
    expect(usages).toEqual([{ output_tokens: 11 }])
  })
})
