// app/api/datasets/[datasetId]/export/html/share/route.ts
// POST — accepts a pre-generated HTML file, uploads to Supabase Storage,
// returns a signed GET URL valid for 7 days.
//
// Was previously backed by AWS S3 (AWS_S3_BUCKET / AWS_REGION /
// AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY) — switched to Supabase
// Storage so there's no extra service to configure. The signed-URL model
// is the same: link itself is the capability, short TTL, unguessable
// path.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

const BUCKET = 'report-exports'
const EXPIRY_SECONDS = 7 * 24 * 60 * 60  // 7 days

export async function POST(req: Request, { params }: Params) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cross-org gate: caller must own the dataset (or be a platform admin).
  // Same Phase E pattern as the rest of the dataset routes.
  const { orgId, isAdmin } = await getCallerOrgContext(supabase)
  const service = createServiceRoleClient()
  const { data: dataset } = await service
    .from('datasets').select('org_id').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  if (!isAdmin && dataset.org_id !== orgId) {
    return NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 })
  }

  // Read HTML body (sent as text/html).
  let htmlBuffer: Buffer
  try {
    const arrayBuffer = await req.arrayBuffer()
    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'Empty body — no HTML to upload.' }, { status: 400 })
    }
    htmlBuffer = Buffer.from(arrayBuffer)
  } catch {
    return NextResponse.json({ error: 'Could not read request body.' }, { status: 400 })
  }

  // Path: reports/<datasetId>/<uuid>.html — unguessable, scoped per dataset.
  const path = `reports/${params.datasetId}/${randomUUID()}.html`

  const { error: uploadErr } = await service.storage.from(BUCKET).upload(path, htmlBuffer, {
    contentType: 'text/html; charset=utf-8',
    upsert:      false,
  })
  if (uploadErr) {
    console.error('[share] upload error:', uploadErr)
    return NextResponse.json({ error: 'Upload failed: ' + uploadErr.message }, { status: 502 })
  }

  const { data: signed, error: signErr } = await service.storage.from(BUCKET)
    .createSignedUrl(path, EXPIRY_SECONDS)
  if (signErr || !signed?.signedUrl) {
    console.error('[share] presign error:', signErr)
    return NextResponse.json({ error: 'Could not generate share link: ' + (signErr?.message || 'unknown') }, { status: 502 })
  }

  const expiresAt = new Date(Date.now() + EXPIRY_SECONDS * 1000).toISOString()
  return NextResponse.json({ url: signed.signedUrl, expiresAt, key: path })
}
