import { createClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { SLUG_REGEX } from '@/lib/constants'

// GET /api/studies/check-slug?slug=xxx&exclude=studyId
// Returns { available: boolean }
export async function GET(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const slug = (url.searchParams.get('slug') || '').toLowerCase().trim()
  const exclude = url.searchParams.get('exclude') || ''

  if (!slug) return NextResponse.json({ available: true })

  // Validate format
  if (!SLUG_REGEX.test(slug)) {
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
