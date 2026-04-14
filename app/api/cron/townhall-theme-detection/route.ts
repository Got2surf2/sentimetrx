// app/api/cron/townhall-theme-detection/route.ts
// Vercel cron — runs every 5 min, detects themes for active auto-detection sessions

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { detectThemesForSession } from '@/lib/townhallThemeDetection'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(req: Request) {
  // Verify cron secret
  const auth = req.headers.get('authorization')
  if (auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

    // Check if interval has elapsed
    const intervalMin = config?.engine?.theme_detection_interval_minutes || 10
    const lastRun = s.last_theme_detection_at ? new Date(s.last_theme_detection_at).getTime() : 0
    const elapsed = (Date.now() - lastRun) / 60000
    if (elapsed < intervalMin) continue

    scanned++
    try {
      const result = await detectThemesForSession(s.id)
      totalDetected += result.inserted
    } catch (e) {
      console.error('[cron/townhall-theme-detection] Error for session', s.id, e)
    }
  }

  return NextResponse.json({ scanned, detected: totalDetected })
}
