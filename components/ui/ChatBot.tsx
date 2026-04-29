'use client'

// components/ui/ChatBot.tsx
// Shared chatbot UI component used by /bot, /clara, /nora pages.
// All branding, colors, and content are passed via config props.

import { useState, useRef, useEffect, useMemo } from 'react'
import SanjayModal, { checkVerboseCommand } from './SanjayModal'

function genSessionId() {
  return 'bs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  _debug?: string[]
}

export interface ChatBotConfig {
  apiEndpoint: string
  name: string
  subtitle: string
  avatarLetter: string
  headerGradient: string
  avatarGradient: string
  avatarTextColor?: string
  accentColor: string
  pageBg: string
  userBubbleBg: string
  websiteUrl: string
  websiteLabel: string
  placeholder: string
  fontFamily?: string
  suggestions: string[]
  initialMessage: string
  askName?: boolean
  languages?: string[]
  language?: string
}

const LANG_LABELS: Record<string, { name: string; native: string }> = {
  en: { name: 'English', native: 'English' },
  es: { name: 'Spanish', native: 'Español' },
  fr: { name: 'French', native: 'Français' },
  de: { name: 'German', native: 'Deutsch' },
  pt: { name: 'Portuguese', native: 'Português' },
  it: { name: 'Italian', native: 'Italiano' },
  zh: { name: 'Chinese', native: '中文' },
  ja: { name: 'Japanese', native: '日本語' },
  ko: { name: 'Korean', native: '한국어' },
  ar: { name: 'Arabic', native: 'العربية' },
  hi: { name: 'Hindi', native: 'हिन्दी' },
  vi: { name: 'Vietnamese', native: 'Tiếng Việt' },
  tl: { name: 'Filipino', native: 'Filipino' },
  ru: { name: 'Russian', native: 'Русский' },
  pl: { name: 'Polish', native: 'Polski' },
  ht: { name: 'Haitian Creole', native: 'Kreyòl ayisyen' },
}

// Simple name validation — block profanity/slurs without importing the full content guard (client-side)
const BAD_NAME_PATTERNS = [
  /\b(f+u+c+k|c+u+n+t|shit|bitch|asshole|bastard|dick|cock|pussy|damn|hell|crap)\w*/i,
  /\b(n+i+g+\w*|f+a+g+\w*|r+e+t+a+r+d\w*|sp[i1]c[ks]?|ch[i1]nk|k[i1]ke)\b/i,
  /\b(kill|murder|rape|bomb)\b/i,
]

function isCleanName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length < 1 || trimmed.length > 40) return false
  return !BAD_NAME_PATTERNS.some(p => p.test(trimmed))
}

export default function ChatBot({ config }: { config: ChatBotConfig }) {
  const askName = config.askName !== false // default ON
  const multiLang = Array.isArray(config.languages) && config.languages.length > 1
  const [selectedLang, setSelectedLang] = useState<string | null>(multiLang ? null : (config.language || 'en'))
  const isNonEnglish = selectedLang !== null && selectedLang !== 'en'

  const EN_INITIAL: Message = {
    role: 'assistant',
    content: askName
      ? "Hi, I'm " + config.name + "! What's your name?"
      : config.initialMessage,
  }
  const [messages, setMessages] = useState<Message[]>([EN_INITIAL])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [debugMode, setDebugMode] = useState(false)
  const [showVerboseAuth, setShowVerboseAuth] = useState(false)
  const [userName, setUserName] = useState<string | null>(askName ? null : '_skip')
  const sessionId = useMemo(() => genSessionId(), [])

  // When a non-English language is selected, fetch the greeting from the API in that language
  useEffect(() => {
    if (!isNonEnglish) return
    setMessages([])
    setLoading(true)
    const greetPrompt = askName
      ? 'Greet the user warmly and ask for their name. Keep it to one short sentence.'
      : 'Greet the user warmly. Keep it to one short sentence.'
    fetch(config.apiEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: greetPrompt }], session_id: sessionId, language: selectedLang }),
    })
      .then(r => r.json())
      .then(data => {
        setMessages([{ role: 'assistant', content: data.reply || config.initialMessage }])
      })
      .catch(() => {
        setMessages([{ role: 'assistant', content: config.initialMessage }])
      })
      .finally(() => setLoading(false))
  }, [selectedLang])

  const resetChat = () => {
    setMessages([EN_INITIAL])
    setInput('')
    setLoading(false)
    setUserName(askName ? null : '_skip')
    if (multiLang) setSelectedLang(null)
  }
  const rootRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastMsgRef = useRef<HTMLDivElement>(null)

  const scrollBottom = () => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }

  // On iOS (Safari & Chrome), when the keyboard opens the visual viewport shrinks
  // but position:fixed elements still reference the full layout viewport.
  // We track visualViewport size and offset to keep the container in view.
  useEffect(() => {
    const vv = window.visualViewport
    const el = rootRef.current
    if (!vv || !el) return
    const onViewport = () => {
      el.style.height = vv.height + 'px'
      el.style.top = vv.offsetTop + 'px'
      scrollBottom()
    }
    vv.addEventListener('resize', onViewport)
    vv.addEventListener('scroll', onViewport)
    return () => { vv.removeEventListener('resize', onViewport); vv.removeEventListener('scroll', onViewport) }
  }, [])

  useEffect(() => {
    scrollBottom()
    setTimeout(scrollBottom, 100)
  }, [messages, loading, scrollBottom])

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return

    // Check for verbose/sanjay commands
    const cmd = checkVerboseCommand(text.trim())
    if (cmd === 'bypass') { setInput(''); setDebugMode(true); return }
    if (cmd === 'auth') { setInput(''); setShowVerboseAuth(true); return }

    // Name capture step — before first real chat message (only if askName is on)
    if (userName === null) {
      const name = text.trim()
      setMessages(prev => [...prev, { role: 'user', content: name }])
      setInput('')
      if (!isCleanName(name)) {
        if (isNonEnglish) {
          setLoading(true)
          fetch(config.apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'The user gave an inappropriate name. Ask them to try a different name. One sentence.' }], session_id: sessionId, language: selectedLang }),
          }).then(r => r.json()).then(data => {
            setMessages(prev => [...prev, { role: 'assistant', content: data.reply || "Let's try a different name." }])
          }).finally(() => setLoading(false))
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: "Let's try a different name — what would you like me to call you?" }])
        }
      } else {
        const cleanName = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        setUserName(cleanName)
        if (isNonEnglish) {
          setLoading(true)
          fetch(config.apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ messages: [{ role: 'user', content: 'My name is ' + cleanName + '. Greet me by name and ask how you can help. One sentence.' }], session_id: sessionId, language: selectedLang, user_name: cleanName }),
          }).then(r => r.json()).then(data => {
            setMessages(prev => [...prev, { role: 'assistant', content: data.reply || ('Great to meet you, ' + cleanName + '!') }])
          }).finally(() => setLoading(false))
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: 'Great to meet you, ' + cleanName + '! How can I help you today?' }])
        }
      }
      setTimeout(() => inputRef.current?.focus(), 100)
      return
    }

    const userMsg: Message = { role: 'user', content: text.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      // Filter out the name-ask exchange from API messages to keep context clean
      const apiMessages = newMessages
        .filter(m => m.content !== EN_INITIAL.content)
        .map(m => ({ role: m.role, content: m.content }))

      const res = await fetch(config.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          session_id: sessionId,
          debug: debugMode || undefined,
          user_name: userName && userName !== '_skip' ? userName : undefined,
          language: selectedLang || undefined,
        }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply || 'Sorry, something went wrong.', _debug: data._debug }])
    } catch {
      setMessages(prev => [...prev, { role: 'assistant', content: "I'm having trouble connecting. Please try again." }])
    } finally {
      setLoading(false)
      setTimeout(() => inputRef.current?.focus(), 100)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  const formatHtml = (content: string) => {
    // Step 1: Convert markdown links [text](url) first — replace with placeholder tokens
    const mdLinks: string[] = []
    let out = content.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) => {
      mdLinks.push('<a href="' + url + '" target="_blank" rel="noopener noreferrer" style="color:#00b4d8;text-decoration:underline">' + text + '</a>')
      return '\x00ML' + (mdLinks.length - 1) + '\x00'
    })
    // Step 2: Format the rest
    out = out
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>')
      .replace(/- /g, '&bull; ')
      // Full URLs with protocol (won't match placeholders)
      .replace(/(https?:\/\/[^\s<)]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#00b4d8;text-decoration:underline">$1</a>')
      // Email addresses
      .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<a href="mailto:$1" style="color:inherit;text-decoration:underline">$1</a>')
      // Bare domains — expanded TLD list
      .replace(/(?<![/@\w".])((?:[a-zA-Z0-9-]+\.)+(?:com|org|net|ai|io|gov|edu|us|co|info|biz|mil)(?:\/[^\s<)]*)?)/g, '<a href="https://$1" target="_blank" rel="noopener noreferrer" style="color:#00b4d8;text-decoration:underline">$1</a>')
    // Step 3: Restore markdown link placeholders
    for (let i = 0; i < mdLinks.length; i++) {
      out = out.replace('\x00ML' + i + '\x00', mdLinks[i])
    }
    return out
  }

  return (
    <div ref={rootRef} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: config.pageBg, display: 'flex', flexDirection: 'column', fontFamily: config.fontFamily, overflow: 'hidden', maxWidth: '100vw' }}>
      {/* Header */}
      <header style={{
        background: config.headerGradient,
        padding: '12px 12px',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        overflow: 'hidden',
      }}>
        <div style={{
          width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
          background: config.avatarGradient,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.1rem', fontWeight: 700,
          color: config.avatarTextColor || 'white',
        }}>
          {config.avatarLetter}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'white', fontWeight: 700, fontSize: '0.875rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{config.name}</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.625rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{config.subtitle}</div>
        </div>
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          {messages.length > 1 && (
            <button onClick={resetChat} style={{
              padding: '4px 10px', borderRadius: 16, border: '1px solid rgba(255,255,255,0.3)',
              background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: '0.625rem',
              fontWeight: 500, cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
              whiteSpace: 'nowrap',
            }}>New</button>
          )}
          {config.websiteLabel && (
            <a href={config.websiteUrl} target="_blank" rel="noopener noreferrer"
              style={{ color: 'rgba(255,255,255,0.35)', fontSize: '0.5625rem', textDecoration: 'none', fontFamily: 'system-ui, sans-serif', whiteSpace: 'nowrap' }}>
              {config.websiteLabel}
            </a>
          )}
        </div>
      </header>

      {/* Verbose mode banner */}
      {debugMode && (
        <div style={{ background: '#FEF3C7', borderBottom: '1px solid #FDE68A', padding: '4px 16px', fontSize: '0.6875rem', color: '#92400E', fontWeight: 600, flexShrink: 0, textAlign: 'center' }}>
          Running in verbose mode — AI reasoning visible
        </div>
      )}

      {/* Language selector — shown before chat when multi-language is enabled */}
      {multiLang && selectedLang === null && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', gap: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>{config.avatarLetter}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>Choose your language</div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Select the language you'd like to chat in</div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%', maxWidth: 320 }}>
            {(config.languages || []).map(function(code) {
              var label = LANG_LABELS[code] || { name: code, native: code }
              return (
                <button key={code} onClick={function() { setSelectedLang(code) }}
                  style={{
                    padding: '12px 20px', borderRadius: 12,
                    border: '1.5px solid #e5e7eb', background: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    cursor: 'pointer', fontSize: 14, fontWeight: 500,
                    transition: 'all 0.15s',
                  }}
                  onMouseEnter={function(e) { (e.currentTarget as HTMLElement).style.borderColor = config.accentColor; (e.currentTarget as HTMLElement).style.background = '#f9fafb' }}
                  onMouseLeave={function(e) { (e.currentTarget as HTMLElement).style.borderColor = '#e5e7eb'; (e.currentTarget as HTMLElement).style.background = 'white' }}
                >
                  <span style={{ color: '#111827' }}>{label.native}</span>
                  {label.native !== label.name && <span style={{ color: '#9ca3af', fontSize: 12 }}>{label.name}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Chat area */}
      {(selectedLang !== null || !multiLang) && <div ref={chatRef} style={{
        flex: 1, overflowY: 'auto', overflowX: 'hidden', minHeight: 0, padding: '12px 12px',
        display: 'flex', flexDirection: 'column', gap: 12,
        width: '100%', boxSizing: 'border-box' as const,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {messages.map((msg, i) => (
          <div key={i} ref={i === messages.length - 1 ? lastMsgRef : undefined}>
            <div style={{
              display: 'flex',
              justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
              gap: 8,
            }}>
              {msg.role === 'assistant' && (
                <div style={{
                  width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                  background: config.avatarGradient,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: '0.875rem', color: config.avatarTextColor || 'white', fontWeight: 700,
                }}>{config.avatarLetter}</div>
              )}
              <div style={{
                maxWidth: '80%',
                padding: '12px 16px',
                borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                background: msg.role === 'user' ? config.userBubbleBg : 'white',
                color: msg.role === 'user' ? 'white' : '#1a1a1a',
                fontSize: '0.9rem',
                lineHeight: 1.6,
                border: msg.role === 'assistant' ? '1px solid #e5e7eb' : 'none',
                boxShadow: msg.role === 'assistant' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
                whiteSpace: 'pre-wrap', overflowWrap: 'break-word' as const, wordBreak: 'break-word' as const,
              }}
                dangerouslySetInnerHTML={{ __html: formatHtml(msg.content) }}
              />
            </div>
            {debugMode && msg._debug && msg._debug.length > 0 && (
              <div style={{ margin: '4px 0 6px 40px', padding: '8px 12px', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 12, fontSize: '0.6875rem', color: '#92400e', lineHeight: 1.5, maxWidth: '85%' }}>
                <div style={{ fontWeight: 700, fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, color: '#78350f' }}>AI Thinking</div>
                {msg._debug.map((line, j) => <div key={j} style={{ marginBottom: 2 }}>{line}</div>)}
              </div>
            )}
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: config.avatarGradient,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.875rem', color: config.avatarTextColor || 'white', fontWeight: 700,
            }}>{config.avatarLetter}</div>
            <div style={{
              padding: '12px 20px', borderRadius: '18px 18px 18px 4px',
              background: 'white', border: '1px solid #e5e7eb',
              display: 'flex', gap: 6, alignItems: 'center',
            }}>
              <span className="chatbot-typing-dot" style={{ animationDelay: '0ms' }} />
              <span className="chatbot-typing-dot" style={{ animationDelay: '200ms' }} />
              <span className="chatbot-typing-dot" style={{ animationDelay: '400ms' }} />
            </div>
          </div>
        )}

        {/* Suggestion chips — only show at start */}
        {messages.length <= 1 && !loading && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {config.suggestions.map((s, i) => (
              <button key={i} onClick={() => sendMessage(s)}
                style={{
                  padding: '8px 16px', borderRadius: 20,
                  background: 'white', border: '1.5px solid #e5e7eb',
                  color: '#4b5563', fontSize: '0.8125rem', fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = config.accentColor; (e.target as HTMLElement).style.color = config.accentColor }}
                onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = '#e5e7eb'; (e.target as HTMLElement).style.color = '#4b5563' }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>}

      {/* Input area — hidden during language selection */}
      {(selectedLang !== null || !multiLang) && <div style={{
        flexShrink: 0,
        padding: '10px 12px',
        paddingBottom: 'max(10px, env(safe-area-inset-bottom))',
        borderTop: '1px solid #e5e7eb',
        background: 'white',
      }}>
        <div style={{
          maxWidth: 800, margin: '0 auto',
          display: 'flex', gap: 8, alignItems: 'flex-end',
        }}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={config.placeholder}
            rows={1}
            style={{
              flex: 1, width: 0, minWidth: 0, boxSizing: 'border-box' as const,
              resize: 'none',
              padding: '10px 14px', borderRadius: 24,
              border: '1.5px solid #e5e7eb', outline: 'none',
              fontSize: '16px', fontFamily: 'inherit',
              lineHeight: 1.5, maxHeight: 120,
              background: '#f9fafb',
            }}
            onFocus={e => { (e.target as HTMLElement).style.borderColor = config.accentColor }}
            onBlur={e => (e.target as HTMLElement).style.borderColor = '#e5e7eb'}
            onInput={e => {
              const t = e.target as HTMLTextAreaElement
              t.style.height = 'auto'
              t.style.height = Math.min(t.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={!input.trim() || loading}
            style={{
              width: 42, height: 42, borderRadius: '50%',
              background: input.trim() && !loading ? config.userBubbleBg : '#e5e7eb',
              color: input.trim() && !loading ? 'white' : '#9ca3af',
              border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.1rem', fontWeight: 700, flexShrink: 0,
              transition: 'all 0.15s',
            }}
          >
            ↑
          </button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <span style={{ color: '#9ca3af', fontSize: '0.6875rem' }}>
            Powered by <a href="https://www.datanautix.com" target="_blank" rel="noopener noreferrer"
              style={{ color: '#6b7280', fontWeight: 600, textDecoration: 'none' }}>Datanautix</a>
          </span>
        </div>
      </div>}

      <style>{`
        @keyframes chatbotDotPulse {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        .chatbot-typing-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: ${config.accentColor}; display: inline-block;
          animation: chatbotDotPulse 1.4s infinite ease-in-out both;
        }
      `}</style>

      {showVerboseAuth && (
        <SanjayModal
          onSuccess={() => { setDebugMode(true); setShowVerboseAuth(false) }}
          onCancel={() => setShowVerboseAuth(false)}
        />
      )}
    </div>
  )
}
