// app/api/verify-auth/route.ts
// Verify email + password against Supabase Auth without creating a session.
// Used by #verbose command in surveys/town halls to confirm admin access.

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  let body: { email?: string; password?: string }
  try { body = await request.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { email, password } = body
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  // Use a throwaway client — we don't want to affect any existing session
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  )

  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    return NextResponse.json({ valid: false })
  }

  // Sign out immediately — we only needed to verify
  await supabase.auth.signOut()
  return NextResponse.json({ valid: true })
}
