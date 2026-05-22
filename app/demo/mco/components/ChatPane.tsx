'use client'

// Chat pane — left side of the canvas demo.
// POSTs to /api/bots/[id]/chat (the live AskAna agent at bot_id 920c571b-…).
// Independent vertical scroll; bottom-anchored input.
//
// After each assistant reply lands, fires a fire-and-forget call to the
// sibling endpoint POST /api/bots/[id]/ui-hints with the (user, assistant)
// pair. The extractor returns zero or one UiHint which is surfaced upward
// via onHintReceived so CanvasShell can update the right pane.
// Failures degrade silently: a missing hint leaves the canvas as-is.

import { useEffect, useRef, useState } from 'react'
import type { DeploymentMode, ExtractorContext, UiHint } from '@/lib/uiHints'

const LIVE_ASKANA_BOT_ID = '920c571b-5a09-4d3a-a20e-904a417d20b3'

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
  botOverride?: string | null
  activeContext?: ExtractorContext
  pendingMessage?: string | null
  onPendingMessageConsumed?: () => void
  onHintReceived?: (hint: UiHint | null) => void
  onExtractingChange?: (extracting: boolean) => void
}

function newSessionId() {
  return 'demo_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36)
}

export default function ChatPane({ greeting, chips: initialChips, placeholder, mode, botOverride, activeContext, pendingMessage, onPendingMessageConsumed, onHintReceived, onExtractingChange }: Props) {
  const askanaBotId = botOverride || LIVE_ASKANA_BOT_ID
  const [sessionId] = useState(() => newSessionId())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [pending, setPending] = useState(false)
  const [liveChips, setLiveChips] = useState<string[] | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Reset thread when the greeting changes (mode flip). Also clear any
  // live hint so the canvas reverts to the mode's default demo card.
  useEffect(() => {
    setMessages([])
    setInput('')
    setLiveChips(null)
    onHintReceived?.(null)
  }, [greeting])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages.length, pending])

  // Restore focus to the input after each reply lands. Even though the input
  // is no longer `disabled` (so focus is mostly preserved), this is defensive
  // for cases where the user clicked a chip (focus on the button) and we
  // want the cursor back in the box.
  useEffect(() => {
    if (!pending) inputRef.current?.focus()
  }, [pending])

  // Tile clicks on the WelcomeCard are delivered as a pendingMessage.
  // Tiles only appear before any conversation exists, so messages is always []
  // at this point — no stale-closure concern.
  useEffect(() => {
    if (!pendingMessage) return
    onPendingMessageConsumed?.()
    send(pendingMessage)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage])

  // Fire the extractor after a new assistant message lands. Fire-and-forget
  // by design — the prose answer is already on screen; we don't block the
  // user on this. The canvas card just animates in a beat later.
  //
  // Three signals can come back:
  //   - ui_hints[0]: new card to show on the right pane
  //   - revert_canvas=true: clear the right pane to idle (user pivoted off-topic)
  //   - empty + revert_canvas=false: keep the existing card (no opinion)
  async function extractHint(userText: string, assistantText: string) {
    onExtractingChange?.(true)
    try {
      const res = await fetch('/api/bots/' + askanaBotId + '/ui-hints', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userMessage: userText,
          assistantMessage: assistantText,
          context: activeContext,
        }),
      })
      if (!res.ok) return
      const data = await res.json()
      const hints: UiHint[] = Array.isArray(data?.ui_hints) ? data.ui_hints : []
      if (hints.length > 0) {
        onHintReceived?.(hints[0])
      } else if (data?.revert_canvas === true) {
        // Explicit signal that the new turn doesn't belong with what's on
        // canvas. Clear it so CanvasShell falls back to the idle welcome card.
        onHintReceived?.(null)
      }
      // Otherwise empty + no revert → keep the existing card.
      const nextChips: string[] = Array.isArray(data?.next_chips)
        ? data.next_chips.filter((s: any) => typeof s === 'string' && s.length > 0 && s.length <= 80).slice(0, 4)
        : []
      if (nextChips.length > 0) setLiveChips(nextChips)
    } catch {
      // Silent failure: keep the existing card.
    } finally {
      onExtractingChange?.(false)
    }
  }

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
      const res = await fetch('/api/bots/' + askanaBotId + '/chat', {
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

      // Extract a UI hint from this turn. Don't await — the prose already
      // rendered, and the card animates in when the extractor returns.
      if (reply) void extractHint(trimmed, reply)
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: "Sorry, I had trouble reaching the airport's information system. Try again?", turnIdx: messages.length + 1 }])
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="chat-pane">
      <div className="thread">
        <div className="turn ana">
          <div className="who">Ana</div>
          <div className="bubble">{greeting}</div>
        </div>

        {messages.map((m) => (
          <div key={m.turnIdx} className={'turn ' + m.role}>
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

      {(() => {
        const chipsToShow = liveChips ?? initialChips
        return chipsToShow.length > 0 ? (
          <div className="chips">
            {chipsToShow.map((c) => (
              <button key={c} className="chip" onClick={() => send(c)} disabled={pending}>{c}</button>
            ))}
          </div>
        ) : null
      })()}

      <div className="chat-input">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !pending) send(input) }}
          placeholder={placeholder}
          autoFocus
        />
        <button onClick={() => send(input)} disabled={pending || !input.trim()} aria-label="Send">➤</button>
      </div>
    </div>
  )
}
