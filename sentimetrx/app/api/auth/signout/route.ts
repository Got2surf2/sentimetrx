import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = createClient()
  await supabase.auth.signOut()
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
  return new NextResponse(null, {
    status: 303,
    headers: { Location: `${baseUrl}/login` },
  })
}

export const GET = POST
