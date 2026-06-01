// app/api/admin/invite-preview/route.ts
// POST /api/admin/invite-preview
// Returns the rendered HTML the bulk-invite UI will send. Same auth
// gate as /api/admin/bulk-invite. Useful for showing inviters what
// recipients will see — including any custom message — before they
// click Send.
//
// Doesn't write to the invites table. Doesn't send mail. Pure preview.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { buildInviteEmail } from '@/lib/email/inviteTemplate'

export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { org_id?: string; message?: string; role?: string }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  const orgId = body.org_id
  if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 })

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, role, full_name, email, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as { organizations?: unknown } | null)?.organizations
  const isSuperAdmin = Array.isArray(orgRel)
    ? (orgRel[0] as { is_admin_org?: boolean } | undefined)?.is_admin_org === true
    : (orgRel as { is_admin_org?: boolean } | null)?.is_admin_org === true
  const isOrgOwner = (userData as { role?: string; org_id?: string } | null)?.role === 'owner'
    && (userData as { org_id?: string } | null)?.org_id === orgId
  if (!isSuperAdmin && !isOrgOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const service = createServiceRoleClient()
  const { data: orgRow } = await service.from('organizations').select('name').eq('id', orgId).single()
  const orgName = (orgRow as { name?: string } | null)?.name || 'their organization'
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'

  const { subject, html, text } = buildInviteEmail({
    orgName,
    inviterName:  (userData as { full_name?: string } | null)?.full_name || undefined,
    inviterEmail: (userData as { email?: string } | null)?.email || undefined,
    role:         body.role || 'owner',
    inviteUrl:    `${baseUrl}/invite/PREVIEW-TOKEN`,
    expiresAt:    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    customMessage: body.message,
  })

  return NextResponse.json({ subject, html, text })
}
