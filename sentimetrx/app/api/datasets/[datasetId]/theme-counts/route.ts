// app/api/datasets/[datasetId]/theme-counts/route.ts
// Server-side theme counting — streams through dataset rows and counts keyword matches
// per theme WITHOUT sending all rows to the browser.
// Accepts themes + field names, returns counts and percentages per theme.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { expandLemma } from '@/lib/lemmas'

interface Props { params: { datasetId: string } }

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Build lemma-aware regex for a keyword (same logic as themeUtils but server-side)
function buildKwRegex(kw: string): RegExp {
  const forms = expandLemma(kw)
  const seen: Record<string, boolean> = {}
  const alts: string[] = []
  for (let i = 0; i < forms.length; i++) {
    const alt = forms[i].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*'
    if (!seen[alt]) { seen[alt] = true; alts.push(alt) }
  }
  const escOrig = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\w*'
  if (!seen[escOrig]) alts.push(escOrig)
  return new RegExp('(?<![a-z])(?:' + alts.join('|') + ')', 'i')
}

export async function POST(req: Request, { params }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: {
    themes: { id: string; keywords: string[] }[]
    fields: string[]  // field keys to match against
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { themes, fields } = body
  if (!themes?.length || !fields?.length) {
    return NextResponse.json({ error: 'Provide themes and fields' }, { status: 400 })
  }

  // Pre-compile keyword regexes for each theme
  const themeRegexes: { id: string; regexes: RegExp[] }[] = themes.map(t => ({
    id: t.id,
    regexes: (t.keywords || []).filter(Boolean).map(buildKwRegex),
  }))

  const service = createServiceRoleClient()

  // Stream through dataset rows in batches
  const BATCH_SIZE = 100
  let page = 0
  let hasMore = true
  let totalNonEmpty = 0
  const counts: Record<string, number> = {}
  for (const t of themes) counts[t.id] = 0

  // Build normalized field key lookup from first batch
  let fieldKeys: string[] = fields
  let keyMapBuilt = false

  while (hasMore) {
    const { data: batches } = await service
      .from('dataset_rows')
      .select('rows')
      .eq('dataset_id', params.datasetId)
      .order('batch_index', { ascending: true })
      .range(page * BATCH_SIZE, (page + 1) * BATCH_SIZE - 1)

    if (!batches || batches.length === 0) { hasMore = false; break }

    for (const batch of batches) {
      const batchRows = (batch as any).rows || []
      if (!keyMapBuilt && batchRows.length > 0) {
        // Resolve field names against actual row keys (case-insensitive)
        const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
        const rowKeys = Object.keys(batchRows[0])
        const keyMap: Record<string, string> = {}
        for (const k of rowKeys) keyMap[normalize(k)] = k
        fieldKeys = fields.map(f => keyMap[normalize(f)] || f)
        keyMapBuilt = true
      }

      for (const row of batchRows) {
        const text = fieldKeys.map(k => String(row[k] || '')).join(' ').toLowerCase().trim()
        if (!text) continue
        totalNonEmpty++

        for (const t of themeRegexes) {
          if (t.regexes.length > 0 && t.regexes.some(re => re.test(text))) {
            counts[t.id]++
          }
        }
      }
    }

    if (batches.length < BATCH_SIZE) hasMore = false
    page++
  }

  // Build response with counts and percentages
  const result = themes.map(t => ({
    id: t.id,
    count: counts[t.id],
    percentage: totalNonEmpty > 0 ? Math.round(counts[t.id] / totalNonEmpty * 100) : 0,
  }))

  return NextResponse.json({ counts: result, totalNonEmpty })
}
