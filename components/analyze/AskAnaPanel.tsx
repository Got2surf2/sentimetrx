'use client'

// components/analyze/AskAnaPanel.tsx
// Right-side slide-out panel for Ask Ana — iMessage-style chat with streaming AI responses
// User asks freeform questions about their dataset, Ana answers based on the actual data.

import { useState, useRef, useEffect } from 'react'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}

interface Props {
  datasetId: string
  datasetName: string
  filters?: Record<string, any>
  onClose: () => void
}

var IMSG_BLUE = '#007AFF'
var IMSG_GRAY = '#E9E9EB'
var HERMES = '#E8632A'

var STARTERS = [
  'What are the main themes people are discussing?',
  'What are people most upset about?',
  'Summarize the overall sentiment',
  'What topics get the most engagement?',
]

export default function AskAnaPanel({ datasetId, datasetName, filters, onClose }: Props) {
  var [messages, setMessages] = useState<Message[]>([])
  var [input, setInput] = useState('')
  var [loading, setLoading] = useState(false)
  var scrollRef = useRef<HTMLDivElement>(null)
  var inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll on new messages
  useEffect(function() {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  // Focus input on mount
  useEffect(function() {
    setTimeout(function() { inputRef.current?.focus() }, 200)
  }, [])

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return

    var userMsg: Message = { id: Date.now() + '-user', role: 'user', content: text.trim() }
    var assistantId = Date.now() + '-assistant'
    var assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', streaming: true }

    setMessages(function(prev) { return [...prev, userMsg, assistantMsg] })
    setInput('')
    setLoading(true)

    // Build conversation history (exclude the current exchange)
    var history = messages
      .filter(function(m) { return !m.streaming })
      .map(function(m) { return { role: m.role, content: m.content } })

    // Serialize filters for the API
    var serializedFilters: Record<string, any> | undefined
    if (filters && Object.keys(filters).length > 0) {
      serializedFilters = {}
      Object.entries(filters).forEach(function(entry) {
        var field = entry[0], f = entry[1] as any
        if (f.type === 'cat') {
          serializedFilters![field] = { type: 'cat', values: Array.from(f.values), excludeBlanks: f.excludeBlanks }
        } else {
          serializedFilters![field] = f
        }
      })
    }

    try {
      var res = await fetch('/api/ask-ana', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasetId: datasetId,
          question: text.trim(),
          conversationHistory: history,
          filters: serializedFilters,
        }),
      })

      if (!res.ok) {
        var errData = await res.json().catch(function() { return { error: 'Request failed' } })
        setMessages(function(prev) {
          return prev.map(function(m) {
            return m.id === assistantId ? { ...m, content: errData.error || 'Something went wrong.', streaming: false } : m
          })
        })
        setLoading(false)
        return
      }

      // Read SSE stream
      var reader = res.body!.getReader()
      var decoder = new TextDecoder()
      var buffer = ''
      var accumulated = ''

      while (true) {
        var result = await reader.read()
        if (result.done) break

        buffer += decoder.decode(result.value, { stream: true })
        var lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (var i = 0; i < lines.length; i++) {
          var line = lines[i]
          if (!line.startsWith('data: ')) continue
          var payload = line.slice(6).trim()
          if (payload === '[DONE]') continue

          try {
            var event = JSON.parse(payload)
            if (event.text) {
              accumulated += event.text
              var snapshot = accumulated
              setMessages(function(prev) {
                return prev.map(function(m) {
                  return m.id === assistantId ? { ...m, content: snapshot } : m
                })
              })
            }
            if (event.error) {
              accumulated += '\n\n*Error: ' + event.error + '*'
            }
          } catch {}
        }
      }

      // Mark as done
      var final = accumulated
      setMessages(function(prev) {
        return prev.map(function(m) {
          return m.id === assistantId ? { ...m, content: final, streaming: false } : m
        })
      })
    } catch (err) {
      setMessages(function(prev) {
        return prev.map(function(m) {
          return m.id === assistantId ? { ...m, content: 'Connection error. Please try again.', streaming: false } : m
        })
      })
    }

    setLoading(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  function handleClear() {
    setMessages([])
    setInput('')
  }

  var hasMessages = messages.length > 0

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, bottom: 0, width: 420, maxWidth: '100vw',
      background: 'white', boxShadow: '-8px 0 32px rgba(0,0,0,.15)',
      display: 'flex', flexDirection: 'column', zIndex: 1500,
      animation: 'askAnaSlideIn .2s ease-out',
    }}>
      {/* Inline animation keyframe */}
      <style>{`
        @keyframes askAnaSlideIn { from { transform: translateX(100%); } to { transform: translateX(0); } }
        .ask-ana-input:focus { outline: none; border-color: ${HERMES} !important; box-shadow: 0 0 0 3px rgba(232,99,42,.15) !important; }
      `}</style>

      {/* Header */}
      <div style={{
        padding: '12px 16px', borderBottom: 'none',
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        background: HERMES,
      }}>
        <div style={{
          width: 34, height: 34, borderRadius: 10, background: 'rgba(255,255,255,.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 15, fontWeight: 900, color: 'white',
        }}>A</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'white', letterSpacing: '-.2px' }}>Ask Ana</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{datasetName}</div>
        </div>
        {hasMessages && (
          <button onClick={handleClear}
            style={{
              fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,.8)', background: 'rgba(255,255,255,.15)',
              border: '1px solid rgba(255,255,255,.25)', borderRadius: 6, padding: '4px 10px',
              cursor: 'pointer',
            }}>
            Clear
          </button>
        )}
        <button onClick={onClose}
          style={{
            fontSize: 18, color: 'rgba(255,255,255,.7)', background: 'none', border: 'none',
            cursor: 'pointer', padding: '0 4px', lineHeight: 1,
          }}>{'\u00D7'}</button>
      </div>

      {/* Messages area */}
      <div ref={scrollRef} style={{
        flex: 1, overflow: 'auto', padding: '16px 16px 8px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {!hasMessages && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 20, padding: '0 16px' }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 8 }}>{'\uD83D\uDCAC'}</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 4 }}>Ask Ana anything</div>
              <div style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>
                Ask questions about your data and Ana will analyze the responses for you.
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
              {STARTERS.map(function(s, i) {
                return (
                  <button key={i} onClick={function() { sendMessage(s) }}
                    style={{
                      textAlign: 'left', padding: '10px 14px', fontSize: 13, color: '#374151',
                      background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10,
                      cursor: 'pointer', lineHeight: 1.4, transition: 'all .12s',
                    }}
                    onMouseEnter={function(e) { (e.currentTarget as HTMLButtonElement).style.background = '#f3f4f6'; (e.currentTarget as HTMLButtonElement).style.borderColor = HERMES }}
                    onMouseLeave={function(e) { (e.currentTarget as HTMLButtonElement).style.background = '#f9fafb'; (e.currentTarget as HTMLButtonElement).style.borderColor = '#e5e7eb' }}>
                    {s}
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {messages.map(function(m) {
          var isUser = m.role === 'user'
          return (
            <div key={m.id} style={{
              display: 'flex', flexDirection: 'column', alignItems: isUser ? 'flex-end' : 'flex-start',
            }}>
              <div style={{ display: 'flex', justifyContent: isUser ? 'flex-end' : 'flex-start' }}>
                {!isUser && (
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', background: HERMES,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 900, color: 'white', flexShrink: 0, marginRight: 8, marginTop: 2,
                  }}>A</div>
                )}
                <div style={{
                  maxWidth: '80%', padding: '9px 14px',
                  borderRadius: isUser ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                  background: isUser ? IMSG_BLUE : IMSG_GRAY,
                  color: isUser ? 'white' : '#000',
                  fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {isUser ? m.content : <FormattedResponse text={m.content} streaming={m.streaming} />}
                </div>
              </div>
              {!isUser && !m.streaming && m.content && (
                <CopyButton text={m.content} />
              )}
            </div>
          )
        })}
      </div>

      {/* Input area */}
      <div style={{
        padding: '12px 16px', borderTop: '1px solid #e5e7eb',
        background: '#fafafa', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            className="ask-ana-input"
            value={input}
            onChange={function(e) { setInput(e.target.value) }}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question about your data..."
            rows={1}
            disabled={loading}
            style={{
              flex: 1, resize: 'none', fontSize: 14, padding: '10px 14px',
              border: '1px solid #d1d5db', borderRadius: 12,
              background: 'white', color: '#111', lineHeight: 1.4,
              minHeight: 42, maxHeight: 120, overflow: 'auto',
              fontFamily: 'inherit',
            }}
          />
          <button
            onClick={function() { sendMessage(input) }}
            disabled={!input.trim() || loading}
            style={{
              width: 40, height: 40, borderRadius: '50%',
              background: input.trim() && !loading ? HERMES : '#d1d5db',
              border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'background .15s', flexShrink: 0,
            }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13" />
              <polygon points="22 2 15 22 11 13 2 9 22 2" />
            </svg>
          </button>
        </div>
        <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 6, textAlign: 'center' }}>
          Ana answers based on your dataset. Shift+Enter for new line.
        </div>
      </div>
    </div>
  )
}

// Simple markdown-like formatting for Ana's responses
function FormattedResponse({ text, streaming }: { text: string; streaming?: boolean }) {
  if (!text && streaming) {
    return <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Thinking...</span>
  }

  // Convert markdown-ish formatting to simple HTML
  var parts = text.split('\n')
  var elements: React.ReactNode[] = []

  for (var i = 0; i < parts.length; i++) {
    var line = parts[i]

    // Bold: **text**
    var formatted = formatInline(line)

    // Bullet points
    if (line.match(/^[\-\*]\s/)) {
      elements.push(
        <div key={i} style={{ paddingLeft: 12, position: 'relative', marginTop: 2 }}>
          <span style={{ position: 'absolute', left: 0 }}>{'\u2022'}</span>
          <span>{formatted}</span>
        </div>
      )
    }
    // Numbered list
    else if (line.match(/^\d+\.\s/)) {
      elements.push(
        <div key={i} style={{ paddingLeft: 4, marginTop: 2 }}>{formatted}</div>
      )
    }
    // Headers (### or ##)
    else if (line.match(/^#{1,3}\s/)) {
      var headerText = line.replace(/^#{1,3}\s/, '')
      elements.push(
        <div key={i} style={{ fontWeight: 700, marginTop: i > 0 ? 8 : 0, marginBottom: 2 }}>{headerText}</div>
      )
    }
    // Empty line
    else if (line.trim() === '') {
      elements.push(<div key={i} style={{ height: 6 }} />)
    }
    // Regular text
    else {
      elements.push(<div key={i}>{formatted}</div>)
    }
  }

  return <>{elements}{streaming && <span style={{ animation: 'blink 1s infinite' }}>{'\u258C'}</span>}<style>{`@keyframes blink { 0%,50% { opacity: 1 } 51%,100% { opacity: 0 } }`}</style></>
}

// Copy button for assistant messages
function CopyButton({ text }: { text: string }) {
  var [copied, setCopied] = useState(false)
  function handleCopy() {
    navigator.clipboard.writeText(text).then(function() {
      setCopied(true)
      setTimeout(function() { setCopied(false) }, 2000)
    })
  }
  return (
    <button onClick={handleCopy}
      style={{
        marginLeft: 36, marginTop: 3, fontSize: 10, color: copied ? '#059669' : '#9ca3af',
        background: 'none', border: 'none', cursor: 'pointer',
        display: 'flex', alignItems: 'center', gap: 3, padding: 0,
        transition: 'color .15s',
      }}>
      {copied ? (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="20 6 9 17 4 12" />
        </svg>
      ) : (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      )}
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

// Handle inline formatting: **bold**, *italic*, "quotes"
function formatInline(text: string): React.ReactNode {
  // Split on **bold** markers
  var boldParts = text.split(/\*\*(.+?)\*\*/g)
  if (boldParts.length === 1) return text

  return boldParts.map(function(part, i) {
    if (i % 2 === 1) return <strong key={i}>{part}</strong>
    return <span key={i}>{part}</span>
  })
}
