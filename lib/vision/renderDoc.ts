// lib/vision/renderDoc.ts
//
// Render a PDF stored in Supabase Storage to one PNG per page, in a Vercel
// Sandbox (poppler/pdftoppm). Shared primitive — recordings slide ingestion is
// the first caller; bot-KB document ingestion can reuse it later.
//
// Mirrors lib/recordings/extract.ts: signed-URL in, signed-URL out, so large
// files never pass through the worker's memory. Returns short-TTL signed READ
// URLs for the page PNGs (Anthropic vision fetches them directly).
//
// The Sandbox base image (Amazon Linux) has poppler-utils in its default dnf
// repos (unlike ffmpeg), so a plain `dnf install -y poppler-utils` works — but
// we still verify pdftoppm landed and fail loudly if not.

import 'server-only'
import { Sandbox } from '@vercel/sandbox'
import { createServiceRoleClient } from '@/lib/supabase/server'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'
const READ_URL_TTL_SEC = 60 * 60
const SANDBOX_TIMEOUT_MS = 15 * 60 * 1000          // 15min ceiling for a slide render
const SANDBOX_RUNTIME = 'node24' as const
const RENDER_DPI = 110                               // ~1300px wide page → ~1.6K vision tokens
const MAX_PAGES = 60                                 // safety cap

const INSTALL_POPPLER = `
set -e
command -v pdftoppm >/dev/null 2>&1 || sudo dnf install -y poppler-utils
pdftoppm -v >/dev/null 2>&1
`.trim()

export interface RenderPdfInput {
  pdf_storage_path: string                           // bucket-relative path of the source PDF
  out_prefix: string                                 // bucket-relative dir, e.g. <org>/<rec>/slides
}

export interface RenderedDoc {
  page_paths: string[]                               // bucket-relative PNG paths, page order
  page_urls: string[]                                // signed READ urls (TTL ~1h)
  page_count: number
}

export async function renderPdfToPng(input: RenderPdfInput): Promise<RenderedDoc> {
  const service = createServiceRoleClient()
  const downloadUrl = await freshReadUrl(service, input.pdf_storage_path)

  const sandbox = await bootSandbox()
  try {
    await runOrThrow(sandbox, ['sh', '-c', `curl -fsSL '${shellQuote(downloadUrl)}' -o /tmp/doc.pdf`], 'download pdf')
    // pdftoppm zero-pads page numbers; -png + a fixed prefix gives page-01.png, …
    await runOrThrow(sandbox, ['sh', '-c', `pdftoppm -png -r ${RENDER_DPI} /tmp/doc.pdf /tmp/page`], 'pdftoppm render')
    const { stdout } = await runOrThrow(sandbox, ['sh', '-c', `ls /tmp/page-*.png | sort`], 'list pages')
    const localPages = stdout.split('\n').map(s => s.trim()).filter(Boolean).slice(0, MAX_PAGES)
    if (localPages.length === 0) throw new Error('pdftoppm produced no pages')

    const page_paths: string[] = []
    const page_urls: string[] = []
    for (let i = 0; i < localPages.length; i++) {
      const local = localPages[i]
      const path = `${input.out_prefix}/page-${String(i + 1).padStart(3, '0')}.png`
      const uploadUrl = await freshUploadUrl(service, path)
      await runOrThrow(sandbox, ['sh', '-c',
        `curl -fsS -X PUT -H 'Content-Type: image/png' -H 'x-upsert: true' --data-binary @${local} '${shellQuote(uploadUrl)}'`,
      ], `upload page ${i + 1}`)
      page_paths.push(path)
      page_urls.push(await freshReadUrl(service, path))
    }
    return { page_paths, page_urls, page_count: page_paths.length }
  } finally {
    await sandbox.stop().catch(() => undefined)
  }
}

// ── helpers (mirror extract.ts) ──────────────────────────────────────────────

async function bootSandbox(): Promise<InstanceType<typeof Sandbox>> {
  const sandbox = await Sandbox.create({ runtime: SANDBOX_RUNTIME, timeout: SANDBOX_TIMEOUT_MS })
  await runOrThrow(sandbox, ['sh', '-c', INSTALL_POPPLER], 'install poppler')
  return sandbox
}

async function runOrThrow(sandbox: InstanceType<typeof Sandbox>, argv: string[], label: string): Promise<{ stdout: string; stderr: string }> {
  const [cmd, ...args] = argv
  const result = await sandbox.runCommand(cmd, args)
  const stdout = await result.stdout()
  const stderr = await (result.stderr?.() ?? Promise.resolve(''))
  const exitCode = (result as { exitCode?: number }).exitCode ?? 0
  if (exitCode !== 0) throw new Error(`${label} failed (exit ${exitCode}): ${stderr.slice(-500) || stdout.slice(-500)}`)
  return { stdout, stderr }
}

async function freshReadUrl(service: ReturnType<typeof createServiceRoleClient>, path: string): Promise<string> {
  const { data, error } = await service.storage.from(BUCKET).createSignedUrl(path, READ_URL_TTL_SEC)
  if (error || !data?.signedUrl) throw new Error(`signed read url for ${BUCKET}/${path} failed: ${error?.message ?? 'no url'}`)
  return data.signedUrl
}

async function freshUploadUrl(service: ReturnType<typeof createServiceRoleClient>, path: string): Promise<string> {
  await service.storage.from(BUCKET).remove([path]).catch(() => undefined)
  const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path)
  if (error || !data?.signedUrl) throw new Error(`signed upload url for ${BUCKET}/${path} failed: ${error?.message ?? 'no url'}`)
  return data.signedUrl
}

function shellQuote(s: string): string { return s.replace(/'/g, `'\\''`) }
