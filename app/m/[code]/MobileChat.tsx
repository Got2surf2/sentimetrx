'use client'

// Mobile chat surface for /m/[code]. Re-hydrates the chat thread from the
// kiosk handoff and lets the user keep talking to the same bot on their
// phone. Mints a fresh session_id so the mobile conversation doesn't
// poison the kiosk's session (which has already been cleared by the
// 60s inactivity timer or the user's "Done" tap).

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

interface Message { role: 'user' | 'assistant'; content: string }
interface Props {
  botId: string
  initialMessages: Message[]
  code: string
}

// Same tiny markdown renderer as ChatPane — handles [text](url) and **bold**.
function renderMarkdown(text: string): ReactNode {
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g
  const out: ReactNode[] = []
  let lastIdx = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = linkRe.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(<span key={k++}>{renderBold(text.slice(lastIdx, m.index))}</span>)
    out.push(<a key={k++} href={m[2]} target="_blank" rel="noopener noreferrer">{m[1]}</a>)
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) out.push(<span key={k++}>{renderBold(text.slice(lastIdx))}</span>)
  return <>{out}</>
}
function renderBold(text: string): ReactNode {
  const boldRe = /\*\*([^*]+)\*\*/g
  const out: ReactNode[] = []
  let lastIdx = 0
  let m: RegExpExecArray | null
  let k = 0
  while ((m = boldRe.exec(text)) !== null) {
    if (m.index > lastIdx) out.push(text.slice(lastIdx, m.index))
    out.push(<strong key={k++}>{m[1]}</strong>)
    lastIdx = m.index + m[0].length
  }
  if (lastIdx < text.length) out.push(text.slice(lastIdx))
  return <>{out}</>
}

export default function MobileChat({ botId, initialMessages, code }: Props) {
  const [sessionId] = useState(() => 'm_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36))
  const [messages, setMessages] = useState<Message[]>(initialMessages)
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages.length, pending])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || pending) return
    setInput('')
    const userMsg: Message = { role: 'user', content: trimmed }
    setMessages(prev => [...prev, userMsg])
    setPending(true)
    try {
      const apiMessages = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/bots/' + botId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: apiMessages, session_id: sessionId, demo: true }),
      })
      const data = await res.json()
      const reply = data?.message || data?.reply || data?.text || ''
      if (reply) setMessages(prev => [...prev, { role: 'assistant', content: reply }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: "Sorry, I had trouble reaching MCO's information system. Try again?" }])
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mob">
      <header className="mob-top">
        <div className="mob-avatar">✈️</div>
        <div>
          <div className="mob-brand">AskAna</div>
          <div className="mob-sub">Continued from the MCO kiosk · {code}</div>
        </div>
      </header>

      <div className="mob-thread">
        {messages.length === 0 ? (
          <div className="mob-turn assistant">
            <div className="mob-who">Ana</div>
            <div className="mob-bubble">Hi — your kiosk session is open here now. What else can I help with?</div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={'mob-turn ' + m.role}>
              <div className="mob-who">{m.role === 'user' ? 'You' : 'Ana'}</div>
              <div className="mob-bubble">{m.role === 'assistant' ? renderMarkdown(m.content) : m.content}</div>
            </div>
          ))
        )}
        {pending && (
          <div className="mob-turn assistant">
            <div className="mob-who">Ana</div>
            <div className="mob-bubble"><span className="dot" /><span className="dot" /><span className="dot" /></div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="mob-input"
        onSubmit={(e) => { e.preventDefault(); send(input) }}
      >
        <input
          type="text"
          placeholder="Ask Ana…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
        />
        <button type="submit" disabled={!input.trim() || pending}>Send</button>
      </form>

      <style jsx>{`
        .mob { display: flex; flex-direction: column; height: 100dvh; background: #f3f5f8; }
        .mob-top {
          display: flex; align-items: center; gap: 10px;
          padding: 12px 16px; background: #0a2540; color: #fff;
        }
        .mob-avatar {
          width: 32px; height: 32px; border-radius: 32px;
          background: linear-gradient(135deg, #1e4d8b, #2b6cb0);
          display: flex; align-items: center; justify-content: center; font-size: 18px;
        }
        .mob-brand { font-weight: 700; font-size: 15px; }
        .mob-sub { font-size: 11px; opacity: 0.7; letter-spacing: 0.04em; }
        .mob-thread {
          flex: 1; overflow-y: auto; padding: 16px;
          display: flex; flex-direction: column; gap: 14px;
        }
        .mob-turn { display: flex; flex-direction: column; gap: 4px; max-width: 88%; }
        .mob-turn.user { align-self: flex-end; align-items: flex-end; }
        .mob-turn.assistant { align-self: flex-start; }
        .mob-who { font-size: 11px; color: #6b7280; font-weight: 600; letter-spacing: 0.04em; padding: 0 4px; }
        .mob-bubble {
          padding: 10px 14px; border-radius: 14px; font-size: 15px;
          line-height: 1.45; word-wrap: break-word;
        }
        .mob-turn.user .mob-bubble { background: #0a2540; color: #fff; }
        .mob-turn.assistant .mob-bubble {
          background: #fff; color: #0a2540;
          border: 1px solid #e5e7eb;
        }
        .mob-bubble :global(a) { color: #2563eb; text-decoration: underline; word-break: break-word; }
        .mob-turn.user .mob-bubble :global(a) { color: #93c5fd; }
        .dot {
          display: inline-block; width: 6px; height: 6px; background: #94a3b8;
          border-radius: 50%; margin: 0 2px;
          animation: blink 1.2s infinite ease-in-out;
        }
        .dot:nth-child(2) { animation-delay: 0.15s; }
        .dot:nth-child(3) { animation-delay: 0.3s; }
        @keyframes blink { 0%, 80%, 100% { opacity: 0.3 } 40% { opacity: 1 } }
        .mob-input {
          display: flex; gap: 8px; padding: 12px;
          background: #fff; border-top: 1px solid #e5e7eb;
        }
        .mob-input input {
          flex: 1; padding: 12px 14px; border: 1px solid #e5e7eb;
          border-radius: 24px; font-size: 16px; outline: none;
        }
        .mob-input input:focus { border-color: #f59e0b; }
        .mob-input button {
          padding: 0 18px; border: none; border-radius: 24px;
          background: #f59e0b; color: #0a2540; font-weight: 700; font-size: 14px;
          cursor: pointer; disabled-opacity: 0.5;
        }
        .mob-input button:disabled { background: #e5e7eb; color: #9ca3af; cursor: default; }
      `}</style>
    </div>
  )
}
