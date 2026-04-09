// app/api/datasets/[datasetId]/export/html/share/route.ts
// POST — accepts a pre-generated HTML file, uploads to S3,
// returns a pre-signed GET URL valid for 7 days.
//
// Required env vars:
//   AWS_ACCESS_KEY_ID
//   AWS_SECRET_ACCESS_KEY
//   AWS_REGION          (e.g. "us-east-1")
//   AWS_S3_BUCKET       (your bucket name)

import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'crypto'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

const EXPIRY_SECONDS = 7 * 24 * 60 * 60  // 7 days

export async function POST(req: Request, { params }: Params) {
  // Auth check
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Validate env vars
  const bucket = process.env.AWS_S3_BUCKET
  const region = process.env.AWS_REGION
  if (!bucket || !region) {
    return NextResponse.json(
      { error: 'AWS_S3_BUCKET and AWS_REGION must be configured in environment variables.' },
      { status: 500 }
    )
  }

  // Read HTML body (sent as text/html)
  let htmlContent: Buffer
  try {
    const arrayBuffer = await req.arrayBuffer()
    if (arrayBuffer.byteLength === 0) {
      return NextResponse.json({ error: 'Empty body — no HTML to upload.' }, { status: 400 })
    }
    htmlContent = Buffer.from(arrayBuffer)
  } catch {
    return NextResponse.json({ error: 'Could not read request body.' }, { status: 400 })
  }

  // Build S3 key: reports/<datasetId>/<uuid>.html
  const key = `reports/${params.datasetId}/${randomUUID()}.html`

  const s3 = new S3Client({
    region,
    credentials: {
      accessKeyId:     process.env.AWS_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    },
  })

  // Upload
  try {
    await s3.send(new PutObjectCommand({
      Bucket:      bucket,
      Key:         key,
      Body:        htmlContent,
      ContentType: 'text/html; charset=utf-8',
    }))
  } catch (e: any) {
    console.error('[share] S3 upload error:', e)
    return NextResponse.json(
      { error: 'Upload failed: ' + (e.message || 'S3 error') },
      { status: 502 }
    )
  }

  // Generate pre-signed GET URL (7 days)
  let url: string
  try {
    url = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key }),
      { expiresIn: EXPIRY_SECONDS }
    )
  } catch (e: any) {
    console.error('[share] presign error:', e)
    return NextResponse.json(
      { error: 'Could not generate share link: ' + (e.message || 'presign error') },
      { status: 502 }
    )
  }

  const expiresAt = new Date(Date.now() + EXPIRY_SECONDS * 1000).toISOString()
  return NextResponse.json({ url, expiresAt, key })
}
