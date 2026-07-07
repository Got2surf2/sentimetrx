// app/api/admin/questions/route.ts
// POST — admin-only: create a custom demo or psychographic question for the
// caller's org. The library-listing GET that used to live here moved to
// /api/questions/library so non-admin survey/agent creators can read it
// without traversing an /api/admin/* path.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'

async function getOrgAndCustomQ(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data: userData } = await supabase
    .from('users').select('org_id').eq('id', userId).single()
  const orgId = userData?.org_id
  if (!orgId) return { orgId: null, customQ: { demo: [], psycho: [] }, features: {} }
  const { data: orgData } = await supabase
    .from('organizations').select('id, features, is_admin_org').eq('id', orgId).single()
  const features = orgData?.features || {}
  const customQ = features.custom_questions || { demo: [], psycho: [] }
  return { orgId, customQ, features, isAdmin: !!orgData?.is_admin_org }
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId, customQ, features } = await getOrgAndCustomQ(supabase, user.id)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 400 })

  const body = await req.json()
  const { type, data: qData } = body  // type: 'demo' | 'psycho'
  if (type !== 'demo' && type !== 'psycho') return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const newId = crypto.randomUUID()
  const entry = { ...qData, id: newId }

  const updated = { ...customQ }
  if (type === 'demo') updated.demo = [...(customQ.demo || []), entry]
  else updated.psycho = [...(customQ.psycho || []), entry]

  const { error } = await supabase.from('organizations')
    .update({ features: { ...features, custom_questions: updated } })
    .eq('id', orgId)
  if (error) return serverError(error, 'admin.questions.create', { orgId })

  return NextResponse.json({ id: newId, ...entry })
}
