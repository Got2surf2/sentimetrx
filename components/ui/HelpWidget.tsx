'use client'

// components/ui/HelpWidget.tsx
// The in-product Help launcher — a floating lifesaver (🛟) button on every
// authenticated page that opens a chat panel with "Sherpa", the help assistant.
// Streams from the authed /api/help/chat route (SSE), sending the current page
// as context so answers are relevant to where the user is. See docs/HELP_AGENT.md.
//
// Grounded, product-how-to only: data questions get redirected to Ask Ana by the
// agent itself (system-prompt scope), not here.

import { useEffect, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'

const HERMES = '#E8632A'

interface Props {
  currentPage?: string
  features?: Record<string, boolean>
}

interface Msg { role: 'user' | 'assistant'; content: string }

const GREETING: Msg = {
  role: 'assistant',
  content: "Hi, I'm Sherpa 🛟 — I can help you find your way around Sentimetrx. Ask me how to do something, like \"how do I export a deck?\" (For questions about what your data says, use Ask Ana inside a dataset.)",
}

// Minimal inline formatter: **bold** + line breaks. Avoids pulling a markdown
// dependency into the nav bundle for a few emphasis spans.
function renderContent(text: string) {
  return text.split('\n').map((line, li) => (
    <span key={li}>
      {li > 0 && <br />}
      {line.split(/(\*\*[^*]+\*\*)/g).map((seg, si) =>
        seg.startsWith('**') && seg.endsWith('**')
          ? <strong key={si}>{seg.slice(2, -2)}</strong>
          : <span key={si}>{seg}</span>,
      )}
    </span>
  ))
}

function getSessionId(): string {
  try {
    const k = 'help_session_id'
    let v = localStorage.getItem(k)
    if (!v) { v = 'help-' + Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem(k, v) }
    return v
  } catch { return 'help-ephemeral' }
}

export default function HelpWidget({ currentPage, features }: Props) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([GREETING])
  const [input, setInput] = useState('')
  const [streamText, setStreamText] = useState('')
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Record<number, 'up' | 'down'>>({})
  const scrollRef = useRef<HTMLDivElement>(null)

  async function sendFeedback(idx: number, rating: 1 | -1) {
    if (feedback[idx]) return
    setFeedback(f => ({ ...f, [idx]: rating === 1 ? 'up' : 'down' }))
    try {
      await fetch('/api/help/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating,
          session_id: getSessionId(),
          question: messages[idx - 1]?.content ?? null,
          answer: messages[idx]?.content ?? null,
          page_route: pathname,
        }),
      })
    } catch { /* best-effort — the local state already thanked them */ }
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streamText, open])

  async function send() {
    const q = input.trim()
    if (!q || busy) return
    const next = [...messages, { role: 'user' as const, content: q }]
    setMessages(next)
    setInput('')
    setBusy(true)
    setStreamText('')
    try {
      const apiMessages = next.filter(m => m !== GREETING).map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/help/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          session_id: getSessionId(),
          stream: true,
          pageContext: { route: pathname, currentPage, features },
        }),
      })

      let reply: string | null = null
      const ctype = res.headers.get('content-type') || ''
      if (res.ok && ctype.includes('text/event-stream') && res.body) {
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          let sep: number
          while ((sep = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, sep); buf = buf.slice(sep + 2)
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) continue
              let ev: { type?: string; text?: string; result?: { reply?: string | null }; error?: string }
              try { ev = JSON.parse(line.slice(5).trim()) } catch { continue }
              if (ev.type === 'delta' && typeof ev.text === 'string') setStreamText(prev => prev + ev.text)
              else if (ev.type === 'done') reply = ev.result?.reply ?? null
              else if (ev.type === 'error') throw new Error(ev.error || 'stream error')
            }
          }
        }
      } else {
        const data = await res.json().catch(() => null)
        if (!res.ok) throw new Error((data as { error?: string })?.error || 'Request failed')
        reply = (data as { reply?: string })?.reply ?? null
      }
      setMessages(m => [...m, { role: 'assistant', content: reply || "Sorry, I couldn't answer that one." }])
    } catch {
      setMessages(m => [...m, { role: 'assistant', content: "Sorry, I'm having trouble right now. Please try again in a moment." }])
    } finally {
      setBusy(false)
      setStreamText('')
    }
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open Help"
          title="Help"
          className="fixed bottom-5 right-5 z-[60] flex items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
          style={{ width: 52, height: 52, background: 'white', border: '1px solid #eee', fontSize: 26 }}
        >
          <span aria-hidden>🛟</span>
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed bottom-5 right-5 z-[60] flex flex-col rounded-2xl shadow-2xl bg-white overflow-hidden"
          style={{ width: 'min(380px, calc(100vw - 24px))', height: 'min(560px, calc(100vh - 88px))', border: '1px solid #eee' }}
          role="dialog"
          aria-label="Help"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3" style={{ background: HERMES }}>
            <div className="flex items-center gap-2 text-white font-semibold">
              <span aria-hidden style={{ fontSize: 20 }}>🛟</span>
              <span>Help</span>
              <span className="text-white/70 text-sm font-normal">· Sherpa</span>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close Help"
              className="text-white/90 hover:text-white" style={{ fontSize: 20, lineHeight: 1 }}>×</button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3" style={{ background: '#faf9f8' }}>
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start'}>
                <div
                  className="rounded-2xl px-3 py-2 text-sm leading-relaxed"
                  style={m.role === 'user'
                    ? { background: HERMES, color: 'white', maxWidth: '85%', alignSelf: 'flex-end' }
                    : { background: 'white', color: '#1f2937', border: '1px solid #eee', maxWidth: '90%' }}
                >
                  {renderContent(m.content)}
                </div>
                {/* Thumbs on real answers (not the greeting) — the KB-gap signal. */}
                {m.role === 'assistant' && m !== GREETING && (
                  <div className="flex items-center gap-1 mt-1 pl-1 text-xs text-gray-400">
                    {feedback[i] ? (
                      <span>Thanks for the feedback!</span>
                    ) : (
                      <>
                        <button type="button" aria-label="Helpful" title="Helpful"
                          onClick={() => void sendFeedback(i, 1)} className="hover:text-gray-700">👍</button>
                        <button type="button" aria-label="Not helpful" title="Not helpful"
                          onClick={() => void sendFeedback(i, -1)} className="hover:text-gray-700">👎</button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-3 py-2 text-sm bg-white border" style={{ borderColor: '#eee', color: '#1f2937', maxWidth: '90%' }}>
                  {streamText ? renderContent(streamText) : <LottieLoader size={40} />}
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="flex items-end gap-2 p-2 border-t" style={{ borderColor: '#eee' }}>
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
              placeholder="Ask how to do something…"
              rows={1}
              className="flex-1 resize-none rounded-xl px-3 py-2 outline-none"
              style={{ fontSize: '16px', border: '1px solid #e5e7eb', maxHeight: 120 }}
            />
            <button
              type="button"
              onClick={() => void send()}
              disabled={busy || !input.trim()}
              aria-label="Send"
              className="rounded-xl px-3 py-2 text-white font-medium disabled:opacity-40"
              style={{ background: HERMES, fontSize: 14 }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  )
}
