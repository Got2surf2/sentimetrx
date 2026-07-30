// app/api/th/[token]/audio/route.ts
//
// GET /api/th/[token]/audio — the PUBLIC twin of /api/recordings/[id]/audio.
// Mints a short-TTL signed URL for the stitched meeting audio, authorised by a
// share token instead of a session, so the public report (/th/[token]) can make
// its timestamps click-to-play.
//
// This is the only route that hands meeting audio to an unauthenticated caller,
// so it fails closed on FIVE independent conditions and never takes a recording
// id from the caller — only the opaque token:
//   1. token present,
//   2. a recording actually carries that share_token,
//   3. share_enabled,
//   4. not past share_expires_at,
//   5. status='complete',
//   6. share_audio — the separate per-meeting opt-in (sql/185). Publishing the
//      written report must never imply publishing residents' voices, so an
//      enabled share link with share_audio=false still 404s here.
//
// Like the authed twin, the TUS-uploaded source files are never served; only the
// canonical stitched mp3 is exposed. 404 (never 403) on every failure so the
// route can't be used to probe which tokens or meetings exist.

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'
// Shorter than the authed route's hour: a public link is forwardable, so a
// leaked signed URL should die quickly. Long enough to listen to a meeting.
const SIGNED_URL_TTL_SEC = 1800

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  if (!token) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const service = createServiceRoleClient()
  const { data: rec } = await service
    .from('recordings')
    .select('id, org_id, status, share_enabled, share_expires_at, share_audio')
    .eq('share_token', token)
    .maybeSingle()

  if (!rec || !rec.share_enabled || rec.status !== 'complete') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (rec.share_expires_at && new Date(rec.share_expires_at as string).getTime() < Date.now()) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }
  if (!rec.share_audio) {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const path = `${rec.org_id}/${rec.id}/audio/stitched.mp3`
  const { data: signed, error } = await service.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_TTL_SEC)
  if (error || !signed?.signedUrl) {
    return NextResponse.json({ error: 'audio unavailable' }, { status: 404 })
  }

  return NextResponse.json({ url: signed.signedUrl })
}
