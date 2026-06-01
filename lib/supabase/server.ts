import 'server-only'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createServiceClient, type User } from '@supabase/supabase-js'

// Server-side Supabase client — uses cookies for auth
// Use this in Server Components, Route Handlers, Server Actions.
//
// @supabase/ssr ≥ 0.5 deprecated the `get/set/remove` cookie shape in
// favor of `getAll`/`setAll`. The body is the same operation — read all
// request cookies, write back the ones Supabase asks us to refresh.
// `setAll` is wrapped in try/catch because cookie writes outside a
// request context (e.g. background revalidation) throw in Next.js 14.
export async function createClient() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set({ name, value, ...options })
          }
        } catch {
          /* cookie op outside request context */
        }
      },
    },
  })
}

// Verifies the user's JWT against Supabase. Costs an extra ~50-200ms
// network call vs. cookie-decode-only, but rejects revoked or forged
// tokens — required for any route that gates access to org-scoped data.
// Previously used getSession() which only decodes the cookie locally;
// that left revoked sessions accepted until the cookie expired.
export async function getAuthUser(supabase: Awaited<ReturnType<typeof createClient>>): Promise<User | null> {
  const { data: { user } } = await supabase.auth.getUser()
  return user ?? null
}

// Service-role client — BYPASSES RLS
// Use ONLY in server-side API routes that need admin access
// (e.g. saving survey responses from unauthenticated users)
export function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable')
  return createServiceClient(url, key, { auth: { persistSession: false } })
}
