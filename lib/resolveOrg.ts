export function resolveOrg(raw: unknown): { is_admin_org?: boolean; logo_url?: string; name?: string } | null {
  if (!raw) return null
  const org = Array.isArray(raw) ? raw[0] : raw
  return org ?? null
}
