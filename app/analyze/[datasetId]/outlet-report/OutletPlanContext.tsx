'use client'

// Owns the outlet's AI action-plan fetch for the whole report page.
//
// The plan is the one thing the page does NOT have at first render — it's an
// LLM call, cached server-side. Two things need it: the action-plan section
// that displays it, and the Download PDF button, which posts it back so the
// export doesn't have to generate its own (a duplicate ~30s call was most of
// the 52s one download took). They sit far apart in the tree, so the fetch
// lives here and both consume it — nothing pushes state upward.
//
// The provider is keyed by outlet in page.tsx, so switching locations remounts
// it and no stale plan can leak into the next outlet's download.

import { createContext, useContext, useEffect, useState } from 'react'
import type { ActionPlan } from '@/lib/outletActionPlan'
import type { ThemeTableRow } from '@/lib/outletReport'

export type PlanState = {
  plan: ActionPlan | null
  status: 'loading' | 'ok' | 'error'
  retry: () => void
}

const Ctx = createContext<PlanState>({ plan: null, status: 'loading', retry: () => {} })

export function useOutletPlan(): PlanState {
  return useContext(Ctx)
}

export function OutletPlanProvider({ datasetId, outlet, reviews, themeTable, children }: {
  datasetId: string
  outlet: string
  // Posted with the request so the route can check its cache without re-running
  // a full dataset scan just to rebuild the cache key.
  reviews: number
  themeTable: ThemeTableRow[]
  children: React.ReactNode
}) {
  const [plan, setPlan] = useState<ActionPlan | null>(null)
  const [status, setStatus] = useState<'loading' | 'ok' | 'error'>('loading')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const ctrl = new AbortController()
    // The plan is one LLM call (~30s the first time, cached after). Cap the wait
    // so a slow/failed call surfaces a Retry instead of spinning forever.
    const timer = setTimeout(() => ctrl.abort(), 90000)
    fetch(`/api/datasets/${datasetId}/outlet-action-plan?outlet=${encodeURIComponent(outlet)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reviews, themeTable }),
      signal: ctrl.signal,
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!cancelled) { setPlan(d.plan); setStatus('ok') } })
      .catch(() => { if (!cancelled) setStatus('error') })
      .finally(() => clearTimeout(timer))
    return () => { cancelled = true; clearTimeout(timer); ctrl.abort() }
  }, [datasetId, outlet, reviews, themeTable, attempt])

  const retry = () => { setPlan(null); setStatus('loading'); setAttempt((a) => a + 1) }

  return <Ctx.Provider value={{ plan, status, retry }}>{children}</Ctx.Provider>
}
