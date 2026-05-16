// app/api/cron/cleanup-shared-links/route.ts
// Cron endpoint: deletes expired shared_links rows.
// Runs daily via Vercel Cron.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cronAuth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const service = createServiceRoleClient()

  const { data, error } = await service
    .from('shared_links')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select('id')

  const deleted = data?.length || 0

  if (error) {
    console.error({ at: 'cleanup-shared-links', msg: "error", err: error.message })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted })
}
