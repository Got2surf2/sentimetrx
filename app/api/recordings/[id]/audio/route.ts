// app/api/recordings/[id]/audio/route.ts
//
// GET /api/recordings/[id]/audio — mint a short-TTL signed URL for the stitched
// meeting audio (§ 5.4). The report's modal player fetches this on open. The
// TUS-uploaded source files are never served directly; only the canonical
// stitched mp3 at <org_id>/<recording_id>/audio/stitched.mp3 is exposed.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getUserContext } from '@/lib/userContext'

export const dynamic = 'force-dynamic'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'
const SIGNED_URL_TTL_SEC = 3600   // 1h — comfortably covers a listening session

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const recording_id = (await ctx.params).id
  if (!recording_id) return NextResponse.json({ error: 'missing recording id' }, { status: 400 })

  const supabase = await createClient()
  const uc = await getUserContext(supabase)
  if (!uc) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  // Load the recording org-scoped — but platform admins (admin org) can reach any
  // org's recording, matching the status/report routes. A non-admin still pairs
  // (id, org_id) so a bare id can't cross tenants.
  let recQ = service.from('recordings').select('id, org_id').eq('id', recording_id)
  if (!uc.isAdminOrg) recQ = recQ.eq('org_id', uc.orgId)
  const { data: rec, error: rErr } = await recQ.single()
  if (rErr || !rec) return NextResponse.json({ error: 'not found' }, { status: 404 })

  // Build the storage path from the RECORDING's org, not the caller's — otherwise
  // an admin viewing another org's recording signs a path that doesn't exist.
  const path = `${rec.org_id as string}/${recording_id}/audio/stitched.mp3`
  const { data: signed, error: sErr } = await service.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SEC)
  if (sErr || !signed?.signedUrl) {
    return NextResponse.json({ error: 'audio not available' }, { status: 404 })
  }

  return NextResponse.json({ url: signed.signedUrl, expires_in: SIGNED_URL_TTL_SEC })
}
