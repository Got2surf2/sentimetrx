'use client'

// app/bots/[id]/knowledge/page.tsx
// Knowledge base CRUD viewer — view, add, edit, delete individual chunks

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'

var HERMES = '#E8632A'

interface Chunk {
  id: string
  title: string
  content: string
  metadata: { sentiment?: string; opponent?: string; source?: string } | null
  created_at: string
}

export default function KnowledgeClient() {
  var params = useParams()
  var router = useRouter()
  var botId = params.id as string

  var [chunks, setChunks] = useState<Chunk[]>([])
  var [loading, setLoading] = useState(true)
  var [botName, setBotName] = useState('')
  var [search, setSearch] = useState('')
  var [filterType, setFilterType] = useState('all')

  // Add/edit state
  var [showAdd, setShowAdd] = useState(false)
  var [addTitle, setAddTitle] = useState('')
  var [addContent, setAddContent] = useState('')
  var [addType, setAddType] = useState<'fact' | 'faq' | 'general'>('general')
  var [addFaqQ, setAddFaqQ] = useState('')
  var [saving, setSaving] = useState(false)

  // Edit state
  var [editId, setEditId] = useState<string | null>(null)
  var [editTitle, setEditTitle] = useState('')
  var [editContent, setEditContent] = useState('')

  useEffect(function() {
    fetch('/api/bots/' + botId).then(function(r) { return r.json() }).then(function(d) {
      if (d.name) setBotName(d.name)
    }).catch(function() {})
    loadChunks()
  }, [botId])

  function loadChunks() {
    setLoading(true)
    fetch('/api/bots/' + botId + '/knowledge')
      .then(function(r) { return r.json() })
      .then(function(d) { setChunks(d.chunks || []) })
      .catch(function() {})
      .finally(function() { setLoading(false) })
  }

  async function addChunk() {
    if (!addContent.trim()) return
    setSaving(true)
    var text = ''
    var title = addTitle.trim() || 'New entry'
    if (addType === 'faq' && addFaqQ.trim()) {
      text = '### ' + addFaqQ.trim() + '\n' + addContent.trim()
    } else if (addType === 'fact') {
      text = '### ' + title + '\n' + addContent.trim()
    } else {
      text = addTitle.trim() ? '## ' + addTitle.trim() + '\n' + addContent.trim() : addContent.trim()
    }
    try {
      await fetch('/api/bots/' + botId + '/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text }),
      })
      setAddTitle(''); setAddContent(''); setAddFaqQ(''); setShowAdd(false)
      loadChunks()
    } catch { alert('Failed to add') }
    setSaving(false)
  }

  async function updateChunk() {
    if (!editId || !editContent.trim()) return
    setSaving(true)
    try {
      await fetch('/api/bots/' + botId + '/knowledge/' + editId, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle, content: editContent }),
      })
      setEditId(null)
      loadChunks()
    } catch { alert('Failed to update') }
    setSaving(false)
  }

  async function deleteChunk(id: string) {
    if (!confirm('Delete this knowledge chunk?')) return
    try {
      await fetch('/api/bots/' + botId + '/knowledge/' + id, { method: 'DELETE' })
      setChunks(function(prev) { return prev.filter(function(c) { return c.id !== id }) })
      if (editId === id) setEditId(null)
    } catch { alert('Failed to delete') }
  }

  // Categorize chunks
  function getChunkType(c: Chunk): string {
    if (c.metadata?.opponent) return 'opponent'
    if (c.metadata?.sentiment === 'negative') return 'negative'
    if (c.title?.startsWith('Fact ') || c.metadata?.source === 'fact') return 'fact'
    if (c.title?.includes('?') || c.metadata?.source === 'faq') return 'faq'
    return 'general'
  }

  var typeColors: Record<string, { bg: string; color: string; label: string }> = {
    general: { bg: '#F3F4F6', color: '#374151', label: 'General' },
    faq: { bg: '#DBEAFE', color: '#1D4ED8', label: 'FAQ' },
    fact: { bg: '#D1FAE5', color: '#059669', label: 'Fact' },
    opponent: { bg: '#FEF3C7', color: '#D97706', label: 'Opponent' },
    negative: { bg: '#FEE2E2', color: '#DC2626', label: 'Negative' },
  }

  var filtered = chunks.filter(function(c) {
    if (filterType !== 'all' && getChunkType(c) !== filterType) return false
    if (search.trim()) {
      var q = search.toLowerCase()
      if (!(c.title || '').toLowerCase().includes(q) && !(c.content || '').toLowerCase().includes(q)) return false
    }
    return true
  })

  // Stats
  var typeCounts: Record<string, number> = {}
  chunks.forEach(function(c) { var t = getChunkType(c); typeCounts[t] = (typeCounts[t] || 0) + 1 })
  var totalChars = chunks.reduce(function(sum, c) { return sum + (c.content?.length || 0) }, 0)

  var pill = function(active: boolean, bg: string, color: string) {
    return {
      padding: '4px 12px', borderRadius: 16, fontSize: 11, fontWeight: 600 as const, cursor: 'pointer' as const, border: 'none',
      background: active ? color : bg, color: active ? 'white' : color, transition: 'all 0.15s',
    }
  }

  return (
    <div style={{ maxWidth: 1000, margin: '0 auto', padding: '32px 24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
        <button onClick={function() { router.push('/bots') }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: '#6b7280' }}>&larr; Back</button>
        <div style={{ flex: 1 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{botName || 'Agent'} — Knowledge Base</h1>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>{chunks.length} chunks · {totalChars.toLocaleString()} chars</p>
        </div>
        <button onClick={function() { setShowAdd(!showAdd) }}
          style={{ padding: '8px 20px', borderRadius: 20, border: 'none', background: HERMES, color: 'white', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
          + Add Knowledge
        </button>
      </div>

      {/* Stats bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {Object.entries(typeCounts).map(function(entry) {
          var tc = typeColors[entry[0]] || typeColors.general
          return (
            <div key={entry[0]} style={{ padding: '8px 16px', borderRadius: 10, background: tc.bg, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 18, fontWeight: 700, color: tc.color }}>{entry[1]}</span>
              <span style={{ fontSize: 11, color: tc.color, fontWeight: 500 }}>{tc.label}</span>
            </div>
          )
        })}
      </div>

      {/* Add panel */}
      {showAdd && (
        <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>Add Knowledge</span>
            <div style={{ display: 'flex', gap: 4 }}>
              {[{ val: 'general', label: 'General' }, { val: 'fact', label: 'Fact' }, { val: 'faq', label: 'FAQ' }].map(function(opt) {
                return <button key={opt.val} onClick={function() { setAddType(opt.val as any) }}
                  style={{ padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600, border: 'none', cursor: 'pointer', background: addType === opt.val ? HERMES : '#F3F4F6', color: addType === opt.val ? 'white' : '#6b7280' }}>
                  {opt.label}
                </button>
              })}
            </div>
          </div>
          {addType === 'faq' && (
            <input type="text" value={addFaqQ} onChange={function(e) { setAddFaqQ(e.target.value) }}
              placeholder="Question (e.g., What are your office hours?)"
              style={{ display: 'block', width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, marginBottom: 8 }} />
          )}
          {addType !== 'faq' && (
            <input type="text" value={addTitle} onChange={function(e) { setAddTitle(e.target.value) }}
              placeholder="Title (optional)"
              style={{ display: 'block', width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, marginBottom: 8 }} />
          )}
          <textarea value={addContent} onChange={function(e) { setAddContent(e.target.value) }}
            placeholder={addType === 'faq' ? 'Answer...' : addType === 'fact' ? 'Fact or talking point...' : 'Knowledge content (markdown supported)...'}
            rows={4}
            style={{ display: 'block', width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical', fontFamily: 'monospace' }} />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
            <button onClick={function() { setShowAdd(false) }}
              style={{ padding: '6px 16px', borderRadius: 16, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 12, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
            <button onClick={() => { void addChunk() }} disabled={saving || !addContent.trim()}
              style={{ padding: '6px 16px', borderRadius: 16, border: 'none', background: saving ? '#9ca3af' : HERMES, color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {saving ? <><LottieLoader size={16} /> Adding...</> : 'Add'}
            </button>
          </div>
        </div>
      )}

      {/* Filter bar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <input type="text" value={search} onChange={function(e) { setSearch(e.target.value) }}
          placeholder="Search knowledge..."
          style={{ padding: '6px 12px', borderRadius: 20, border: '1px solid #d1d5db', fontSize: 12, width: 220 }} />
        <button onClick={function() { setFilterType('all') }} style={pill(filterType === 'all', '#F3F4F6', '#6b7280')}>All ({chunks.length})</button>
        {Object.entries(typeCounts).map(function(entry) {
          var tc = typeColors[entry[0]] || typeColors.general
          return <button key={entry[0]} onClick={function() { setFilterType(entry[0]) }} style={pill(filterType === entry[0], tc.bg, tc.color)}>{tc.label} ({entry[1]})</button>
        })}
      </div>

      {/* Chunks list */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 40 }}><LottieLoader size={60} /></div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 48, background: 'white', borderRadius: 16, border: '2px dashed #e5e7eb' }}>
          <p style={{ fontSize: 16, fontWeight: 600, color: '#374151' }}>{chunks.length === 0 ? 'No knowledge yet' : 'No chunks match'}</p>
          <p style={{ fontSize: 13, color: '#6b7280', marginTop: 8 }}>Add knowledge from the agent editor or use the button above.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(function(c) {
            var ct = getChunkType(c)
            var tc = typeColors[ct] || typeColors.general
            var isEditing = editId === c.id

            if (isEditing) {
              return (
                <div key={c.id} style={{ background: 'white', border: '2px solid ' + HERMES, borderRadius: 12, padding: 16 }}>
                  <input type="text" value={editTitle} onChange={function(e) { setEditTitle(e.target.value) }}
                    style={{ display: 'block', width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, fontWeight: 600, marginBottom: 8 }} />
                  <textarea value={editContent} onChange={function(e) { setEditContent(e.target.value) }}
                    rows={6}
                    style={{ display: 'block', width: '100%', padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, resize: 'vertical', fontFamily: 'monospace' }} />
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                    <button onClick={function() { setEditId(null) }}
                      style={{ padding: '5px 14px', borderRadius: 14, border: '1px solid #d1d5db', background: 'white', color: '#374151', fontSize: 11, fontWeight: 500, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={() => { void updateChunk() }} disabled={saving}
                      style={{ padding: '5px 14px', borderRadius: 14, border: 'none', background: HERMES, color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                      {saving ? <><LottieLoader size={14} /> Saving...</> : 'Save'}
                    </button>
                  </div>
                </div>
              )
            }

            return (
              <div key={c.id} style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: '12px 16px', transition: 'all 0.15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 9, fontWeight: 600, padding: '2px 8px', borderRadius: 8, background: tc.bg, color: tc.color, textTransform: 'uppercase' }}>{tc.label}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{c.title}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={function() { setEditId(c.id); setEditTitle(c.title); setEditContent(c.content) }}
                      style={{ padding: '3px 10px', borderRadius: 10, border: '1px solid #d1d5db', background: 'white', color: '#6b7280', fontSize: 10, fontWeight: 500, cursor: 'pointer' }}>Edit</button>
                    <button onClick={function() { void deleteChunk(c.id) }}
                      style={{ padding: '3px 10px', borderRadius: 10, border: '1px solid #fecaca', background: '#fef2f2', color: '#dc2626', fontSize: 10, fontWeight: 500, cursor: 'pointer' }}>Delete</button>
                  </div>
                </div>
                <p style={{ fontSize: 12, color: '#4b5563', lineHeight: 1.6, whiteSpace: 'pre-wrap', maxHeight: 120, overflow: 'hidden' }}>
                  {c.content.length > 300 ? c.content.slice(0, 300) + '...' : c.content}
                </p>
                <div style={{ display: 'flex', gap: 8, marginTop: 6, fontSize: 10, color: '#9ca3af' }}>
                  <span>{c.content.length} chars</span>
                  {c.metadata?.sentiment && <span>Sentiment: {c.metadata.sentiment}</span>}
                  {c.metadata?.opponent && <span>Opponent: {c.metadata.opponent}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
