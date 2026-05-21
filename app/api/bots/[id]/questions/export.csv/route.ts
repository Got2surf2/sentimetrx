// app/api/bots/[id]/questions/export.csv/route.ts
// GET — CSV export of logged questions for a bot. Org-member or admin gated.
//
// PII redaction is ON by default (docs/BOTS.md § 9.x.6 open design Q —
// MVP default is redact, superadmin toggle ?reveal=1 to unmask). Three
// patterns redacted: email, phone (NA-style), street address number.
// Future: tie to safety:pii content_flags + a per-org "always redact"
// setting. For now this is a defensible default for the NOWOCATS PM-2
// public-record export.

import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { isCallerSuperadmin } from '@/lib/auth/superadmin'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: { id: string } }

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE_RE = /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g
const ADDR_RE = /\b\d{1,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Boulevard|Ln|Lane|Dr|Drive|Way|Ct|Court|Pl|Place)\b\.?/g

function redactPII(text: string): string {
  if (!text) return text
  return text
    .replace(EMAIL_RE, '[email]')
    .replace(PHONE_RE, '[phone]')
    .replace(ADDR_RE, '[address]')
}

function csvEscape(v: any): string {
  if (v === null || v === undefined) return ''
  const s = String(v)
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"'
  }
  return s
}

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  const { data: bot } = await service.from('agents').select('id, slug, org_id').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })
  if (!isAdmin && bot.org_id !== orgId) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const wantReveal = req.nextUrl.searchParams.get('reveal') === '1'
  let reveal = false
  if (wantReveal) reveal = await isCallerSuperadmin(service, userId)

  const { data: rows, error } = await service
    .from('logged_questions')
    .select('user_message, language, classification, status, session_id, notes, suggested_kb_addition, resolved_at, created_at')
    .eq('bot_id', params.id)
    .eq('org_id', bot.org_id)
    .order('created_at', { ascending: false })
    .limit(10000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const header = ['created_at', 'classification', 'status', 'language', 'session_id', 'user_message', 'notes', 'suggested_kb_addition', 'resolved_at']
  const lines = [header.join(',')]
  for (const r of rows || []) {
    const msg = reveal ? r.user_message : redactPII(r.user_message || '')
    const notes = reveal ? r.notes : (r.notes ? redactPII(r.notes) : '')
    const sugg = reveal ? r.suggested_kb_addition : (r.suggested_kb_addition ? redactPII(r.suggested_kb_addition) : '')
    lines.push([
      r.created_at,
      r.classification,
      r.status,
      r.language || '',
      r.session_id,
      msg,
      notes || '',
      sugg || '',
      r.resolved_at || '',
    ].map(csvEscape).join(','))
  }

  const stamp = new Date().toISOString().slice(0, 10)
  const filename = 'questions_' + bot.slug + '_' + stamp + (reveal ? '_unredacted' : '') + '.csv'

  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
    },
  })
}
