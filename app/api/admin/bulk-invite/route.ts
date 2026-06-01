// app/api/admin/bulk-invite/route.ts
// POST /api/admin/bulk-invite
// Bulk-create invites + send emails for a list of (email, optional name)
// pairs against a single org. Wraps the same primitive that /api/invite
// uses one-at-a-time, so the email template + replyTo + RLS treatment
// stay consistent.
//
// Caller must be a super-admin (any is_admin_org member) OR an owner
// of the target org — same gate as /api/invite POST.
//
// Returns per-email result so the UI can show which sent vs failed:
//   { results: [{ email, status: 'sent' | 'duplicate' | 'failed', error?, token? }] }
// Already-invited (unused, unexpired) entries are skipped with status='duplicate'
// to avoid spamming users twice. Already-registered users are also skipped.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { randomBytes } from 'crypto'
import { sendInviteEmail } from '@/lib/email/sendInvite'

export const dynamic = 'force-dynamic'
export const maxDuration = 90

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ALLOWED_ROLES = new Set(['owner', 'admin', 'member', 'viewer'])

interface BulkInviteUser { email: string; name?: string }
interface ResultRow {
  email:  string
  status: 'sent' | 'created' | 'duplicate' | 'failed' | 'already_user'
  error?: string
  token?: string
  invite_url?: string
}

export async function POST(req: NextRequest) {
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { org_id?: string; users?: unknown; role?: string; message?: string; sendEmail?: boolean }
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const orgId = body.org_id
  if (!orgId) return NextResponse.json({ error: 'org_id is required' }, { status: 400 })

  const customMessage = typeof body.message === 'string' ? body.message.slice(0, 2000) : undefined
  // sendEmail defaults to true. When explicitly false, just create the
  // invite rows + return URLs — the inviter wants to send their own
  // email out-of-band (with preamble, etc).
  const sendEmail = body.sendEmail !== false
  const requestedRole = (body.role || 'owner') as string
  if (!ALLOWED_ROLES.has(requestedRole)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  if (!Array.isArray(body.users) || body.users.length === 0) {
    return NextResponse.json({ error: 'users must be a non-empty array' }, { status: 400 })
  }
  if (body.users.length > 100) {
    return NextResponse.json({ error: 'Cap is 100 invites per call' }, { status: 400 })
  }

  // Authorize: super-admin OR owner of target org (same as /api/invite)
  const { data: userData } = await supabase
    .from('users')
    .select('org_id, role, organizations(is_admin_org)')
    .eq('id', user.id)
    .single()
  const orgRel = (userData as { organizations?: unknown } | null)?.organizations
  const isSuperAdmin = Array.isArray(orgRel)
    ? (orgRel[0] as { is_admin_org?: boolean } | undefined)?.is_admin_org === true
    : (orgRel as { is_admin_org?: boolean } | null)?.is_admin_org === true
  const isOrgOwner = (userData as { role?: string; org_id?: string } | null)?.role === 'owner'
    && (userData as { org_id?: string } | null)?.org_id === orgId
  if (!isSuperAdmin && !isOrgOwner) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const service = createServiceRoleClient()

  // Normalize + validate inputs
  const normalized: BulkInviteUser[] = []
  for (const raw of body.users as Array<{ email?: unknown; name?: unknown }>) {
    const email = String(raw.email ?? '').trim().toLowerCase()
    if (!email || !EMAIL_RE.test(email)) continue
    const name = typeof raw.name === 'string' ? raw.name.trim() : undefined
    normalized.push({ email, name })
  }
  if (normalized.length === 0) {
    return NextResponse.json({ error: 'No valid email addresses provided' }, { status: 400 })
  }

  // One pass to find already-active users (auth.users) and pending invites
  const emails = normalized.map(u => u.email)
  const { data: existingUsers } = await service
    .from('users')
    .select('email')
    .in('email', emails)
  const alreadyUserSet = new Set(((existingUsers || []) as { email: string }[]).map(u => u.email))

  const { data: existingInvites } = await service
    .from('invites')
    .select('email, used_at, expires_at')
    .in('email', emails)
    .eq('org_id', orgId)
  const now = Date.now()
  const pendingInviteSet = new Set(
    ((existingInvites || []) as { email: string; used_at: string | null; expires_at: string }[])
      .filter(i => !i.used_at && new Date(i.expires_at).getTime() > now)
      .map(i => i.email),
  )

  const results: ResultRow[] = []

  for (const u of normalized) {
    if (alreadyUserSet.has(u.email)) {
      results.push({ email: u.email, status: 'already_user' })
      continue
    }
    if (pendingInviteSet.has(u.email)) {
      results.push({ email: u.email, status: 'duplicate' })
      continue
    }

    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()

    const { data: invite, error: insertErr } = await service
      .from('invites')
      .insert({
        token,
        org_id:     orgId,
        email:      u.email,
        role:       requestedRole,
        created_by: user.id,
        expires_at: expiresAt,
      })
      .select('id, token, email, role, org_id, expires_at')
      .single()

    if (insertErr || !invite) {
      results.push({ email: u.email, status: 'failed', error: insertErr?.message || 'insert failed' })
      continue
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
    const inviteUrl = `${baseUrl.replace(/\/$/, '')}/invite/${invite.token}`

    if (!sendEmail) {
      // Link-only mode: skip sendInviteEmail entirely.
      results.push({ email: u.email, status: 'created', token: invite.token, invite_url: inviteUrl })
      continue
    }

    const sendResult = await sendInviteEmail(service, invite, user.id, customMessage)
    if (sendResult.status === 'sent') {
      results.push({ email: u.email, status: 'sent', token: invite.token, invite_url: inviteUrl })
    } else {
      results.push({ email: u.email, status: 'failed', error: sendResult.error, token: invite.token, invite_url: inviteUrl })
    }
  }

  return NextResponse.json({ results })
}
