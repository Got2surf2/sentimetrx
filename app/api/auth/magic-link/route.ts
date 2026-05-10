// POST /api/auth/magic-link — server-side wrapper around signInWithOtp.
//
// Why this exists: the Supabase anon-client signInWithOtp call returns a
// 422 "Signups not allowed for otp" for unknown emails when
// shouldCreateUser:false is set, while returning success for known emails.
// That's an account-enumeration vector visible from the browser network
// tab. This route swallows the discrepancy on the server, always returns
// 200 OK, and the client UX is uniformly "check your email" regardless of
// whether the email is known.

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkRateLimit } from '@/lib/rateLimit'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    'unknown'

  // 5/min per IP. Magic-link requests trigger a Supabase email send for
  // known users, and even for unknown users we want to bound abuse via
  // this endpoint to roughly the same surface a normal user would use.
  const rl = await checkRateLimit('magic-link:' + ip, 5, 60_000)
  if (rl.limited) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  let body: { email?: unknown; redirectTo?: unknown }
  try { body = await req.json() } catch {
    // Same uniform response — even malformed bodies must not differentiate.
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const redirectTo = typeof body.redirectTo === 'string' ? body.redirectTo : undefined

  // Reject obviously-invalid shapes silently. The client validates email
  // formatting; this is a server-side belt.
  if (!email || email.length > 254 || !email.includes('@')) {
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    // Misconfiguration on our side — uniform response either way.
    return NextResponse.json({ ok: true }, { status: 200 })
  }

  const supabase = createClient(url, anonKey, { auth: { persistSession: false } })

  // Fire-and-forget shape: we await so any unexpected throw is logged, but
  // the response is identical regardless of the outcome.
  try {
    await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
      },
    })
  } catch (err) {
    // Don't surface — uniform response. Log server-side for observability.
    console.warn('magic-link: signInWithOtp threw', err)
  }

  return NextResponse.json({ ok: true }, { status: 200 })
}
