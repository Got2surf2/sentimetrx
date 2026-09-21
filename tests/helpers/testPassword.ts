// tests/helpers/testPassword.ts
//
// Throwaway password for users the env-gated suites create in the TEST
// Supabase project. Random hex alone is lowercase + digits; the project's
// password policy also requires an uppercase letter and a symbol, so
// `admin.createUser` rejected it and every suite died in setup (2026-09-20).
import { randomBytes } from 'node:crypto'

export function testPassword(): string {
  return randomBytes(16).toString('hex') + 'Aa1!'
}
