'use client'

// components/ui/ChatBot.tsx
// Shared chatbot UI component used by /bot, /clara, /nora pages.
// All branding, colors, and content are passed via config props.

import { useState, useRef, useEffect, useMemo } from 'react'
import DOMPurify from 'isomorphic-dompurify'
import SanjayModal, { checkVerboseCommand } from './SanjayModal'

function genSessionId() {
  return 'bs_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8)
}

// Per-bot session id stored in localStorage so a respondent who refreshes,
// closes the tab, or hits a connectivity blip can resume the same
// conversation (lib/chatCore.ts has the server-side history; the rehydrate
// effect below fetches it on mount). One key per API endpoint so a
// respondent talking to two different agents in the same browser keeps
// distinct sessions.
function getOrCreateSessionId(apiEndpoint: string): string {
  if (typeof window === 'undefined') return genSessionId()
  const key = 'cb_sid_' + apiEndpoint
  try {
    const existing = window.localStorage.getItem(key)
    if (existing && /^[A-Za-z0-9_-]{8,80}$/.test(existing)) return existing
  } catch { /* localStorage disabled (private mode etc.) — fall through */ }
  const fresh = genSessionId()
  try { window.localStorage.setItem(key, fresh) } catch { /* swallow quota / disabled errors */ }
  return fresh
}

// Wrap fetch with a small retry-with-backoff so a transient network blip
// (WiFi flap, Vercel Function cold-start, brief Claude API timeout) doesn't
// surface as "I'm having trouble connecting" on the first try. Caller still
// catches the final exception if all retries fail; the retry-button UI
// below handles that case.
async function fetchWithRetry(url: string, options: RequestInit, retries = 2): Promise<Response> {
  let lastErr: unknown
  for (let i = 0; i <= retries; i++) {
    try { return await fetch(url, options) }
    catch (e) {
      lastErr = e
      if (i < retries) await new Promise(r => setTimeout(r, 600 * (i + 1)))
    }
  }
  throw lastErr
}

// Sentimetrx wordmark colors. Hermes orange against dark headers, Sarina
// blue against light ones — same brand colors used elsewhere (lib/constants
// HERMES, app/shared SARINA).
const HERMES_ORANGE = '#E8632A'
const SARINA_BLUE   = '#00B4D8'

function pickWordmarkColor(headerBg: string): string {
  // Pick the first hex color in the gradient/string and compute perceived
  // luminance (Rec. 709). > ~140 = light, use Sarina blue; else Hermes.
  const m = String(headerBg || '').match(/#([0-9a-fA-F]{3,8})/)
  if (!m) return HERMES_ORANGE
  let hex = m[1]
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('')
  if (hex.length < 6) return HERMES_ORANGE
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 140 ? SARINA_BLUE : HERMES_ORANGE
}

interface Message {
  role: 'user' | 'assistant'
  content: string
  _debug?: string[]
  _signals?: Array<{ label: string; type: string; color: string }>
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
  // Extra fields merged into every POST body sent to apiEndpoint. Used by
  // deployment-context plumbing — e.g. BotClient sets { site: 'foundations' }
  // from the URL ?site= param so the chat handler can bias retrieval and
  // the system prompt to the deploying site.
  extraBody?: Record<string, any>
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

const PLACEHOLDER_TRANSLATIONS: Record<string, string> = {
  en: 'Ask me anything...',
  es: 'Pregúntame lo que quieras...',
  fr: 'Posez-moi une question...',
  de: 'Frag mich was...',
  pt: 'Pergunte-me qualquer coisa...',
  it: 'Chiedimi qualcosa...',
  zh: '问我任何问题...',
  ja: '何でも聞いてください...',
  ko: '무엇이든 물어보세요...',
  ar: 'اسألني أي شيء...',
  hi: 'मुझसे कुछ भी पूछें...',
  vi: 'Hỏi tôi bất cứ điều gì...',
  tl: 'Magtanong ng kahit ano...',
  ru: 'Спросите меня о чём угодно...',
  pl: 'Zapytaj mnie o cokolwiek...',
  ht: 'Mande m nenpòt bagay...',
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

  // Opener flow: when askName is on, the FIRST message is a name-only ask;
  // the topical opener (config.initialMessage) is rendered as the SECOND message
  // after the user provides their name. Two clean prompts instead of one flaky
  // double-question.
  const EN_INITIAL: Message = {
    role: 'assistant',
    content: askName
      ? "Hi, I'm " + (config.name || 'there') + "! What's your name?"
      : config.initialMessage,
  }
  const [messages, setMessages] = useState<Message[]>([EN_INITIAL])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [debugMode, setDebugMode] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const [showVerboseAuth, setShowVerboseAuth] = useState(false)
  const [userName, setUserName] = useState<string | null>(askName ? null : '_skip')
  // Number of leading messages that belong to the name-capture exchange
  // (name-ask + user's name reply + topical opener). When > 0, the API call
  // for the user's first real message slices past these so the server sees
  // a clean turn 1.
  const [nameExchangeMessages, setNameExchangeMessages] = useState(0)
  // Tracks whether the user has sent their first "real" topic message
  // (not the name-capture step). Used solely to gate the suggestion chips
  // — chips show until the first real message, then disappear. The previous
  // gate (`messages.length <= 1`) broke for askName=true bots because by the
  // time userName was set the bot had already replied and length was 3.
  const [hasFirstMessage, setHasFirstMessage] = useState(false)
  const sessionId = useMemo(() => getOrCreateSessionId(config.apiEndpoint), [config.apiEndpoint])
  // Track the user's most recent failed send so we can offer a Retry button
  // when fetchWithRetry exhausts its attempts. Cleared on successful send
  // and on resetChat.
  const [lastFailedInput, setLastFailedInput] = useState<string | null>(null)

  // Widget-open beacon — fire once on mount so the Agent Study can count true
  // invocations (opens that never become conversations leave no turn rows).
  // Only fires for real bot endpoints (/api/bots/<id>/chat); clara/nora skip.
  const impressionFired = useRef(false)
  useEffect(() => {
    if (impressionFired.current) return
    const m = config.apiEndpoint.match(/^(\/api\/bots\/[^/]+)\/chat$/)
    if (!m) return
    impressionFired.current = true
    const eb = config.extraBody || {}
    try {
      fetch(m[1] + '/impression', {
        method: 'POST', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ visitor_id: sessionId, source: eb.site || eb.source, medium: eb.medium, campaign: eb.campaign }),
      }).catch(() => {})
    } catch { /* beacon is best-effort */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      body: JSON.stringify({ messages: [{ role: 'user', content: greetPrompt }], session_id: sessionId, language: selectedLang, ...(config.extraBody || {}) }),
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
    setHasFirstMessage(false)
    setNameExchangeMessages(0)
    setLastFailedInput(null)
    if (multiLang) setSelectedLang(null)
    // Clear the stored session id so the user starts a fresh conversation
    // — resetChat is the explicit "start over" surface.
    if (typeof window !== 'undefined') {
      try { window.localStorage.removeItem('cb_sid_' + config.apiEndpoint) } catch { /* */ }
    }
  }

  // On mount, try to rehydrate the conversation from the server using the
  // stored session_id. If turns exist, restore the full chat so the user
  // picks up exactly where they left off. Only works for bot endpoints
  // (matches the /api/bots/{id}/chat shape); other surfaces (clara/nora)
  // get a 404 and silently fall through to the fresh-chat state.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!/\/api\/bots\/[^/]+\/chat$/.test(config.apiEndpoint)) return
    const historyUrl = config.apiEndpoint.replace(/\/chat$/, '/session/' + encodeURIComponent(sessionId) + '/turns')
    let cancelled = false
    fetch(historyUrl)
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (cancelled) return
        if (!data || !Array.isArray(data.turns) || data.turns.length === 0) return
        const hydrated: Message[] = data.turns.map((t: { role: string; content: string }) => ({
          role: t.role === 'user' ? 'user' : 'assistant',
          content: t.content,
        }))
        setMessages(hydrated)
        setHasFirstMessage(true)
        if (askName) {
          setUserName('_skip')
          setNameExchangeMessages(0)
        }
      })
      .catch(() => { /* silently no-op — fresh-chat state remains */ })
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const rootRef = useRef<HTMLDivElement>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastMsgRef = useRef<HTMLDivElement>(null)
  // Silence-triggered probe: fires once per session when the user has been
  // idle for SILENCE_TIMEOUT_MS after a bot reply lands. Cap of one per
  // session is enforced both client-side (ref) and server-side (existing
  // source='silence_probe' turn).
  const SILENCE_TIMEOUT_MS = 25000
  const silenceProbeFiredRef = useRef(false)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearSilenceTimer = () => {
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current)
      silenceTimerRef.current = null
    }
  }

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

  // Silence-probe idle timer. Re-arms each time a bot reply lands AND the
  // user has had at least one real exchange. Clears on any state change so
  // a user message immediately cancels the pending probe.
  useEffect(() => {
    clearSilenceTimer()
    if (silenceProbeFiredRef.current) return
    if (!hasFirstMessage || loading) return
    if (messages.length === 0) return
    const last = messages[messages.length - 1]
    if (last.role !== 'assistant') return

    silenceTimerRef.current = setTimeout(async function() {
      if (silenceProbeFiredRef.current) return
      silenceProbeFiredRef.current = true
      try {
        const apiMessages = (nameExchangeMessages > 0
          ? messages.slice(nameExchangeMessages)
          : messages.filter(m => m.content !== EN_INITIAL.content)
        ).map(m => ({ role: m.role, content: m.content }))
        if (apiMessages.length === 0) return
        const res = await fetch(config.apiEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: apiMessages,
            session_id: sessionId,
            trigger: 'silence',
            language: selectedLang || undefined,
            ...(config.extraBody || {}),
          }),
        })
        const data = await res.json()
        if (data?.reply) {
          setMessages(prev => [...prev, { role: 'assistant', content: data.reply }])
        }
      } catch { /* silent — probe failure must not disrupt UX */ }
    }, SILENCE_TIMEOUT_MS)

    return () => clearSilenceTimer()
  }, [messages, loading, hasFirstMessage, nameExchangeMessages, sessionId, selectedLang, config.apiEndpoint, EN_INITIAL.content])

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return

    // Check for verbose/sanjay commands
    const cmd = checkVerboseCommand(text.trim())
    if (cmd === 'bypass') { setInput(''); setDebugMode(true); return }
    if (cmd === 'auth') { setInput(''); setShowVerboseAuth(true); return }
    if (cmd === 'demo') { setInput(''); setDemoMode(v => !v); return }

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
            body: JSON.stringify({ messages: [{ role: 'user', content: 'The user gave an inappropriate name. Ask them to try a different name. One sentence.' }], session_id: sessionId, language: selectedLang, ...(config.extraBody || {}) }),
          }).then(r => r.json()).then(data => {
            setMessages(prev => [...prev, { role: 'assistant', content: data.reply || "Let's try a different name." }])
          }).finally(() => setLoading(false))
        } else {
          setMessages(prev => [...prev, { role: 'assistant', content: "Let's try a different name — what would you like me to call you?" }])
        }
      } else {
        const cleanName = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        setUserName(cleanName)
        // Two-step opener: name-ask was step 1; now show the topical opener
        // (config.initialMessage) as step 2. For English, render directly — no
        // API call needed. For non-English, ask the API to translate the opener
        // into the selected language and personalize it with the user's name.
        if (isNonEnglish) {
          setLoading(true)
          fetch(config.apiEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              messages: [{ role: 'user', content: 'The user just told you their name is "' + cleanName + '". Greet them warmly by name in one short sentence, then ask this opening question (translated naturally into the target language): "' + config.initialMessage + '". Return only the greeting + question, nothing else.' }],
              session_id: sessionId,
              language: selectedLang,
              user_name: cleanName,
              ...(config.extraBody || {}),
            }),
          }).then(r => r.json()).then(data => {
            setMessages(prev => {
              const next = [...prev, { role: 'assistant' as const, content: data.reply || (cleanName + ', ' + config.initialMessage) }]
              setNameExchangeMessages(next.length - 1)
              return next
            })
          }).catch(function() {
            setMessages(prev => {
              const next = [...prev, { role: 'assistant' as const, content: cleanName + ', ' + config.initialMessage }]
              setNameExchangeMessages(next.length - 1)
              return next
            })
          }).finally(() => setLoading(false))
        } else {
          setMessages(prev => {
            const next = [...prev, { role: 'assistant' as const, content: 'Nice to meet you, ' + cleanName + '. ' + config.initialMessage }]
            // Drop the name-ask (idx 0) and name reply (idx 1) from future API
            // calls. Keep the topical opener (idx 2) as conversation context.
            setNameExchangeMessages(next.length - 1)
            return next
          })
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
    setHasFirstMessage(true)

    try {
      // Drop the name-ask exchange from API messages so the server sees a clean
      // conversation starting with the topical opener (askName flow) or with
      // the user's first message (askName=false flow).
      const apiMessages = (nameExchangeMessages > 0
        ? newMessages.slice(nameExchangeMessages)
        : newMessages.filter(m => m.content !== EN_INITIAL.content)
      ).map(m => ({ role: m.role, content: m.content }))

      const res = await fetchWithRetry(config.apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: apiMessages,
          session_id: sessionId,
          debug: debugMode || undefined,
          demo: demoMode || undefined,
          user_name: userName && userName !== '_skip' ? userName : undefined,
          language: selectedLang || undefined,
          ...(config.extraBody || {}),
        }),
      })
      const data = await res.json()
      setLastFailedInput(null)
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply || 'Sorry, something went wrong.', _debug: data._debug, _signals: data._signals }])
    } catch {
      // All retries exhausted. Save the user's message so they can hit
      // Retry instead of having to retype it; show a friendlier error.
      setLastFailedInput(text)
      setMessages(prev => [...prev, { role: 'assistant', content: "Connection hiccup — your message didn't go through. Tap Retry below to send it again." }])
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
    // Step -1: Some models occasionally emit raw `<a href="…">text</a>` even
    // when prompted not to. Without normalisation, escapeHtml would turn the
    // tag into entities and the bare-URL auto-linker further down would then
    // match the URL *inside* the escaped tag string and wrap it in a real
    // anchor — producing attribute-soup in the bubble. Rewrite the raw anchor
    // to markdown so the existing markdown pipeline handles it cleanly.
    const normalized = content.replace(
      /<a\s+[^>]*href=["']?(https?:\/\/[^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi,
      function(_m: string, url: string, text: string) {
        const cleanText = text.replace(/<[^>]+>/g, '').trim() || url
        return '[' + cleanText + '](' + url + ')'
      }
    )
    // Step 0: HTML-escape first. Without this the function inserts the
    // raw user/agent string into innerHTML — a literal `"` in a URL or
    // body lets an attacker break out of the href="..." attribute and
    // inject script handlers.
    const escapeHtml = (s: string) => s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;')
    // Step 1: Convert markdown links [text](url) first — replace with placeholder tokens.
    // We escape both the visible text and the URL so neither can break out
    // of the surrounding markup.
    const mdLinks: string[] = []
    let out = escapeHtml(normalized).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) => {
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
          {/* Mandatory: Powered by Datanautix — always shown on every agent.
              Stacked: tiny "powered by" caption above the wordmark.
              Wordmark color picks Hermes orange on dark headers, Sarina
              blue on light ones, by sampling the first hex color in the
              header gradient string and computing perceived luminance. */}
          <a href="https://www.datanautix.com" target="_blank" rel="noopener noreferrer"
            style={{ textDecoration: 'none', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', lineHeight: 1, fontFamily: 'system-ui, sans-serif', whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: '0.5rem', color: 'rgba(255,255,255,0.45)', textTransform: 'lowercase', letterSpacing: '0.04em' }}>powered by</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.08em', color: pickWordmarkColor(config.headerGradient), marginTop: 2 }}>DATANAUTIX</span>
          </a>
        </div>
      </header>

      {/* Verbose mode banner */}
      {debugMode && (
        <div style={{ background: '#FEF3C7', borderBottom: '1px solid #FDE68A', padding: '4px 16px', fontSize: '0.6875rem', color: '#92400E', fontWeight: 600, flexShrink: 0, textAlign: 'center' }}>
          Running in verbose mode — AI reasoning visible
        </div>
      )}

      {/* Demo mode banner */}
      {demoMode && !debugMode && (
        <div style={{ background: '#EDE9FE', borderBottom: '1px solid #C4B5FD', padding: '4px 16px', fontSize: '0.6875rem', color: '#5B21B6', fontWeight: 600, flexShrink: 0, textAlign: 'center' }}>
          Demo mode — AI signals visible
        </div>
      )}

      {/* Language selector — shown before chat when multi-language is enabled */}
      {multiLang && selectedLang === null && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 24px', gap: 20 }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '2rem', marginBottom: 8 }}>{config.avatarLetter}</div>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#111827' }}>Choose your language</div>
            <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 4 }}>Select the language you&apos;d like to chat in</div>
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
                dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(formatHtml(msg.content)) }}
              />
            </div>
            {debugMode && msg._debug && msg._debug.length > 0 && (
              <div style={{ margin: '4px 0 6px 40px', padding: '8px 12px', background: '#fef3c7', border: '1px solid #fbbf24', borderRadius: 12, fontSize: '0.6875rem', color: '#92400e', lineHeight: 1.5, maxWidth: '85%' }}>
                <div style={{ fontWeight: 700, fontSize: '0.625rem', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, color: '#78350f' }}>AI Thinking</div>
                {msg._debug.map((line, j) => <div key={j} style={{ marginBottom: 2 }}>{line}</div>)}
              </div>
            )}
            {demoMode && !debugMode && msg._signals && msg._signals.length > 0 && (
              <div style={{ margin: '4px 0 6px 40px', display: 'flex', flexWrap: 'wrap', gap: 4, maxWidth: '85%' }}>
                {msg._signals.map((sig, j) => (
                  <span key={j} style={{ padding: '2px 8px', borderRadius: 20, fontSize: 9, fontWeight: 700, background: sig.color + '20', color: sig.color, border: '1px solid ' + sig.color + '40' }}>
                    {sig.label}
                  </span>
                ))}
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

        {/* Retry button — surfaced when fetchWithRetry has exhausted its
           retries and we've saved the user's last input. Tapping it
           re-sends the same message so the respondent doesn't have to
           retype after a connectivity blip. */}
        {lastFailedInput && !loading && (
          <div style={{ display: 'flex', marginTop: 8 }}>
            <button onClick={() => { const t = lastFailedInput; setLastFailedInput(null); sendMessage(t) }}
              style={{
                padding: '8px 16px', borderRadius: 20,
                background: config.accentColor, border: 'none',
                color: 'white', fontSize: '0.8125rem', fontWeight: 600,
                cursor: 'pointer', fontFamily: 'inherit',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {/* Suggestion chips — show until the user sends their first real
           topic message (NOT counting name capture). Gating on
           hasFirstMessage instead of `messages.length <= 1` is what makes
           chips appear after name capture for askName=true bots: by then
           messages.length is already 3 (greeting + name + bot reply), so
           the old length gate excluded them. userName !== null ensures we
           don't show chips while still asking for the name (otherwise a
           chip click would be interpreted as the user's name). */}
        {!hasFirstMessage && !loading && userName !== null && (
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
            onChange={e => { setInput(e.target.value); clearSilenceTimer() }}
            onKeyDown={handleKeyDown}
            placeholder={isNonEnglish ? (PLACEHOLDER_TRANSLATIONS[selectedLang!] || config.placeholder) : config.placeholder}
            rows={1}
            autoCorrect="on"
            autoCapitalize="sentences"
            spellCheck={true}
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
              style={{ color: '#E8632A', fontWeight: 600, textDecoration: 'underline', textUnderlineOffset: 2 }}>Datanautix</a>
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
