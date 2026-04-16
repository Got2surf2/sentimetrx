'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { SUPPORTED_LANGUAGES } from '@/lib/types'
import type { DemoField, PsychoQuestion } from '@/lib/types'

type Phase = 'chat' | 'transition' | 'psycho' | 'demo' | 'submitting' | 'done'
interface Message { who: 'bot' | 'user'; text: string; italic?: boolean; _debug?: string[] }
interface Props { sessionId: string }

const IMSG_BLUE = '#007AFF'
const IMSG_GRAY = '#E9E9EB'
const BG = '#FFFFFF'

// Client-side bleep — replace profanity with asterisks for display
function clientBleep(text: string): string {
  return text
    .replace(/\b(f+u+c+k\w*|c+u+n+t+s?|motherf\w*)\b/gi, m => m[0] + '*'.repeat(Math.max(1, m.length - 2)) + m[m.length - 1])
    .replace(/\b(shit\w*|bullshit|bitch\w*|bastard[s]?|asshole[s]?)\b/gi, m => m[0] + '*'.repeat(Math.max(1, m.length - 2)) + m[m.length - 1])
    .replace(/\b(n[i1]gg\w*|sp[i1]c[ks]?|ch[i1]nk[s]?|k[i1]ke[s]?|f[a4]gg\w*|r[e3]t[a4]rd\w*)\b/gi, m => m[0] + '*'.repeat(Math.max(1, m.length - 2)) + m[m.length - 1])
    .replace(/\b(dumbass\w*|idiot[s]?|moron[s]?)\b/gi, m => m[0] + '*'.repeat(Math.max(1, m.length - 2)) + m[m.length - 1])
    .replace(/\b(screw\s*you|piss\s*off|bite\s*me|eat\s*shit)\b/gi, m => m[0] + '*'.repeat(Math.max(1, m.length - 2)) + m[m.length - 1])
}

// Mimic agent typing — 30ms per char, clamped 400–1800ms (matches survey engine)
function typingDelay(text: string) {
  const dur = Math.max(400, Math.min(1800, text.length * 30))
  return new Promise(r => setTimeout(r, dur))
}

export default function TownHallChat({ sessionId }: Props) {
  const searchParams = useSearchParams()
  const urlDebugPwd = searchParams.get('debug') || ''

  // Session info — fetched via GET /api/townhall/join/:id
  const [sessionName, setSessionName] = useState('')
  const [botName, setBotName] = useState('Town Hall')
  const [botEmoji, setBotEmoji] = useState('\uD83D\uDCAC')
  const [status, setStatus] = useState<'loading' | 'setup' | 'active' | 'paused' | 'ended' | 'notfound'>('loading')
  const [display, setDisplay] = useState<any>({})
  const [closingMsg, setClosingMsg] = useState('')
  const [languages, setLanguages] = useState<string[]>([])
  const [selectedLang, setSelectedLang] = useState<string | null>(null)

  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [joined, setJoined] = useState(false)
  const [phase, setPhase] = useState<Phase>('chat')
  const [pid, setPid] = useState('')
  const [resolvedId, setResolvedId] = useState(sessionId) // UUID from join — slug resolved server-side
  const [turn, setTurn] = useState(0)
  const [themeId, setThemeId] = useState<string | null>(null)

  // Post-session question state
  const [demoFields, setDemoFields] = useState<DemoField[]>([])
  const [psychoBank, setPsychoBank] = useState<PsychoQuestion[]>([])
  const [psychoCount, setPsychoCount] = useState(3)
  const [psychoQuestions, setPsychoQuestions] = useState<PsychoQuestion[]>([])
  const [psychoIdx, setPsychoIdx] = useState(0)
  const [psychoAnswers, setPsychoAnswers] = useState<Record<string, string>>({})
  const [demoAnswers, setDemoAnswers] = useState<Record<string, string>>({})
  const [botMessages, setBotMessages] = useState({ post_session_intro: '', post_session_demo: '', post_session_thanks: '' })
  const [testing, setTesting] = useState(false)
  const [debugMode, setDebugMode] = useState(false)

  const finished = phase !== 'chat'

  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const joiningRef = useRef(false)

  const hasScrolledRef = useRef(false)
  const scroll = useCallback(() => {
    const el = chatRef.current
    if (!el) return
    // Don't auto-scroll on first message — let user see prologue from the top
    if (!hasScrolledRef.current && messages.length <= 1) return
    hasScrolledRef.current = true
    // Scroll so the last message's top is visible (not the absolute bottom)
    // This ensures long messages show from their start and the input stays reachable
    setTimeout(() => {
      const lastMsg = el.lastElementChild as HTMLElement
      if (lastMsg) { lastMsg.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
      else { el.scrollTop = el.scrollHeight }
    }, 80)
  }, [messages.length])

  useEffect(() => { scroll() }, [messages, loading, scroll])
  useEffect(() => { if (!loading && joined && phase === 'chat') inputRef.current?.focus() }, [loading, joined, phase])

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
      setBotName(d.bot_name || 'Town Hall')
      setBotEmoji(d.bot_emoji || '\uD83D\uDCAC')
      setLanguages(d.languages || [])
      setDisplay(d.display || {})
      setClosingMsg(d.closing_message || '')
      if (d.opening_message) setDisplay((prev: any) => ({ ...prev, opening_message: d.opening_message }))
      if (d.bot_messages) setBotMessages(d.bot_messages)
      if (d.demoFields) setDemoFields(d.demoFields.filter((f: DemoField) => f.enabled))
      if (d.psychographicBank) setPsychoBank(d.psychographicBank)
      if (d.psychoCount != null) setPsychoCount(d.psychoCount)
      if (d.testing) setTesting(true)
      if (d.status === 'active') {
        setStatus('active')
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      } else if (d.status === 'ended') {
        setStatus('ended')
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      } else if (d.status === 'paused') {
        setStatus('paused')
        // Keep polling — session may resume
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
      const lang = selectedLang || 'en'
      const r = await fetch('/api/townhall/join/' + sessionId, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language: lang, debug_password: urlDebugPwd || undefined }),
      })
      const d = await r.json()
      if (d.error) {
        if (d.status === 'setup') { setStatus('setup'); setLoading(false); return }
        setMessages([{ who: 'bot', text: d.error }]); setPhase('done'); setLoading(false); return
      }
      if (d.session_id) setResolvedId(d.session_id)
      setPid(d.participant_id); setTurn(d.turn_number); setThemeId(d.theme_id)
      // Store translated messages + psycho/demo from join response
      if (d.bot_messages) setBotMessages(d.bot_messages)
      if (d.closing_message) setClosingMsg(d.closing_message)
      if (d.psychographicBank) setPsychoBank(d.psychographicBank)
      if (d.demoFields) setDemoFields(d.demoFields.filter((f: DemoField) => f.enabled))
      if (d.debug_mode) { setDebugMode(true); setTesting(true); console.log('%c[DEBUG MODE ACTIVE]', 'color: #E8632A; font-weight: bold; font-size: 14px', 'Session ID matched — verbose AI reasoning enabled') }
      setJoined(true)
      // Show typing dots, then reveal message
      setLoading(true)
      await typingDelay(d.bot_message)
      setLoading(false)
      setMessages([{ who: 'bot', text: d.bot_message }])
      if (d.is_final) await startPostSession()
    } catch { setMessages([{ who: 'bot', text: 'Something went wrong. Please try again.' }]) }
    setLoading(false)
  }

  // Send
  const handleSend = async (text?: string, skip?: boolean) => {
    const msg = text || input.trim()
    if (!msg && !skip) return
    if (loading || finished) return
    const isDebugCmd = /^#debug\s/i.test(msg)
    if (skip) { setMessages(p => [...p, { who: 'user', text: display.skip_label || "I'd rather not answer that", italic: true }]) }
    else if (!isDebugCmd) { setMessages(p => [...p, { who: 'user', text: clientBleep(msg) }]) }
    setInput('')
    setLoading(true)
    try {
      const r = await fetch('/api/townhall/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: resolvedId, participant_id: pid, message: skip ? '' : msg, turn_number: turn, theme_id: themeId, skipped: !!skip, language: selectedLang || 'en', debug: debugMode || undefined }),
      })
      const d = await r.json()
      // Handle debug mode toggle
      // Handle debug mode toggle — don't add duplicate bot message
      if (d.debug_mode === true) { setDebugMode(true); setTesting(true); console.log('%c[DEBUG MODE ON]', 'color: #E8632A; font-weight: bold'); setLoading(false); return }
      if (d.debug_mode === false) { setDebugMode(false); setTesting(false); console.log('%c[DEBUG MODE OFF]', 'color: #6b7280; font-weight: bold'); setLoading(false); return }
      setTurn(d.turn_number); setThemeId(d.theme_id)
      // Handle language switch — update language for future messages
      if (d.language_switched) setSelectedLang(d.language_switched)
      // Typing dots are already showing (loading=true) — wait for realistic duration
      await typingDelay(d.bot_message)
      setMessages(p => [...p, { who: 'bot', text: d.bot_message, ...(d._debug ? { _debug: d._debug } : {}) }])
      if (d.is_final) await startPostSession()
    } catch { setMessages(p => [...p, { who: 'bot', text: 'Something went wrong. Let me try again — what were you saying?' }]) }
    setLoading(false)
  }

  // Start post-session flow: transition → psycho → demo → done
  const startPostSession = useCallback(async () => {
    const hasPsycho = psychoBank.length > 0 && psychoCount > 0
    const hasDemo = demoFields.length > 0
    if (!hasPsycho && !hasDemo) {
      setPhase('done')
      return
    }

    // Show intro message before first post-session question
    setPhase('transition')
    const introMsg = botMessages.post_session_intro || 'Almost done — a few quick optional questions to help us understand who we heard from today.'
    setLoading(true)
    await typingDelay(introMsg)
    setLoading(false)
    setMessages(p => [...p, { who: 'bot', text: introMsg }])

    if (hasPsycho) {
      // Pick random psycho questions
      const pool = [...psychoBank]
      const picked: PsychoQuestion[] = []
      const n = Math.min(psychoCount, pool.length)
      while (picked.length < n && pool.length > 0) {
        const idx = Math.floor(Math.random() * pool.length)
        picked.push(...pool.splice(idx, 1))
      }
      setPsychoQuestions(picked)
      setPsychoIdx(0)
      setPhase('psycho')
    } else if (hasDemo) {
      // Skip straight to demo — intro message already shown above
      setPhase('demo')
    } else {
      setPhase('done')
    }
  }, [psychoBank, psychoCount, demoFields, botMessages])

  const handleDone = async () => {
    setMessages(p => [...p, { who: 'user', text: display.done_label || "I'm done sharing", italic: true }])
    const msg = closingMsg || display.thank_you_message || 'Thank you for your time. Your voice matters.'
    setLoading(true)
    await typingDelay(msg)
    setLoading(false)
    setMessages(p => [...p, { who: 'bot', text: msg }])
    fetch('/api/townhall/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: resolvedId, participant_id: pid, message: '[done]', turn_number: turn, theme_id: themeId, skipped: true }),
    }).catch(() => {})
    await startPostSession()
  }

  const submitPostSession = async (psycho: Record<string, string>, demo: Record<string, string>) => {
    setPhase('submitting')
    try {
      await fetch('/api/townhall/responses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: resolvedId, participant_id: pid, psychographics: psycho, demographics: demo }),
      })
    } catch { /* silently fail — don't block the thank-you screen */ }
    const thankMsg = closingMsg || botMessages.post_session_thanks || 'Thanks for sharing! Your input helps us understand our community better.'
    setLoading(true)
    await typingDelay(thankMsg)
    setLoading(false)
    setMessages(p => [...p, { who: 'bot', text: thankMsg }])
    setPhase('done')
  }

  const onKey = (e: React.KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }

  // --- RENDER ---

  if (status === 'loading') return <Screen>{'\u23F3'} Loading...</Screen>
  if (status === 'notfound') return <Screen>Session not found.</Screen>

  if (status === 'setup' || (status === 'paused' && !joined)) {
    return (
      <Screen>
        <div style={{ width: 64, height: 64, borderRadius: '50%', background: '#C7C7CC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, marginBottom: 12 }}>{botEmoji}</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#374151', marginBottom: 4 }}>{sessionName}</h2>
        <p style={{ color: '#9ca3af', fontSize: 14, marginBottom: 16 }}>
          {status === 'setup' ? 'Stand by — the town hall hasn\'t started yet.' : 'Session is paused. Please wait...'}
        </p>
        <p style={{ color: '#d1d5db', fontSize: 12 }}>This page will update automatically when the session begins.</p>
        <div style={{ marginTop: 16 }}><Dots /></div>
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

  // Language selection — multiple languages configured and not yet selected
  if (!joined && languages.length > 1 && !selectedLang) {
    const langOptions = SUPPORTED_LANGUAGES.filter(l => languages.includes(l.code))
    return (
      <div ref={wrapRef} style={{ height: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: BG, padding: 24 }}>
        <div style={{ textAlign: 'center', maxWidth: 400, width: '100%' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>{botEmoji}</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: '#111827', marginBottom: 8 }}>{sessionName}</h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>Choose your language:</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 280, margin: '0 auto' }}>
            {langOptions.map(l => (
              <button key={l.code} onClick={() => setSelectedLang(l.code)}
                style={{ padding: '12px 16px', borderRadius: 12, border: '1px solid #E0E0E0', background: 'white', fontSize: 15, fontWeight: 500, color: '#111827', cursor: 'pointer', textAlign: 'left', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{l.nativeName}</span>
                {l.nativeName !== l.name && <span style={{ fontSize: 12, color: '#9ca3af' }}>{l.name}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // Auto-select English if single language or none configured
  if (!selectedLang && languages.length <= 1) {
    if (typeof window !== 'undefined') setTimeout(() => setSelectedLang(languages[0] || 'en'), 0)
    return <Screen>Loading...</Screen>
  }

  // Auto-join once language is selected — skip landing page
  if (!joined && selectedLang && !loading && status === 'active' && !joiningRef.current) {
    joiningRef.current = true
    setTimeout(() => handleJoin(), 0)
    return <Screen><Dots /></Screen>
  }
  if (!joined && joiningRef.current) {
    return <Screen><Dots /></Screen>
  }

  return (
    <div ref={wrapRef} style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: BG }}>
      {/* iMessage-style header */}
      <div style={{ padding: '10px 16px 10px', background: '#F6F6F6', borderBottom: '1px solid #E0E0E0', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, flexDirection: 'column' }}>
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: '#C7C7CC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, marginBottom: 2 }}>{botEmoji}</div>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#000' }}>{botName}</div>
      </div>

      {/* Debug mode banner */}
      {testing && (
        <div style={{ background: '#FEF3C7', borderBottom: '1px solid #FDE68A', padding: '4px 16px', fontSize: 11, color: '#92400E', fontWeight: 600, flexShrink: 0, textAlign: 'center' }}>
          Running in debug mode — AI reasoning visible
        </div>
      )}

      {/* Chat area */}
      <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        {messages.map((m, i) => (
          <div key={i}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, justifyContent: m.who === 'user' ? 'flex-end' : 'flex-start' }}>
              {m.who === 'bot' && (
                <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#C7C7CC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{botEmoji}</div>
              )}
              <div style={{
                maxWidth: '75%', padding: '9px 14px',
                borderRadius: m.who === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: m.who === 'user' ? (m.italic ? '#E5E5EA' : IMSG_BLUE) : IMSG_GRAY,
                color: m.who === 'user' ? (m.italic ? '#8E8E93' : 'white') : '#000',
                fontSize: m.italic ? 14 : 16, lineHeight: 1.4, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                fontStyle: m.italic ? 'italic' : 'normal',
              }}>{m.text}</div>
            </div>
            {testing && m._debug && m._debug.length > 0 && (
              <div style={{ margin: '4px 0 6px 8px', padding: '8px 12px', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 12, fontSize: 11, color: '#92400e', lineHeight: 1.5, maxWidth: '85%' }}>
                <div style={{ fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, color: '#78350f' }}>AI Thinking</div>
                {m._debug.map((line, j) => <div key={j} style={{ marginBottom: 2 }}>{line}</div>)}
              </div>
            )}
          </div>
        ))}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, justifyContent: 'flex-start' }}>
            <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#C7C7CC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>{botEmoji}</div>
            <div style={{ padding: '12px 18px', borderRadius: '18px 18px 18px 4px', background: IMSG_GRAY, display: 'flex', gap: 5, alignItems: 'center' }}>
              <Dots />
            </div>
          </div>
        )}
      </div>

      {/* Input area — changes based on phase */}
      {phase === 'chat' ? (
        <div style={{ padding: '8px 10px', background: '#F6F6F6', borderTop: '1px solid #E0E0E0', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <textarea ref={inputRef} value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey} placeholder="iMessage" disabled={loading} rows={1}
              style={{ flex: 1, resize: 'none', border: '1px solid #C7C7CC', borderRadius: 20, padding: '9px 14px', fontSize: 16, outline: 'none', maxHeight: 120, lineHeight: 1.4, background: loading ? '#F6F6F6' : 'white' }}
              onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = Math.min(t.scrollHeight, 120) + 'px' }} />
            <button onClick={() => handleSend()} disabled={loading || !input.trim()}
              style={{ width: 34, height: 34, borderRadius: '50%', border: 'none', background: input.trim() ? IMSG_BLUE : '#C7C7CC', color: 'white', fontSize: 16, cursor: input.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'background 0.15s' }}>{'\u2191'}</button>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => handleSend(undefined, true)} disabled={loading} style={{ background: 'none', border: 'none', color: '#8E8E93', fontSize: 12, cursor: 'pointer', padding: '2px 8px' }}>{display.skip_label || "I'd rather not answer that"}</button>
            <span style={{ color: '#D1D1D6', fontSize: 12 }}>|</span>
            <button onClick={handleDone} disabled={loading} style={{ background: 'none', border: 'none', color: '#8E8E93', fontSize: 12, cursor: 'pointer', padding: '2px 8px' }}>{display.done_label || "I'm done sharing"}</button>
          </div>
        </div>
      ) : phase === 'psycho' && psychoQuestions[psychoIdx] ? (
        <div style={{ padding: '12px', background: '#F6F6F6', borderTop: '1px solid #E0E0E0', flexShrink: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 8, lineHeight: 1.4 }}>{psychoQuestions[psychoIdx].q}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {psychoQuestions[psychoIdx].opts.map(opt => (
              <button key={opt} onClick={async () => {
                const q = psychoQuestions[psychoIdx]
                setPsychoAnswers(p => ({ ...p, [q.key]: opt }))
                setMessages(p => [...p, { who: 'user', text: opt }])
                const nextIdx = psychoIdx + 1
                if (nextIdx < psychoQuestions.length) {
                  setPsychoIdx(nextIdx)
                  setLoading(true)
                  await typingDelay(psychoQuestions[nextIdx].q)
                  setLoading(false)
                } else if (demoFields.length > 0) {
                  setPhase('demo')
                  setLoading(true)
                  const demoMsg = botMessages.post_session_demo || 'A couple of optional questions about you.'
                  await typingDelay(demoMsg)
                  setMessages(p => [...p, { who: 'bot', text: demoMsg }])
                  setLoading(false)
                } else {
                  submitPostSession({ ...psychoAnswers, [q.key]: opt }, {})
                }
              }}
                style={{ textAlign: 'left', padding: '10px 14px', borderRadius: 12, border: '1.5px solid #E0E0E0', background: 'white', fontSize: 15, color: '#374151', cursor: 'pointer', transition: 'all 0.15s' }}
                onMouseOver={e => { (e.target as HTMLElement).style.borderColor = IMSG_BLUE; (e.target as HTMLElement).style.background = '#EBF5FF' }}
                onMouseOut={e => { (e.target as HTMLElement).style.borderColor = '#E0E0E0'; (e.target as HTMLElement).style.background = 'white' }}>
                {opt}
              </button>
            ))}
          </div>
          <button onClick={async () => {
            const nextIdx = psychoIdx + 1
            setMessages(p => [...p, { who: 'user', text: 'Skip' }])
            if (nextIdx < psychoQuestions.length) {
              setPsychoIdx(nextIdx)
            } else if (demoFields.length > 0) {
              setPhase('demo')
            } else {
              submitPostSession(psychoAnswers, {})
            }
          }} style={{ background: 'none', border: 'none', color: '#8E8E93', fontSize: 12, cursor: 'pointer', marginTop: 6, width: '100%', textAlign: 'center' }}>
            Skip this question
          </button>
        </div>
      ) : phase === 'demo' ? (
        <div style={{ padding: '12px', background: '#F6F6F6', borderTop: '1px solid #E0E0E0', flexShrink: 0, maxHeight: '50vh', overflowY: 'auto' }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 10 }}>Tell us a bit about yourself <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span></p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {demoFields.map(f => (
              <div key={f.key}>
                <label style={{ fontSize: 12, fontWeight: 600, color: '#6b7280', display: 'block', marginBottom: 4 }}>{f.label}</label>
                {f.type === 'select' && f.options ? (
                  <select value={demoAnswers[f.key] || ''} onChange={e => setDemoAnswers(p => ({ ...p, [f.key]: e.target.value }))}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #D1D5DB', fontSize: 14, background: 'white', color: '#374151', outline: 'none' }}>
                    <option value="">Select...</option>
                    {f.options.map(([val, label]) => <option key={val} value={val}>{label}</option>)}
                  </select>
                ) : (
                  <input type="text" value={demoAnswers[f.key] || ''} onChange={e => setDemoAnswers(p => ({ ...p, [f.key]: e.target.value }))} placeholder={f.label}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 10, border: '1px solid #D1D5DB', fontSize: 14, background: 'white', color: '#374151', outline: 'none', boxSizing: 'border-box' }} />
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={() => submitPostSession(psychoAnswers, demoAnswers)}
              style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', background: IMSG_BLUE, color: 'white', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
              Submit
            </button>
            <button onClick={() => submitPostSession(psychoAnswers, {})}
              style={{ padding: '11px 16px', borderRadius: 12, border: '1px solid #D1D5DB', background: 'white', color: '#8E8E93', fontSize: 14, cursor: 'pointer' }}>
              Skip
            </button>
          </div>
        </div>
      ) : phase === 'submitting' ? (
        <div style={{ padding: '16px 12px', background: '#F6F6F6', borderTop: '1px solid #E0E0E0', textAlign: 'center', flexShrink: 0 }}><p style={{ color: '#8E8E93', fontSize: 13 }}>Saving your responses...</p></div>
      ) : (
        <div style={{ padding: '16px 12px', background: '#F6F6F6', borderTop: '1px solid #E0E0E0', textAlign: 'center', flexShrink: 0 }}><p style={{ color: '#8E8E93', fontSize: 13 }}>Conversation ended</p></div>
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
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
      {[0, 1, 2].map(i => <div key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: '#8E8E93', animation: 'th-dot 1.4s ease-in-out infinite', animationDelay: (i * 0.2) + 's' }} />)}
      <style>{`@keyframes th-dot { 0%, 60%, 100% { transform: translateY(0); opacity: 0.3; } 30% { transform: translateY(-4px); opacity: 0.8; } }`}</style>
    </div>
  )
}
