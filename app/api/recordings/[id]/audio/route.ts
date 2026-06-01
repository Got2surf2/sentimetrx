// app/api/recordings/[id]/audio/route.ts
//
// GET /api/recordings/[id]/audio — mint a short-TTL signed URL for the stitched
// meeting audio (§ 5.4). The report's modal player fetches this on open. The
// TUS-uploaded source files are never served directly; only the canonical
// stitched mp3 at <org_id>/<recording_id>/audio/stitched.mp3 is exposed.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'
const SIGNED_URL_TTL_SEC = 3600   // 1h — comfortably covers a listening session

export async function GET(_req: Request, ctx: { params: { id: string } }) {
  const recording_id = ctx.params.id
  if (!recording_id) return NextResponse.json({ error: 'missing recording id' }, { status: 400 })

  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const { data: userRow } = await supabase
    .from('users')
    .select('org_id')
    .eq('id', user.id)
    .single()
  const org_id = userRow?.org_id as string | undefined
  if (!org_id) return NextResponse.json({ error: 'org not found' }, { status: 403 })

  const service = createServiceRoleClient()

  // Pair (id, org_id) — bare id lookup with service role is a cross-tenant leak.
  const { data: rec, error: rErr } = await service
    .from('recordings')
    .select('id, org_id')
    .eq('id', recording_id)
    .eq('org_id', org_id)
    .single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const path = `${org_id}/${recording_id}/audio/stitched.mp3`
  const { data: signed, error: sErr } = await service.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SEC)
  if (sErr || !signed?.signedUrl) {
    return NextResponse.json({ error: 'audio not available' }, { status: 404 })
  }

  return NextResponse.json({ url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SEC })
}
