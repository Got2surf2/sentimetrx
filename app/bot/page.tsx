'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'What does Datanautix do?',
  'How is Sarina different from SurveyMonkey?',
  'What results can I expect?',
  'Tell me about Ana text analytics',
  'What languages do you support?',
  'How does pricing work?',
]

const INITIAL_MESSAGE: Message = { role: 'assistant', content: "Hi! I'm the Datanautix assistant. I can answer questions about our products — **Sarina** (conversational surveys), **Ana** (text analytics), and the **Datanautix Platform** (our integrated suite). What would you like to know?" }

export default function BotPage() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  const resetChat = () => {
    setMessages([INITIAL_MESSAGE])
    setInput('')
    setLoading(false)
  }
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const lastMsgRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Scroll so the top of the latest message is visible
    requestAnimationFrame(() => {
      if (lastMsgRef.current) {
        lastMsgRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    })
  }, [messages, loading])

  const sendMessage = async (text: string) => {
    if (!text.trim() || loading) return
    const userMsg: Message = { role: 'user', content: text.trim() }
    const newMessages = [...messages, userMsg]
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/bot-chat', {
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
    <div style={{ minHeight: '100vh', background: '#f8fafc', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: 'linear-gradient(135deg, #0a1628, #1a2d4a)',
        padding: '16px 24px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        flexShrink: 0,
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: '50%',
          background: 'linear-gradient(135deg, #00b4d8, #0077a8)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.2rem',
        }}>
          🤖
        </div>
        <div>
          <div style={{ color: 'white', fontWeight: 700, fontSize: '1rem' }}>Datanautix Assistant</div>
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.75rem' }}>Ask me anything about our products</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 12 }}>
          {messages.length > 1 && (
            <button onClick={resetChat} style={{
              padding: '5px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.3)',
              background: 'transparent', color: 'rgba(255,255,255,0.7)', fontSize: '0.7rem',
              fontWeight: 500, cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
              transition: 'all 0.15s',
            }}
              onMouseEnter={e => { (e.target as HTMLElement).style.background = 'rgba(255,255,255,0.1)'; (e.target as HTMLElement).style.color = 'white' }}
              onMouseLeave={e => { (e.target as HTMLElement).style.background = 'transparent'; (e.target as HTMLElement).style.color = 'rgba(255,255,255,0.7)' }}
            >New Conversation</button>
          )}
          <a href="https://www.datanautix.com" target="_blank" rel="noopener noreferrer"
            style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.75rem', textDecoration: 'none' }}>
            datanautix.com
          </a>
        </div>
      </header>

      {/* Chat area */}
      <div ref={chatRef} style={{
        flex: 1, overflowY: 'auto', padding: '20px 16px',
        display: 'flex', flexDirection: 'column', gap: 16,
        maxWidth: 800, width: '100%', margin: '0 auto',
        scrollBehavior: 'smooth' as const,
      }}>
        {messages.map((msg, i) => (
          <div key={i} ref={i === messages.length - 1 ? lastMsgRef : undefined} style={{
            display: 'flex',
            justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
            gap: 8,
          }}>
            {msg.role === 'assistant' && (
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: 'linear-gradient(135deg, #00b4d8, #0077a8)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.875rem', color: 'white', fontWeight: 700,
              }}>D</div>
            )}
            <div style={{
              maxWidth: '80%',
              padding: '12px 16px',
              borderRadius: msg.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
              background: msg.role === 'user' ? '#0a1628' : 'white',
              color: msg.role === 'user' ? 'white' : '#1a1a1a',
              fontSize: '0.9rem',
              lineHeight: 1.6,
              border: msg.role === 'assistant' ? '1px solid #e5e7eb' : 'none',
              boxShadow: msg.role === 'assistant' ? '0 1px 3px rgba(0,0,0,0.06)' : 'none',
              whiteSpace: 'pre-wrap',
            }}
              dangerouslySetInnerHTML={{
                __html: msg.content
                  .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                  .replace(/\n/g, '<br/>')
                  .replace(/- /g, '&bull; ')
                  .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">$1</a>')
                  .replace(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g, '<a href="mailto:$1" style="color:inherit;text-decoration:underline">$1</a>')
                  .replace(/(?<![/@\w".])((?:[a-zA-Z0-9-]+\.)+(?:com|org|net|ai|io)(?:\/[^\s<)]*)?)/g, '<a href="https://$1" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">$1</a>')
              }}
            />
          </div>
        ))}

        {/* Typing indicator */}
        {loading && (
          <div style={{ display: 'flex', gap: 8 }}>
            <div style={{
              width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
              background: 'linear-gradient(135deg, #00b4d8, #0077a8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: '0.875rem', color: 'white', fontWeight: 700,
            }}>D</div>
            <div style={{
              padding: '12px 20px', borderRadius: '18px 18px 18px 4px',
              background: 'white', border: '1px solid #e5e7eb',
              display: 'flex', gap: 6, alignItems: 'center',
            }}>
              <span className="typing-dot" style={{ animationDelay: '0ms' }} />
              <span className="typing-dot" style={{ animationDelay: '200ms' }} />
              <span className="typing-dot" style={{ animationDelay: '400ms' }} />
            </div>
          </div>
        )}

        {/* Suggestion chips — only show at start */}
        {messages.length <= 1 && !loading && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {SUGGESTIONS.map((s, i) => (
              <button key={i} onClick={() => sendMessage(s)}
                style={{
                  padding: '8px 16px', borderRadius: 20,
                  background: 'white', border: '1.5px solid #e5e7eb',
                  color: '#4b5563', fontSize: '0.8125rem', fontWeight: 500,
                  cursor: 'pointer', fontFamily: 'inherit',
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => { (e.target as HTMLElement).style.borderColor = '#00b4d8'; (e.target as HTMLElement).style.color = '#00b4d8' }}
                onMouseLeave={e => { (e.target as HTMLElement).style.borderColor = '#e5e7eb'; (e.target as HTMLElement).style.color = '#4b5563' }}
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
        borderTop: '1px solid #e5e7eb',
        background: 'white',
        flexShrink: 0,
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
            placeholder="Ask about Datanautix products..."
            rows={1}
            style={{
              flex: 1, resize: 'none',
              padding: '10px 16px', borderRadius: 24,
              border: '1.5px solid #e5e7eb', outline: 'none',
              fontSize: '0.9rem', fontFamily: 'inherit',
              lineHeight: 1.5, maxHeight: 120,
              background: '#f9fafb',
            }}
            onFocus={e => (e.target as HTMLElement).style.borderColor = '#00b4d8'}
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
              background: input.trim() && !loading ? '#0a1628' : '#e5e7eb',
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
      </div>

      <style>{`
        @keyframes dotPulse {
          0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
          40% { transform: scale(1); opacity: 1; }
        }
        .typing-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #00b4d8; display: inline-block;
          animation: dotPulse 1.4s infinite ease-in-out both;
        }
      `}</style>
    </div>
  )
}
