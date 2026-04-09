import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form   = await req.formData()
  const file   = form.get('file') as File | null
  const org_id = form.get('org_id') as string | null

  if (!file || !org_id) return NextResponse.json({ error: 'Missing file or org_id' }, { status: 400 })
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: 'File too large (max 2MB)' }, { status: 400 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = userData?.organizations
  const isAdmin = Array.isArray(orgData) ? orgData[0]?.is_admin_org : (orgData as any)?.is_admin_org
  const isOwner = userData?.org_id === org_id

  if (!isAdmin && !isOwner) {
    return NextResponse.json({ error: 'Permission denied' }, { status: 403 })
  }

  const bytes  = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const ext    = file.name.split('.').pop() || 'png'
  const path   = `${org_id}/logo.${ext}`

  const service = createServiceRoleClient()

  const { error: uploadError } = await service.storage
    .from('org-logos')
    .upload(path, buffer, { contentType: file.type, upsert: true })

  if (uploadError) return NextResponse.json({ error: uploadError.message }, { status: 500 })

  const { data: urlData } = service.storage.from('org-logos').getPublicUrl(path)
  const logo_url = urlData.publicUrl + '?t=' + Date.now()

  const { error: updateError } = await service
    .from('organizations')
    .update({ logo_url })
    .eq('id', org_id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json({ logo_url })
}

export async function DELETE(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { org_id } = await req.json()
  if (!org_id) return NextResponse.json({ error: 'Missing org_id' }, { status: 400 })

  const service = createServiceRoleClient()

  await service.storage.from('org-logos').remove([`${org_id}/logo.png`, `${org_id}/logo.jpg`, `${org_id}/logo.webp`])

  const { error } = await service.from('organizations').update({ logo_url: null }).eq('id', org_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
