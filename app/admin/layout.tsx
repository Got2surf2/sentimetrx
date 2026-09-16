// app/admin/layout.tsx
// Platform-admin session policy at the page boundary (SECURITY.md §3, ratified
// 2026-09-15: 30 min idle / 24 h max). API routes enforce it in requireAdmin;
// this layout covers a hard load of any /admin page. Page renders cannot set
// cookies, so this only CHECKS (touch:false) — proxy.ts re-stamps the cookie
// on /admin navigations, requireAdmin on every admin API call.
import type { ReactNode } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { evaluateAdminSession, ADMIN_SESSION_COOKIE } from '@/lib/auth/adminSession'

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    // Non-admins are each page's business (they redirect to /dashboard); the
    // policy applies to admin-org users only.
    const { isAdmin } = await getCallerOrgContext(supabase)
    if (isAdmin) {
      const jar = await cookies()
      const state = evaluateAdminSession({ cookie: jar.get(ADMIN_SESSION_COOKIE)?.value, lastSignInAt: user.last_sign_in_at, touch: false })
      if (!state.ok) redirect('/login?reason=' + state.reason)
    }
  }
  return <>{children}</>
}
