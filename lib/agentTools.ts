// lib/agentTools.ts
// AGENT_TIERS Phase 3 — the in-turn tool loop for Super Agents.
//
// chatCore.handleChatTurn assembles the prompt and decides WHETHER tools are
// active (capability knob, not town-hall mode); this module owns the
// mechanics: the two tool definitions, their executors, and the bounded
// agentic loop that replays assistant tool_use blocks + tool_results until
// the model answers in text. Extracted from chatCore so every branch here is
// unit-testable without standing up the full chat pipeline.

import type { AIStreamResult, AIToolDefinition, AIToolUse, AIUsage, MessageContent, ToolResultContentBlock } from '@/lib/ai'
import type { RagChunk } from '@/lib/chatCore'
import { htmlToText } from '@/lib/crawlText'

/** Events surfaced to a streaming client while a turn runs. `delta` is an
 *  incremental chunk of reply text; `tool` announces a tool execution
 *  (render as a status line, not reply text). The authoritative final text
 *  is the handleChatTurn return value — streamed text must reconcile to it. */
export type ChatStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'tool'; name: string; label: string }

/** Max tool-execution rounds per turn. Past this the model's pending calls
 *  get budget-exhausted errors and the next call forces a text answer. */
export const MAX_TOOL_ROUNDS = 3

/** The tool definitions offered to the model. fetch_page only exists when
 *  the agent has official domains (training_urls hosts) to allowlist —
 *  the model must never fetch (or be steered to) arbitrary URLs, per the
 *  Spacy link-hallucination incident. */
export function buildAgentTools(allowedHosts: Set<string>): AIToolDefinition[] {
  return [
    {
      name: 'search_knowledge',
      description: 'Search this agent\'s knowledge base with a fresh query. Call this when the knowledge already provided does not answer the user\'s question and a differently-worded search might (specific names, synonyms, related programs). Do not repeat a search that already came back empty.',
      input_schema: { type: 'object', properties: { query: { type: 'string', description: 'The search query' } }, required: ['query'], additionalProperties: false },
    },
    ...(allowedHosts.size > 0 ? [{
      name: 'fetch_page',
      description: 'Fetch the live text of a page on this organization\'s official website. Call this for time-sensitive details (hours, prices, event dates, availability) when freshness matters, or when the knowledge base points at a page whose current content you need. Only URLs on the official domains are allowed — never construct or guess URLs on other domains.',
      input_schema: { type: 'object', properties: { url: { type: 'string', description: 'Full URL on an official domain' } }, required: ['url'], additionalProperties: false },
    }] : []),
  ]
}

/** Human-readable status line for a tool call, shown in the widget. */
export function agentToolLabel(tu: AIToolUse): string {
  if (tu.name === 'fetch_page') {
    try { return 'Checking ' + new URL(String(tu.input.url || '')).hostname + '…' } catch { return 'Checking the website…' }
  }
  return 'Searching the knowledge base…'
}

export interface ToolExecutorDeps {
  /** The same retrieval pass the main RAG injection uses (embed → semantic
   *  RPC with keyword fallback → confidence normalization). */
  runRetrieval: (q: string) => Promise<RagChunk[] | null>
  allowedHosts: Set<string>
  /** Overridable in tests. */
  fetchImpl?: typeof fetch
}

/** Execute one tool call. Every failure path returns an 'Error: …' string
 *  (fed back to the model as an is_error tool_result) — never throws. */
export function makeToolExecutor(deps: ToolExecutorDeps): (name: string, input: Record<string, unknown>) => Promise<string> {
  const doFetch = deps.fetchImpl || fetch
  const hostOk = (h: string) => deps.allowedHosts.has(h) || [...deps.allowedHosts].some((a) => h.endsWith('.' + a))
  return async function executeTool(name, input) {
    if (name === 'search_knowledge') {
      const q = String(input.query || '').trim().slice(0, 300)
      if (!q) return 'Error: empty query.'
      const found = await deps.runRetrieval(q)
      // Same negative-content holdout as the main RAG injection — the tool
      // must not become a side door into deflected material.
      const safe = (found || []).filter((c) => !c.metadata?.sentiment || c.metadata.sentiment !== 'negative')
      if (safe.length === 0) return 'No matching knowledge found for that query.'
      return safe.slice(0, 8).map((c) => '### ' + (c.title || 'Untitled') + '\n' + (c.content || '')).join('\n\n').slice(0, 6000)
    }
    if (name === 'fetch_page') {
      const raw = String(input.url || '')
      let target: URL
      try { target = new URL(raw) } catch { return 'Error: invalid URL.' }
      if (target.protocol !== 'https:' && target.protocol !== 'http:') return 'Error: only http(s) URLs are allowed.'
      if (!hostOk(target.hostname.toLowerCase())) return 'Error: that URL is not on this agent\'s official domains. Use a URL from the Official Links Directory.'
      let res: Response
      try {
        res = await doFetch(target.toString(), { signal: AbortSignal.timeout(8000), redirect: 'follow', headers: { 'User-Agent': 'SentimetrxAgent/1.0 (+https://www.sentimetrx.ai)' } })
      } catch { return 'Error: the page could not be fetched (timeout or network error).' }
      // Redirects may hop off the allowlist — re-check the landing host.
      try { if (res.url && !hostOk(new URL(res.url).hostname.toLowerCase())) return 'Error: the page redirected off the official domains.' } catch { /* non-fatal res.url quirk */ }
      if (!res.ok) return 'Error: page returned HTTP ' + res.status + '.'
      const html = (await res.text()).slice(0, 400000)
      const text = htmlToText(html, target.toString())
      return text.trim() ? ('Live content of ' + (res.url || target.toString()) + ' (fetched just now):\n\n' + text.slice(0, 8000)) : 'Error: the page had no readable text.'
    }
    return 'Error: unknown tool.'
  }
}

export interface ToolLoopParams {
  /** The conversation so far — MUTATED as assistant/tool_result turns append. */
  messages: Array<{ role: 'user' | 'assistant'; content: MessageContent }>
  /** One streaming model call over the current messages. The caller wires
   *  system prompt, model, tools, and delta emission inside. */
  callOnce: (messages: ToolLoopParams['messages'], toolChoice?: Record<string, unknown>) => Promise<AIStreamResult>
  executeTool: (name: string, input: Record<string, unknown>) => Promise<string>
  emit?: (ev: ChatStreamEvent) => void
  /** Usage of each NON-final round (the caller logs the final round as the
   *  main chat/chat_super event, keeping the super-quota count at 1/turn). */
  onRoundUsage?: (usage: AIUsage | undefined) => void
  debugLine?: (line: string) => void
  maxRounds?: number
}

/** Bounded agentic loop: call → execute requested tools → replay assistant
 *  blocks + tool_results verbatim → call again. Pre-tool text from every
 *  round joins the final answer with paragraph breaks (matching the
 *  separators emitted to the stream), so "Let me check the schedule." reads
 *  ahead of the fetched answer. */
export async function runAgentToolLoop(params: ToolLoopParams): Promise<{ text: string; stopReason: string; usage?: AIUsage; rounds: number }> {
  const maxRounds = params.maxRounds ?? MAX_TOOL_ROUNDS
  const assembled: string[] = []
  let rounds = 0
  let turn = await params.callOnce(params.messages)
  while (turn.stopReason === 'tool_use' && turn.toolUses.length > 0) {
    rounds++
    const budgetExhausted = rounds > maxRounds
    if (turn.text.trim()) { assembled.push(turn.text); params.emit?.({ type: 'delta', text: '\n\n' }) }
    params.messages.push({ role: 'assistant', content: turn.contentBlocks })
    const toolResults: ToolResultContentBlock[] = []
    for (const tu of turn.toolUses) {
      let output: string
      if (budgetExhausted) {
        output = 'Error: the tool budget for this turn is exhausted. Answer now with what you already know.'
      } else {
        params.emit?.({ type: 'tool', name: tu.name, label: agentToolLabel(tu) })
        params.debugLine?.('Tool round ' + rounds + ': ' + tu.name + ' ' + JSON.stringify(tu.input).slice(0, 150))
        try { output = await params.executeTool(tu.name, tu.input) } catch (te) { output = 'Error: ' + ((te as Error)?.message || 'tool failed') }
      }
      toolResults.push({ type: 'tool_result', tool_use_id: tu.id, content: output.slice(0, 8000), ...(output.startsWith('Error:') ? { is_error: true } : {}) })
    }
    params.messages.push({ role: 'user', content: toolResults })
    params.onRoundUsage?.(turn.usage)
    // Past the budget, force a text answer (tool_choice none) so a
    // tool-happy model cannot loop forever.
    turn = await params.callOnce(params.messages, budgetExhausted ? { type: 'none' } : undefined)
  }
  if (turn.text.trim() || assembled.length === 0) assembled.push(turn.text)
  return { text: assembled.join('\n\n'), stopReason: turn.stopReason, usage: turn.usage, rounds }
}
