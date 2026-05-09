// app/api/auth/log-login/route.ts
// POST { method: 'password'|'magic'|'sso'|'invite' }
// Called by the client right after a successful sign-in. Identifies the user
// from the JWT (already set by the time we're called) and writes a row to
// user_logins. Best-effort — never blocks the auth flow.

import { createClient } from '@/lib/supabase/server'
import { logLogin, type LoginMethod } from '@/lib/loginLog'
import { checkRateLimit } from '@/lib/rateLimit'
import { NextRequest, NextResponse } from 'next/server'

const VALID: LoginMethod[] = ['password', 'magic', 'sso', 'invite']

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 20/min per user. Login is a once-per-session event in normal use —
  // anything more is either a bug or someone trying to flood user_logins.
  const rl = await checkRateLimit('log-login:' + user.id, 20, 60 * 1000)
  if (rl.limited) return NextResponse.json({ error: 'Too many requests' }, { status: 429 })

  let body: any
  try { body = await req.json() } catch { body = {} }
  const method: LoginMethod = VALID.includes(body?.method) ? body.method : 'password'

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
  const ua = req.headers.get('user-agent') || null

  await logLogin({ userId: user.id, method, ip, userAgent: ua })
  return NextResponse.json({ logged: true })
}
