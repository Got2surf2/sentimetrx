'use client'

import { useState, useRef, useEffect, useCallback } from 'react'

interface Message { who: 'bot' | 'user'; text: string }
interface Props { sessionId: string }

const HERMES = '#E8632A'
const BG = '#f9fafb'

export default function TownHallChat({ sessionId }: Props) {
  // Session info — fetched via GET /api/townhall/join/:id
  const [sessionName, setSessionName] = useState('')
  const [status, setStatus] = useState<'loading' | 'setup' | 'active' | 'ended' | 'notfound'>('loading')
  const [display, setDisplay] = useState<any>({})
  const [closingMsg, setClosingMsg] = useState('')

  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [joined, setJoined] = useState(false)
  const [finished, setFinished] = useState(false)
  const [pid, setPid] = useState('')
  const [turn, setTurn] = useState(0)
  const [themeId, setThemeId] = useState<string | null>(null)

  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const scroll = useCallback(() => {
    const el = chatRef.current
    if (!el) return
    setTimeout(() => { el.scrollTop = el.scrollHeight }, 60)
    setTimeout(() => { el.scrollTop = el.scrollHeight }, 300)
  }, [])

  useEffect(() => { scroll() }, [messages, loading, scroll])
  useEffect(() => { if (!loading && joined && !finished) inputRef.current?.focus() }, [loading, joined, finished])

  // Mobile viewport
  const wrapRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const r = () => { if (wrapRef.current) wrapRef.current.style.height = vv.height + 'px' }
    vv.addEventListener('resize', r); r()
    return () => vv.removeEventListener('resize', r)
  }, [])

  // Poll session via GET /api/townhall/join/:id (same endpoint, no auth needed)
  const poll = useCallback(async () => {
    try {
      const r = await fetch('/api/townhall/join/' + sessionId)
      if (!r.ok) { setStatus('notfound'); return }
      const d = await r.json()
      if (!d.found) { setStatus('notfound'); return }
      setSessionName(d.name || '')
      setDisplay(d.display || {})
      setClosingMsg(d.closing_message || '')
      if (d.status === 'active') {
        setStatus('active')
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      } else if (d.status === 'ended') {
        setStatus('ended')
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      } else {
        setStatus('setup')
      }
    } catch { /* network blip, keep polling */ }
  }, [sessionId])

  useEffect(() => {
    poll()
    pollRef.current = setInterval(poll, 3000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [poll])

  // Join
  const handleJoin = async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/townhall/join/' + sessionId, { method: 'POST' })
      const d = await r.json()
      if (d.error) {
        if (d.status === 'setup') { setStatus('setup'); setLoading(false); return }
        setMessages([{ who: 'bot', text: d.error }]); setFinished(true); setLoading(false); return
      }
      setPid(d.participant_id); setTurn(d.turn_number); setThemeId(d.theme_id)
      setJoined(true); setMessages([{ who: 'bot', text: d.bot_message }])
      if (d.is_final) setFinished(true)
    } catch { setMessages([{ who: 'bot', text: 'Something went wrong. Please try again.' }]) }
    setLoading(false)
  }

  // Send
  const handleSend = async (text?: string, skip?: boolean) => {
    const msg = text || input.trim()
    if (!msg && !skip) return
    if (loading || finished) return
    if (!skip) { setMessages(p => [...p, { who: 'user', text: msg }]); setInput('') }
    setLoading(true)
    try {
      const r = await fetch('/api/townhall/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, participant_id: pid, message: skip ? '' : msg, turn_number: turn, theme_id: themeId, skipped: !!skip }),
      })
      const d = await r.json()
      setTurn(d.turn_number); setThemeId(d.theme_id)
      await new Promise(r => setTimeout(r, 600 + Math.random() * 800))
      setMessages(p => [...p, { who: 'bot', text: d.bot_message }])
      if (d.is_final) setFinished(true)
    } catch { setMessages(p => [...p, { who: 'bot', text: 'Something went wrong. Let me try again — what were you saying?' }]) }
    setLoading(false)
  }

  const handleDone = () => {
    setMessages(p => [...p, { who: 'bot', text: display.thank_you_message || 'Thank you for your time. Your voice matters.' }])
    setFinished(true)
    fetch('/api/townhall/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, participant_id: pid, message: '[done]', turn_number: turn, theme_id: themeId, skipped: true }),
    }).catch(() => {})
  }

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }

  // --- RENDER ---

  if (status === 'loading') return <Screen>{'\u23F3'} Loading...</Screen>
  if (status === 'notfound') return <Screen>Session not found.</Screen>

  if (status === 'setup') {
    return (
      <Screen>
        <div style={{ fontSize: 40, marginBottom: 12 }}>{'\uD83C\uDFE4'}</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#374151', marginBottom: 4 }}>{sessionName}</h2>
        <p style={{ color: '#9ca3af', fontSize: 14 }}>Waiting for the facilitator to start the session...</p>
        <Dots />
      </Screen>
    )
  }

  if (status === 'ended' && !joined) {
    return (
      <Screen>
        <div style={{ fontSize: 40, marginBottom: 12 }}>{'\u2705'}</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#374151', marginBottom: 4 }}>{sessionName}</h2>
        <p style={{ color: '#9ca3af', fontSize: 14 }}>{closingMsg || 'This session has ended. Thank you!'}</p>
      </Screen>
    )
  }

  if (!joined) {
    return (
      <div ref={wrapRef} style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: BG, padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{'\uD83D\uDCAC'}</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 8 }}>{sessionName}</h1>
          <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.6, marginBottom: 24 }}>
            {display.welcome_message || 'Welcome! Share your thoughts anonymously.'}
          </p>
          <button onClick={handleJoin} disabled={loading}
            style={{ background: HERMES, color: 'white', border: 'none', borderRadius: 12, padding: '12px 32px', fontSize: 15, fontWeight: 600, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
            {loading ? 'Joining...' : 'Join the conversation'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={wrapRef} style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: BG }}>
      <div style={{ padding: '12px 16px', background: 'white', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: '50%', background: HERMES, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 16 }}>{'\uD83D\uDCAC'}</div>
        <div><div style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>{sessionName}</div><div style={{ fontSize: 11, color: '#9ca3af' }}>Anonymous conversation</div></div>
      </div>
      <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {messages.map((m, i) => (
          <div key={i} style={{ display: 'flex', justifyContent: m.who === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ maxWidth: '80%', padding: '10px 14px', borderRadius: m.who === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px', background: m.who === 'user' ? HERMES : 'white', color: m.who === 'user' ? 'white' : '#374151', fontSize: 14, lineHeight: 1.5, boxShadow: m.who === 'bot' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{m.text}</div>
          </div>
        ))}
        {loading && <div style={{ display: 'flex', justifyContent: 'flex-start' }}><div style={{ padding: '10px 18px', borderRadius: '16px 16px 16px 4px', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', gap: 4, alignItems: 'center' }}><Dots /></div></div>}
      </div>
      {!finished ? (
        <div style={{ padding: '10px 12px', borderTop: '1px solid #e5e7eb', background: 'white', display: 'flex', flexDirection: 'column', gap: 8, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey} placeholder="Type your thoughts..." disabled={loading} rows={1}
              style={{ flex: 1, resize: 'none', border: '1px solid #e5e7eb', borderRadius: 12, padding: '10px 14px', fontSize: 14, outline: 'none', maxHeight: 120, lineHeight: 1.4, background: loading ? '#f9fafb' : 'white' }}
              onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px' }} />
            <button onClick={() => handleSend()} disabled={loading || !input.trim()}
              style={{ width: 40, height: 40, borderRadius: 12, border: 'none', background: input.trim() ? HERMES : '#e5e7eb', color: 'white', fontSize: 18, cursor: input.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{'\u2191'}</button>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => handleSend(undefined, true)} disabled={loading} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 12, cursor: 'pointer', padding: '2px 8px' }}>{display.skip_label || "I'd rather not answer that"}</button>
            <span style={{ color: '#e5e7eb', fontSize: 12 }}>|</span>
            <button onClick={handleDone} disabled={loading} style={{ background: 'none', border: 'none', color: '#9ca3af', fontSize: 12, cursor: 'pointer', padding: '2px 8px' }}>{display.done_label || "I'm done sharing"}</button>
          </div>
        </div>
      ) : (
        <div style={{ padding: '16px 12px', borderTop: '1px solid #e5e7eb', background: 'white', textAlign: 'center', flexShrink: 0 }}><p style={{ color: '#9ca3af', fontSize: 13 }}>Conversation ended</p></div>
      )}
      <style>{`@keyframes th-dot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-6px); opacity: 1; } }`}</style>
    </div>
  )
}

function Screen({ children }: { children: React.ReactNode }) {
  return <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', padding: 20 }}><div style={{ textAlign: 'center' }}>{children}</div></div>
}

function Dots() {
  return (
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      {[0, 1, 2].map(i => <div key={i} style={{ width: 7, height: 7, borderRadius: '50%', background: '#d1d5db', animation: 'th-dot 1.2s ease-in-out infinite', animationDelay: (i * 0.2) + 's' }} />)}
      <style>{`@keyframes th-dot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.4; } 30% { transform: translateY(-4px); opacity: 1; } }`}</style>
    </div>
  )
}
