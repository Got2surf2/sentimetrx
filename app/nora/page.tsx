'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'What kind of food do you serve?',
  'Where are your locations?',
  'How do I make a reservation?',
  'Tell me about catering',
  'Do you have vegetarian options?',
  'What is the Masala Club?',
]

export default function NoraPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: "Welcome to Tabla! I'm Nora, your virtual host. I can help you find a location, explore the menu, make a reservation, or learn about catering and events. What can I help you with?" },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!chatRef.current) return
    const lastMsg = chatRef.current.lastElementChild as HTMLElement | null
    if (lastMsg && messages.length > 1 && messages[messages.length - 1].role === 'assistant') {
      requestAnimationFrame(() => lastMsg.scrollIntoView({ block: 'start', behavior: 'smooth' }))
    } else {
      requestAnimationFrame(() => { chatRef.current!.scrollTop = chatRef.current!.scrollHeight })
    }
  }, [messages, loading])

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: Message = { role: 'user', content: text.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/nora-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: newMessages.map(m => ({ role: m.role, content: m.content })),
        }),
      })
      const data = await res.json()
      setMessages(prev => [...prev, { role: 'assistant', content: data.reply || 'Sorry, something went wrong.' }])
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

  return (
    <div style={{ minHeight: '100vh', background: '#FDF8F3', display: 'flex', flexDirection: 'column', fontFamily: "'Georgia', 'Times New Roman', serif" }}>
      {/* Header */}
      <header style={{
        background: 'linear-gradient(135deg, #8B1A1A, #5C1010)',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'linear-gradient(135deg, #D4A843, #B8922F)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1rem', fontWeight: 700, color: '#5C1010',
        }}>
          N
        </div>
        <div>
          <div style={{ color: 'white', fontWeight: 700, fontSize: '1rem', fontFamily: 'Georgia, serif' }}>Nora</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem', fontFamily: 'system-ui, sans-serif' }}>Tabla Cuisine Virtual Host</div>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <a href="https://www.tablacuisine.com" target="_blank" rel="noopener noreferrer"
            style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', textDecoration: 'none', fontFamily: 'system-ui, sans-serif' }}>
            tablacuisine.com
          </a>
        </div>
      </header>

      {/* Chat area */}
      <div ref={chatRef} style={{
        flex: 1, overflowY: 'auto', padding: '20px 16px',
        display: 'flex', flexDirection: 'column', gap: 16,
        maxWidth: 800, width: '100%', margin: '0 auto',
        scrollBehavior: 'smooth' as const,
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}>
        {messages.map((msg, i) => (
          <div key={i} style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            gap: 8,
          }}>
            {msg.role === 'assistant' && (
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #D4A843, #B8922F)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.875rem', color: '#5C1010', fontWeight: 700,
              }}>N</div>
            )}
            <div style={{
              maxWidth: '80%',
              padding: '12px 16px',
              borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: msg.role === 'user' ? '#8B1A1A' : 'white',
              color: msg.role === 'user' ? 'white' : '#1a1a1a',
              fontSize: '0.9rem',
              lineHeight: 1.6,
              border: msg.role === 'assistant' ? '1px solid #E8DDD0' : 'none',
              boxShadow: msg.role === 'assistant' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              whiteSpace: 'pre-wrap',
            }}
              dangerouslySetInnerHTML={{
                __html: msg.content
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/\n/g, '<br/>')
                  .replace(/- /g, '&bull; ')
              }}
            />
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #D4A843, #B8922F)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.875rem', color: '#5C1010', fontWeight: 700,
            }}>N</div>
            <div style={{
              padding: '12px 20px', borderRadius: '18px 18px 18px 4px',
              background: 'white', border: '1px solid #E8DDD0',
              display: 'flex', gap: 6, alignItems: 'center',
            }}>
              <span className="nora-typing-dot" style={{ animationDelay: '0ms' }} />
              <span className="nora-typing-dot" style={{ animationDelay: '200ms' }} />
              <span className="nora-typing-dot" style={{ animationDelay: '400ms' }} />
            </div>
          </div>
        )}

        {/* Suggestion chips */}
        {messages.length <= 1 && !loading && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {SUGGESTIONS.map((s, i) => (
              <button key={i} onClick={() => sendMessage(s)}
                style={{
                  padding: '8px 16px', borderRadius: 20,
                  background: 'white', border: '1.5px solid #E8DDD0',
                  color: '#8B6914', fontSize: '0.8125rem', fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = '#D4A843'; (e.target as HTMLElement).style.color = '#8B1A1A' }}
                onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = '#E8DDD0'; (e.target as HTMLElement).style.color = '#8B6914' }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input area */}
      <div style={{
        padding: '12px 16px',
        paddingBottom: 'max(12px, env(safe-area-inset-bottom))',
        borderTop: '1px solid #E8DDD0',
        background: 'white',
        flexShrink: 0,
        fontFamily: 'system-ui, -apple-system, sans-serif',
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
            placeholder="Ask Nora about Tabla..."
            rows={1}
            style={{
              flex: 1, resize: 'none',
              padding: '10px 16px', borderRadius: 24,
              border: '1.5px solid #E8DDD0', outline: 'none',
              fontSize: '0.9rem', fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.5, maxHeight: 120,
              background: '#FDF8F3',
            }}
            onFocus={e => (e.target as HTMLElement).style.borderColor = '#D4A843'}
            onBlur={e => (e.target as HTMLElement).style.borderColor = '#E8DDD0'}
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
              background: input.trim() && !loading ? '#8B1A1A' : '#E8DDD0',
              color: input.trim() && !loading ? 'white' : '#9ca3af',
              border: 'none', cursor: input.trim() && !loading ? 'pointer' : 'default',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '1.1rem', fontWeight: 700, flexShrink: 0,
              transition: 'all 0.15s',
            }}
          >
            &#8593;
          </button>
        </div>
        <div style={{ textAlign: 'center', marginTop: 8 }}>
          <span style={{ color: '#9ca3af', fontSize: '0.6875rem' }}>
            Powered by <a href="https://www.tablacuisine.com" target="_blank" rel="noopener noreferrer"
              style={{ color: '#8B6914', fontWeight: 600, textDecoration: 'none' }}>Tabla Cuisine</a>
          </span>
        </div>
      </div>

      <style>{`
        @keyframes noraDotPulse {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        .nora-typing-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #D4A843; display: inline-block;
          animation: noraDotPulse 1.4s infinite ease-in-out both;
        }
      `}</style>
    </div>
  )
}
