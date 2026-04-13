'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Message {
  who: 'bot' | 'user'
  text: string
}

interface Props {
  sessionId: string
}

const HERMES = '#E8632A'
const BG = '#f9fafb'

export default function TownHallChat({ sessionId }: Props) {
  // Session state — fetched client-side
  const [sessionName, setSessionName] = useState('')
  const [sessionStatus, setSessionStatus] = useState<string | null>(null)
  const [config, setConfig] = useState<any>(null)
  const [fetchError, setFetchError] = useState(false)

  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [joined, setJoined] = useState(false)
  const [finished, setFinished] = useState(false)
  const [participantId, setParticipantId] = useState('')
  const [turnNumber, setTurnNumber] = useState(0)
  const [currentThemeId, setCurrentThemeId] = useState<string | null>(null)
  const [currentSource, setCurrentSource] = useState<string | null>(null)

  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const display = config?.display || {}

  const scrollBottom = useCallback(() => {
    const el = chatRef.current
    if (!el) return
    setTimeout(() => { el.scrollTop = el.scrollHeight }, 60)
    setTimeout(() => { el.scrollTop = el.scrollHeight }, 300)
  }, [])

  useEffect(() => { scrollBottom() }, [messages, loading, scrollBottom])

  useEffect(() => {
    if (!loading && joined && !finished) inputRef.current?.focus()
  }, [loading, joined, finished])

  // Mobile viewport fix
  const wrapperRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      if (wrapperRef.current) wrapperRef.current.style.height = vv.height + 'px'
    }
    vv.addEventListener('resize', onResize)
    onResize()
    return () => vv.removeEventListener('resize', onResize)
  }, [])

  // Fetch session status — poll until active
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null

    const checkSession = async () => {
      try {
        const res = await fetch('/api/townhall/status/' + sessionId)
        if (!res.ok) { setFetchError(true); return }
        const data = await res.json()
        if (data.id) {
          setSessionName(data.name)
          setSessionStatus(data.status)
          setConfig({ display: data.display, session_end: { closing_message: data.closing_message } })
          // Stop polling once active or ended
          if ((data.status === 'active' || data.status === 'ended') && interval) {
            clearInterval(interval)
          }
        } else {
          setFetchError(true)
        }
      } catch {
        setFetchError(true)
      }
    }

    checkSession()
    // Poll every 3 seconds while waiting for session to start
    interval = setInterval(checkSession, 3000)

    return () => { if (interval) clearInterval(interval) }
  }, [sessionId])

  // Join session
  const handleJoin = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/townhall/join/' + sessionId, { method: 'POST' })
      const data = await res.json()

      if (data.error) {
        setMessages([{ who: 'bot', text: data.error }])
        setFinished(true)
        setLoading(false)
        return
      }

      setParticipantId(data.participant_id)
      setTurnNumber(data.turn_number)
      setCurrentThemeId(data.theme_id)
      setCurrentSource(data.source)
      setJoined(true)

      if (data.is_final) {
        setMessages([{ who: 'bot', text: data.bot_message }])
        setFinished(true)
      } else {
        setMessages([{ who: 'bot', text: data.bot_message }])
      }
    } catch {
      setMessages([{ who: 'bot', text: 'Something went wrong. Please try again.' }])
    }
    setLoading(false)
  }

  // Send message
  const handleSend = async (text?: string, skip?: boolean) => {
    const msg = text || input.trim()
    if (!msg && !skip) return
    if (loading || finished) return

    if (!skip) {
      setMessages(prev => [...prev, { who: 'user', text: msg }])
      setInput('')
    }

    setLoading(true)

    try {
      const res = await fetch('/api/townhall/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: sessionId,
          participant_id: participantId,
          message: skip ? '' : msg,
          turn_number: turnNumber,
          theme_id: currentThemeId,
          skipped: !!skip,
        }),
      })

      const data = await res.json()

      setTurnNumber(data.turn_number)
      setCurrentThemeId(data.theme_id)
      setCurrentSource(data.source)

      await new Promise(r => setTimeout(r, 600 + Math.random() * 800))

      setMessages(prev => [...prev, { who: 'bot', text: data.bot_message }])

      if (data.is_final) {
        setFinished(true)
      }
    } catch {
      setMessages(prev => [...prev, { who: 'bot', text: 'Something went wrong. Let me try again — what were you saying?' }])
    }

    setLoading(false)
  }

  const handleDone = () => {
    const thankYou = display.thank_you_message || 'Thank you for your time. Your voice matters.'
    setMessages(prev => [...prev, { who: 'bot', text: thankYou }])
    setFinished(true)

    fetch('/api/townhall/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        participant_id: participantId,
        message: '[done]',
        turn_number: turnNumber,
        theme_id: currentThemeId,
        skipped: true,
      }),
    }).catch(() => {})
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  // Loading state while fetching session
  if (sessionStatus === null && !fetchError) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG }}>
        <p style={{ color: '#9ca3af', fontSize: 14 }}>Loading...</p>
      </div>
    )
  }

  // Session not found
  if (fetchError) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG }}>
        <p style={{ color: '#9ca3af', fontSize: 14 }}>Session not found.</p>
      </div>
    )
  }

  // Session not started yet — auto-polls until active
  if (sessionStatus === 'setup' || sessionStatus === 'paused') {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG, padding: 20 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{'\uD83C\uDFE4'}</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#374151', marginBottom: 4 }}>{sessionName}</h2>
          <p style={{ color: '#9ca3af', fontSize: 14 }}>This session hasn't started yet. Please wait for the facilitator to begin.</p>
          <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#d1d5db', animation: 'th-bounce 1.2s ease-in-out infinite' }} />
            <span style={{ fontSize: 12, color: '#d1d5db' }}>Waiting...</span>
          </div>
          <style>{`
            @keyframes th-bounce {
              0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
              30% { transform: translateY(-4px); opacity: 1; }
            }
          `}</style>
        </div>
      </div>
    )
  }

  // Session ended
  if (sessionStatus === 'ended' && !joined) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: BG, padding: 20 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{'\u2705'}</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#374151', marginBottom: 4 }}>{sessionName}</h2>
          <p style={{ color: '#9ca3af', fontSize: 14 }}>{config?.session_end?.closing_message || 'This session has ended. Thank you!'}</p>
        </div>
      </div>
    )
  }

  // Pre-join welcome screen (session is active)
  if (!joined) {
    return (
      <div ref={wrapperRef} style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: BG, padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{'\uD83D\uDCAC'}</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 8 }}>{sessionName}</h1>
          <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, marginBottom: 24 }}>
            {display.welcome_message || 'Welcome! Share your thoughts anonymously — we\'ll have a short conversation to understand your perspective.'}
          </p>
          <button
            onClick={handleJoin}
            disabled={loading}
            style={{
              background: HERMES, color: 'white', border: 'none', borderRadius: 12,
              padding: '12px 32px', fontSize: 15, fontWeight: 600, cursor: 'pointer',
              opacity: loading ? 0.6 : 1, transition: 'opacity 0.2s',
            }}>
            {loading ? 'Joining...' : 'Join the conversation'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: BG }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px', background: 'white', borderBottom: '1px solid #e5e7eb',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%', background: HERMES,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontSize: 16, fontWeight: 700,
        }}>
          {'\uD83D\uDCAC'}
        </div>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{sessionName}</div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>Anonymous conversation</div>
        </div>
      </div>

      {/* Chat area */}
      <div ref={chatRef} style={{
        flex: 1, overflowY: 'auto', padding: '16px 12px',
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: msg.who === 'user' ? 'flex-end' : 'flex-start',
          }}>
            <div style={{
              maxWidth: '80%',
              padding: '10px 14px',
              borderRadius: msg.who === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
              background: msg.who === 'user' ? HERMES : 'white',
              color: msg.who === 'user' ? 'white' : '#374151',
              fontSize: 14,
              lineHeight: 1.5,
              boxShadow: msg.who === 'bot' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}>
              {msg.text}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
            <div style={{
              padding: '10px 18px', borderRadius: '16px 16px 16px 4px',
              background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
              display: 'flex', gap: 4, alignItems: 'center',
            }}>
              {[0, 1, 2].map(i => (
                <div key={i} style={{
                  width: 7, height: 7, borderRadius: '50%', background: '#d1d5db',
                  animation: 'th-bounce 1.2s ease-in-out infinite',
                  animationDelay: (i * 0.2) + 's',
                }} />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input area */}
      {!finished ? (
        <div style={{
          padding: '10px 12px', borderTop: '1px solid #e5e7eb', background: 'white',
          display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your thoughts..."
              disabled={loading}
              rows={1}
              style={{
                flex: 1, resize: 'none', border: '1px solid #e5e7eb', borderRadius: 12,
                padding: '10px 14px', fontSize: 14, outline: 'none', maxHeight: 120,
                lineHeight: 1.4, background: loading ? '#f9fafb' : 'white',
              }}
              onInput={e => {
                const el = e.target as HTMLTextAreaElement
                el.style.height = 'auto'
                el.style.height = Math.min(el.scrollHeight, 120) + 'px'
              }}
            />
            <button
              onClick={() => handleSend()}
              disabled={loading || !input.trim()}
              style={{
                width: 40, height: 40, borderRadius: 12, border: 'none',
                background: input.trim() ? HERMES : '#e5e7eb',
                color: 'white', fontSize: 18, cursor: input.trim() ? 'pointer' : 'default',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'background 0.2s', flexShrink: 0,
              }}>
              {'\u2191'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button
              onClick={() => handleSend(undefined, true)}
              disabled={loading}
              style={{
                background: 'none', border: 'none', color: '#9ca3af', fontSize: 12,
                cursor: 'pointer', padding: '2px 8px',
              }}>
              {display.skip_label || "I'd rather not answer that"}
            </button>
            <span style={{ color: '#e5e7eb', fontSize: 12 }}>|</span>
            <button
              onClick={handleDone}
              disabled={loading}
              style={{
                background: 'none', border: 'none', color: '#9ca3af', fontSize: 12,
                cursor: 'pointer', padding: '2px 8px',
              }}>
              {display.done_label || "I'm done sharing"}
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          padding: '16px 12px', borderTop: '1px solid #e5e7eb', background: 'white',
          textAlign: 'center', flexShrink: 0,
        }}>
          <p style={{ color: '#9ca3af', fontSize: 13 }}>Conversation ended</p>
        </div>
      )}

      <style>{`
        @keyframes th-bounce {
          0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
          30% { transform: translateY(-6px); opacity: 1; }
        }
      `}</style>
    </div>
  )
}
