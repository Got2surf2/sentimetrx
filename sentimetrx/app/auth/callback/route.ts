import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')

  if (code) {
    const supabase = createClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL('/auth/reset-password', request.url))
    }
  }

  return NextResponse.redirect(
    new URL('/login?error=Reset+link+expired.+Please+request+a+new+one.', request.url)
  )
}
