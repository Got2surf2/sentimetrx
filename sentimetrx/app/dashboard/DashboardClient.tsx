'use client'

import { useState } from 'react'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Study {
  id: string; guid: string; name: string; bot_name: string; bot_emoji: string
  status: string; visibility: string; created_by: string; created_at: string
  config: any; org_id?: string; orgName?: string; creatorName?: string
}
interface StudyStats {
  total: number; promoters: number; passives: number; detractors: number
  avgNps: number; lastResponse: string | null
}
interface Props {
  logoUrl?: string; orgId?: string
  user: { email: string; fullName?: string; role?: string; clientName?: string; isAdmin?: boolean; userId: string }
  studies: Study[]; statsMap: Record<string, StudyStats>
}
type OwnerFilter  = 'all' | 'mine' | 'public'
type StatusFilter = 'all' | 'active' | 'closed' | 'draft'

const HERMES = '#E8632A'

// ── Donut chart ────────────────────────────────────────────────────────────────
function DonutChart({ promoters, passives, detractors, total, avgNps }: {
  promoters: number; passives: number; detractors: number; total: number; avgNps: number
}) {
  const size = 96; const r = 36; const cx = 48; const cy = 48
  const circ = 2 * Math.PI * r
  const pct = (n: number) => total > 0 ? n / total : 0
  const pp = pct(promoters); const pa = pct(passives); const pd = pct(detractors)
  const arc = (offset: number, p: number, color: string) => {
    const dash = p * circ
    return <circle key={color} cx={cx} cy={cy} r={r} fill="none" stroke={color}
      strokeWidth="14" strokeDasharray={`${dash} ${circ - dash}`}
      strokeDashoffset={-offset * circ} transform={`rotate(-90 ${cx} ${cy})`} />
  }
  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f3f4f6" strokeWidth="14" />
        {total > 0 && <>{arc(0, pp, '#22c55e')}{arc(pp, pa, '#f59e0b')}{arc(pp + pa, pd, '#ef4444')}</>}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-lg font-black leading-none" style={{ color: HERMES }}>
          {total > 0 ? avgNps : '—'}
        </span>
        <span className="text-[9px] text-gray-400 font-medium">NPS</span>
      </div>
      </div>
    </div>
  )
}

// ── QR / Deploy modal ──────────────────────────────────────────────────────────
function QRCode({ url }: { url: string }) {
  const src = `https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(url)}&margin=8`
  return <img src={src} alt="QR code" className="w-40 h-40 rounded-lg border border-gray-200" />
}

function DeployModal({ study, onClose }: { study: Study; onClose: () => void }) {
  const url = `${process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'}/s/${study.guid}`
  const [copied, setCopied] = useState(false)
  const copy = () => { navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000) }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-md w-full mx-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-gray-800 text-base">Deploy — {study.name}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="flex gap-5 items-start">
          <QRCode url={url} />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-500 mb-2 font-medium">Survey URL</p>
            <div className="bg-gray-50 rounded-lg p-3 break-all text-xs text-gray-700 mb-3 border border-gray-200">{url}</div>
            <button onClick={copy} className="w-full py-2 rounded-lg text-white text-sm font-medium transition-all hover:opacity-90" style={{ background: HERMES }}>
              {copied ? '✓ Copied!' : 'Copy link'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Confirm modal ──────────────────────────────────────────────────────────────
function ConfirmModal({ message, onConfirm, onCancel }: { message: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
        <p className="text-gray-700 text-sm mb-5">{message}</p>
        <div className="flex gap-3 justify-end">
          <button onClick={onCancel} className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium">Cancel</button>
          <button onClick={onConfirm} className="px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90" style={{ background: HERMES }}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

// ── Study card ─────────────────────────────────────────────────────────────────
function StudyCard({ study, stats, isAdmin, userId, onPatch, onDelete, onDuplicate }: {
  study: Study; stats: StudyStats; isAdmin: boolean; userId: string
  onPatch: (id: string, body: object) => Promise<void>
  onDelete: (id: string) => Promise<void>
  onDuplicate: (study: Study) => Promise<void>
}) {
  const [busy,       setBusy]       = useState(false)
  const [confirm,    setConfirm]    = useState<{ msg: string; action: () => void } | null>(null)
  const [deployOpen, setDeployOpen] = useState(false)
  const [deleteConf, setDeleteConf] = useState(false)
  const [vis,        setVis]        = useState(study.visibility)
  const [status,     setStatus]     = useState(study.status)

  const canEdit  = study.created_by === userId || isAdmin
  const theme    = study.config?.theme || {}
  const headerBg = theme.headerGradient || `linear-gradient(135deg,${HERMES},#c44d1a)`

  const do_patch = async (body: object) => {
    setBusy(true)
    try {
      await onPatch(study.id, body)
      if ('status'     in body) setStatus((body as any).status)
      if ('visibility' in body) setVis((body as any).visibility)
    } finally { setBusy(false) }
  }

  const statusColor = (s: string) => {
    if (s === 'active') return 'bg-green-100 text-green-700 border-green-200'
    if (s === 'closed') return 'bg-red-100 text-red-600 border-red-200'
    return 'bg-gray-100 text-gray-500 border-gray-200'
  }

  const pp = stats.total > 0 ? Math.round(stats.promoters  / stats.total * 100) : 0
  const ap = stats.total > 0 ? Math.round(stats.passives   / stats.total * 100) : 0
  const dp = stats.total > 0 ? Math.round(stats.detractors / stats.total * 100) : 0

  const lastResp = stats.lastResponse
    ? new Date(stats.lastResponse).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null

  const handleExport = () => {
    window.location.href = `/studies/${study.id}/responses?export=csv`
  }

  return (
    <>
      {confirm    && <ConfirmModal message={confirm.msg} onConfirm={() => { confirm.action(); setConfirm(null) }} onCancel={() => setConfirm(null)} />}
      {deployOpen && <DeployModal study={study} onClose={() => setDeployOpen(false)} />}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-orange-200 transition-all flex flex-col overflow-hidden">

        {/* Color strip */}
        <div className="h-1.5 w-full" style={{ background: headerBg }} />

        <div className="p-4 flex flex-col gap-3 flex-1">

          {/* Title row */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg flex-shrink-0" style={{ background: headerBg }}>
                {study.bot_emoji}
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-gray-800 text-sm leading-tight truncate max-w-[160px]">{study.name}</h3>
                <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                  <p className="text-xs text-gray-400 truncate max-w-[100px]">{study.bot_name}</p>
                  {lastResp && (
                    <>
                      <span className="text-gray-300 text-xs">·</span>
                      <span className="text-xs text-gray-400" title="Last response received">
                        Last: {lastResp}
                      </span>
                    </>
                  )}
                </div>
              </div>
            </div>
            {canEdit && (
              <button
                onClick={() => { if (deleteConf) { onDelete(study.id); setDeleteConf(false) } else setDeleteConf(true) }}
                className={'text-xs transition-colors flex-shrink-0 ' + (deleteConf ? 'text-red-500 font-bold' : 'text-gray-300 hover:text-red-400')}>
                {deleteConf ? 'Sure?' : '🗑'}
              </button>
            )}
          </div>

          {/* Donut + stats */}
          <div className="flex items-center gap-3">
            <DonutChart promoters={stats.promoters} passives={stats.passives} detractors={stats.detractors} total={stats.total} avgNps={stats.avgNps} />
            <div className="flex flex-col gap-1 flex-1 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Promoters</span>
                <span className="font-semibold text-gray-700">{pp}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Passives</span>
                <span className="font-semibold text-gray-700">{ap}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Detractors</span>
                <span className="font-semibold text-gray-700">{dp}%</span>
              </div>
              <div className="mt-1 pt-1 border-t border-gray-100 flex items-center justify-between">
                <span className="text-gray-400">Responses</span>
                <span className="font-bold text-gray-700">{stats.total}</span>
              </div>
            </div>
          </div>

          {/* Status controls */}
          {canEdit && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={'text-xs px-2 py-0.5 rounded-full border font-medium ' + statusColor(status)}>{status}</span>
              <button
                onClick={() => { const nv = vis === 'public' ? 'private' : 'public'; do_patch({ visibility: nv }) }}
                className={'text-xs px-2 py-0.5 rounded-full border transition-colors ' +
                  (vis === 'public' ? 'bg-blue-50 text-blue-600 border-blue-200' : 'bg-gray-100 text-gray-400 border-gray-200')}>
                {vis}
              </button>
              {status === 'draft' && (
                <button disabled={busy}
                  onClick={() => setConfirm({ msg: `Publish "${study.name}"? This will make it live.`, action: () => do_patch({ status: 'active' }) })}
                  className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 disabled:opacity-40">
                  Publish
                </button>
              )}
              {status === 'active' && (
                <button disabled={busy}
                  onClick={() => setConfirm({ msg: `Close "${study.name}"? Responses will stop being collected.`, action: () => do_patch({ status: 'closed' }) })}
                  className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 disabled:opacity-40">
                  Close
                </button>
              )}
              {status === 'closed' && (
                <button disabled={busy}
                  onClick={() => setConfirm({ msg: `Reopen "${study.name}"? This will make it active again.`, action: () => do_patch({ status: 'active' }) })}
                  className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-40">
                  Reopen
                </button>
              )}
            </div>
          )}

          {/* Creator / org / date */}
          <div className="text-xs text-gray-400 flex items-center gap-1 flex-wrap">
            {isAdmin && study.orgName && <span className="text-orange-500 font-medium">{study.orgName}</span>}
            {study.creatorName && <><span>·</span><span>{study.creatorName}</span></>}
            <span>· {new Date(study.created_at).toLocaleDateString()}</span>
          </div>
        </div>

        {/* Footer — row 1: Analytics, Responses, Export */}
        <div className="border-t border-gray-100 px-3 py-2 flex items-center gap-1 bg-gray-50/50">
          <Link href={'/studies/' + study.id + '/analytics'}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 font-medium hover:bg-orange-500 hover:text-white transition-all">Analytics</Link>
          <Link href={'/studies/' + study.id + '/responses'}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-orange-500 hover:text-white transition-all">Responses</Link>
          <button onClick={handleExport}
            className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-orange-500 hover:text-white transition-all">
            Export
          </button>
        </div>

        {/* Footer — row 2: Edit, Deploy, Duplicate */}
        {canEdit && (
          <div className="px-3 py-2 flex items-center gap-1 bg-gray-50/30 rounded-b-2xl border-t border-gray-100">
            <Link href={'/studies/' + study.id + '/edit'}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-orange-500 hover:text-white transition-all">Edit</Link>
            <button onClick={() => status === 'active' ? setDeployOpen(true) : undefined}
              className={'text-xs px-2.5 py-1.5 rounded-lg transition-all ' +
                (status === 'active'
                  ? 'bg-gray-100 text-gray-600 hover:bg-orange-500 hover:text-white'
                  : 'bg-gray-50 text-gray-300 cursor-not-allowed')}>
              Deploy
            </button>
            <button onClick={() => onDuplicate(study)}
              className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-orange-500 hover:text-white transition-all">
              Duplicate
            </button>
          </div>
        )}
      </div>
    </>
  )
}

// ── Main dashboard ─────────────────────────────────────────────────────────────
export default function DashboardClient({ user, studies: initialStudies, logoUrl = '', orgId = '', statsMap }: Props) {
  const [studies,      setStudies]      = useState(initialStudies)
  const [ownerFilter,  setOwnerFilter]  = useState<OwnerFilter>('mine')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('active')
  const [error,        setError]        = useState<string | null>(null)
  const defaultFrom = () => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) }
  const defaultTo   = () => new Date().toISOString().slice(0, 10)
  const [dateFrom,  setDateFrom]  = useState('')
  const [dateTo,    setDateTo]    = useState('')
  const router = useRouter()

  const filtered = studies.filter(s => {
    if (ownerFilter  === 'mine'   && s.created_by !== user.userId) return false
    if (ownerFilter  === 'public' && s.visibility  !== 'public')   return false
    if (statusFilter !== 'all'   && s.status       !== statusFilter) return false
    if (dateFrom && s.created_at < dateFrom) return false
    if (dateTo   && s.created_at > dateTo + 'T23:59:59') return false
    return true
  })

  const handlePatch = async (studyId: string, body: object) => {
    const res = await fetch('/api/studies/' + studyId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error('Failed')
    setStudies(prev => prev.map(s => s.id === studyId ? { ...s, ...body } : s))
  }

  const handleDelete = async (studyId: string) => {
    const res = await fetch('/api/studies/' + studyId, { method: 'DELETE' })
    if (!res.ok) { setError('Failed to delete.'); return }
    setStudies(prev => prev.filter(s => s.id !== studyId))
  }

  const handleDuplicate = async (study: Study) => {
    try {
      const res = await fetch('/api/studies', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: study.name + ' (copy)', bot_name: study.bot_name, bot_emoji: study.bot_emoji, config: study.config, visibility: 'private' }) })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      router.push('/studies/' + data.id + '/edit')
    } catch { setError('Failed to duplicate.') }
  }

  const ownerTabs:  { key: OwnerFilter;  label: string }[] = [{ key: 'all', label: 'All' }, { key: 'mine', label: 'Mine' }, { key: 'public', label: 'Public' }]
  const statusTabs: { key: StatusFilter; label: string }[] = [{ key: 'all', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'draft', label: 'Draft' }, { key: 'closed', label: 'Closed' }]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="fixed top-0 left-0 right-0 z-50"><TopNav logoUrl={logoUrl} orgName={user.clientName} isAdmin={user.isAdmin} userEmail={user.email} fullName={user.fullName} currentPage="dashboard" /></div>
      <SubHeader crumbs={[{ label: 'Dashboard' }]} isAdmin={user.isAdmin} orgId={orgId} showFilters />

      <main className="max-w-7xl mx-auto px-6 py-8 pt-28">

        {/* Toolbar */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
          <div className="flex flex-col gap-2">
            {/* Owner filter */}
            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
              {ownerTabs.map(({ key, label }) => (
                <button key={key} onClick={() => setOwnerFilter(key)}
                  className={'px-4 py-1.5 rounded-lg text-sm font-medium transition-all ' +
                    (ownerFilter === key ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700')}
                  style={ownerFilter === key ? { background: HERMES } : {}}>
                  {label}
                </button>
              ))}
            </div>
            {/* Status filter */}
            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
              {statusTabs.map(({ key, label }) => (
                <button key={key} onClick={() => setStatusFilter(key)}
                  className={'px-3 py-1 rounded-lg text-xs font-medium transition-all ' +
                    (statusFilter === key ? 'text-white shadow-sm' : 'text-gray-400 hover:text-gray-600')}
                  style={statusFilter === key ? { background: HERMES } : {}}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* Date range filter */}
          <div className="flex items-center gap-2">
            <button onClick={() => { setDateFrom(defaultFrom()); setDateTo(defaultTo()) }}
              className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 text-gray-600 text-xs transition-colors">Last 30 days</button>
            <button onClick={() => { setDateFrom(''); setDateTo('') }}
              className="px-3 py-1.5 rounded-lg bg-white border border-gray-200 hover:bg-gray-100 text-gray-600 text-xs transition-colors">All time</button>
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs outline-none focus:border-orange-400 transition-colors" />
              <span className="text-gray-400 text-xs">to</span>
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 text-xs outline-none focus:border-orange-400 transition-colors" />
            </div>
          </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">{filtered.length} studies</span>
            <Link href="/studies/new"
              className="px-4 py-2 rounded-xl text-white text-sm font-semibold shadow-sm hover:opacity-90 transition-all"
              style={{ background: HERMES }}>
              + New Study
            </Link>
          </div>
        </div>

        {error && <div className="mb-5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>}

        {filtered.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-2xl bg-white">
            <div className="text-4xl mb-3">📋</div>
            <p className="text-gray-500 text-sm">No studies match this filter.</p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            {filtered.map(study => (
              <StudyCard
                key={study.id}
                study={study}
                stats={statsMap[study.id] || { total: 0, promoters: 0, passives: 0, detractors: 0, avgNps: 0, lastResponse: null }}
                isAdmin={!!user.isAdmin}
                userId={user.userId}
                onPatch={handlePatch}
                onDelete={handleDelete}
                onDuplicate={handleDuplicate}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
