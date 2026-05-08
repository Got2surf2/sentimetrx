import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Tests should never accidentally hit production Supabase. If a test forgets
// to mock the supabase server module, surface that loudly.
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
