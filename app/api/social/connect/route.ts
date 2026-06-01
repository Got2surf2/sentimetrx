// app/api/social/connect/route.ts
// Initiates Meta OAuth flow — redirects user to Facebook login

import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { signOauthState } from '@/lib/oauthState'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const appId = process.env.META_APP_ID
  const redirectUri = process.env.META_REDIRECT_URI || `${process.env.NEXT_PUBLIC_SITE_URL || 'https://www.sentimetrx.ai'}/api/social/callback`

  if (!appId) return NextResponse.json({ error: 'META_APP_ID not configured' }, { status: 500 })

  const scopes = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
  ].join(',')

  let state: string
  try {
    state = signOauthState({ userId: user.id })
  } catch (e: any) {
    console.error({ at: 'social/connect', err: e?.message })
    return NextResponse.json({ error: 'OAuth not configured' }, { status: 500 })
  }

  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${encodeURIComponent(state)}&response_type=code`

  return NextResponse.redirect(url)
}
