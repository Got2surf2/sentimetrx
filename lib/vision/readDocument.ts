// lib/vision/readDocument.ts
//
// Generic "read pages of a document with Claude vision" primitive. Given page
// image URLs + a system prompt describing the per-page JSON schema, returns one
// parsed object per page, in order. Batches pages per call to keep output
// bounded. Shared — recordings slide ingestion is the first caller; bot-KB
// document ingestion can reuse it (with text-extract-first, vision-fallback).

import 'server-only'
import { callAI, type AIUsageContext, type TextContentBlock, type ImageContentBlock } from '@/lib/ai'

const SONNET_MODEL = 'claude-sonnet-4-6'

export interface VisionReadInput {
  imageUrls: string[]                 // signed PNG urls, page order
  system: string                      // describes the per-page JSON schema; must ask for {"pages":[...]}
  batchSize?: number                  // pages per model call (default 8)
  maxTokensPerBatch?: number          // default 4000
  model?: string
  usage?: AIUsageContext
}

/**
 * Returns one object per input page (best-effort aligned by order). Pages the
 * model failed to return are filled with `{}` so the array length always matches
 * imageUrls — callers index by position.
 */
export async function visionReadPages(input: VisionReadInput): Promise<Record<string, unknown>[]> {
  const batchSize = input.batchSize ?? 8
  const out: Record<string, unknown>[] = []

  for (let i = 0; i < input.imageUrls.length; i += batchSize) {
    const batch = input.imageUrls.slice(i, i + batchSize)
    const content: Array<TextContentBlock | ImageContentBlock> = []
    batch.forEach((url, j) => {
      content.push({ type: 'text', text: `--- PAGE ${i + j + 1} ---` })
      content.push({ type: 'image', source: { type: 'url', url } })
    })
    content.push({ type: 'text', text: `Return a single JSON object {"pages":[...]} with exactly ${batch.length} entries, one per page above, in order.` })

    let pages: Record<string, unknown>[] = []
    try {
      const resp = await callAI({
        tier: 'advanced',
        modelOverride: input.model ?? SONNET_MODEL,
        maxTokens: input.maxTokensPerBatch ?? 4000,
        timeoutMs: 180000,
        system: [{ type: 'text', text: input.system, cache: true }],
        messages: [{ role: 'user', content }],
        usage: input.usage,
      })
      const obj = parseJsonObject(resp.text)
      pages = Array.isArray(obj?.pages) ? (obj!.pages as Record<string, unknown>[]) : []
    } catch (e) {
      console.error({ at: 'vision.readPages', msg: 'batch failed', batchStart: i, err: (e as Error)?.message })
    }
    // Align to batch length: pad/truncate so positions stay correct.
    for (let k = 0; k < batch.length; k++) out.push(pages[k] && typeof pages[k] === 'object' ? pages[k] : {})
  }
  return out
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  let t = text.trim()
  if (t.startsWith('```')) t = t.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const a = t.indexOf('{'), b = t.lastIndexOf('}')
  if (a < 0 || b < a) return null
  try { return JSON.parse(t.slice(a, b + 1)) } catch { return null }
}
