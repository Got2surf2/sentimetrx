// app/api/cron/townhall-theme-detection/route.ts
// Vercel cron — runs every 15 min (see vercel.json), safety net for active
// auto-detection sessions. Primary trigger is response-count-based, in the
// chat route (config.engine.theme_detection_every_n_responses, default 20).
//
// Phase 5 commit 1 (2026-05-21): the cron now scans BOTH the legacy
// townhall_sessions table AND the new pulseiq_sessions table. The two paths
// coexist during the convergence transition (docs/CONVERGENCE.md § 4
// row 5). Once every town hall lives on the new substrate, the legacy
// block + lib/townhallThemeDetection.ts can be dropped.

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { detectThemesForSession } from '@/lib/townhallThemeDetection'
import { detectThemesForTownHall } from '@/lib/cohortThemeAggregator'
import { checkCronAuth } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const supabase = createServiceRoleClient()

  let scanned = 0
  let totalDetected = 0

  // ── Legacy path: townhall_sessions ─────────────────────────────────
  const { data: sessions } = await supabase
    .from('townhall_sessions')
    .select('id, config, last_theme_detection_at')
    .eq('status', 'active')

  for (const s of (sessions || [])) {
    const config = s.config as any
    const mode = config?.engine?.theme_detection_mode
    if (mode !== 'auto') continue

    // Cron is a safety net — primary trigger is response-count-based in the chat route.
    // Only run if at least 10 minutes since last detection to avoid duplicate runs.
    const lastRun = s.last_theme_detection_at ? new Date(s.last_theme_detection_at).getTime() : 0
    const elapsed = (Date.now() - lastRun) / 60000
    if (elapsed < 10) continue

    scanned++
    try {
      const result = await detectThemesForSession(s.id)
      totalDetected += result.inserted
    } catch (e) {
      console.error({ at: 'cron/townhall-theme-detection', msg: 'legacy detect error', sessionId: s.id, err: e })
    }
  }

  // ── New path: pulseiq_sessions on the unified substrate ──────────────────
  // Default theme_detection_mode='auto' when cohort_config doesn't
  // specify — town halls are cohort-driven by design.
  const { data: townHalls } = await supabase
    .from('pulseiq_sessions')
    .select('id, cohort_config, last_theme_detection_at')
    .eq('status', 'live')

  for (const th of (townHalls || [])) {
    const cohortConfig = (th.cohort_config || {}) as any
    const mode = cohortConfig?.theme_detection_mode || 'auto'
    if (mode !== 'auto') continue

    const lastRun = th.last_theme_detection_at ? new Date(th.last_theme_detection_at).getTime() : 0
    const elapsed = (Date.now() - lastRun) / 60000
    if (elapsed < 10) continue

    scanned++
    try {
      const result = await detectThemesForTownHall(th.id)
      totalDetected += result.inserted
    } catch (e) {
      console.error({ at: 'cron/townhall-theme-detection', msg: 'new substrate detect error', townHallId: th.id, err: e })
    }
  }

  return NextResponse.json({ scanned, detected: totalDetected })
}
