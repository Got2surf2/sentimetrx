// lib/recordings/presentation.ts
//
// Presentation-phase summary pass. One Sonnet call over the presentation-phase
// transcript slice + the slide outline (ground truth), producing a neutral
// "Meeting Overview" (docs/RECORDINGS.md). Non-fatal: returns null on failure
// or when there's no presentation content, and the pipeline still completes.

import 'server-only'
import { callAI } from '@/lib/ai'
import { buildPresentationSummaryPrompt } from '@/lib/recordings/prompts/presentation'
import type {
  ProceedingsSummary,
  ProceedingsAgendaItem,
  PresentationOutline,
  QaSetupInputs,
  TranscriptSegment,
} from '@/lib/recordings/types'

const SONNET_MODEL = 'claude-sonnet-4-6'

export interface SummarizePresentationInput {
  recording_id: string
  org_id: string
  setup: QaSetupInputs
  transcript: TranscriptSegment[]      // the presentation-phase slice
  outline?: PresentationOutline | null
}

export interface SummarizePresentationResult {
  summary: ProceedingsSummary | null
  cents: number
}

export async function summarizePresentation(input: SummarizePresentationInput): Promise<SummarizePresentationResult> {
  if (!input.transcript || input.transcript.length === 0) return { summary: null, cents: 0 }

  let resp
  try {
    const { system, userPrompt } = buildPresentationSummaryPrompt({ setup: input.setup, transcript: input.transcript, outline: input.outline })
    resp = await callAI({
      tier: 'advanced',
      modelOverride: SONNET_MODEL,
      maxTokens: 4000,
      timeoutMs: 300000,
      system: [{ type: 'text', text: system, cache: true }],
      messages: [{ role: 'user', content: userPrompt }],
      usage: { org_id: input.org_id, resource_type: 'recording', resource_id: input.recording_id, event_type: 'recording_presentation_summary' },
    })
  } catch (e) {
    console.error({ at: 'recordings.presentation', msg: 'summary call failed', err: (e as Error)?.message })
    return { summary: null, cents: 0 }
  }

  const obj = parseJsonObject(resp.text)
  if (!obj) {
    console.error({ at: 'recordings.presentation', msg: 'summary JSON unparseable' })
    return { summary: null, cents: 25 }
  }

  const items: ProceedingsAgendaItem[] = []
  for (const it of (Array.isArray(obj.items) ? obj.items : [])) {
    const o = (it ?? {}) as Record<string, unknown>
    const title = String(o.title ?? '').trim()
    const what = String(o.what_was_presented ?? '').trim()
    if (!title && !what) continue
    items.push({
      title: title || 'Agenda item',
      presenter: o.presenter ? String(o.presenter).trim() : null,
      what_was_presented: what,
      key_figures: Array.isArray(o.key_figures)
        ? (o.key_figures as unknown[])
            .map((f) => f as Record<string, unknown>)
            .filter((f) => f && f.label && f.value)
            .map((f) => ({ label: String(f.label).trim(), value: String(f.value).trim() }))
        : [],
      slide_refs: Array.isArray(o.slide_refs)
        ? (o.slide_refs as unknown[]).map((n) => Number(n)).filter((n) => Number.isInteger(n))
        : [],
    })
  }

  const overview = String(obj.overview ?? '').trim()
  if (!overview && items.length === 0) return { summary: null, cents: 25 }

  return {
    summary: { overview, items, generated_at: new Date().toISOString(), model: SONNET_MODEL },
    cents: 25,
  }
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  let t = text.trim()
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b < a) return null
  try { return JSON.parse(t.slice(a, b + 1)) } catch { return null }
}
