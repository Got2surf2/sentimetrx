import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/studies/check-slug?slug=xxx&exclude=studyId
// Returns { available: boolean }
export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const slug = (url.searchParams.get('slug') || '').toLowerCase().trim()
  const exclude = url.searchParams.get('exclude') || ''

  if (!slug) return NextResponse.json({ available: true })

  // Validate format
  if (!/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/.test(slug)) {
    return NextResponse.json({ available: false, reason: 'Invalid format. Use 3-50 lowercase letters, numbers, and hyphens.' })
  }

  let query = supabase
    .from('studies')
    .select('id')
    .eq('slug', slug)
    .limit(1)

  if (exclude) query = query.neq('id', exclude)

  const { data } = await query

  return NextResponse.json({ available: !data || data.length === 0 })
}
