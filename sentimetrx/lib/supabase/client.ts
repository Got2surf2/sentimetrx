import { createBrowserClient } from '@supabase/ssr'

// Browser-side Supabase client — safe to use in client components
// Uses the public anon key (respects RLS policies)
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
