'use client'

import { useEffect, useState } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'
import {
  REO_DOMAINS, REO_ASPECTS, REO_SENTIMENTS, REO_SEVERITIES, REO_DOMAIN_COLOR, aspectDef,
  type ReoDomain, type ReoObservation,
} from '@/lib/reoVocabulary'

const HERMES = '#E8632A', NAVY = '#0f172a', SLATE = '#64748b', GREEN = '#059669', RED = '#DC2626'

interface Review {
  id: string
  ext_review_id: string
  rating: number | null
  review_text: string
  proposed: ReoObservation[]
  gold: ReoObservation[] | null
  reviewer_note: string | null
  status: string
}
type WorkObs = ReoObservation & { _keep: boolean }

const sentColor = (s: string) => s === 'Positive' ? GREEN : s === 'Negative' ? RED : SLATE
const inputStyle: React.CSSProperties = { fontSize: 16, padding: '5px 7px', borderRadius: 8, border: '1px solid #e2e8f0', background: '#fff', color: NAVY }

export default function GoldSetClient() {
  const [reviews, setReviews] = useState<Review[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [idx, setIdx] = useState(0)
  const [working, setWorking] = useState<WorkObs[]>([])
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function load() {
    setLoading(true)
    const res = await fetch('/api/admin/reo-gold-set')
    if (!res.ok) { setErr('Failed to load. Has the gold set been seeded?'); setLoading(false); return }
    const j = await res.json()
    setReviews(j.reviews || [])
    setCounts(j.counts || {})
    const firstPending = (j.reviews || []).findIndex((r: Review) => r.status === 'pending')
    setIdx(firstPending >= 0 ? firstPending : 0)
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const cur = reviews[idx]
  useEffect(() => {
    if (!cur) return
    const base = (cur.gold ?? cur.proposed) as ReoObservation[]
    setWorking(base.map(o => ({ ...o, _keep: true })))
    setNote(cur.reviewer_note ?? '')
    setErr('')
  }, [idx, cur?.id])

  const reviewedCount = (counts.approved || 0) + (counts.edited || 0) + (counts.skipped || 0)
  const keptCount = working.filter(o => o._keep).length

  function setObs(i: number, patch: Partial<WorkObs>) {
    setWorking(w => w.map((o, j) => j === i ? { ...o, ...patch } : o))
  }
  function changeDomain(i: number, domain: ReoDomain) {
    setObs(i, { domain, aspect: REO_ASPECTS[domain][0] })
  }
  function toggleKeep(i: number) { setObs(i, { _keep: !working[i]._keep }) }
  function addObs() {
    setWorking(w => [...w, { domain: 'FoodBeverage', aspect: REO_ASPECTS.FoodBeverage[0], sentiment: 'Negative', evidence: '', severity: 'none', _keep: true }])
  }
  function removeObs(i: number) { setWorking(w => w.filter((_, j) => j !== i)) }

  async function save(status: 'approved' | 'edited' | 'skipped') {
    if (!cur || saving) return
    setSaving(true); setErr('')
    const body: any = { id: cur.id, status, reviewer_note: note }
    if (status === 'approved') body.gold = cur.proposed
    else if (status === 'edited') body.gold = working.filter(o => o._keep).map(({ _keep, ...o }) => o)
    const res = await fetch('/api/admin/reo-gold-set', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) { const j = await res.json().catch(() => ({})); setErr(j.error || 'Save failed'); setSaving(false); return }
    const wasPending = cur.status === 'pending'
    setReviews(rs => rs.map((r, j) => j === idx ? { ...r, status, gold: body.gold ?? null, reviewer_note: note } : r))
    setCounts(c => ({ ...c, [status]: (c[status] || 0) + 1, pending: Math.max(0, (c.pending || 0) - (wasPending ? 1 : 0)) }))
    setSaving(false)
    const nextPending = reviews.findIndex((r, j) => j > idx && r.status === 'pending')
    setIdx(nextPending >= 0 ? nextPending : Math.min(idx + 1, reviews.length - 1))
  }

  if (loading) return <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}><LottieLoader message="Loading gold set…" /></div>

  if (!reviews.length) return (
    <main className="max-w-4xl mx-auto px-6 pt-24 pb-16">
      <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY }}>Dimensions Gold Set</h1>
      <p style={{ color: SLATE, marginTop: 8 }}>No reviews yet. Seed the set by running <code>npx tsx scripts/seed-reo-goldset.ts</code> from the repo, then refresh.</p>
      {err && <p style={{ color: RED, marginTop: 8 }}>{err}</p>}
    </main>
  )

  return (
    <main className="max-w-4xl mx-auto px-6 pt-24 pb-16">
      {/* Header + progress */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, color: NAVY }}>Dimensions Gold Set</h1>
          <p style={{ color: SLATE, fontSize: 13, marginTop: 4 }}>Judge each proposed label: keep the right ones, drop the wrong ones, add anything I missed. The definition is under each label so you don’t have to guess.</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: NAVY }}>{reviewedCount} / {reviews.length} reviewed</div>
          <div style={{ fontSize: 12, color: SLATE }}>
            <span style={{ color: GREEN }}>{counts.approved || 0} approved</span> · {counts.edited || 0} edited · {counts.skipped || 0} skipped
          </div>
        </div>
      </div>

      {/* Progress dots */}
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 18 }}>
        {reviews.map((r, j) => (
          <button key={r.id} onClick={() => setIdx(j)} title={`${r.ext_review_id} — ${r.status}`}
            style={{ width: 18, height: 18, borderRadius: 5, cursor: 'pointer', fontSize: 0,
              border: j === idx ? `2px solid ${NAVY}` : '1px solid #e2e8f0',
              background: r.status === 'pending' ? '#fff' : r.status === 'skipped' ? '#e2e8f0' : r.status === 'approved' ? '#bbf7d0' : '#fde68a' }} />
        ))}
      </div>

      {/* Review card */}
      <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 14, padding: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: HERMES, letterSpacing: 0.4 }}>{cur.ext_review_id}</span>
          {cur.rating != null && <span style={{ fontSize: 13, color: '#D97706' }}>{'★'.repeat(cur.rating)}{'☆'.repeat(5 - cur.rating)}</span>}
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, padding: '2px 9px', borderRadius: 999,
            background: cur.status === 'pending' ? '#f1f5f9' : '#ecfdf5', color: cur.status === 'pending' ? SLATE : GREEN }}>{cur.status}</span>
        </div>
        <p style={{ fontSize: 15, lineHeight: 1.55, color: '#1e293b', marginBottom: 18, whiteSpace: 'pre-wrap' }}>{cur.review_text}</p>

        {/* Observations — tap to keep/drop */}
        <div style={{ fontSize: 12, fontWeight: 800, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>
          Labels — keeping {keptCount} of {working.length}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {working.map((o, i) => {
            const dropped = !o._keep
            return (
              <div key={i} style={{ padding: 10, borderRadius: 10, border: '1px solid ' + (dropped ? '#fee2e2' : '#eef2f7'), background: dropped ? '#fef2f2' : '#fafbfc', opacity: dropped ? 0.6 : 1 }}>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                  {/* keep/drop toggle */}
                  <button onClick={() => toggleKeep(i)} title={dropped ? 'Rejected — click to keep' : 'Kept — click to drop'}
                    style={{ width: 30, height: 30, borderRadius: 8, cursor: 'pointer', flexShrink: 0, fontSize: 15, fontWeight: 800,
                      border: '1px solid ' + (dropped ? '#fca5a5' : '#a7f3d0'), background: dropped ? '#fff' : '#ecfdf5', color: dropped ? RED : GREEN }}>
                    {dropped ? '✗' : '✓'}
                  </button>
                  <span style={{ width: 9, height: 9, borderRadius: 3, background: REO_DOMAIN_COLOR[o.domain] || SLATE, flexShrink: 0, textDecoration: dropped ? 'line-through' : 'none' }} />
                  <select value={o.domain} onChange={e => changeDomain(i, e.target.value as ReoDomain)} style={{ ...inputStyle, fontWeight: 700 }}>
                    {REO_DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                  <select value={o.aspect} onChange={e => setObs(i, { aspect: e.target.value })} style={inputStyle}>
                    {REO_ASPECTS[o.domain].map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                  <select value={o.sentiment} onChange={e => setObs(i, { sentiment: e.target.value as any })} style={{ ...inputStyle, fontWeight: 700, color: sentColor(o.sentiment) }}>
                    {REO_SENTIMENTS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <select value={o.severity || 'none'} onChange={e => setObs(i, { severity: e.target.value as any })} title="Severity flag"
                    style={{ ...inputStyle, color: o.severity && o.severity !== 'none' ? RED : SLATE }}>
                    {REO_SEVERITIES.map(s => <option key={s} value={s}>{s === 'none' ? '—' : s}</option>)}
                  </select>
                  <input value={o.evidence || ''} onChange={e => setObs(i, { evidence: e.target.value })} placeholder="evidence span…"
                    style={{ ...inputStyle, flex: 1, minWidth: 130 }} />
                  <button onClick={() => removeObs(i)} title="Remove entirely" style={{ border: 'none', background: 'transparent', color: SLATE, fontSize: 16, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>🗑</button>
                </div>
                {/* inline definition so judging is unambiguous */}
                <div style={{ fontSize: 12, color: SLATE, marginTop: 6, marginLeft: 38, fontStyle: 'italic' }}>
                  {aspectDef(o.domain, o.aspect) || '—'}
                </div>
              </div>
            )
          })}
        </div>
        <button onClick={addObs} style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: HERMES, background: '#fff', border: `1px dashed ${HERMES}`, borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>+ Add a label I missed</button>

        {/* Guidance note */}
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: SLATE, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Note to guide me (optional)</div>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="e.g. 'I wasn’t sure where the dish itself goes' or 'cold service should also be Friendliness'"
            style={{ ...inputStyle, width: '100%', resize: 'vertical', fontSize: 16 }} />
        </div>

        {err && <p style={{ color: RED, fontSize: 13, marginTop: 10 }}>{err}</p>}

        {/* Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 18, flexWrap: 'wrap' }}>
          <button disabled={saving} onClick={() => save('approved')}
            style={{ fontSize: 14, fontWeight: 700, color: '#fff', background: GREEN, border: 'none', borderRadius: 10, padding: '9px 16px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>✓ All correct</button>
          <button disabled={saving} onClick={() => save('edited')}
            style={{ fontSize: 14, fontWeight: 700, color: '#fff', background: HERMES, border: 'none', borderRadius: 10, padding: '9px 16px', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>Save my judgments</button>
          <button disabled={saving} onClick={() => save('skipped')}
            style={{ fontSize: 13, fontWeight: 600, color: SLATE, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '9px 14px', cursor: 'pointer' }}>Not sure — skip</button>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button disabled={idx === 0} onClick={() => setIdx(i => Math.max(0, i - 1))} style={{ fontSize: 13, color: NAVY, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', cursor: idx === 0 ? 'default' : 'pointer', opacity: idx === 0 ? 0.4 : 1 }}>← Prev</button>
            <button disabled={idx >= reviews.length - 1} onClick={() => setIdx(i => Math.min(reviews.length - 1, i + 1))} style={{ fontSize: 13, color: NAVY, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px', cursor: idx >= reviews.length - 1 ? 'default' : 'pointer', opacity: idx >= reviews.length - 1 ? 0.4 : 1 }}>Next →</button>
          </div>
        </div>
      </div>
    </main>
  )
}
