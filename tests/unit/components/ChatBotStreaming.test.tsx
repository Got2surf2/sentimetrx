// @vitest-environment jsdom
//
// ChatBot — Phase 3 streaming transport. The widget opts into SSE
// (body.stream:true), paints delta events live, shows tool-status lines,
// and reconciles the finished bubble to the authoritative done-event result
// (chips trailer extracted, guardrail-scrubbed text wins). Servers that
// answer plain JSON (older deploys, clara/nora) fall back transparently.

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ChatBot, { type ChatBotConfig } from '@/components/ui/ChatBot'

const CONFIG: ChatBotConfig = {
  // Non-bot endpoint shape → the impression beacon and history-rehydrate
  // effects (which only fire for /api/bots/<id>/chat) stay quiet.
  apiEndpoint: '/api/test-chat',
  name: 'Testy',
  subtitle: 'test agent',
  avatarLetter: 'T',
  headerGradient: '#111',
  avatarGradient: '#222',
  accentColor: '#00B4D8',
  pageBg: '#fff',
  userBubbleBg: '#333',
  websiteUrl: 'https://example.org',
  websiteLabel: 'example.org',
  placeholder: 'Ask…',
  suggestions: ['What are your hours?'],
  initialMessage: 'Hi! Ask me anything.',
  askName: false,
  dynamicChips: true,
}

function sseBody(events: Array<Record<string, unknown>>): Response {
  const payload = events.map((ev) => 'data: ' + JSON.stringify(ev) + '\n\n').join('')
  return new Response(payload, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})

describe('ChatBot streaming', () => {
  it('sends stream:true, paints deltas, and reconciles to the done result with chips extracted', async () => {
    const fetchMock = global.fetch as unknown as Mock
    fetchMock.mockResolvedValue(sseBody([
      { type: 'delta', text: 'We are ' },
      { type: 'tool', name: 'fetch_page', label: 'Checking example.org…' },
      { type: 'delta', text: 'open 9-5.' },
      { type: 'done', result: { reply: 'We are open 9-5.\n[[chips: Weekend hours | Location]]' } },
    ]))

    render(<ChatBot config={CONFIG} />)
    fireEvent.click(screen.getByText('What are your hours?'))

    await waitFor(() => expect(screen.getByText(/open 9-5/)).toBeTruthy())
    // Request opted into streaming.
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.stream).toBe(true)
    // Chips trailer never renders as text; pills do.
    expect(screen.queryByText(/\[\[chips/)).toBeNull()
    await waitFor(() => expect(screen.getByText('Weekend hours')).toBeTruthy())
    expect(screen.getByText('Location')).toBeTruthy()
  })

  it('locks the session when the done result carries ended:true', async () => {
    const fetchMock = global.fetch as unknown as Mock
    fetchMock.mockResolvedValue(sseBody([
      { type: 'delta', text: 'Goodbye.' },
      { type: 'done', result: { reply: 'This session has ended.', ended: true } },
    ]))
    render(<ChatBot config={CONFIG} />)
    fireEvent.click(screen.getByText('What are your hours?'))
    await waitFor(() => expect(screen.getByText(/session has ended/)).toBeTruthy())
    // The composer locks: textarea disabled with the ended placeholder.
    const ta = document.querySelector('textarea') as HTMLTextAreaElement
    expect(ta.disabled).toBe(true)
  })

  it('falls back to plain JSON when the server does not stream', async () => {
    const fetchMock = global.fetch as unknown as Mock
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ reply: 'JSON answer.' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    render(<ChatBot config={CONFIG} />)
    fireEvent.click(screen.getByText('What are your hours?'))
    await waitFor(() => expect(screen.getByText('JSON answer.')).toBeTruthy())
  })

  it('offers Retry when the stream errors mid-turn', async () => {
    const fetchMock = global.fetch as unknown as Mock
    fetchMock.mockResolvedValue(sseBody([
      { type: 'delta', text: 'partial…' },
      { type: 'error', error: 'chat failed' },
    ]))
    render(<ChatBot config={CONFIG} />)
    fireEvent.click(screen.getByText('What are your hours?'))
    await waitFor(() => expect(screen.getByText(/Connection hiccup/)).toBeTruthy())
    expect(screen.getByText('Retry')).toBeTruthy()
  })
})
