'use client'

// Research Probes results dashboard (BOTS.md §14.6): per-probe outcome funnel,
// response/decline rates, quota progress, coded distribution, wording variants
// (concept mode) and verbatim answers. Read-only; probes are configured in the
// agent editor's "Research Probes" section.

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import LottieLoader from '@/components/ui/LottieLoader'

export interface ProbeResult {
  probe_id: string
  version: number
  question: string
  mode: string | null
  enabled: boolean
  target_n: number | null
  answered_quota: number
  funnel: { assigned: number; asked: number; asked_answered: number; asked_declined: number; asked_ignored: number; never_fit: number; quota_closed: number }
  response_rate: number | null
  decline_rate: number | null
  coded: { yes_no: { yes: number; no: number }; emotion: Record<string, number> }
  wording_variants: { wording: string; n: number }[]
  answers: { answer_text: string; followup_text: string | null; asked_wording: string | null; asked_turn: number | null; coded: Record<string, unknown> | null; created_at: string }[]
}

const TEAL = '#0F7173'

export default function ProbesClient() {
  const params = useParams()
  const botId = String(params?.id || '')
  const [data, setData] = useState<{ agent: { id: string; name: string }; enabled_count: number; probes: ProbeResult[] } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!botId) return
    fetch('/api/bots/' + botId + '/probes')
      .then(r => r.json().then(d => ({ ok: r.ok, d })))
      .then(({ ok, d }) => { if (!ok) setError(d.error || 'Failed to load'); else setData(d) })
      .catch(() => setError('Failed to load'))
  }, [botId])

  if (error) return <div className="max-w-4xl mx-auto p-8 text-sm text-red-600">{error}</div>
  if (!data) return <div className="pt-24"><LottieLoader size={80} message="Loading probe results…" /></div>

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{data.agent.name} — Research Probes</h1>
        <p className="text-xs text-gray-500 mt-1">
          Every sampled conversation resolves to exactly one outcome — response and decline rates are part of the result, not survivorship.
          Results are grouped per question version; a wording change starts a fresh line.
        </p>
      </div>

      {data.probes.length === 0 && (
        <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-500">
          No research probes yet. Add one in the agent editor&apos;s <b>Research Probes</b> section — it starts collecting on the next conversation.
        </div>
      )}

      {data.probes.map(p => <ProbeCard key={p.probe_id + '@' + p.version} p={p} />)}
    </div>
  )
}

function Pct({ v }: { v: number | null }) {
  return <>{v == null ? '—' : Math.round(v * 100) + '%'}</>
}

export function ProbeCard({ p }: { p: ProbeResult }) {
  const [showAnswers, setShowAnswers] = useState(false)
  const f = p.funnel
  const funnelSteps = [
    { label: 'Assigned', n: f.assigned, color: '#94a3b8' },
    { label: 'Asked', n: f.asked, color: '#60a5fa' },
    { label: 'Answered', n: f.asked_answered, color: TEAL },
  ]
  const max = Math.max(f.assigned, 1)
  const emotionEntries = Object.entries(p.coded.emotion).sort((a, b) => b[1] - a[1])
  const hasYesNo = p.coded.yes_no.yes + p.coded.yes_no.no > 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-gray-900">&ldquo;{p.question}&rdquo;</div>
          <div className="flex items-center gap-2 mt-1.5">
            <span className="text-[10px] font-mono text-gray-400">{p.probe_id} · v{p.version}</span>
            {p.mode && <Chip text={p.mode} tone={p.mode === 'verbatim' ? 'teal' : 'blue'} />}
            <Chip text={p.enabled ? 'active' : 'inactive'} tone={p.enabled ? 'green' : 'gray'} />
            {p.target_n != null && p.target_n > 0 && (
              <Chip text={`quota ${Math.min(p.answered_quota, p.target_n)}/${p.target_n}${p.answered_quota >= p.target_n ? ' — closed' : ''}`} tone={p.answered_quota >= p.target_n ? 'amber' : 'gray'} />
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] text-gray-400 uppercase tracking-wide">Response / Decline</div>
          <div className="text-sm font-bold text-gray-800"><Pct v={p.response_rate} /> <span className="text-gray-300 font-normal">/</span> <Pct v={p.decline_rate} /></div>
        </div>
      </div>

      {/* Funnel */}
      <div className="space-y-1">
        {funnelSteps.map(s => (
          <div key={s.label} className="flex items-center gap-2">
            <div className="w-20 text-[11px] text-gray-500 text-right">{s.label}</div>
            <div className="flex-1 h-4 bg-gray-50 rounded overflow-hidden">
              <div className="h-full rounded" style={{ width: Math.max((s.n / max) * 100, s.n > 0 ? 1.5 : 0) + '%', background: s.color }} />
            </div>
            <div className="w-10 text-xs tabular-nums text-gray-700">{s.n}</div>
          </div>
        ))}
        <div className="pl-22 text-[10px] text-gray-400" style={{ paddingLeft: '5.5rem' }}>
          {f.asked_declined > 0 && <>declined {f.asked_declined} · </>}
          {f.asked_ignored > 0 && <>no engagement {f.asked_ignored} · </>}
          {f.never_fit > 0 && <>no natural moment {f.never_fit} · </>}
          {f.quota_closed > 0 && <>after quota closed {f.quota_closed}</>}
        </div>
      </div>

      {/* Coded distribution */}
      {(hasYesNo || emotionEntries.length > 0) && (
        <div className="flex flex-wrap gap-2">
          {hasYesNo && (
            <>
              <Chip text={`Yes ${p.coded.yes_no.yes}`} tone="green" />
              <Chip text={`No ${p.coded.yes_no.no}`} tone="red" />
            </>
          )}
          {emotionEntries.map(([sub, n]) => <Chip key={sub} text={`${sub} language ${n}`} tone="amber" />)}
        </div>
      )}

      {/* Wording variants (concept mode) */}
      {p.mode === 'concept' && p.wording_variants.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mb-1">Wordings actually used</div>
          <ul className="space-y-0.5">
            {p.wording_variants.slice(0, 6).map(w => (
              <li key={w.wording} className="text-xs text-gray-600">&ldquo;{w.wording}&rdquo; <span className="text-gray-400">×{w.n}</span></li>
            ))}
          </ul>
        </div>
      )}

      {/* Verbatim answers */}
      {p.answers.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowAnswers(s => !s)} className="text-xs font-semibold" style={{ color: TEAL }}>
            {showAnswers ? '▾' : '▸'} {p.answers.length} verbatim answer{p.answers.length === 1 ? '' : 's'}
          </button>
          {showAnswers && (
            <ul className="mt-2 space-y-2">
              {p.answers.map((a, i) => (
                <li key={i} className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                  <div className="text-xs text-gray-800">&ldquo;{a.answer_text}&rdquo;</div>
                  {a.followup_text && <div className="text-[11px] text-gray-500 mt-1">Follow-up: &ldquo;{a.followup_text}&rdquo;</div>}
                  <div className="text-[10px] text-gray-400 mt-1">
                    turn {a.asked_turn ?? '—'} · {new Date(a.created_at).toLocaleDateString()}
                    {(a.coded as { yes_no?: boolean } | null)?.yes_no === true && ' · coded yes'}
                    {(a.coded as { yes_no?: boolean } | null)?.yes_no === false && ' · coded no'}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function Chip({ text, tone }: { text: string; tone: 'teal' | 'blue' | 'green' | 'red' | 'amber' | 'gray' }) {
  const tones: Record<string, { bg: string; fg: string }> = {
    teal:  { bg: '#E6F4F2', fg: '#0F7173' },
    blue:  { bg: '#EFF6FF', fg: '#2563EB' },
    green: { bg: '#D1FAE5', fg: '#059669' },
    red:   { bg: '#FEE2E2', fg: '#DC2626' },
    amber: { bg: '#FEF3C7', fg: '#B45309' },
    gray:  { bg: '#F3F4F6', fg: '#6B7280' },
  }
  const t = tones[tone]
  return <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: t.bg, color: t.fg }}>{text}</span>
}
