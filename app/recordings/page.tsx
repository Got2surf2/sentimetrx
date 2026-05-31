// app/recordings/page.tsx
//
// Org-admin recordings list (§ 5.5). Single per-org list rendered server-side.
// Scoping mirrors § 4.8: isAdminOrg → all orgs, isAdmin (org admin) → own org,
// regular user → only created_by=self. Click into any row routes to the
// status surface (for in-progress / failed) or the report (for complete).

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'
import TopNav from '@/components/nav/TopNav'

export const dynamic = 'force-dynamic'

interface Row {
  id: string
  org_id: string
  created_by: string
  dataset_id: string | null
  name: string
  session_type: string
  meeting_date: string | null
  status: string
  cost_cents: number
  source_duration_sec: number | null
  created_at: string
  completed_at: string | null
  owner_name: string | null
  org_name: string | null
}

export default async function RecordingsListPage() {
  const supabase = createClient()
  const ctx = await getUserContext(supabase)
  if (!ctx) redirect('/login')
  if (!ctx.features.analyze) redirect('/dashboard')

  const service = createServiceRoleClient()

  let q = service
    .from('recordings')
    .select(
      'id, org_id, created_by, dataset_id, name, session_type, meeting_date, status, ' +
      'cost_cents, source_duration_sec, created_at, completed_at, ' +
      'users:created_by(full_name, email), organizations:org_id(name)',
    )
    .order('created_at', { ascending: false })
    .limit(200)

  if (!ctx.isAdminOrg) {
    if (ctx.isAdmin) {
      q = q.eq('org_id', ctx.orgId)
    } else {
      q = q.eq('org_id', ctx.orgId).eq('created_by', ctx.userId)
    }
  }

  const { data, error } = await q
  const rows: Row[] = (data ?? []).map((r: any) => ({
    id: r.id,
    org_id: r.org_id,
    created_by: r.created_by,
    dataset_id: r.dataset_id,
    name: r.name,
    session_type: r.session_type,
    meeting_date: r.meeting_date,
    status: r.status,
    cost_cents: r.cost_cents ?? 0,
    source_duration_sec: r.source_duration_sec,
    created_at: r.created_at,
    completed_at: r.completed_at,
    owner_name: r.users?.full_name || r.users?.email || null,
    org_name: r.organizations?.name || null,
  }))

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav
        logoUrl={ctx.navProps.logoUrl || ''}
        orgName={ctx.navProps.orgName || ''}
        isAdmin={ctx.navProps.isAdmin}
        userEmail={ctx.navProps.userEmail}
        fullName={ctx.navProps.fullName || ''}
        features={ctx.navProps.features}
        analyzeEnabled={true}
        campaignsEnabled={!!ctx.features.campaigns}
        currentPage="analyze"
      />
      <main className="pt-20 px-4 pb-12 max-w-6xl mx-auto">
        <header className="flex items-baseline justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Recordings</h1>
            <p className="text-sm text-gray-500 mt-1">
              {rows.length === 1 ? '1 recording' : `${rows.length} recordings`}
              {ctx.isAdminOrg ? ' across all orgs' : ctx.isAdmin ? ' in your org' : ' you own'}
            </p>
          </div>
          <Link
            href="/analyze/new/recording"
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ backgroundColor: '#E8632A' }}
          >
            + New recording
          </Link>
        </header>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4">
            {error.message}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-2xl p-12 text-center">
            <div className="text-4xl mb-3">🎙️</div>
            <p className="text-sm text-gray-600">No recordings yet.</p>
            <p className="text-xs text-gray-400 mt-1">Drop a meeting file in the wizard to get started.</p>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>Date</Th>
                  <Th>Status</Th>
                  <Th align="right">Cost</Th>
                  <Th>Owner</Th>
                  {ctx.isAdminOrg && <Th>Org</Th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {rows.map(r => (
                  <RecordingRow key={r.id} row={r} showOrg={ctx.isAdminOrg} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  )
}

function Th({ children, align }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th className={`px-4 py-2 text-xs font-semibold text-gray-500 ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  )
}

function RecordingRow({ row, showOrg }: { row: Row; showOrg: boolean }) {
  // Route choice:
  //   complete + dataset_id → report
  //   otherwise (in-progress, failed, cancelled) → status surface
  const targetHref = row.status === 'complete' && row.dataset_id
    ? `/analyze/${row.dataset_id}/report`
    : `/analyze/new/recording/${row.id}/status`

  return (
    <tr className="hover:bg-gray-50">
      <td className="px-4 py-3">
        <Link href={targetHref} className="font-semibold text-gray-900 hover:text-orange-700">
          {row.name}
        </Link>
      </td>
      <td className="px-4 py-3 text-gray-700 capitalize">
        {sessionTypeLabel(row.session_type)}
      </td>
      <td className="px-4 py-3 text-gray-700">
        {row.meeting_date ?? '—'}
      </td>
      <td className="px-4 py-3">
        <StatusPill status={row.status} />
      </td>
      <td className="px-4 py-3 text-right text-gray-700 tabular-nums">
        {formatCost(row.cost_cents)}
      </td>
      <td className="px-4 py-3 text-gray-700">
        {row.owner_name ?? '—'}
      </td>
      {showOrg && (
        <td className="px-4 py-3 text-gray-700">
          {row.org_name ?? '—'}
        </td>
      )}
    </tr>
  )
}

function StatusPill({ status }: { status: string }) {
  const cls: Record<string, string> = {
    uploading:    'bg-gray-100 text-gray-700',
    queued:       'bg-blue-100 text-blue-700',
    extracting:   'bg-blue-100 text-blue-700',
    transcribing: 'bg-blue-100 text-blue-700',
    analyzing:    'bg-blue-100 text-blue-700',
    rendering:    'bg-blue-100 text-blue-700',
    complete:     'bg-green-100 text-green-700',
    failed:       'bg-red-100 text-red-700',
    cancelled:    'bg-gray-100 text-gray-500',
  }
  const icon: Record<string, string> = {
    complete: '✓',
    failed: '✗',
    cancelled: '⊘',
  }
  return (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${cls[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {icon[status] ? `${icon[status]} ` : ''}
      {status}
    </span>
  )
}

function sessionTypeLabel(t: string): string {
  if (t === 'qa') return 'Q&A'
  if (t === 'focus_group') return 'Focus group'
  if (t === 'general_meeting') return 'Meeting'
  if (t === 'interview') return 'Interview'
  if (t === 'lecture') return 'Lecture'
  return t
}

function formatCost(cents: number): string {
  if (cents === 0) return '—'
  if (cents < 100) return `${cents}¢`
  return `$${(cents / 100).toFixed(2)}`
}
