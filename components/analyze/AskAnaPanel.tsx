'use client'

// components/analyze/AskAnaPanel.tsx
// Right-side slide-out panel for Ask Ana — iMessage-style chat with streaming AI responses.
// Supports both Q&A (text) and analysis framework mutations (tool_use → confirmation cards).

import { useState, useRef, useEffect, useCallback } from 'react'
import { serializeFilters } from '@/lib/filterUtils'
import type { Filters } from '@/lib/filterUtils'

interface AnaAction {
  tool: string
  toolId: string
  input: Record<string, any>
  status: 'pending' | 'approved' | 'rejected'
}

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
  actions?: AnaAction[]
}

interface Props {
  datasetId: string
  datasetName: string
  filters?: Filters
  onClose: () => void
  onThemesChanged?: () => void  // called after a mutation is applied
}

var IMSG_BLUE = '#007AFF'
var IMSG_GRAY = '#E9E9EB'
var HERMES = '#E8632A'

var STARTERS = [
  'What are the main themes people are discussing?',
  'What are people most upset about?',
  'Summarize the overall sentiment',
  'Create a theme for the most common complaints',
]

export default function AskAnaPanel({ datasetId, datasetName, filters, onClose, onThemesChanged }: Props) {
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

  // Apply a confirmed action to the dataset's theme model
  var applyAction = useCallback(async function(msgId: string, actionIdx: number) {
    var msg = messages.find(function(m) { return m.id === msgId })
    if (!msg || !msg.actions || !msg.actions[actionIdx]) return
    var action = msg.actions[actionIdx]

    try {
      // Fetch current theme model
      var stateRes = await fetch('/api/datasets/' + datasetId + '/state')
      if (!stateRes.ok) throw new Error('Failed to fetch state')
      var state = await stateRes.json()
      var themeModel = state.theme_model || { themes: [], aiGenerated: false, version: 1 }
      var themes: any[] = themeModel.themes || []

      if (action.tool === 'create_theme') {
        var newTheme = {
          id: 't' + Date.now(),
          name: action.input.name,
          label: action.input.name,
          description: action.input.description,
          keywords: action.input.keywords || [],
          sentiment: action.input.sentiment || 'neutral',
          count: 0,
          percentage: 0,
          relatedThemes: [],
        }
        themes.push(newTheme)
      } else if (action.tool === 'update_theme') {
        var target = themes.find(function(t: any) {
          return (t.name || t.label || '').toLowerCase() === (action.input.theme_name || '').toLowerCase()
        })
        if (target) {
          if (action.input.new_name) { target.name = action.input.new_name; target.label = action.input.new_name }
          if (action.input.new_description) target.description = action.input.new_description
          if (action.input.new_sentiment) target.sentiment = action.input.new_sentiment
          if (action.input.add_keywords) {
            var existing = new Set(target.keywords || [])
            action.input.add_keywords.forEach(function(kw: string) { existing.add(kw) })
            target.keywords = Array.from(existing)
          }
          if (action.input.remove_keywords) {
            var toRemove = new Set(action.input.remove_keywords)
            target.keywords = (target.keywords || []).filter(function(kw: string) { return !toRemove.has(kw) })
          }
        }
      } else if (action.tool === 'merge_themes') {
        var mergeNames = new Set((action.input.theme_names || []).map(function(n: string) { return n.toLowerCase() }))
        var mergedKeywords = new Set<string>()
        themes.forEach(function(t: any) {
          if (mergeNames.has((t.name || t.label || '').toLowerCase())) {
            (t.keywords || []).forEach(function(kw: string) { mergedKeywords.add(kw) })
          }
        })
        themes = themes.filter(function(t: any) { return !mergeNames.has((t.name || t.label || '').toLowerCase()) })
        themes.push({
          id: 't' + Date.now(),
          name: action.input.merged_name,
          label: action.input.merged_name,
          description: action.input.merged_description,
          keywords: Array.from(mergedKeywords),
          sentiment: action.input.merged_sentiment || 'neutral',
          count: 0,
          percentage: 0,
          relatedThemes: [],
        })
      } else if (action.tool === 'delete_theme') {
        var delName = (action.input.theme_name || '').toLowerCase()
        themes = themes.filter(function(t: any) { return (t.name || t.label || '').toLowerCase() !== delName })
      } else if (action.tool === 'generate_report') {
        // Render deck and trigger download — no theme model changes
        var deckRes = await fetch('/api/ana/render-deck', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ deck: action.input, datasetName }),
        })
        if (!deckRes.ok) throw new Error('Render failed')
        var blob = await deckRes.blob()
        var url = URL.createObjectURL(blob)
        var a = document.createElement('a')
        a.href = url
        a.download = (datasetName || 'report').replace(/[^a-z0-9]/gi, '_').slice(0, 40) + '_ana.pptx'
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)

        // Mark as approved and return early — no theme save needed
        setMessages(function(prev) {
          return prev.map(function(m) {
            if (m.id !== msgId || !m.actions) return m
            var updated = m.actions.map(function(a, i) { return i === actionIdx ? { ...a, status: 'approved' as const } : a })
            return { ...m, actions: updated }
          })
        })
        return
      }

      // Save updated theme model
      themeModel.themes = themes
      var patchRes = await fetch('/api/datasets/' + datasetId + '/state', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ theme_model: themeModel }),
      })
      if (!patchRes.ok) throw new Error('Failed to save')

      // Mark action as approved
      setMessages(function(prev) {
        return prev.map(function(m) {
          if (m.id !== msgId || !m.actions) return m
          var updated = m.actions.map(function(a, i) { return i === actionIdx ? { ...a, status: 'approved' as const } : a })
          return { ...m, actions: updated }
        })
      })

      if (onThemesChanged) onThemesChanged()
    } catch (err) {
      // Show error inline
      setMessages(function(prev) {
        return prev.map(function(m) {
          if (m.id !== msgId) return m
          return { ...m, content: m.content + '\n\n*Error applying change. Please try again.*' }
        })
      })
    }
  }, [messages, datasetId, onThemesChanged])

  var rejectAction = useCallback(function(msgId: string, actionIdx: number) {
    setMessages(function(prev) {
      return prev.map(function(m) {
        if (m.id !== msgId || !m.actions) return m
        var updated = m.actions.map(function(a, i) { return i === actionIdx ? { ...a, status: 'rejected' as const } : a })
        return { ...m, actions: updated }
      })
    })
  }, [])

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return

    var userMsg: Message = { id: Date.now() + '-user', role: 'user', content: text.trim() }
    var assistantId = Date.now() + '-assistant'
    var assistantMsg: Message = { id: assistantId, role: 'assistant', content: '', streaming: true, actions: [] }

    setMessages(function(prev) { return [...prev, userMsg, assistantMsg] })
    setInput('')
    setLoading(true)

    // Build conversation history (exclude the current exchange)
    var history = messages
      .filter(function(m) { return !m.streaming })
      .map(function(m) { return { role: m.role, content: m.content } })

    // Serialize filters for the API
    var serializedFilters = filters && Object.keys(filters).length > 0
      ? serializeFilters(filters)
      : undefined

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
      var collectedActions: AnaAction[] = []

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
              var actionsSnapshot = [...collectedActions]
              setMessages(function(prev) {
                return prev.map(function(m) {
                  return m.id === assistantId ? { ...m, content: snapshot, actions: actionsSnapshot } : m
                })
              })
            }
            if (event.action) {
              collectedActions.push({
                tool: event.action.tool,
                toolId: event.action.toolId,
                input: event.action.input,
                status: 'pending',
              })
              var actSnap = [...collectedActions]
              var textSnap = accumulated
              setMessages(function(prev) {
                return prev.map(function(m) {
                  return m.id === assistantId ? { ...m, content: textSnap, actions: actSnap } : m
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
      var final_ = accumulated
      var finalActions = [...collectedActions]
      setMessages(function(prev) {
        return prev.map(function(m) {
          return m.id === assistantId ? { ...m, content: final_, streaming: false, actions: finalActions } : m
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

      {/* Header — matches TopNav h-14 (56px) */}
      <div style={{
        height: 56, padding: '0 16px', borderBottom: 'none',
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
                Ask questions about your data, or tell Ana to create and modify themes.
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
              {/* Action confirmation cards */}
              {!isUser && m.actions && m.actions.length > 0 && (
                <div style={{ marginLeft: 36, marginTop: 6, display: 'flex', flexDirection: 'column', gap: 6, maxWidth: '85%' }}>
                  {m.actions.map(function(action, ai) {
                    return <ActionCard key={ai} action={action} msgId={m.id} actionIdx={ai}
                      onApprove={applyAction} onReject={rejectAction} />
                  })}
                </div>
              )}
              {!isUser && !m.streaming && m.content && (!m.actions || m.actions.length === 0) && (
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
            placeholder="Ask a question or tell Ana to modify themes..."
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
          Ana can answer questions and modify your analysis framework. Shift+Enter for new line.
        </div>
      </div>
    </div>
  )
}

// ── Action confirmation card ────────────────────────────────────────────────
function ActionCard({ action, msgId, actionIdx, onApprove, onReject }: {
  action: AnaAction; msgId: string; actionIdx: number
  onApprove: (msgId: string, idx: number) => void
  onReject: (msgId: string, idx: number) => void
}) {
  var [applying, setApplying] = useState(false)

  var toolLabel: Record<string, string> = {
    create_theme: 'Create Theme',
    update_theme: 'Update Theme',
    merge_themes: 'Merge Themes',
    delete_theme: 'Delete Theme',
    generate_report: 'Generate Deck',
  }

  var toolIcon: Record<string, string> = {
    create_theme: '+',
    update_theme: '\u270E',
    merge_themes: '\u2194',
    delete_theme: '\u2212',
    generate_report: '\uD83D\uDCCA',
  }

  var borderColor = action.status === 'approved' ? '#22c55e'
    : action.status === 'rejected' ? '#d1d5db'
    : HERMES

  var inp = action.input

  return (
    <div style={{
      border: '1.5px solid ' + borderColor,
      borderRadius: 12, padding: '10px 14px', background: 'white',
      opacity: action.status === 'rejected' ? 0.5 : 1,
      transition: 'opacity .2s, border-color .2s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{
          width: 22, height: 22, borderRadius: 6, background: borderColor,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 700, color: 'white',
        }}>{toolIcon[action.tool] || '?'}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#374151' }}>
          {toolLabel[action.tool] || action.tool}
        </span>
        {action.status === 'approved' && (
          <span style={{ fontSize: 10, color: '#22c55e', fontWeight: 600, marginLeft: 'auto' }}>Applied</span>
        )}
        {action.status === 'rejected' && (
          <span style={{ fontSize: 10, color: '#9ca3af', fontWeight: 600, marginLeft: 'auto' }}>Cancelled</span>
        )}
      </div>

      {/* Body — varies by tool */}
      {action.tool === 'create_theme' && (
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>{inp.name}</div>
          <div style={{ color: '#6b7280', marginBottom: 4 }}>{inp.description}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
            {(inp.keywords || []).slice(0, 12).map(function(kw: string, ki: number) {
              return <span key={ki} style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 4,
                background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb',
              }}>{kw}</span>
            })}
            {(inp.keywords || []).length > 12 && (
              <span style={{ fontSize: 10, color: '#9ca3af' }}>+{inp.keywords.length - 12} more</span>
            )}
          </div>
        </div>
      )}

      {action.tool === 'update_theme' && (
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <div><strong>{inp.theme_name}</strong>{inp.new_name ? ' \u2192 ' + inp.new_name : ''}</div>
          {inp.new_description && <div style={{ color: '#6b7280' }}>{inp.new_description}</div>}
          {inp.add_keywords && inp.add_keywords.length > 0 && (
            <div style={{ marginTop: 3 }}>
              <span style={{ color: '#22c55e', fontSize: 10, fontWeight: 600 }}>+ </span>
              {inp.add_keywords.map(function(kw: string, ki: number) {
                return <span key={ki} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#dcfce7', color: '#166534', marginRight: 3 }}>{kw}</span>
              })}
            </div>
          )}
          {inp.remove_keywords && inp.remove_keywords.length > 0 && (
            <div style={{ marginTop: 3 }}>
              <span style={{ color: '#ef4444', fontSize: 10, fontWeight: 600 }}>&minus; </span>
              {inp.remove_keywords.map(function(kw: string, ki: number) {
                return <span key={ki} style={{ fontSize: 10, padding: '1px 5px', borderRadius: 3, background: '#fee2e2', color: '#991b1b', marginRight: 3, textDecoration: 'line-through' }}>{kw}</span>
              })}
            </div>
          )}
        </div>
      )}

      {action.tool === 'merge_themes' && (
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <div>{(inp.theme_names || []).join(' + ')} <strong>{'\u2192'} {inp.merged_name}</strong></div>
          {inp.merged_description && <div style={{ color: '#6b7280' }}>{inp.merged_description}</div>}
        </div>
      )}

      {action.tool === 'delete_theme' && (
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <div>Remove: <strong>{inp.theme_name}</strong></div>
          {inp.reason && <div style={{ color: '#6b7280' }}>{inp.reason}</div>}
        </div>
      )}

      {action.tool === 'generate_report' && (
        <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>{inp.title}{inp.subtitle ? ' — ' + inp.subtitle : ''}</div>
          {(inp.slides || []).map(function(s: any, si: number) {
            var typeIcon: Record<string, string> = { bar_chart: '\u2593', kpi_grid: '\u25A3', table: '\u2261', bullets: '\u2022', quotes: '\u201C', two_column: '\u2016' }
            return (
              <div key={si} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 10, color: HERMES, fontWeight: 700, width: 14 }}>{typeIcon[s.type] || '?'}</span>
                <span style={{ fontSize: 11 }}>{s.title}</span>
                <span style={{ fontSize: 9, color: '#9ca3af' }}>({s.type})</span>
              </div>
            )
          })}
          <div style={{ fontSize: 10, color: '#9ca3af', marginTop: 4 }}>{(inp.slides || []).length} slides</div>
        </div>
      )}

      {/* Buttons */}
      {action.status === 'pending' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <button onClick={function() { setApplying(true); onApprove(msgId, actionIdx) }}
            disabled={applying}
            style={{
              flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600,
              background: HERMES, color: 'white', border: 'none',
              borderRadius: 8, cursor: applying ? 'default' : 'pointer',
              opacity: applying ? 0.6 : 1,
            }}>
            {applying ? (action.tool === 'generate_report' ? 'Building deck...' : 'Applying...') : (action.tool === 'generate_report' ? 'Build & Download' : 'Approve')}
          </button>
          <button onClick={function() { onReject(msgId, actionIdx) }}
            style={{
              flex: 1, padding: '6px 0', fontSize: 12, fontWeight: 600,
              background: 'white', color: '#6b7280', border: '1px solid #d1d5db',
              borderRadius: 8, cursor: 'pointer',
            }}>
            Cancel
          </button>
        </div>
      )}
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
