// app/api/mco/handoff/route.ts
//
// POST — create a "send to phone" handoff for the /demo/mco kiosk. Accepts
// a snapshot of the current conversation, persists it under a short
// Crockford-base32 code, and returns { code, url } the client uses to render
// a QR code in the kiosk modal.
//
// The code is the only auth factor on the pickup side. Codes expire after
// 15 minutes (enforced by GET /m/[code] checking expires_at, plus a periodic
// cleanup via the cron worker — not yet wired). Public, CORS-open, no auth.

import { NextResponse, type NextRequest } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

// Crockford base32 (omits I, L, O, U to avoid 1/I/L and 0/O ambiguity).
// 6 chars = 32^6 = ~10^9 codes — plenty for kiosk concurrency.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
function makeCode(): string {
  let s = ''
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  for (let i = 0; i < 6; i++) s += ALPHABET[bytes[i] % ALPHABET.length]
  return s
}

interface Message { role: 'user' | 'assistant'; content: string }

export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'invalid json' }, { status: 400, headers: cors }) }

  const sessionId = typeof body?.session_id === 'string' ? body.session_id.slice(0, 80) : ''
  const botId = typeof body?.bot_id === 'string' ? body.bot_id : ''
  const messagesRaw = Array.isArray(body?.messages) ? body.messages : []
  if (!sessionId || !botId) return NextResponse.json({ error: 'session_id and bot_id required' }, { status: 400, headers: cors })

  // Sanitize + cap messages: drop anything that doesn't look like a chat turn,
  // truncate each content to 4000 chars, cap total turns at 50.
  const messages: Message[] = []
  for (const m of messagesRaw.slice(-50)) {
    if (m?.role !== 'user' && m?.role !== 'assistant') continue
    if (typeof m?.content !== 'string' || m.content.length === 0) continue
    messages.push({ role: m.role, content: m.content.slice(0, 4000) })
  }

  const service = createServiceRoleClient()

  // Generate a code and retry once on collision (extremely unlikely at 32^6).
  let code = ''
  let lastErr: any = null
  for (let attempt = 0; attempt < 3; attempt++) {
    code = makeCode()
    const { error } = await service.from('mco_handoff_sessions').insert({
      code,
      bot_id: botId,
      source_session_id: sessionId,
      messages,
    })
    if (!error) { lastErr = null; break }
    lastErr = error
    // Postgres unique_violation = 23505
    if ((error as any).code !== '23505') break
  }
  if (lastErr) {
    console.error('[mco/handoff] insert failed:', lastErr)
    return NextResponse.json({ error: 'handoff_failed' }, { status: 500, headers: cors })
  }

  // Build the absolute URL using the request's host so it works in dev + prod.
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const host = req.headers.get('host') || 'sentimetrx.ai'
  const url = `${proto}://${host}/m/${code}`

  return NextResponse.json({ code, url, expires_in_seconds: 15 * 60 }, { headers: cors })
}
