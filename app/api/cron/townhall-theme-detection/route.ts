// app/api/cron/townhall-theme-detection/route.ts
// Vercel cron — runs every 15 min (see vercel.json), safety net for active
// auto-detection sessions. Primary trigger is response-count-based, in the
// chat route (config.engine.theme_detection_every_n_responses, default 20).
//
// Tranche 2 (docs/CONVERGENCE.md § 4.2): the legacy townhall_sessions scan
// is retired — the cron serves the unified substrate only.
// lib/townhallThemeDetection.ts survives until the frozen legacy
// orchestrator is deleted (it still calls detectThemesForSession).

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
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

  // ── pulseiq_sessions on the unified substrate ──────────────────
  // Default theme_detection_mode='auto' when cohort_config doesn't
  // specify — town halls are cohort-driven by design.
  const { data: townHalls } = await supabase
    .from('pulseiq_sessions')
    .select('id, cohort_config, last_theme_detection_at')
    .eq('status', 'live')

  for (const th of (townHalls || [])) {
    const cohortConfig = (th.cohort_config || {}) as { theme_detection_mode?: string; engine?: { theme_detection_mode?: string } }
    // Top-level lifted by sessions POST; nested engine.* fallback for
    // console-edited configs.
    const mode = cohortConfig?.theme_detection_mode || cohortConfig?.engine?.theme_detection_mode || 'auto'
    if (mode !== 'auto') continue

    const lastRun = th.last_theme_detection_at ? new Date(th.last_theme_detection_at).getTime() : 0
    const elapsed = (Date.now() - lastRun) / 60000
    if (elapsed < 10) continue

    // Idle guard: skip the paid AI run when no user turn has arrived since
    // the last detection (last_theme_detection_at is only set after a
    // successful run, so null means never-ran — don't skip those).
    if (th.last_theme_detection_at) {
      const { data: linkedConvs } = await supabase
        .from('pulseiq_session_conversations')
        .select('conversation_id')
        .eq('town_hall_id', th.id)
      const conversationIds = (linkedConvs || []).map(r => r.conversation_id)
      if (conversationIds.length === 0) continue
      const { data: newTurns } = await supabase
        .from('conversation_turns')
        .select('id')
        .in('conversation_id', conversationIds)
        .eq('role', 'user')
        .gt('created_at', th.last_theme_detection_at)
        .limit(1)
      if (!newTurns || newTurns.length === 0) continue
    }

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
