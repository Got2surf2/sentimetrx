// lib/loginLog.ts
// Helper to log a successful sign-in event. Call from auth-callback paths
// AFTER the session has been established. Writes via service role so it
// works regardless of RLS state.
//
// Always treat as best-effort — never block the auth flow if logging fails.

import { createServiceRoleClient } from './supabase/server'

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
    await service.from('user_logins').insert({
      user_id:    opts.userId,
      org_id:     u?.org_id || null,
      method:     opts.method,
      ip:         opts.ip || null,
      user_agent: opts.userAgent || null,
    })
  } catch (e) {
    console.error('[loginLog] failed:', (e as any)?.message || e)
  }
}
