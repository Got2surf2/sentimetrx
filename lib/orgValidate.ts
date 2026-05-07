// lib/orgValidate.ts
// Lightweight validator for the Phase E admin ?org= URL filter. Catches the
// realistic bad case (typo / pasted non-UUID / outdated bookmark) without an
// extra DB round-trip. If the filter doesn't look like a UUID, treat it as
// absent — don't 400, just fall back to "all orgs". Better UX than throwing
// a 500 from Postgres on a malformed UUID.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Returns the org id if it's a syntactically valid UUID, otherwise null. */
export function validateOrgFilter(raw: string | string[] | null | undefined): string | null {
  if (!raw) return null
  const v = Array.isArray(raw) ? raw[0] : raw
  if (!v || !UUID_RE.test(v)) return null
  return v
}
