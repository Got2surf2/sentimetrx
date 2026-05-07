// app/api/admin/questions/[id]/route.ts
// PATCH — update a custom demo or psychographic question
// DELETE — remove a custom demo or psychographic question

import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

async function getOrgAndCustomQ(supabase: any, userId: string) {
  const { data: userData } = await supabase
    .from('users').select('org_id').eq('id', userId).single()
  const orgId = userData?.org_id
  if (!orgId) return { orgId: null, customQ: { demo: [], psycho: [] }, features: {}, isAdmin: false }
  const { data: orgData } = await supabase
    .from('organizations').select('id, features, is_admin_org').eq('id', orgId).single()
  const features = orgData?.features || {}
  const customQ = features.custom_questions || { demo: [], psycho: [] }
  return { orgId, customQ, features, isAdmin: !!orgData?.is_admin_org }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId, customQ, features, isAdmin } = await getOrgAndCustomQ(supabase, user.id)
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 400 })

  const body = await req.json()
  const { type, data: qData } = body  // type: 'demo' | 'psycho'

  const updated = { ...customQ }
  if (type === 'demo') {
    updated.demo = (customQ.demo || []).map(function(q: any) {
      return q.id === params.id ? { ...q, ...qData, id: params.id } : q
    })
  } else if (type === 'psycho') {
    updated.psycho = (customQ.psycho || []).map(function(q: any) {
      return q.id === params.id ? { ...q, ...qData, id: params.id } : q
    })
  } else {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  const { error } = await supabase.from('organizations')
    .update({ features: { ...features, custom_questions: updated } })
    .eq('id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId, customQ, features, isAdmin } = await getOrgAndCustomQ(supabase, user.id)
  if (!isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 400 })

  const url = new URL(req.url)
  const type = url.searchParams.get('type')  // 'demo' | 'psycho'

  const updated = { ...customQ }
  if (type === 'demo') {
    updated.demo = (customQ.demo || []).filter(function(q: any) { return q.id !== params.id })
  } else if (type === 'psycho') {
    updated.psycho = (customQ.psycho || []).filter(function(q: any) { return q.id !== params.id })
  } else {
    return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
  }

  const { error } = await supabase.from('organizations')
    .update({ features: { ...features, custom_questions: updated } })
    .eq('id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
