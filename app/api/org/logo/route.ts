import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const form   = await req.formData()
  const file   = form.get('file') as File | null
  const org_id = form.get('org_id') as string | null

  if (!file || !org_id) return NextResponse.json({ error: 'Missing file or org_id' }, { status: 400 })
  if (file.size > 2 * 1024 * 1024) return NextResponse.json({ error: 'File too large (max 2MB)' }, { status: 400 })

  // Whitelist image-only uploads. Without this, an admin could upload
  // logo.html with content-type: text/html to a public bucket and serve
  // arbitrary HTML/JS from the sentimetrx.ai-adjacent storage domain.
  const ALLOWED_MIME = new Map<string, string[]>([
    ['image/png', ['png']],
    ['image/jpeg', ['jpg', 'jpeg']],
    ['image/webp', ['webp']],
    ['image/svg+xml', ['svg']],
  ])
  const incomingExt = (file.name.split('.').pop() || '').toLowerCase()
  const allowedExts = ALLOWED_MIME.get(file.type)
  if (!allowedExts || !allowedExts.includes(incomingExt)) {
    return NextResponse.json({ error: 'Logo must be PNG, JPEG, WebP, or SVG' }, { status: 400 })
  }

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
  // Use the validated extension; ignore anything weird in the original filename.
  const path   = `${org_id}/logo.${incomingExt}`

  const service = createServiceRoleClient()

  const { error: uploadError } = await service.storage
    .from('org-logos')
    .upload(path, buffer, { contentType: file.type, upsert: true })

  if (uploadError) return serverError(uploadError, 'org.logo.upload', { orgId: org_id })

  const { data: urlData } = service.storage.from('org-logos').getPublicUrl(path)
  const logo_url = urlData.publicUrl + '?t=' + Date.now()

  const { error: updateError } = await service
    .from('organizations')
    .update({ logo_url })
    .eq('id', org_id)

  if (updateError) return serverError(updateError, 'org.logo.update', { orgId: org_id })
  return NextResponse.json({ logo_url })
}

export async function DELETE(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { org_id } = await req.json()
  if (!org_id) return NextResponse.json({ error: 'Missing org_id' }, { status: 400 })

  // Mirror the POST gate: only the org's own member, or a platform admin,
  // may clear the logo. Without this check, any authed user could DELETE
  // any org's logo by posting that org's id.
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

  const service = createServiceRoleClient()

  await service.storage.from('org-logos').remove([`${org_id}/logo.png`, `${org_id}/logo.jpg`, `${org_id}/logo.webp`])

  const { error } = await service.from('organizations').update({ logo_url: null }).eq('id', org_id)
  if (error) return serverError(error, 'org.logo.delete', { orgId: org_id })
  return NextResponse.json({ success: true })
}
