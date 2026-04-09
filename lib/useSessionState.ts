/**
 * Thin helpers for reading/writing JSON to sessionStorage.
 * SSR-safe — returns null on the server.
 */

export function readSession<T = Record<string, unknown>>(key: string): T | null {
  if (typeof window === 'undefined') return null
  try { var s = sessionStorage.getItem(key); return s ? JSON.parse(s) : null } catch { return null }
}

export function writeSession(key: string, value: unknown): void {
  try { sessionStorage.setItem(key, JSON.stringify(value)) } catch {}
}
