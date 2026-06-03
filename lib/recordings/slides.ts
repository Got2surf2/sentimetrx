// lib/recordings/slides.ts
//
// Ingest the presenter's uploaded slide deck (file_role='slides', PDF in v1):
// render to page images (Vercel Sandbox / poppler), read each page with Claude
// vision, and assemble a PresentationOutline. The outline is the ground-truth
// seed for the presentation summary (exact figures/names/dates).
//
// Non-fatal: any failure returns null and the pipeline continues (the
// presentation summary then runs from the transcript alone).

import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { renderPdfToPng } from '@/lib/vision/renderDoc'
import { visionReadPages } from '@/lib/vision/readDocument'
import { buildSlideVisionSystem } from '@/lib/recordings/prompts/presentation'
import type { PresentationOutline, SlideOutline } from '@/lib/recordings/types'

const SONNET_MODEL = 'claude-sonnet-4-6'

export interface IngestSlidesInput {
  recording_id: string
  org_id: string
}

export async function ingestSlides(input: IngestSlidesInput): Promise<PresentationOutline | null> {
  const service = createServiceRoleClient()

  const { data: slideFile } = await service
    .from('recording_files')
    .select('id, original_filename, storage_path, mime_type')
    .eq('recording_id', input.recording_id)
    .eq('org_id', input.org_id)
    .eq('file_role', 'slides')
    .maybeSingle()
  if (!slideFile) return null

  // v1 supports PDF only.
  if (!String(slideFile.mime_type || '').includes('pdf') && !String(slideFile.original_filename || '').toLowerCase().endsWith('.pdf')) {
    console.error({ at: 'recordings.slides', msg: 'slides not a PDF — skipping (v1 PDF-only)', file: slideFile.original_filename })
    return null
  }

  try {
    const rendered = await renderPdfToPng({
      pdf_storage_path: slideFile.storage_path as string,
      out_prefix: `${input.org_id}/${input.recording_id}/slides`,
    })
    if (rendered.page_count === 0) return null

    const pages = await visionReadPages({
      imageUrls: rendered.page_urls,
      system: buildSlideVisionSystem(),
      batchSize: 6,
      usage: { org_id: input.org_id, resource_type: 'recording', resource_id: input.recording_id, event_type: 'recording_slide_vision' },
    })

    const slides: SlideOutline[] = pages.map((p, i) => ({
      slide_number: i + 1,
      title: p.title ? String(p.title).trim() : null,
      key_points: Array.isArray(p.key_points) ? p.key_points.map((x) => String(x).trim()).filter(Boolean) : [],
      figures: Array.isArray(p.figures)
        ? (p.figures as unknown[])
            .map((f) => f as Record<string, unknown>)
            .filter((f) => f && f.label && f.value)
            .map((f) => ({ label: String(f.label).trim(), value: String(f.value).trim() }))
        : [],
      presenter: p.presenter ? String(p.presenter).trim() : null,
      notes: p.notes ? String(p.notes).trim() : null,
    }))

    return {
      slides,
      source_filename: slideFile.original_filename as string,
      page_count: rendered.page_count,
      generated_at: new Date().toISOString(),
      model: SONNET_MODEL,
    }
  } catch (e) {
    console.error({ at: 'recordings.slides', msg: 'slide ingestion failed', err: (e as Error)?.message })
    return null
  }
}
