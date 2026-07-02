// lib/recordings/setupExtract.ts
//
// Setup-before-media: read an uploaded project document (the deck that will be
// presented) and PROPOSE the setup fields — objectives, agenda, panel, glossary
// — so the analyst confirms instead of typing from scratch. The proposal is a
// suggestion; the user reviews + edits it in the wizard.
//
// Reuses the slide-vision rails: render the PDF to page PNGs (Vercel Sandbox /
// poppler) and read them with Claude vision in one pass → one JSON proposal.
// Stateless: the caller (POST /api/recordings/extract-setup) uploads the PDF to
// a temp path, calls this, then deletes the temp objects. Nothing is persisted.

import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { renderPdfToPng } from '@/lib/vision/renderDoc'
import { callAI } from '@/lib/ai'

const BUCKET = process.env.RECORDINGS_BUCKET || 'recordings'
const SONNET_MODEL = 'claude-sonnet-4-6'
const MAX_PAGES = 25            // bound vision cost; decks past this are rare for setup

export interface SetupProposal {
  objectives: { summary: string; questions: string[] }
  agenda: string[]
  panel: Array<{ name: string; role?: string }>
  glossary: string[]
}

const SETUP_SYSTEM = `You read a slide deck for a meeting that has not happened yet and propose how to set up its analysis. You are given the deck's pages as images, in order.

Return ONLY a single JSON object with this exact shape:
{
  "objectives": { "summary": string, "questions": string[] },
  "agenda": string[],
  "panel": [ { "name": string, "role": string } ],
  "glossary": string[]
}

Rules:
- objectives.summary: 1-3 sentences describing the meeting's purpose / what this analysis should establish, grounded in the deck. "" if unclear.
- objectives.questions: specific questions the analysis should answer (the decisions/concerns the deck implies). [] if none are evident.
- agenda: the agenda topics / section headings shown in the deck, as short labels. [] if none.
- panel: presenters / speakers / officials named on title or credit slides, with their role/title. Omit role if unknown. [] if none.
- glossary: proper names, places, projects, and technical terms whose spelling matters (so the transcriber can be corrected). [] if none.
- Use ONLY what is on the slides. Do NOT invent names, figures, or topics. Prefer fewer, confident items over guesses. Empty strings/arrays are correct when the deck doesn't say.`

export async function extractSetupFromPdf(pdfStoragePath: string, outPrefix: string, orgId?: string): Promise<SetupProposal> {
  const service = createServiceRoleClient()

  const { page_paths } = await renderPdfToPng({ pdf_storage_path: pdfStoragePath, out_prefix: outPrefix })
  const capped = page_paths.slice(0, MAX_PAGES)
  if (capped.length === 0) return emptyProposal()

  const signed = await Promise.all(
    capped.map(async p => {
      const { data } = await service.storage.from(BUCKET).createSignedUrl(p, 600)
      return data?.signedUrl ?? null
    }),
  )
  const urls = signed.filter((u): u is string => !!u)
  if (urls.length === 0) return emptyProposal()

  const content: Array<{ type: 'text'; text: string } | { type: 'image'; source: { type: 'url'; url: string } }> = []
  urls.forEach((url, i) => {
    content.push({ type: 'text', text: `--- PAGE ${i + 1} ---` })
    content.push({ type: 'image', source: { type: 'url', url } })
  })
  content.push({ type: 'text', text: 'Return ONLY the JSON object described in the system prompt.' })

  const resp = await callAI({
    tier: 'advanced',
    modelOverride: SONNET_MODEL,
    maxTokens: 2000,
    timeoutMs: 180000,
    usage: { org_id: orgId, resource_type: 'recording', event_type: 'recording_setup_extract' },
    system: [{ type: 'text', text: SETUP_SYSTEM, cache: true }],
    messages: [{ role: 'user', content }],
  })

  return normalize(parseJsonObject(resp.text))
}

function emptyProposal(): SetupProposal {
  return { objectives: { summary: '', questions: [] }, agenda: [], panel: [], glossary: [] }
}

function normalize(obj: Record<string, unknown> | null): SetupProposal {
  if (!obj) return emptyProposal()
  const o = (obj.objectives ?? {}) as Record<string, unknown>
  const strArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : []
  const panel = Array.isArray(obj.panel)
    ? (obj.panel as unknown[])
        .map(p => {
          const r = (p ?? {}) as Record<string, unknown>
          const name = typeof r.name === 'string' ? r.name.trim() : ''
          const role = typeof r.role === 'string' ? r.role.trim() : ''
          return name ? { name, ...(role ? { role } : {}) } : null
        })
        .filter((p): p is { name: string; role?: string } => !!p)
    : []
  return {
    objectives: {
      summary: typeof o.summary === 'string' ? o.summary.trim() : '',
      questions: strArr(o.questions),
    },
    agenda: strArr(obj.agenda),
    panel,
    glossary: strArr(obj.glossary),
  }
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  let t = text.trim()
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b < a) return null
  try { return JSON.parse(t.slice(a, b + 1)) } catch { return null }
}
