// app/auth/callback/route.ts
// Universal Supabase Auth callback. Handles every URL format the Supabase
// dashboard email templates can produce so a single endpoint covers magic
// link, password reset, invite, and signup confirmation.
//
// Supported inbound formats:
//   1. PKCE code      — ?code=<x>                       (from {{ .ConfirmationURL }} after Supabase verifies)
//   2. PKCE token_hash — ?token_hash=<x>&type=<t>&next=<path>  (custom URL in template)
//   3. Hash fragment   — #access_token=...               (legacy implicit flow — handled client-side at /auth/confirm)
//
// Routing on success: type=recovery → /auth/reset-password, otherwise the
// `next` param (or /dashboard if none).

import { createClient } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'

type OtpType = 'magiclink' | 'recovery' | 'invite' | 'signup' | 'email_change'

function destFor(type: string, next: string): string {
  if (type === 'recovery') return '/auth/reset-password'
  if (next && next.startsWith('/')) return next
  return '/dashboard'
}

function failRedirect(request: NextRequest, type: string, detail?: string): NextResponse {
  const isReset = type === 'recovery'
  const msg = isReset
    ? 'Password reset link expired or invalid. Please request a new one.'
    : 'Sign-in link expired or invalid. Please request a new one.'
  const params = new URLSearchParams({ error: msg })
  if (detail) params.set('detail', detail)
  return NextResponse.redirect(new URL('/login?' + params.toString(), request.url))
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code      = url.searchParams.get('code')
  const tokenHash = url.searchParams.get('token_hash')
  const typeRaw   = (url.searchParams.get('type') || '').toLowerCase()
  const next      = url.searchParams.get('next') || ''

  const supabase = await createClient()

  // (1) PKCE code — what Supabase's own /auth/v1/verify redirect produces
  // when the email template uses {{ .ConfirmationURL }}.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) return failRedirect(request, typeRaw, error.message)
    return NextResponse.redirect(new URL(destFor(typeRaw, next), request.url))
  }

  // (2) PKCE token_hash — custom URL pattern (e.g. magic link template
  // built as {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=...).
  if (tokenHash && typeRaw) {
    const allowed: OtpType[] = ['magiclink', 'recovery', 'invite', 'signup', 'email_change']
    if (!allowed.includes(typeRaw as OtpType)) {
      // Reject unknown type strictly. Defaulting to 'magiclink' was
      // overly permissive — a malformed link should surface a clear
      // error, not be coerced into a different verification flow.
      return failRedirect(request, typeRaw, 'unknown link type')
    }
    const type = typeRaw as OtpType
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (error) return failRedirect(request, typeRaw, error.message)
    return NextResponse.redirect(new URL(destFor(typeRaw, next), request.url))
  }

  // (3) Hash fragment — server can't see #fragments. Forward to the
  // client-side /auth/confirm page which reads location.hash.
  return NextResponse.redirect(new URL('/auth/confirm', request.url))
}
