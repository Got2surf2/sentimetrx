// app/api/settings/team/disable/route.ts
// PATCH — Toggle a user's disabled status. Only org owners can disable
// members of their own org. Disabling sets users.disabled = true AND tells
// Supabase auth to ban the user (banned_until far-future) so new login
// attempts are blocked at the auth layer. Re-enabling clears both flags.

import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { serverError } from '@/lib/apiError'

const FAR_FUTURE = '2099-12-31T23:59:59Z'

export async function PATCH(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { user_id?: string; disabled?: boolean }
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
  const { user_id, disabled } = body
  if (!user_id || typeof disabled !== 'boolean') {
    return NextResponse.json({ error: 'Missing user_id or disabled' }, { status: 400 })
  }
  if (user_id === user.id) {
    return NextResponse.json({ error: 'Cannot disable yourself' }, { status: 400 })
  }

  const { data: actor } = await supabase.from('users').select('org_id, role').eq('id', user.id).single()
  const { data: target } = await supabase.from('users').select('org_id').eq('id', user_id).single()
  if (!actor || !target || actor.org_id !== target.org_id) {
    return NextResponse.json({ error: 'Not in same org' }, { status: 403 })
  }
  if (actor.role !== 'owner') {
    return NextResponse.json({ error: 'Only owners can disable members' }, { status: 403 })
  }

  const service = createServiceRoleClient()

  // Update the canonical flag in our public.users table first — this is what
  // the app reads. Then update auth.users to enforce at the auth layer.
  const { error: dbErr } = await service.from('users')
    .update({ disabled }).eq('id', user_id)
  if (dbErr) return serverError(dbErr, 'settings.team.disable', { orgId: actor.org_id })

  // Ban / unban via Supabase admin. ban_duration accepts a duration string
  // ("none" to clear, or e.g. "8760h" for a year). We use the far-future
  // banned_until pattern via direct admin call.
  try {
    if (disabled) {
      await service.auth.admin.updateUserById(user_id, { ban_duration: '876000h' /* 100 years */ })
    } else {
      await service.auth.admin.updateUserById(user_id, { ban_duration: 'none' })
    }
  } catch (e: unknown) {
    // Non-fatal: even if the admin call fails, the public.users.disabled flag
    // means the app will reject the user (in pages that check). Log only.
    console.error({ at: 'team/disable', msg: "admin updateUserById failed", err: e instanceof Error ? e.message : e })
  }

  return NextResponse.json({ success: true, disabled })
}
