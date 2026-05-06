'use client'

import { useState } from 'react'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import Link from 'next/link'
import type { CampaignStatus, CampaignStats } from '@/lib/types'

interface CampaignRow {
  id: string; name: string; status: CampaignStatus; study_id: string
  study_name?: string; study_status?: string; target_responses: number | null
  created_by: string; created_at: string; email_provider: string
  study_color?: string | null; study_gradient?: string | null; study_emoji?: string | null
}
interface Props {
  logoUrl?: string; orgId?: string
  analyzeEnabled?: boolean; campaignsEnabled?: boolean; features?: import('@/lib/types').ModuleFeatures
  user: { email: string; fullName?: string; role?: string; clientName?: string; isAdmin?: boolean; userId: string }
  campaigns: CampaignRow[]
  statsMap: Record<string, CampaignStats>
  respondentsMap?: Record<string, { email: string; status: string }[]>
}

type StatusFilter = 'all' | 'draft' | 'active' | 'scheduled' | 'paused' | 'completed'

const HERMES = '#E8632A'

function DonutChart({ completed, sent, pending, total, brandColor = HERMES }: {
  completed: number; sent: number; pending: number; total: number; brandColor?: string
}) {
  if (total === 0) {
    return (
      <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
        <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'conic-gradient(#f3f4f6 100%)' }} />
        <div style={{ position: 'absolute', top: 12, left: 12, width: 56, height: 56, borderRadius: '50%', background: 'white' }} />
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontSize: 14, fontWeight: 900, color: '#9ca3af' }}>--</span>
        </div>
      </div>
    )
  }
  const cp = Math.round(completed / total * 100)
  const sp = Math.round(sent / total * 100)
  const pp = Math.round(pending / total * 100)
  const bg = `conic-gradient(#22c55e ${cp}%, #3b82f6 ${cp}% ${cp + sp}%, #f59e0b ${cp + sp}% ${cp + sp + pp}%, #f3f4f6 ${cp + sp + pp}%)`
  return (
    <div style={{ position: 'relative', width: 80, height: 80, flexShrink: 0 }}>
      <div style={{ width: 80, height: 80, borderRadius: '50%', background: bg }} />
      <div style={{ position: 'absolute', top: 12, left: 12, width: 56, height: 56, borderRadius: '50%', background: 'white' }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ fontSize: 16, fontWeight: 900, lineHeight: 1, color: brandColor }}>{cp}%</span>
        <span style={{ fontSize: 8, color: '#9ca3af', fontWeight: 500 }}>Complete</span>
      </div>
    </div>
  )
}

function ProgressBar({ current, target, brandColor = HERMES }: { current: number; target: number; brandColor?: string }) {
  const pct = target > 0 ? Math.min(Math.round(current / target * 100), 100) : 0
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 3, background: '#f3f4f6', overflow: 'hidden' }}>
        <div style={{ width: pct + '%', height: '100%', borderRadius: 3, background: pct >= 100 ? '#22c55e' : brandColor, transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: pct >= 100 ? '#16a34a' : '#6b7280', whiteSpace: 'nowrap' }}>
        {current}/{target} ({pct}%)
      </span>
    </div>
  )
}

function CampaignCard({ campaign, stats, respondents = [], onDelete }: {
  campaign: CampaignRow; stats: CampaignStats; respondents?: { email: string; status: string }[]; onDelete: (id: string) => void
}) {
  const [busy, setBusy] = useState(false)
  const [deleteConf, setDeleteConf] = useState(false)
  const [expanded, setExpanded] = useState(false)

  // Auto-detect completion: all recipients in terminal state (completed/bounced/unsubscribed)
  const terminalCount = stats.completed + stats.bounced + stats.unsubscribed
  const allDone = stats.total > 0 && terminalCount === stats.total
  const effectiveStatus = (campaign.status === 'active' || campaign.status === 'scheduled') && allDone
    ? 'completed' : campaign.status
  const [status, setStatus] = useState(effectiveStatus)

  // Study color scheme
  const brandColor = campaign.study_color || HERMES
  const brandGradient = campaign.study_gradient || `linear-gradient(135deg, ${brandColor}, ${brandColor}cc)`

  const statusColor = (s: string) => {
    if (s === 'active')    return 'bg-green-100 text-green-700 border-green-200'
    if (s === 'scheduled') return 'bg-blue-100 text-blue-700 border-blue-200'
    if (s === 'paused')    return 'bg-yellow-100 text-yellow-700 border-yellow-200'
    if (s === 'completed') return 'bg-emerald-50 text-emerald-600 border-emerald-200'
    return 'bg-gray-100 text-gray-500 border-gray-200'
  }

  const handleStatusChange = async (newStatus: CampaignStatus) => {
    setBusy(true)
    try {
      const res = await fetch('/api/campaigns/' + campaign.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      })
      if (res.ok) setStatus(newStatus)
    } finally { setBusy(false) }
  }

  const handleDelete = async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/campaigns/' + campaign.id, { method: 'DELETE' })
      if (res.ok) onDelete(campaign.id)
    } finally { setBusy(false); setDeleteConf(false) }
  }

  return (
    <>
      {deleteConf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
            <p className="text-gray-700 text-sm mb-5">Delete &quot;{campaign.name}&quot;? This cannot be undone.</p>
            <div className="flex gap-3 justify-end">
              <button onClick={() => setDeleteConf(false)} className="px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium">Cancel</button>
              <button onClick={handleDelete} disabled={busy} className="px-4 py-2 rounded-lg text-white text-sm font-medium hover:opacity-90" style={{ background: HERMES }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm hover:shadow-md hover:border-orange-200 transition-all flex flex-col overflow-hidden">
        {/* Color strip — uses study theme */}
        <div className="h-1.5 w-full" style={{ background: brandGradient }} />

        <div className="p-4 flex flex-col gap-3 flex-1">
          {/* Title row */}
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {campaign.study_emoji && <span className="text-lg leading-none">{campaign.study_emoji}</span>}
                <h3 className="font-bold text-gray-800 text-sm truncate">{campaign.name}</h3>
              </div>
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                <span className={'text-xs px-2 py-0.5 rounded-full border font-semibold uppercase ' + statusColor(status)}>
                  {status}
                </span>
                {campaign.study_name && (
                  <Link href={'/studies/' + campaign.study_id + '/edit'}
                    className="text-xs text-gray-400 hover:text-gray-600 truncate max-w-[160px]">
                    {campaign.study_name}
                  </Link>
                )}
              </div>
            </div>
            <DonutChart
              completed={stats.completed}
              sent={stats.sent + stats.opened + stats.clicked}
              pending={stats.pending}
              total={stats.total}
              brandColor={brandColor}
            />
          </div>

          {/* Delivery metrics */}
          {stats.total > 0 && (
            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="bg-blue-50 rounded-lg py-1.5">
                <div className="text-sm font-bold text-blue-600">{Math.round((stats.sent + stats.opened + stats.clicked + stats.completed + stats.unsubscribed) / stats.total * 100)}%</div>
                <div className="text-[9px] text-blue-500">Delivered</div>
              </div>
              <div className="bg-green-50 rounded-lg py-1.5">
                <div className="text-sm font-bold text-green-600">{Math.round(stats.completed / stats.total * 100)}%</div>
                <div className="text-[9px] text-green-500">Completed</div>
              </div>
              <div className="bg-gray-50 rounded-lg py-1.5">
                <div className="text-sm font-bold text-gray-600">{stats.total}</div>
                <div className="text-[9px] text-gray-400">Recipients</div>
              </div>
            </div>
          )}
          {stats.total === 0 && (
            <div className="text-xs text-gray-400 italic">No recipients yet</div>
          )}

          {/* Target progress */}
          {campaign.target_responses && (
            <ProgressBar current={stats.completed} target={campaign.target_responses} brandColor={brandColor} />
          )}

          {/* Status counts */}
          {stats.total > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className={'w-1.5 h-1.5 rounded-full flex-shrink-0 ' +
                (stats.bounced > stats.total * 0.05 ? 'bg-red-500' : stats.bounced > 0 ? 'bg-amber-500' : 'bg-green-500')} />
              <span className="text-[10px] text-gray-400">
                {stats.bounced > 0 && <span className="text-red-500">{stats.bounced} bounced</span>}
                {stats.bounced > 0 && stats.unsubscribed > 0 && ' · '}
                {stats.unsubscribed > 0 && <span className="text-gray-500">{stats.unsubscribed} unsub</span>}
                {stats.bounced === 0 && stats.unsubscribed === 0 && 'Healthy'}
              </span>
            </div>
          )}

          {/* Expandable recipient list */}
          {stats.total > 0 && respondents.length > 0 && (
            <div className="border-t border-gray-100 pt-1 mt-1">
              <button onClick={() => setExpanded(!expanded)}
                className="w-full flex items-center justify-center gap-1 text-[10px] text-gray-400 hover:text-gray-600 transition-colors py-0.5">
                <span style={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s', display: 'inline-block', fontSize: 8 }}>▼</span>
                {expanded ? 'Hide' : 'Show'} recipients
              </button>
              {expanded && (
                <div className="mt-1 max-h-[200px] overflow-y-auto">
                  {respondents.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 py-1 px-1">
                      <span className={'w-1.5 h-1.5 rounded-full flex-shrink-0 ' +
                        (r.status === 'completed' ? 'bg-green-500' :
                         r.status === 'bounced' ? 'bg-red-500' :
                         r.status === 'unsubscribed' ? 'bg-gray-400' :
                         r.status === 'sent' || r.status === 'opened' || r.status === 'clicked' ? 'bg-blue-500' :
                         'bg-yellow-400')} />
                      <span className="text-[10px] text-gray-600 truncate flex-1">{r.email}</span>
                      <span className={'text-[9px] font-medium ' +
                        (r.status === 'completed' ? 'text-green-600' :
                         r.status === 'bounced' ? 'text-red-500' :
                         r.status === 'unsubscribed' ? 'text-gray-400' :
                         r.status === 'pending' ? 'text-yellow-600' :
                         'text-blue-600')}>
                        {r.status}
                      </span>
                    </div>
                  ))}
                  {stats.total > respondents.length && (
                    <div className="text-[9px] text-gray-400 text-center py-1">
                      +{stats.total - respondents.length} more
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex flex-col gap-1.5 mt-auto pt-2 border-t border-gray-100">
            <div className="flex items-center gap-1.5 flex-wrap">
              <Link href={'/campaigns/' + campaign.id}
                className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all"
                style={{ background: brandColor + '12', color: brandColor, border: '1px solid ' + brandColor + '30' }}>
                View
              </Link>
              <Link href={'/campaigns/' + campaign.id + '/edit'}
                className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all"
                style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' }}>
                Edit
              </Link>
              {status === 'active' && (
                <button onClick={() => handleStatusChange('paused')} disabled={busy}
                  className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all disabled:opacity-50"
                  style={{ background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a' }}>
                  Pause
                </button>
              )}
              {status === 'paused' && (
                <button onClick={() => handleStatusChange('active')} disabled={busy}
                  className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all disabled:opacity-50"
                  style={{ background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' }}>
                  Resume
                </button>
              )}
              <button onClick={async () => {
                  setBusy(true)
                  try {
                    const res = await fetch('/api/campaigns/' + campaign.id + '/clone', {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ include_recipients: true }),
                    })
                    if (res.ok) { const data = await res.json(); window.location.href = '/campaigns/' + data.id }
                  } finally { setBusy(false) }
                }} disabled={busy}
                className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all disabled:opacity-50"
                style={{ background: '#f3f4f6', color: '#4b5563', border: '1px solid #e5e7eb' }}>
                Clone
              </button>
              <button onClick={() => setDeleteConf(true)} disabled={busy}
                className="text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all disabled:opacity-50"
                style={{ background: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca' }}>
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

export default function CampaignDashboardClient({ user, campaigns: initial, logoUrl = '', orgId = '', statsMap, respondentsMap = {}, analyzeEnabled, campaignsEnabled, features }: Props) {
  const [campaigns, setCampaigns] = useState(initial)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  const filtered = campaigns.filter(c => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false
    return true
  })

  const handleDelete = (id: string) => {
    setCampaigns(prev => prev.filter(c => c.id !== id))
  }

  const statusTabs: { key: StatusFilter; label: string }[] = [
    { key: 'all', label: 'All' }, { key: 'active', label: 'Active' }, { key: 'draft', label: 'Draft' },
    { key: 'scheduled', label: 'Scheduled' }, { key: 'paused', label: 'Paused' }, { key: 'completed', label: 'Completed' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="fixed top-0 left-0 right-0 z-50">
        <TopNav
          logoUrl={logoUrl}
          orgName={user.clientName}
          isAdmin={user.isAdmin}
          userEmail={user.email}
          fullName={user.fullName}
          currentPage="campaigns"
          analyzeEnabled={analyzeEnabled}
          campaignsEnabled={campaignsEnabled}
          features={features}
        />
      </div>
      <SubHeader crumbs={[{ label: 'Campaigns' }]} isAdmin={user.isAdmin} orgId={orgId} showFilters />

      <main className="max-w-7xl mx-auto px-6 py-8 pt-28">
        {/* Toolbar */}
        <div className="flex items-start justify-between mb-6 flex-wrap gap-4">
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
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">{filtered.length} campaigns</span>
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-20 border-2 border-dashed border-gray-200 rounded-2xl bg-white">
            <div className="text-4xl mb-3">📧</div>
            <p className="text-gray-500 text-sm mb-4">No campaigns yet.</p>
            <p className="text-gray-400 text-xs">Create a campaign from any active study&apos;s dashboard.</p>
          </div>
        ) : (() => {
          // Group campaigns by study
          const byStudy: Record<string, { name: string; id: string; campaigns: typeof filtered }> = {}
          for (const c of filtered) {
            const key = c.study_id || '_none'
            if (!byStudy[key]) byStudy[key] = { name: c.study_name || 'No study linked', id: c.study_id, campaigns: [] }
            byStudy[key].campaigns.push(c)
          }
          const groups = Object.values(byStudy)

          return (
            <div className="space-y-6">
              {groups.map(group => (
                <div key={group.id || '_none'}>
                  {groups.length > 1 && (
                    <div className="flex items-center gap-2 mb-3">
                      <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">{group.name}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium">{group.campaigns.length}</span>
                      <div className="flex-1 h-px bg-gray-200" />
                    </div>
                  )}
                  <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                    {group.campaigns.map(c => (
                      <CampaignCard
                        key={c.id}
                        campaign={c}
                        stats={statsMap[c.id] || { total: 0, pending: 0, sent: 0, opened: 0, clicked: 0, completed: 0, bounced: 0, unsubscribed: 0 }}
                        respondents={respondentsMap[c.id] || []}
                        onDelete={handleDelete}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        })()}
      </main>
    </div>
  )
}
