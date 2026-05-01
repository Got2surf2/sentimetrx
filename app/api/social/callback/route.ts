// app/api/social/callback/route.ts
// Meta OAuth callback — exchanges code for long-lived token, stores connection

import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function exchangeCodeForToken(code: string, redirectUri: string): Promise<{ access_token: string; expires_in?: number }> {
  const res = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${code}`)
  if (!res.ok) throw new Error('Failed to exchange code: ' + (await res.text()))
  return res.json()
}

async function getLongLivedToken(shortToken: string): Promise<{ access_token: string; expires_in: number }> {
  const res = await fetch(`https://graph.facebook.com/v19.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.META_APP_ID}&client_secret=${process.env.META_APP_SECRET}&fb_exchange_token=${shortToken}`)
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

  const origin = req.headers.get('x-forwarded-host') || req.headers.get('host') || 'www.sentimetrx.ai'
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || `${proto}://${origin}`

  if (error || !code || !stateRaw) {
    return NextResponse.redirect(`${siteUrl}/social?error=oauth_denied`)
  }

  let userId: string
  try {
    const state = JSON.parse(Buffer.from(stateRaw, 'base64').toString())
    userId = state.userId
  } catch {
    return NextResponse.redirect(`${siteUrl}/social?error=invalid_state`)
  }

  const service = createServiceRoleClient()
  const redirectUri = process.env.META_REDIRECT_URI || `${siteUrl}/api/social/callback`

  try {
    // Exchange code for short-lived token
    const shortToken = await exchangeCodeForToken(code, redirectUri)

    // Exchange for long-lived token (60 days)
    const longToken = await getLongLivedToken(shortToken.access_token)
    const expiresAt = new Date(Date.now() + longToken.expires_in * 1000).toISOString()

    // Get user's org
    const { data: userData } = await service.from('users').select('org_id').eq('id', userId).single()
    if (!userData?.org_id) {
      return NextResponse.redirect(`${siteUrl}/social?error=no_org`)
    }

    // Get pages the user manages
    const pages = await getPageTokens(longToken.access_token)

    // Store each page as a Facebook connection + check for linked IG account
    for (const page of pages) {
      // Upsert Facebook Page connection
      await service.from('social_connections').upsert({
        org_id: userData.org_id,
        platform: 'facebook',
        account_id: page.id,
        account_name: page.name,
        access_token: page.access_token, // page-level long-lived token
        token_expires_at: expiresAt,
        connected_by: userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'org_id,platform,account_id', ignoreDuplicates: false })

      // Check for linked Instagram Business account
      const ig = await getInstagramAccount(page.id, page.access_token)
      if (ig) {
        await service.from('social_connections').upsert({
          org_id: userData.org_id,
          platform: 'instagram',
          account_id: ig.id,
          account_name: ig.username,
          access_token: page.access_token, // IG uses the page token
          token_expires_at: expiresAt,
          connected_by: userId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'org_id,platform,account_id', ignoreDuplicates: false })
      }
    }

    return NextResponse.redirect(`${siteUrl}/social?connected=true`)
  } catch (err: any) {
    console.error('[social/callback] OAuth error:', err)
    return NextResponse.redirect(`${siteUrl}/social?error=oauth_failed`)
  }
}
