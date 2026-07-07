// app/api/cron/social-token-refresh/route.ts
// Cron endpoint: refreshes Meta long-lived tokens before they expire.
// Runs daily. Tokens expire after 60 days; refresh when <7 days remaining.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { checkCronAuth } from '@/lib/cronAuth'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(req: NextRequest) {
  const denied = checkCronAuth(req.headers.get('authorization'))
  if (denied) return denied

  const service = createServiceRoleClient()

  // Find tokens expiring within the next 7 days
  const sevenDaysOut = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

  const { data: expiring, error } = await service
    .from('social_connections')
    .select('id, platform, account_name, access_token, token_expires_at')
    .lt('token_expires_at', sevenDaysOut)
    .gt('token_expires_at', new Date().toISOString())

  if (error) {
    return serverError(error, 'cron.socialTokenRefresh.listExpiring')
  }

  if (!expiring?.length) {
    return NextResponse.json({ ok: true, refreshed: 0, message: 'No tokens need refresh' })
  }

  let refreshed = 0
  let failed = 0

  for (const conn of expiring) {
    try {
      // POST body keeps META_APP_SECRET out of upstream proxy/CDN logs;
      // a query-string secret would survive in NEL reports etc.
      const body = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: process.env.META_APP_ID || '',
        client_secret: process.env.META_APP_SECRET || '',
        fb_exchange_token: conn.access_token,
      })
      const res = await fetch('https://graph.facebook.com/v19.0/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      })

      if (!res.ok) {
        console.error({ at: 'social-token-refresh', msg: 'refresh failed', account: conn.account_name, body: await res.text() })
        failed++
        continue
      }

      const data = await res.json()
      const newExpiry = new Date(Date.now() + data.expires_in * 1000).toISOString()

      await service
        .from('social_connections')
        .update({
          access_token: data.access_token,
          token_expires_at: newExpiry,
          updated_at: new Date().toISOString(),
        })
        .eq('id', conn.id)

      refreshed++
    } catch (err: unknown) {
      console.error({ at: 'social-token-refresh', msg: 'connection error', connectionId: conn.id, err })
      failed++
    }
  }

  return NextResponse.json({ ok: true, refreshed, failed })
}
