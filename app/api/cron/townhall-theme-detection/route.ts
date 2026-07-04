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
import { reconcileMirrorForHall } from '@/lib/phase3DualWrite'
import { checkCronAuth } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const supabase = createServiceRoleClient()

  let scanned = 0
  let totalDetected = 0
  let totalHealed = 0

  // ── pulseiq_sessions on the unified substrate ──────────────────
  // Default theme_detection_mode='auto' when cohort_config doesn't
  // specify — town halls are cohort-driven by design.
  const { data: townHalls } = await supabase
    .from('pulseiq_sessions')
    .select('id, bot_id, org_id, cohort_config, last_theme_detection_at')
    .eq('status', 'live')

  for (const th of (townHalls || [])) {
    // Mirror reconciliation (runs for EVERY live session, before the
    // detection gates): the async analytics mirror retries transient
    // failures at write time, but a turn that exhausts its retries during
    // a load spike would undercount forever — this sweep heals the gap.
    // Cheap probe first: two indexed head-counts; full reconcile only when
    // they disagree. Mirror count filters on town_hall_id (sql/156).
    try {
      const [{ count: syncCount }, { count: mirrorCount }] = await Promise.all([
        supabase.from('bot_conversation_turns')
          .select('id', { count: 'exact', head: true })
          .eq('bot_id', th.bot_id)
          .like('session_id', th.id + ':%')
          .neq('content', ''),
        supabase.from('conversation_turns')
          .select('id', { count: 'exact', head: true })
          .eq('town_hall_id', th.id),
      ])
      if ((syncCount || 0) > (mirrorCount || 0)) {
        const healed = await reconcileMirrorForHall(supabase, { townHallId: th.id, botId: th.bot_id, orgId: th.org_id })
        totalHealed += healed.healed
      }
    } catch (e) {
      console.error({ at: 'cron/townhall-theme-detection', msg: 'mirror reconcile error', townHallId: th.id, err: e })
    }

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
    // town_hall_id equality (sql/156) — no more .in(<every conv id>).
    if (th.last_theme_detection_at) {
      const { data: newTurns } = await supabase
        .from('conversation_turns')
        .select('id')
        .eq('town_hall_id', th.id)
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

  return NextResponse.json({ scanned, detected: totalDetected, mirror_healed: totalHealed })
}
