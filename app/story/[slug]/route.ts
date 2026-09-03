// app/story/[slug]/route.ts
// GET — the public short link for a Data Story: sentimetrx.ai/story/<slug>.
//
// The slug is the capability (crypto-random base62, minted by the story
// generation route; same trust model as question_batches.share_token). The
// data_stories row carries the lifecycle the old signed-URL token could not:
// expires_at is editable after a link is sent, revoked_at kills one link from
// the UI without touching storage. Both checks happen here on every request;
// the HTML itself streams from the private report-exports bucket via the
// service role. No cookies, no org context — dead links answer 410.

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

const BUCKET = 'report-exports'

function gone(msg: string, status = 410) {
  return new NextResponse(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  if (!slug || !/^[A-Za-z0-9]{8,32}$/.test(slug)) return gone('Not found.', 404)

  const service = createServiceRoleClient()
  const { data: story } = await service
    .from('data_stories')
    .select('storage_path, expires_at, revoked_at')
    .eq('slug', slug)
    .maybeSingle()
  if (!story) return gone('Not found.', 404)
  if (story.revoked_at) return gone('This link has been revoked by the publisher.')
  if (new Date(story.expires_at).getTime() < Date.now()) return gone('This link has expired.')

  const { data: file, error } = await service.storage.from(BUCKET).download(story.storage_path)
  if (error || !file) return gone('This story is no longer available.', 404)

  // Floating "Download PDF" (owner 9/03) — injected by the viewer because the
  // stored HTML doesn't know its own slug. Hidden in print (the PDF route
  // strips it too).
  let html = await file.text()
  html = html.replace('</body>',
    `<a class="pdfdl" href="/story/${slug}/pdf" style="position:fixed;right:22px;bottom:22px;background:#1A2421;color:#FCFCFB;font:600 13px system-ui;padding:10px 16px;border-radius:999px;text-decoration:none;box-shadow:0 4px 14px rgba(26,36,33,.25)">Download PDF</a><style>@media print{.pdfdl{display:none}}</style></body>`)

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
      'X-Frame-Options': 'DENY',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src https://fonts.gstatic.com; base-uri 'none'; form-action 'none'",
    },
  })
}
