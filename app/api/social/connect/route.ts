// app/api/social/connect/route.ts
// Initiates Meta OAuth flow — redirects user to Facebook login

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const appId = process.env.META_APP_ID
  // Derive redirect URI from the incoming request to avoid env var mismatches
  const origin = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.sentimetrx.ai'
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const redirectUri = process.env.META_REDIRECT_URI || `${proto}://${origin}/api/social/callback`

  if (!appId) return NextResponse.json({ error: 'META_APP_ID not configured' }, { status: 500 })

  const scopes = [
    'pages_show_list',
    'pages_read_engagement',
    'pages_manage_posts',
  ].join(',')

  const state = Buffer.from(JSON.stringify({ userId: user.id })).toString('base64')

  const url = `https://www.facebook.com/v19.0/dialog/oauth?client_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${scopes}&state=${state}&response_type=code`

  return NextResponse.redirect(url)
}
