// lib/botKnowledge/documentVision.ts
// P2c vision fallback — when text extraction finds a PDF is scanned/image-only
// (documentText.extractDocumentText → sparse), read it with Claude vision. This
// is exactly the reuse readDocument.ts documents: renderDoc (PDF→PNG in a
// Vercel Sandbox) + visionReadPages. The source PDF is parked in the recordings
// bucket under a bot-scoped temp prefix, rendered, read, then cleaned up.
//
// Best-effort: any failure returns null and the caller keeps whatever text the
// text-first pass produced (or surfaces the scanned-PDF message).

import 'server-only'
import { randomUUID } from 'node:crypto'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { renderPdfToPng } from '@/lib/vision/renderDoc'
import { visionReadPages } from '@/lib/vision/readDocument'
import type { AIUsageContext } from '@/lib/ai'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'

const KB_VISION_SYSTEM = `You transcribe pages of a document into plain text for a knowledge base.
For each page image, return the full readable text: headings, body copy, bullet
lists, table contents, and any figure/caption text. Preserve reading order.
Do NOT summarize, interpret, or add commentary — transcribe only what is on the page.
Return a single JSON object {"pages":[{"heading": string, "text": string}, ...]}
with exactly one entry per page above, in order. Use "" for a missing heading.`

export interface DocumentVisionInput {
  buffer: Buffer
  botId: string
  orgId: string
  filename: string
}

/**
 * Returns markdown-ish text (one `## heading` section per page) or null if the
 * vision path is unavailable/failed. Only call for scanned PDFs.
 */
export async function extractPdfViaVision(input: DocumentVisionInput): Promise<{ text: string; pageCount: number } | null> {
  const service = createServiceRoleClient()
  const stem = `bot-kb-tmp/${input.botId}/${randomUUID()}`
  const pdfPath = `${stem}.pdf`
  try {
    const up = await service.storage.from(BUCKET).upload(pdfPath, input.buffer, { contentType: 'application/pdf', upsert: true })
    if (up.error) {
      console.error({ at: 'botKnowledge.vision', msg: 'temp pdf upload failed', err: up.error.message })
      return null
    }

    const rendered = await renderPdfToPng({ pdf_storage_path: pdfPath, out_prefix: stem })
    if (rendered.page_count === 0) return null

    const pages = await visionReadPages({
      imageUrls: rendered.page_urls,
      system: KB_VISION_SYSTEM,
      batchSize: 6,
      usage: { org_id: input.orgId, resource_type: 'bot', resource_id: input.botId, event_type: 'knowledge_doc_vision' } as AIUsageContext,
    })

    const body = pages
      .map((p, i) => {
        const heading = p.heading ? String(p.heading).trim() : ''
        const text = p.text ? String(p.text).trim() : ''
        return '## ' + (heading || 'Page ' + (i + 1)) + '\n\n' + text
      })
      .join('\n\n')
      .trim()

    if (body.length < 10) return null
    return { text: body, pageCount: rendered.page_count }
  } catch (e) {
    console.error({ at: 'botKnowledge.vision', msg: 'vision extraction failed', err: (e as Error)?.message })
    return null
  } finally {
    // Clean up temp artifacts (source PDF + rendered PNGs live under `stem`).
    try {
      const { data: leftovers } = await service.storage.from(BUCKET).list(stem)
      const paths = [pdfPath, ...(leftovers || []).map((f) => `${stem}/${f.name}`)]
      await service.storage.from(BUCKET).remove(paths)
    } catch { /* best-effort cleanup */ }
  }
}
