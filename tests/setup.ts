import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'
import { config as loadDotenv } from 'dotenv'

// Load real env values from .env.local first so opt-in tests (e.g. the RLS
// isolation suite gated by RLS_TEST=1) can reach a real Supabase project.
// Override:false leaves explicit shell env (npm script vars) untouched.
loadDotenv({ path: '.env.local', override: false })

// Tests should never accidentally hit production Supabase. If a test forgets
// to mock the supabase server module — and .env.local didn't supply real
// values — these placeholders surface the missing-mock loudly.
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://localhost:54321'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'test-anon-key'
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key'

// next/headers `cookies()` requires a request scope. Stub it so server
// modules can be imported in tests that mock further down the stack.
vi.mock('next/headers', () => ({
  cookies: () => ({
    get: () => undefined,
    set: () => undefined,
  }),
  headers: () => new Headers(),
}))
