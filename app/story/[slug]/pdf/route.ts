// app/story/[slug]/pdf/route.ts
// GET — high-quality PDF of a Data Story (owner 2026-09-03). Same capability
// model as the HTML viewer: the slug IS the credential, revoked/expired links
// answer 410, no cookies. The stored HTML is transformed into a print
// document before rendering — the interactive machinery (what-if modeler,
// verbatim explorer, sticky nav) is stripped by owner decision; sections and
// the data table are forced open so nothing a reader collapsed goes missing.
// Rendered through the shared headless-chromium pipeline (lib/htmlToPdf) with
// the Datanautix chrome; this route MUST stay listed in next.config
// outputFileTracingIncludes (chromium bin) or prod 500s.

import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { brandedPdfChrome, htmlToPdfBuffer } from '@/lib/htmlToPdf'
import { storyPdfHtml } from '@/lib/dataStory'

const BUCKET = 'report-exports'

export const maxDuration = 120

function gone(msg: string, status = 410) {
  return new NextResponse(msg, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}

export async function GET(_req: Request, props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params
  if (!slug || !/^[A-Za-z0-9]{8,32}$/.test(slug)) return gone('Not found.', 404)

  const service = createServiceRoleClient()
  const { data: story } = await service
    .from('data_stories')
    .select('title, storage_path, expires_at, revoked_at')
    .eq('slug', slug)
    .maybeSingle()
  if (!story) return gone('Not found.', 404)
  if (story.revoked_at) return gone('This link has been revoked by the publisher.')
  if (new Date(story.expires_at).getTime() < Date.now()) return gone('This link has expired.')

  const { data: file, error } = await service.storage.from(BUCKET).download(story.storage_path)
  if (error || !file) return gone('This story is no longer available.', 404)

  const html = storyPdfHtml(await file.text())
  const chrome = brandedPdfChrome({ brand: 'datanautix' })
  const pdf = await htmlToPdfBuffer(html, {
    format: 'letter',
    headerTemplate: chrome.headerTemplate,
    footerTemplate: chrome.footerTemplate,
    margin: chrome.margin,
  })

  const name = String(story.title || 'data-story').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'data-story'
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${name}.pdf"`,
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  })
}
