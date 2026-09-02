// app/api/story/[...path]/route.ts
// GET — public viewer for platform-hosted Data Story HTML (and other shared
// report HTML) living in the private `report-exports` bucket.
//
// WHY THIS EXISTS: Supabase Storage deliberately serves text/html objects as
// text/plain on the *.supabase.co domain (anti-phishing hardening), so a
// signed storage URL shows the page SOURCE instead of rendering it. This
// route runs on OUR domain and streams the object with its real content
// type. The security model is unchanged and stays capability-based:
//   - the caller must present the storage signed-URL token (?token=...);
//     Supabase itself verifies the signature and its embedded expiry — this
//     route adds no bypass and holds no session.
//   - EXPIRY: the token stops working at its `exp` (share route default: 7d).
//   - REVOCATION: deleting the storage object kills every link instantly.
// No cookies, no org context, nothing guessable beyond the token — same
// trust boundary as the signed URL, minus the wrong content type.

import { NextResponse } from 'next/server'

const BUCKET = 'report-exports'

export async function GET(req: Request, props: { params: Promise<{ path: string[] }> }) {
  const { path } = await props.params
  const url = new URL(req.url)
  const token = url.searchParams.get('token') || ''

  // Only report objects, only sane path segments, token required.
  const objectPath = (path || []).join('/')
  if (!token || !objectPath.startsWith('reports/') || objectPath.includes('..')) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const base = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!base) return NextResponse.json({ error: 'Not configured' }, { status: 500 })

  // Let storage verify the capability: signature, path binding, expiry.
  const upstream = await fetch(
    `${base}/storage/v1/object/sign/${BUCKET}/${objectPath}?token=${encodeURIComponent(token)}`,
    { cache: 'no-store' },
  )
  if (!upstream.ok || !upstream.body) {
    // Expired token and deleted object both land here — the link is dead.
    return new NextResponse('This link has expired or been removed.', {
      status: upstream.status === 400 ? 410 : 404,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  return new NextResponse(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      // The story is self-contained; keep it from being framed elsewhere.
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'",
    },
  })
}
