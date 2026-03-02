import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code       = url.searchParams.get('code')
  const token_hash = url.searchParams.get('token_hash')
  const type       = url.searchParams.get('type')

  const supabase = createClient()

  // Format 1 — code exchange (newer Supabase versions)
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL('/auth/reset-password', request.url))
    }
  }

  // Format 2 — token hash (older Supabase versions)
  if (token_hash && type) {
    const { error } = await supabase.auth.verifyOtp({
      token_hash,
      type: type as any
    })
    if (!error) {
      return NextResponse.redirect(new URL('/auth/reset-password', request.url))
    }
  }

  // Something went wrong — send back to login with error message
  return NextResponse.redirect(
    new URL('/login?error=The+reset+link+has+expired.+Please+request+a+new+one.', request.url)
  )
}
