// lib/loginLog.ts
// Helper to log a successful sign-in event. Call from auth-callback paths
// AFTER the session has been established. Writes via service role so it
// works regardless of RLS state.
//
// Always treat as best-effort — never block the auth flow if logging fails.
//
// Mirrors the same login event into user_events so the activity dashboard
// captures auth alongside product actions. user_logins stays as the
// auth-specific log (carries method); user_events is the generic stream.

import { createServiceRoleClient } from './supabase/server'
import { recordUserEvent } from './userEvents'

export type LoginMethod = 'password' | 'magic' | 'sso' | 'invite'

export async function logLogin(opts: {
  userId:    string
  method:    LoginMethod
  ip?:       string | null
  userAgent?: string | null
}): Promise<void> {
  try {
    const service = createServiceRoleClient()
    const { data: u } = await service
      .from('users')
      .select('org_id')
      .eq('id', opts.userId)
      .single()
    const orgId = (u as { org_id?: string | null } | null)?.org_id || null
    await service.from('user_logins').insert({
      user_id:    opts.userId,
      org_id:     orgId,
      method:     opts.method,
      ip:         opts.ip || null,
      user_agent: opts.userAgent || null,
    })
    // Mirror into the generic activity stream
    await recordUserEvent({
      userId:    opts.userId,
      orgId,
      event:     'login',
      metadata:  { method: opts.method },
      ip:        opts.ip || null,
      userAgent: opts.userAgent || null,
    })
  } catch (e) {
    console.error('[loginLog] failed:', (e as Error)?.message || e)
  }
}
