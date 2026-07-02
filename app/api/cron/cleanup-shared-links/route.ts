// app/api/cron/cleanup-shared-links/route.ts
// Cron endpoint: deletes expired shared_links rows.
// Runs daily via Vercel Cron.

import { createServiceRoleClient } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { checkCronAuth } from '@/lib/cronAuth'
import { serverError } from '@/lib/apiError'

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
    return serverError(error, 'cron.cleanupSharedLinks.delete')
  }

  return NextResponse.json({ deleted })
}
