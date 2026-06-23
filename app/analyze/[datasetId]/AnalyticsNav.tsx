import Link from 'next/link'
import type { ReactNode } from 'react'

// Shared sub-nav across the three Advanced Analytics views (brand health,
// leaderboard, per-outlet deep-dive). They're separate server routes, but this
// header makes them feel like one tabbed area. Reached via the single "Advanced
// Analytics" sub-tab in TextMine (which lands on Brand Health).
export default function AnalyticsNav({ datasetId, active, outlet, action }: {
  datasetId: string
  active: 'brand' | 'leaderboard' | 'outlet'
  outlet?: string // preserve the selected outlet when linking to the deep-dive
  action?: ReactNode // right-aligned page action (e.g. an Export button)
}) {
  const tabs: { id: 'brand' | 'leaderboard' | 'outlet'; label: string; href: string }[] = [
    { id: 'brand', label: 'Brand Health', href: `/analyze/${datasetId}/improvement-plan` },
    { id: 'leaderboard', label: 'Leaderboard', href: `/analyze/${datasetId}/outlet-leaderboard` },
    { id: 'outlet', label: 'Outlet Deep-Dive', href: `/analyze/${datasetId}/outlet-report${outlet ? `?outlet=${outlet}` : ''}` },
  ]
  return (
    <div className="mb-4 flex items-center justify-between border-b border-gray-200 print:hidden">
      <div className="flex items-center gap-1">
        <Link href={`/analyze/${datasetId}/textmine`} className="mr-3 text-sm font-medium text-gray-400 hover:text-gray-600">← TextMine</Link>
        {tabs.map((t) => (
          <Link key={t.id} href={t.href}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${active === t.id ? 'border-gray-800 text-gray-900' : 'border-transparent text-gray-400 hover:text-gray-600'}`}>
            {t.label}
          </Link>
        ))}
      </div>
      {action && <div className="flex items-center gap-3 pb-1">{action}</div>}
    </div>
  )
}
