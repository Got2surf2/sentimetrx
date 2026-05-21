'use client'

// Chat pane — left side of the canvas demo.
// POSTs to /api/bots/[id]/chat (the live AskAna agent at bot_id 920c571b-…).
// Independent vertical scroll; bottom-anchored input.
//
// Differs from the shared <ChatBot> widget: simpler bubble styling that
// matches the canvas design, no name prompt (the kiosk doesn't need it),
// and surfaces the active turn upward so CanvasShell can drive the
// right-pane card swap when a turn is clicked. Commit 2 will additionally
// fire the ui-hints extractor after each assistant reply.

import { useEffect, useRef, useState } from 'react'
import type { DeploymentMode } from '@/lib/uiHints'

const ASKANA_BOT_ID = '920c571b-5a09-4d3a-a20e-904a417d20b3'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  turnIdx: number
}

interface Props {
  greeting: string
  chips: string[]
  placeholder: string
  mode: DeploymentMode
  onActiveTurnChange?: (turnIdx: number) => void
  activeTurnIdx?: number
}

function newSessionId() {
  return 'demo_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36)
}

export default function ChatPane({ greeting, chips, placeholder, mode, onActiveTurnChange, activeTurnIdx }: Props) {
  const [sessionId] = useState(() => newSessionId())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  // Reset thread when the greeting changes (mode flip)
  useEffect(() => {
    setMessages([])
    setInput('')
  }, [greeting])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, pending])

  async function send(text: string) {
    const trimmed = text.trim()
    if (!trimmed || pending) return
    setInput('')

    const userTurnIdx = messages.length
    const userMsg: ChatMessage = { role: 'user', content: trimmed, turnIdx: userTurnIdx }
    setMessages((prev) => [...prev, userMsg])
    setPending(true)

    try {
      const apiMessages = [...messages, userMsg].map((m) => ({ role: m.role, content: m.content }))
      const res = await fetch('/api/bots/' + ASKANA_BOT_ID + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          session_id: sessionId,
          // demo: true tells chatCore to skip some heavy side effects (persona
          // extraction, conversation review scheduling) — see lib/chatCore.ts
          demo: true,
        }),
      })
      const data = await res.json()
      const reply = data?.message || data?.reply || data?.text || ''
      const anaTurnIdx = messages.length + 1
      setMessages((prev) => [...prev, { role: 'assistant', content: reply, turnIdx: anaTurnIdx }])
      onActiveTurnChange?.(anaTurnIdx)
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: "Sorry, I had trouble reaching the airport's information system. Try again?", turnIdx: messages.length + 1 }])
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="chat-pane">
      <div className="thread">
        <div className={'turn ana' + (activeTurnIdx === 0 ? ' active' : '')}>
          <div className="who">Ana</div>
          <div className="bubble">{greeting}</div>
        </div>

        {messages.map((m) => (
          <div
            key={m.turnIdx}
            className={'turn ' + m.role + (activeTurnIdx === m.turnIdx ? ' active' : '')}
            onClick={() => m.role === 'assistant' && onActiveTurnChange?.(m.turnIdx)}
          >
            <div className="who">{m.role === 'user' ? 'You' : 'Ana'}</div>
            <div className="bubble">{m.content}</div>
          </div>
        ))}

        {pending && (
          <div className="turn ana">
            <div className="who">Ana</div>
            <div className="bubble typing"><span /><span /><span /></div>
          </div>
        )}

        <div ref={endRef} />
      </div>

      {chips.length > 0 && (
        <div className="chips">
          {chips.map((c) => (
            <button key={c} className="chip" onClick={() => send(c)} disabled={pending}>{c}</button>
          ))}
        </div>
      )}

      <div className="chat-input">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(input) }}
          placeholder={placeholder}
          disabled={pending}
        />
        <button onClick={() => send(input)} disabled={pending || !input.trim()} aria-label="Send">➤</button>
      </div>
    </div>
  )
}
