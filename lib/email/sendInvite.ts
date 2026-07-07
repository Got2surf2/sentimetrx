import 'server-only'

import type { SupabaseClient } from '@supabase/supabase-js'
import { getEmailProvider } from '@/lib/email/provider'
import { buildInviteEmail } from '@/lib/email/inviteTemplate'

const INVITE_FROM = 'Sentimetrx <invites@sentimetrx.ai>'

export interface InviteRow {
  id:         string
  token:      string
  email:      string
  role:       string
  org_id:     string
  expires_at: string
}

export interface SendResult {
  status: 'sent' | 'failed'
  error?: string
}

export async function sendInviteEmail(
  service: SupabaseClient,
  invite: InviteRow,
  inviterId: string,
  customMessage?: string,
): Promise<SendResult> {
  try {
    const [orgRes, inviterRes] = await Promise.all([
      service.from('organizations').select('name').eq('id', invite.org_id).single(),
      service.from('users').select('full_name, email').eq('id', inviterId).single(),
    ])

    const baseUrl   = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
    const inviteUrl = `${baseUrl.replace(/\/$/, '')}/invite/${invite.token}`
    const orgName   = orgRes.data?.name || 'their organization'

    const { subject, html, text } = buildInviteEmail({
      orgName,
      inviterName:  inviterRes.data?.full_name || undefined,
      inviterEmail: inviterRes.data?.email || undefined,
      role:         invite.role,
      inviteUrl,
      expiresAt:    invite.expires_at,
      customMessage,
    })

    const provider = getEmailProvider('resend')
    await provider.send({
      to:      invite.email,
      from:    INVITE_FROM,
      replyTo: inviterRes.data?.email || undefined,
      subject,
      html,
      text,
    })
    return { status: 'sent' }
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e)
    console.error('invite: email send failed', { invite_id: invite.id, error })
    return { status: 'failed', error }
  }
}
