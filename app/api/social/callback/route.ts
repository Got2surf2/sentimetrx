// app/api/social/callback/route.ts
// Meta OAuth callback — exchanges code for long-lived token, stores connection

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { verifyOauthState } from '@/lib/oauthState'

export const dynamic = 'force-dynamic'

// Both token-exchange calls send META_APP_SECRET as POST form data instead of
// query string. Anything in the URL (including secrets) lands in upstream
// proxy logs, NEL reports, and any CDN trail along the way; bodies don't.
async function exchangeCodeForToken(code: string, redirectUri: string): Promise<{ access_token: string; expires_in?: number }> {
  console.log('[social/callback] exchanging code with redirect_uri:', redirectUri)
  const body = new URLSearchParams({
    client_id: process.env.META_APP_ID || '',
    client_secret: process.env.META_APP_SECRET || '',
    redirect_uri: redirectUri,
    code,
  })
  const res = await fetch('https://graph.facebook.com/v19.0/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    const errBody = await res.text()
    console.error({ at: 'social/callback', msg: 'token exchange failed', status: res.status, errBody })
    throw new Error('Failed to exchange code: ' + errBody)
  }
  return res.json()
}

async function getLongLivedToken(shortToken: string): Promise<{ access_token: string; expires_in: number }> {
  const body = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID || '',
    client_secret: process.env.META_APP_SECRET || '',
    fb_exchange_token: shortToken,
  })
  const res = await fetch('https://graph.facebook.com/v19.0/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) throw new Error('Failed to get long-lived token: ' + (await res.text()))
  return res.json()
}

async function getPageTokens(userToken: string): Promise<Array<{ id: string; name: string; access_token: string }>> {
  const res = await fetch(`https://graph.facebook.com/v19.0/me/accounts?access_token=${userToken}`)
  if (!res.ok) throw new Error('Failed to get pages: ' + (await res.text()))
  const data = await res.json()
  return data.data || []
}

async function getInstagramAccount(pageId: string, pageToken: string): Promise<{ id: string; username: string } | null> {
  const res = await fetch(`https://graph.facebook.com/v19.0/${pageId}?fields=instagram_business_account{id,username}&access_token=${pageToken}`)
  if (!res.ok) return null
  const data = await res.json()
  return data.instagram_business_account || null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = searchParams.get('code')
  const stateRaw = searchParams.get('state')
  const error = searchParams.get('error')

  // Pin to the configured site URL. Building it from `x-forwarded-host`
  // when env is unset lets an attacker spoof the header (Host, X-Forwarded-
  // Host) and redirect victims through a domain they control. The env var
  // is set in every deployed environment; refuse to redirect if it isn't.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL
  if (!siteUrl) {
    console.error({ at: 'social/callback', msg: "NEXT_PUBLIC_SITE_URL not configured" })
    return NextResponse.json({ error: 'Site URL not configured' }, { status: 503 })
  }

  if (error || !code || !stateRaw) {
    return NextResponse.redirect(`${siteUrl}/social?error=oauth_denied`)
  }

  // verifyOauthState rejects forged or expired states; without this an
  // attacker could attach their own FB pages/tokens to any other user's org.
  const state = verifyOauthState<{ userId?: string }>(stateRaw)
  if (!state || typeof state.userId !== 'string' || !state.userId) {
    return NextResponse.redirect(`${siteUrl}/social?error=invalid_state`)
  }
  const userId = state.userId

  const service = createServiceRoleClient()
  const redirectUri = process.env.META_REDIRECT_URI || `${siteUrl}/api/social/callback`

  try {
    // Exchange code for short-lived token
    const shortToken = await exchangeCodeForToken(code, redirectUri)

    // Exchange for long-lived token (60 days)
    const longToken = await getLongLivedToken(shortToken.access_token)
    const expiresIn = longToken.expires_in || shortToken.expires_in || 5184000 // default 60 days
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString()

    // Get user's org
    const { data: userData } = await service.from('users').select('org_id').eq('id', userId).single()
    if (!userData?.org_id) {
      return NextResponse.redirect(`${siteUrl}/social?error=no_org`)
    }

    // Get pages the user manages
    const pages = await getPageTokens(longToken.access_token)
    console.log('[social/callback] Token exchange OK. Pages found:', pages.length, pages.map(p => p.name).join(', '))

    if (pages.length === 0) {
      console.log('[social/callback] No pages found — user may not manage any Facebook Pages')
      return NextResponse.redirect(`${siteUrl}/social?error=no_pages`)
    }

    // Store each page as a Facebook connection + check for linked IG account
    for (const page of pages) {
      // Delete existing connection for this page, then insert fresh
      await service.from('social_connections').delete().eq('org_id', userData.org_id).eq('platform', 'facebook').eq('account_id', page.id)
      const { error: fbErr } = await service.from('social_connections').insert({
        org_id: userData.org_id,
        platform: 'facebook',
        account_id: page.id,
        account_name: page.name,
        access_token: page.access_token,
        token_expires_at: expiresAt,
        connected_by: userId,
      })
      if (fbErr) console.error({ at: 'social/callback', msg: "FB insert error", err: fbErr.message })
      else console.log('[social/callback] Stored FB page:', page.name, page.id)

      // Check for linked Instagram Business account
      const ig = await getInstagramAccount(page.id, page.access_token)
      if (ig) {
        await service.from('social_connections').delete().eq('org_id', userData.org_id).eq('platform', 'instagram').eq('account_id', ig.id)
        const { error: igErr } = await service.from('social_connections').insert({
          org_id: userData.org_id,
          platform: 'instagram',
          account_id: ig.id,
          account_name: ig.username,
          access_token: page.access_token,
          token_expires_at: expiresAt,
          connected_by: userId,
        })
        if (igErr) console.error({ at: 'social/callback', msg: "IG insert error", err: igErr.message })
      }
    }

    return NextResponse.redirect(`${siteUrl}/social?connected=true`)
  } catch (err: any) {
    console.error({ at: 'social/callback', msg: "OAuth error", err: err })
    return NextResponse.redirect(`${siteUrl}/social?error=oauth_failed`)
  }
}
