// app/api/cron/cleanup-shared-links/route.ts
// Cron endpoint: deletes expired shared_links rows.
// Runs daily via Vercel Cron.

import { createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const service = createServiceRoleClient()

  const { data, error } = await service
    .from('shared_links')
    .delete()
    .lt('expires_at', new Date().toISOString())
    .select('id')

  const deleted = data?.length || 0

  if (error) {
    console.error('[cleanup-shared-links] error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ deleted })
}
