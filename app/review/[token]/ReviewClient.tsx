'use client'

// Public client-review surface: walk the batch's questions, draft a response from
// the agent's knowledge, edit/accept each. All actions go through the token-gated
// POST /api/review/[token]. No auth — the token in the URL is the capability.

import { useMemo, useState } from 'react'

interface Item { id: string; question: string; comment: string; aiDraft: string; answer: string; accepted?: boolean; status: string; origin: string; asker: string }

const TEAL = '#0F7173', TEAL_DK = '#0b5658', ORANGE = '#E85A1A', INK = '#0B1524'

export default function ReviewClient({ token, agentName, batchLabel, initial }: {
  token: string; agentName: string; batchLabel: string; initial: Item[]
}) {
  const [items, setItems] = useState<Item[]>(initial)
  const [i, setI] = useState(() => { const f = initial.findIndex(x => x.status !== 'answered'); return f >= 0 ? f : 0 })
  const [drafting, setDrafting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showComment, setShowComment] = useState(false)

  const cur = items[i]
  const answeredCount = useMemo(() => items.filter(x => x.status === 'answered').length, [items])
  const allDone = items.length > 0 && answeredCount === items.length
  const pct = items.length ? Math.round((answeredCount / items.length) * 100) : 0

  const editorValue = cur ? cur.answer : ''
  function setEditor(v: string) { if (cur) setItems(prev => prev.map((x, idx) => idx === i ? { ...x, answer: v } : x)) }
  function useSuggested() { if (cur) setItems(prev => prev.map((x, idx) => idx === i ? { ...x, answer: x.aiDraft } : x)) }

  async function generateDraft() {
    if (!cur) return
    setDrafting(true); setErr(null)
    try {
      const r = await fetch('/api/review/' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'draft', questionId: cur.id }) })
      const d = await r.json()
      if (!r.ok) { setErr(d?.error || 'Could not draft'); return }
      setItems(prev => prev.map((x, idx) => idx === i ? { ...x, aiDraft: d.draft || '' } : x))
    } catch { setErr('Network error') } finally { setDrafting(false) }
  }

  async function accept() {
    if (!cur) return
    const answer = cur.answer.trim()
    if (answer.length < 2) { setErr('Write or use the suggested response first.'); return }
    setSaving(true); setErr(null)
    try {
      const r = await fetch('/api/review/' + token, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'accept', questionId: cur.id, answer }) })
      const d = await r.json()
      if (!r.ok) { setErr(d?.error || 'Could not save'); return }
      setItems(prev => prev.map((x, idx) => idx === i ? { ...x, answer, accepted: true, status: 'answered' } : x))
      next()
    } catch { setErr('Network error') } finally { setSaving(false) }
  }

  function go(idx: number) { setI(idx); setShowComment(false); setErr(null) }
  function next() { const n = items.findIndex((x, idx) => idx > i && x.status !== 'answered'); go(n >= 0 ? n : Math.min(i + 1, items.length - 1)) }
  function prev() { if (i > 0) go(i - 1) }

  const responded = cur?.status === 'answered'

  return (
    <Shell agentName={agentName} batchLabel={batchLabel} answered={answeredCount} total={items.length} pct={pct}>
      {items.length === 0 ? (
        <div className="rv-card" style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>There are no questions to review.</div>
      ) : (
        <>
          {allDone && (
            <div className="rv-done">
              <span className="rv-done-check">✓</span>
              <div>
                <div style={{ fontWeight: 700, color: TEAL_DK }}>All {items.length} responses reviewed</div>
                <div style={{ fontSize: 13, color: '#5b7a78' }}>You can still revisit and refine any of them below.</div>
              </div>
            </div>
          )}

          {/* Progress dots / position */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '4px 2px 14px', gap: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>Question {i + 1} <span style={{ color: '#aab4c0' }}>of {items.length}</span></span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              {items.map((x, idx) => (
                <button key={x.id} onClick={() => go(idx)} title={`Question ${idx + 1}${x.status === 'answered' ? ' · responded' : ''}`}
                  className="rv-dot" style={{
                    width: idx === i ? 22 : 9, height: 9, borderRadius: 9, border: 'none', cursor: 'pointer', padding: 0,
                    background: idx === i ? ORANGE : x.status === 'answered' ? TEAL : '#d3dbe4',
                  }} />
              ))}
            </div>
          </div>

          {/* Main card */}
          <article className="rv-card" style={{ padding: 0, overflow: 'hidden' }}>
            <div style={{ padding: '22px 24px 4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
                <span className="rv-chip">{cur.origin}</span>
                {cur.asker && <span className="rv-chip rv-chip-asker">{cur.asker}</span>}
                <span style={{ flex: 1 }} />
                <span className="rv-status" style={{ color: responded ? TEAL_DK : '#9aa6b2', background: responded ? '#e8f6f4' : '#f1f5f9' }}>
                  {responded ? '✓ Responded' : 'Needs a response'}
                </span>
              </div>
              <h2 style={{ fontSize: 21, fontWeight: 700, color: INK, lineHeight: 1.35, letterSpacing: '-.01em', margin: 0 }}>{cur.question}</h2>
              {cur.comment && cur.comment.trim() !== cur.question.trim() && (
                <div style={{ marginTop: 10 }}>
                  <button onClick={() => setShowComment(s => !s)} className="rv-link" style={{ fontSize: 12.5 }}>
                    {showComment ? '▾ Hide original comment' : '▸ Read the original comment'}
                  </button>
                  {showComment && <div style={{ fontSize: 13.5, color: '#475569', whiteSpace: 'pre-wrap', lineHeight: 1.55, marginTop: 8, background: '#f8fafc', border: '1px solid #eaeff5', borderRadius: 12, padding: 14, maxHeight: 260, overflow: 'auto' }}>{cur.comment}</div>}
                </div>
              )}
            </div>

            {/* AI suggestion — read-only, preserved */}
            <div style={{ padding: '16px 24px 0' }}>
              <div className="rv-ai">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span className="rv-ai-badge">✦ Suggested by {agentName}</span>
                  <span style={{ flex: 1 }} />
                  <button onClick={generateDraft} disabled={drafting} className="rv-link" style={{ fontWeight: 600 }}>
                    {drafting ? 'Drafting…' : '↻ Re-draft'}
                  </button>
                </div>
                <div style={{ fontSize: 14.5, lineHeight: 1.6, color: '#143e3c', whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>
                  {cur.aiDraft || <span style={{ color: '#7fa3a0' }}>No suggestion yet — tap “Re-draft”.</span>}
                </div>
                {cur.aiDraft && (
                  <button onClick={useSuggested} className="rv-use">↧ Use this as my response</button>
                )}
              </div>
            </div>

            {/* The client's own response */}
            <div style={{ padding: '18px 24px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
                <span style={{ fontSize: 11.5, fontWeight: 800, color: INK, textTransform: 'uppercase', letterSpacing: '.07em' }}>Your response</span>
                <span style={{ fontSize: 11.5, color: '#aab4c0' }}>{editorValue.trim().length} chars · what gets sent back</span>
              </div>
              <textarea
                className="rv-textarea"
                value={editorValue}
                onChange={e => setEditor(e.target.value)}
                placeholder="Write your response here — or use the suggestion above as a starting point."
                rows={7}
                style={{ borderColor: editorValue.trim() ? TEAL : '#d8e0e9' }}
              />
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 14, alignItems: 'center' }}>
                <button onClick={accept} disabled={saving || editorValue.trim().length < 2} className="rv-primary"
                  style={{ background: editorValue.trim().length < 2 ? '#cbd5e1' : ORANGE, cursor: editorValue.trim().length < 2 ? 'default' : 'pointer', boxShadow: editorValue.trim().length < 2 ? 'none' : '0 6px 16px -6px rgba(232,90,26,.6)' }}>
                  {saving ? 'Saving…' : responded ? 'Update response' : 'Accept & continue'} <span style={{ opacity: .85 }}>→</span>
                </button>
                {err && <span style={{ color: '#dc2626', fontSize: 13, fontWeight: 500 }}>{err}</span>}
              </div>
            </div>
          </article>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
            <button onClick={prev} disabled={i === 0} className="rv-ghost">← Previous</button>
            <button onClick={next} disabled={i >= items.length - 1} className="rv-ghost">Skip →</button>
          </div>
        </>
      )}
    </Shell>
  )
}

function Shell({ agentName, batchLabel, answered, total, pct, children }: {
  agentName: string; batchLabel: string; answered: number; total: number; pct: number; children: React.ReactNode
}) {
  return (
    <div className="rv-root">
      <style>{CSS}</style>
      <header className="rv-header">
        <div className="rv-header-in">
          <div className="rv-wordmark"><span style={{ color: TEAL }}>data</span><span style={{ color: ORANGE }}>nautix</span></div>
          <div style={{ flex: 1 }} />
          {total > 0 && <span className="rv-progress-text">{answered} of {total} responded</span>}
        </div>
        {total > 0 && <div className="rv-bar"><div className="rv-bar-fill" style={{ width: pct + '%' }} /></div>}
      </header>

      <main className="rv-main">
        <div style={{ marginBottom: 22 }}>
          <div className="rv-eyebrow">Response Review{batchLabel ? ' · ' + batchLabel : ''}</div>
          <h1 className="rv-title">Review &amp; approve responses</h1>
          <p className="rv-sub">Each one is suggested from {agentName}’s knowledge. Edit anything, then accept — your wording is what gets sent back.</p>
        </div>
        {children}
        <div className="rv-foot">
          Powered by <span style={{ color: TEAL, fontWeight: 800 }}>data</span><span style={{ color: ORANGE, fontWeight: 800 }}>nautix</span>
        </div>
      </main>
    </div>
  )
}

const CSS = `
.rv-root{min-height:100vh;background:linear-gradient(180deg,#f7f9fc 0%,#eef2f7 100%);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Inter,Roboto,sans-serif;color:#0B1524;-webkit-font-smoothing:antialiased}
.rv-header{position:sticky;top:0;z-index:10;background:rgba(255,255,255,.82);backdrop-filter:saturate(180%) blur(12px);border-bottom:1px solid #e6ebf2}
.rv-header-in{max-width:760px;margin:0 auto;padding:14px 20px;display:flex;align-items:center}
.rv-wordmark{font-weight:800;font-size:16px;letter-spacing:-.02em}
.rv-progress-text{font-size:12.5px;font-weight:600;color:#64748b}
.rv-bar{height:3px;background:#e6ebf2;max-width:760px;margin:0 auto}
.rv-bar-fill{height:100%;background:linear-gradient(90deg,#0F7173,#14b8a6);transition:width .4s cubic-bezier(.4,0,.2,1)}
.rv-main{max-width:760px;margin:0 auto;padding:30px 20px 72px}
.rv-eyebrow{font-size:11.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#E85A1A;margin-bottom:8px}
.rv-title{font-size:27px;font-weight:800;letter-spacing:-.02em;color:#0B1524;margin:0}
.rv-sub{font-size:14.5px;line-height:1.55;color:#64748b;margin:8px 0 0;max-width:60ch}
.rv-card{background:#fff;border:1px solid #e8edf3;border-radius:18px;box-shadow:0 1px 2px rgba(15,23,42,.04),0 16px 40px -24px rgba(15,23,42,.18)}
.rv-chip{font-size:11px;font-weight:700;letter-spacing:.01em;color:#51607a;background:#eef2f7;border-radius:999px;padding:3px 11px}
.rv-chip-asker{color:#0b5658;background:#e8f6f4}
.rv-status{font-size:11px;font-weight:700;border-radius:999px;padding:3px 11px;white-space:nowrap}
.rv-ai{background:linear-gradient(180deg,#f3fbfa,#ebf7f6);border:1px solid #d6efeb;border-left:3px solid #0F7173;border-radius:14px;padding:14px 16px}
.rv-ai-badge{font-size:11.5px;font-weight:800;letter-spacing:.04em;color:#0b5658;text-transform:uppercase}
.rv-use{margin-top:10px;padding:7px 13px;border-radius:9px;border:1px solid #0F7173;background:#fff;color:#0b5658;font-weight:700;font-size:13px;cursor:pointer;transition:all .15s}
.rv-use:hover{background:#0F7173;color:#fff}
.rv-textarea{width:100%;padding:14px;border:2px solid #d8e0e9;border-radius:12px;font-size:16px;line-height:1.55;font-family:inherit;color:#0B1524;resize:vertical;transition:border-color .15s,box-shadow .15s;outline:none}
.rv-textarea:focus{border-color:#0F7173;box-shadow:0 0 0 4px rgba(15,113,115,.12)}
.rv-textarea::placeholder{color:#9aa6b2}
.rv-primary{padding:11px 22px;border-radius:12px;border:none;color:#fff;font-weight:700;font-size:15px;letter-spacing:.01em;transition:transform .12s,box-shadow .15s,filter .15s}
.rv-primary:hover:not(:disabled){filter:brightness(1.04);transform:translateY(-1px)}
.rv-primary:active:not(:disabled){transform:translateY(0)}
.rv-ghost{padding:9px 16px;border-radius:11px;border:1px solid #e2e8f0;background:#fff;color:#475569;font-size:14px;font-weight:600;cursor:pointer;transition:all .15s}
.rv-ghost:hover:not(:disabled){border-color:#cbd5e1;background:#f8fafc}
.rv-ghost:disabled{opacity:.4;cursor:default}
.rv-link{background:none;border:none;color:#0b5658;cursor:pointer;font-size:12.5px;padding:0}
.rv-link:hover{text-decoration:underline}
.rv-dot{transition:width .2s,background .2s}
.rv-done{display:flex;align-items:center;gap:12px;background:linear-gradient(180deg,#effaf8,#e3f5f1);border:1px solid #c5e9e2;border-radius:14px;padding:14px 18px;margin-bottom:18px}
.rv-done-check{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:999px;background:#0F7173;color:#fff;font-weight:800;flex-shrink:0}
.rv-foot{margin-top:32px;text-align:center;font-size:12px;color:#9aa6b2}
@media(max-width:560px){.rv-title{font-size:23px}.rv-main{padding:22px 14px 60px}}
`
