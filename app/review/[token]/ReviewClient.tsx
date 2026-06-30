'use client'

// Public client-review surface: walk the batch's questions, draft a response from
// the agent's knowledge, edit/accept each. All actions go through the token-gated
// POST /api/review/[token]. No auth — the token in the URL is the capability.

import { useMemo, useState } from 'react'

interface Item { id: string; question: string; comment: string; answer: string; status: string; asker: string }

const TEAL = '#0F7173', ORANGE = '#E85A1A'

export default function ReviewClient({ token, agentName, batchLabel, initial }: {
  token: string; agentName: string; batchLabel: string; initial: Item[]
}) {
  const [items, setItems] = useState<Item[]>(initial)
  const [i, setI] = useState(() => { const f = initial.findIndex(x => x.status !== 'answered'); return f >= 0 ? f : 0 })
  const [draftText, setDraftText] = useState('')
  const [drafting, setDrafting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showComment, setShowComment] = useState(false)

  const cur = items[i]
  const answeredCount = useMemo(() => items.filter(x => x.status === 'answered').length, [items])

  // The editor value: the saved/accepted answer, else the in-session draft.
  const editorValue = cur ? (cur.answer || draftText) : ''

  function setEditor(v: string) {
    if (!cur) return
    if (cur.answer) setItems(prev => prev.map((x, idx) => idx === i ? { ...x, answer: v } : x))
    else setDraftText(v)
  }

  async function generateDraft() {
    if (!cur) return
    setDrafting(true); setErr(null)
    try {
      const r = await fetch('/api/review/' + token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'draft', questionId: cur.id }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d?.error || 'Could not draft'); return }
      setDraftText(d.draft || '')
    } catch { setErr('Network error') } finally { setDrafting(false) }
  }

  async function accept() {
    if (!cur) return
    const answer = (cur.answer || draftText).trim()
    if (answer.length < 2) { setErr('Write or generate a response first.'); return }
    setSaving(true); setErr(null)
    try {
      const r = await fetch('/api/review/' + token, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'accept', questionId: cur.id, answer }),
      })
      const d = await r.json()
      if (!r.ok) { setErr(d?.error || 'Could not save'); return }
      setItems(prev => prev.map((x, idx) => idx === i ? { ...x, answer, status: 'answered' } : x))
      next()
    } catch { setErr('Network error') } finally { setSaving(false) }
  }

  function go(idx: number) { setI(idx); setDraftText(''); setShowComment(false); setErr(null) }
  function next() { const n = items.findIndex((x, idx) => idx > i && x.status !== 'answered'); go(n >= 0 ? n : Math.min(i + 1, items.length - 1)) }
  function prev() { if (i > 0) go(i - 1) }

  if (items.length === 0) {
    return <Shell agentName={agentName} batchLabel={batchLabel}><p style={{ color: '#475569' }}>There are no questions to review.</p></Shell>
  }

  return (
    <Shell agentName={agentName} batchLabel={batchLabel}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontSize: 13, color: '#64748b' }}>
          Question {i + 1} of {items.length} · <span style={{ color: TEAL, fontWeight: 600 }}>{answeredCount} responded</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {items.map((x, idx) => (
            <span key={x.id} title={x.status === 'answered' ? 'responded' : 'open'}
              style={{ width: 8, height: 8, borderRadius: 8, background: idx === i ? ORANGE : x.status === 'answered' ? TEAL : '#cbd5e1' }} />
          ))}
        </div>
      </div>

      <div style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: 12, padding: 20, boxShadow: '0 1px 2px rgba(0,0,0,.04)' }}>
        {cur.asker && <div style={{ fontSize: 12, color: TEAL, fontWeight: 600, marginBottom: 6 }}>{cur.asker}</div>}
        <div style={{ fontSize: 17, fontWeight: 600, color: '#0f172a', lineHeight: 1.4 }}>{cur.question}</div>
        {cur.comment && cur.comment.trim() !== cur.question.trim() && (
          <div style={{ marginTop: 8 }}>
            <button onClick={() => setShowComment(s => !s)} style={{ fontSize: 12, color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
              {showComment ? '▾ Hide full comment' : '▸ Show full comment'}
            </button>
            {showComment && <div style={{ fontSize: 13, color: '#475569', whiteSpace: 'pre-wrap', marginTop: 6, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: 12, maxHeight: 240, overflow: 'auto' }}>{cur.comment}</div>}
          </div>
        )}

        <div style={{ marginTop: 16, fontSize: 12, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '.05em' }}>Suggested response</div>
        <textarea
          value={editorValue}
          onChange={e => setEditor(e.target.value)}
          placeholder={'Generate a suggested response, or write your own…'}
          rows={7}
          style={{ width: '100%', marginTop: 6, padding: 12, border: '1px solid #cbd5e1', borderRadius: 10, fontSize: 16, lineHeight: 1.5, fontFamily: 'inherit', resize: 'vertical' }}
        />

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'center' }}>
          <button onClick={generateDraft} disabled={drafting}
            style={{ padding: '9px 16px', borderRadius: 10, border: '1px solid ' + TEAL, background: 'white', color: TEAL, fontWeight: 600, fontSize: 14, cursor: 'pointer', opacity: drafting ? 0.6 : 1 }}>
            {drafting ? 'Drafting…' : editorValue ? '↻ Re-draft from knowledge' : '✨ Draft from knowledge'}</button>
          <button onClick={accept} disabled={saving || editorValue.trim().length < 2}
            style={{ padding: '9px 20px', borderRadius: 10, border: 'none', background: editorValue.trim().length < 2 ? '#cbd5e1' : ORANGE, color: 'white', fontWeight: 700, fontSize: 14, cursor: editorValue.trim().length < 2 ? 'default' : 'pointer' }}>
            {saving ? 'Saving…' : cur.status === 'answered' ? 'Update response →' : 'Accept & next →'}</button>
          {err && <span style={{ color: '#dc2626', fontSize: 13 }}>{err}</span>}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
        <button onClick={prev} disabled={i === 0} style={navBtn(i === 0)}>← Previous</button>
        <button onClick={next} disabled={i >= items.length - 1} style={navBtn(i >= items.length - 1)}>Skip →</button>
      </div>
    </Shell>
  )
}

const navBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '8px 14px', borderRadius: 10, border: '1px solid #e2e8f0', background: 'white',
  color: '#475569', fontSize: 14, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.4 : 1,
})

function Shell({ agentName, batchLabel, children }: { agentName: string; batchLabel: string; children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: '#f1f5f9', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 16px 64px' }}>
        <div style={{ marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0f172a', margin: 0 }}>Review responses{batchLabel ? ' — ' + batchLabel : ''}</h1>
          <p style={{ fontSize: 14, color: '#64748b', margin: '6px 0 0' }}>
            Each response is suggested from {agentName}’s knowledge. Edit anything, then accept — your accepted wording is what gets sent back.
          </p>
        </div>
        {children}
        <div style={{ marginTop: 28, textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
          Powered by <span style={{ color: TEAL, fontWeight: 700 }}>data</span><span style={{ color: ORANGE, fontWeight: 700 }}>nautix</span>
        </div>
      </div>
    </div>
  )
}
