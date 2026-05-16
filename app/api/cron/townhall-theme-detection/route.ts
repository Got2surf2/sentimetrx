// app/api/cron/townhall-theme-detection/route.ts
// Vercel cron — runs every 15 min (see vercel.json), safety net for active
// auto-detection sessions. Primary trigger is response-count-based, in the
// chat route (config.engine.theme_detection_every_n_responses, default 20).

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { detectThemesForSession } from '@/lib/townhallThemeDetection'
import { checkCronAuth } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const supabase = createServiceRoleClient()

  // Find active sessions with auto-detection enabled
  const { data: sessions } = await supabase
    .from('townhall_sessions')
    .select('id, config, last_theme_detection_at')
    .eq('status', 'active')

  if (!sessions || sessions.length === 0) {
    return NextResponse.json({ scanned: 0, detected: 0 })
  }

  let scanned = 0
  let totalDetected = 0

  for (const s of sessions) {
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
      console.error({ at: 'cron/townhall-theme-detection', msg: 'detect error', sessionId: s.id, err: e })
    }
  }

  return NextResponse.json({ scanned, detected: totalDetected })
}
