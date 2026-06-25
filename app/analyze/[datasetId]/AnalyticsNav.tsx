import type { ReactNode } from 'react'
import TextMineNav, { type NavSectionItem, type NavViewItem } from '@/components/analyze/TextMineNav'

// Advanced Analytics is a peer SECTION of TextMine (Target B IA), so its three
// pages (brand health, leaderboard, per-outlet deep-dive) render UNDER the same
// persistent two-row bar: row 1 = the peer sections (Advanced active, the rest
// link back into TextMine), row 2 = the three Advanced views. Replaces the old
// one-row sub-nav + "← TextMine" back link.
export default function AnalyticsNav({ datasetId, active, outlet, action }: {
  datasetId: string
  active: 'brand' | 'leaderboard' | 'outlet'
  outlet?: string // preserve the selected outlet when linking to the deep-dive
  action?: ReactNode // right-aligned page action (e.g. an Export button)
}) {
  const base = `/analyze/${datasetId}`
  // Row 1 — the four peer sections. The lens sections link back into TextMine
  // (deep-linked to their Overview); Advanced is the active section. (Advanced
  // pages are google_reviews + multi-outlet datasets, which always carry
  // Dimensions and an entity catalog, so all four sections are shown.)
  const sections: NavSectionItem[] = [
    { id: 'themes', label: 'Themes', help: 'AI-mined themes — clusters of comments that share a topic.', href: `${base}/textmine?section=themes&view=overview` },
    { id: 'dimensions', label: 'Dimensions', help: 'Every row classified into a fixed set of dimensions (service, food, drinks, ambiance, …) with severity alerts.', href: `${base}/textmine?section=dimensions&view=overview` },
    { id: 'entities', label: 'Entities', help: 'The specific things people name — dishes, drinks, brands, places.', href: `${base}/textmine?section=entities&view=overview` },
    { id: 'advanced', label: 'Advanced Analytics', help: 'Brand-health diagnostics & per-outlet deep-dive for multi-location brands: the recommended-actions playbook, drivers & trends, the leaderboard, and each location\'s action plan with an interactive what-if modeler.' },
  ]
  // Row 2 — the three Advanced views.
  const views: NavViewItem[] = [
    { id: 'brand', label: 'Brand Health', href: `${base}/improvement-plan` },
    { id: 'leaderboard', label: 'Leaderboard', href: `${base}/outlet-leaderboard` },
    { id: 'outlet', label: 'Outlet Deep-Dive', href: `${base}/outlet-report${outlet ? `?outlet=${encodeURIComponent(outlet)}` : ''}` },
  ]
  return (
    <div className="mb-4 print:hidden">
      <TextMineNav sections={sections} activeSection="advanced" views={views} activeView={active}>
        {action}
      </TextMineNav>
    </div>
  )
}
