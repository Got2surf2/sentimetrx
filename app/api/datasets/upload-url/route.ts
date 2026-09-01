// app/api/datasets/upload-url/route.ts
// POST — mint a signed Storage upload URL for a dataset file (2026-09-02
// server-side ingest pipeline). The browser PUTs the RAW file straight to
// Storage (one streamed transfer, no Vercel middleman, no row batching), then
// kicks /api/datasets/[id]/ingest which parses and loads it server-side.
//
// The object path is minted HERE under the caller's org prefix — the client
// never chooses it — and the ingest route refuses paths outside the caller's
// org, so one org can't ingest another org's uploaded file.

import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { serverError } from '@/lib/apiError'
import { UPLOAD_BUCKET } from '@/lib/datasetIngest'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const supabase = await createClient()
  const { userId, orgId } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const rawName = typeof body.filename === 'string' ? body.filename : 'upload'
  const safeName = rawName.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80) || 'upload'
  const path = `${orgId}/${randomUUID()}-${safeName}`

  const service = createServiceRoleClient()
  let { data, error } = await service.storage.from(UPLOAD_BUCKET).createSignedUploadUrl(path)
  if (error) {
    // First upload ever: the bucket doesn't exist yet ("The related resource
    // does not exist"). Create it lazily and retry once — createBucket on an
    // existing bucket errors harmlessly into the catch.
    await service.storage.createBucket(UPLOAD_BUCKET, { public: false }).catch(() => {})
    ;({ data, error } = await service.storage.from(UPLOAD_BUCKET).createSignedUploadUrl(path))
  }
  if (error || !data) return serverError(error || new Error('no signed url'), 'datasets.uploadUrl', { orgId })

  return NextResponse.json({ path, signedUrl: data.signedUrl, token: data.token })
}
