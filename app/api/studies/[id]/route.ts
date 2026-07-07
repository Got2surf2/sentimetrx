import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { SLUG_REGEX } from '@/lib/constants'
import { checkTransferTarget, recordOrgTransfer } from '@/lib/orgTransfer'
import { serverError } from '@/lib/apiError'

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('studies')
    .select('*')
    .eq('id', params.id)
    .single()

  if (error || !data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Get user's org info
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = userData?.organizations
  const isAdmin = Array.isArray(orgData)
    ? orgData[0]?.is_admin_org
    : (orgData as unknown as { is_admin_org?: boolean } | null)?.is_admin_org

  let body: Record<string, unknown>
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }

  // Check ownership — creator or admin can update (including close/reopen)
  const { data: existing } = await supabase
    .from('studies')
    .select('status, created_by')
    .eq('id', params.id)
    .single()

  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (!isAdmin && existing.created_by !== user.id) {
    return NextResponse.json({ error: 'You can only edit your own studies' }, { status: 403 })
  }

  // Allow visibility changes only by creator or admin
  const allowed = ['name', 'bot_name', 'bot_emoji', 'status', 'config', 'visibility', 'slug']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  // Validate slug if provided
  if (updates.slug != null) {
    const slug = String(updates.slug).toLowerCase().trim()
    if (slug === '') {
      updates.slug = null  // clear slug
    } else {
      // Validate format: lowercase alphanumeric + hyphens, 3-50 chars
      if (!SLUG_REGEX.test(slug)) {
        return NextResponse.json({ error: 'Slug must be 3-50 characters: lowercase letters, numbers, and hyphens only' }, { status: 400 })
      }
      // Check uniqueness
      const { data: conflict } = await supabase
        .from('studies')
        .select('id')
        .eq('slug', slug)
        .neq('id', params.id)
        .limit(1)
      if (conflict && conflict.length > 0) {
        return NextResponse.json({ error: 'This URL is already taken. Try a different one.' }, { status: 409 })
      }
      updates.slug = slug
    }
  }

  // Admin-only: allow changing org_id (transfer study to another org)
  // Validates active target + records to org_transfers via the shared helper.
  let isTransfer = false
  let prevOrgId: string | null = null
  let resourceName: string | null = null
  if ('org_id' in body) {
    if (!isAdmin) {
      return NextResponse.json({ error: 'Only admins can transfer studies' }, { status: 403 })
    }
    const svc = createServiceRoleClient()
    const { data: cur } = await svc.from('studies').select('org_id, name').eq('id', params.id).single()
    prevOrgId = (cur as { org_id?: string | null; name?: string | null } | null)?.org_id ?? null
    resourceName = (cur as { org_id?: string | null; name?: string | null } | null)?.name ?? null
    const check = await checkTransferTarget(svc, prevOrgId, body.org_id as string)
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status || 400 })
    updates.org_id = body.org_id
    isTransfer = true
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  // Use service role for all updates — API already verified ownership above
  const updateClient = createServiceRoleClient()
  const { data, error } = await updateClient
    .from('studies')
    .update(updates)
    .eq('id', params.id)
    .select('id, guid, slug, status, visibility, org_id')
    .single()

  if (error) return serverError(error, 'studies.update')

  if (isTransfer) {
    const svc = createServiceRoleClient()
    await recordOrgTransfer({
      service: svc, resourceType: 'study', resourceId: params.id,
      resourceName, fromOrgId: prevOrgId, toOrgId: updates.org_id as string,
      initiatedBy: user.id, initiatedByEmail: user.email || null,
    })
  }
  return NextResponse.json(data)
}

export async function DELETE(_req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: study } = await supabase
    .from('studies')
    .select('id, name, created_by, status')
    .eq('id', params.id)
    .single()

  if (!study) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Get user admin status
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()

  const orgData = userData?.organizations
  const isAdmin = Array.isArray(orgData)
    ? orgData[0]?.is_admin_org
    : (orgData as unknown as { is_admin_org?: boolean } | null)?.is_admin_org

  if (!isAdmin && study.created_by !== user.id) {
    return NextResponse.json({ error: 'You can only delete your own studies' }, { status: 403 })
  }

  const { error } = await supabase
    .from('studies')
    .delete()
    .eq('id', params.id)

  if (error) return serverError(error, 'studies.delete')
  return NextResponse.json({ success: true, deleted: study.name })
}
