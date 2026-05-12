/* eslint-disable */
// One-off: produce a 4-slide entity-analysis PPTX for the Coalition Donor
// Survey Collection's "Charities donated to" (q3_response) field.
//
// Run with: node_modules/.bin/tsx scripts/generate-coalition-deck.ts
// Output:   ~/Downloads/Coalition-Charities-Entity-Analysis.pptx
//
// Uses the exact same renderDeck() as StoryTime so the slide chrome
// (gold accent bar, navy header, teal sidebar, page numbers) is
// pixel-identical to the user's existing StoryTime decks.

import { readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

// Load .env.local
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'
import { renderDeck, type DeckSpec, type SlideSpec } from '../lib/pptx/slideRenderer'

// Direct Anthropic fetch — avoids the server-only guard in lib/ai
async function callClaude(prompt: string): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY!
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4000,
      system: 'You are a precise data normaliser. Output valid JSON only.',
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`)
  const json = await res.json() as any
  return json.content?.[0]?.text || ''
}

const COLLECTION_ID = '7d9b148c-7fbf-4b37-838c-03c638c2bd23'
const COLLECTION_DATASET_NAME = 'Coalition Donor Survey Collection'
const FIELD = 'q3_response'
const FIELD_DISPLAY = 'Charities donated to'

// ── Clean + split logic ────────────────────────────────────────────────────

/** Strip the clarifier suffix "[+ ...]" Sentimetrx adds, URLs in parens,
 *  and conversational preambles. */
function cleanRaw(raw: string): string {
  return raw
    .replace(/\[\+[^\]]*\]/g, '')               // [+ clarifier text]
    .replace(/\(https?:\/\/[^)]+\)/g, '')        // (http://...)
    .replace(/https?:\/\/\S+/g, '')              // bare URLs
    .replace(/^(currently,?\s*(?:our family\s+)?(?:we\s+)?supports?\s+)/i, '')
    .replace(/\s+at\s+similar\s+levels.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitMentions(raw: string): string[] {
  const cleaned = cleanRaw(raw)
  if (!cleaned) return []
  // Generous splitting — commas, semicolons, " and ", " & ", newlines, slashes,
  // and ellipses (typed as "...." sequences and the unicode "…" character).
  return cleaned
    .split(/\s*(?:,|;|\n|\band\b|&|\/|\.{3,}|…+)\s*/i)
    .map(s => s.trim().replace(/^\.+|\.+$/g, '').trim())
    .filter(s => s.length >= 2 && s.length <= 120)
    .filter(s => !/^(none|n\/a|na|nothing|no|n\.a\.|several|various|many|multiple|other|others|etc)\.?$/i.test(s))
    .filter(s => !/^[\d\s.,;:'"!?-]+$/.test(s)) // not just punctuation/digits
}

// ── Canonicalise via Claude Haiku ──────────────────────────────────────────

async function canonicalise(uniqueRaw: string[]): Promise<Record<string, { canonical: string; category: string }>> {
  const result: Record<string, { canonical: string; category: string }> = {}
  const BATCH = 50  // Smaller batch — produces tighter JSON that always parses
  for (let i = 0; i < uniqueRaw.length; i += BATCH) {
    process.stdout.write(`  batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(uniqueRaw.length / BATCH)}…`)
    const batch = uniqueRaw.slice(i, i + BATCH)
    const prompt =
`You are normalising a list of charity / nonprofit organisation names from open-ended survey responses. For each input, output a JSON object mapping the raw input verbatim to a canonical name and a category. Group obvious variants of the same org together. Preserve real distinctions (SPCA vs ASPCA are different).

Categories (pick one, lower-case):
- homelessness     — shelters, food banks, transitional housing, the Coalition itself
- religious        — faith-based / church-affiliated
- health           — disease research, hospitals, medical aid
- humanitarian     — international aid, refugees, disaster relief
- education        — schools, scholarships, universities, literacy
- youth            — children, foster care, mentoring, scouting
- animal           — animal welfare, wildlife
- veterans         — military veterans + families
- environmental    — climate, conservation
- community        — civic, local community foundations, legal aid
- arts             — museums, performing arts, public broadcasting
- justice          — bail / legal / civil rights
- other            — anything that does not fit cleanly

Return ONLY a JSON object. Keys = raw inputs verbatim. Values = { "canonical": "...", "category": "..." }.

Raw inputs:
${batch.map(s => `- ${s}`).join('\n')}`
    let mapped = 0
    try {
      const text = (await callClaude(prompt)).trim()
      const jsonStart = text.indexOf('{')
      const jsonEnd = text.lastIndexOf('}')
      if (jsonStart >= 0 && jsonEnd >= 0) {
        const parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1))
        for (const [k, v] of Object.entries(parsed)) {
          const vv = v as any
          if (vv && typeof vv.canonical === 'string' && typeof vv.category === 'string') {
            result[k] = { canonical: vv.canonical.trim(), category: vv.category.toLowerCase().trim() }
            mapped++
          }
        }
      }
      console.log(` ${mapped}/${batch.length} mapped`)
    } catch (e) {
      console.log(`\n  batch parse failed: ${(e as any)?.message || e}`)
    }
  }
  for (const raw of uniqueRaw) {
    if (!result[raw]) result[raw] = { canonical: raw, category: 'other' }
  }
  return result
}

// ── Main ────────────────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  homelessness:  '0F7173', // teal — the Coalition's mission
  religious:     'E8B84B', // gold
  health:        'DC2626', // red
  humanitarian:  '00B4D8', // sarinaBlue
  education:     '6D28D9', // purple
  youth:         'D97706', // amber
  animal:        'E8632A', // hermesOrange
  veterans:      '0D2B45', // navy
  environmental: '059669', // green
  community:     '0A4F51', // tealDark
  arts:          '4A6572', // slateDark
  justice:       '8B5CF6', // violet
  other:         '8FA3AE', // slate
}

function titleCase(c: string) { return c.charAt(0).toUpperCase() + c.slice(1) }

async function main() {
  const s = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  console.log('Pulling collection members…')
  const { data: members } = await s.from('collection_members').select('dataset_id, label').eq('collection_id', COLLECTION_ID)
  if (!members || members.length === 0) throw new Error('no members')

  const allRaw: string[] = []
  const fieldValues: string[] = []
  for (const m of members) {
    console.log(`  ${m.label}…`)
    let offset = 0
    while (offset < 5000) {
      const { data: rows } = await s.from('dataset_rows_flat')
        .select('data')
        .eq('dataset_id', m.dataset_id)
        .order('row_index')
        .range(offset, offset + 999)
      if (!rows || rows.length === 0) break
      for (const r of rows) {
        const v = (r as any).data?.[FIELD]
        if (typeof v === 'string' && v.trim()) {
          fieldValues.push(v)
          for (const part of splitMentions(v)) allRaw.push(part)
        }
      }
      if (rows.length < 1000) break
      offset += 1000
    }
  }
  console.log(`  ${fieldValues.length} non-empty values · ${allRaw.length} mentions extracted`)

  const uniqueRaw = Array.from(new Set(allRaw))
  console.log(`Canonicalising ${uniqueRaw.length} unique mentions via Claude Haiku…`)
  const mapping = await canonicalise(uniqueRaw)

  // Drop AI "unspecified"-style placeholder canonicals — they are noise, not orgs
  const NOISE_RE = /^(unspecified|unknown|unclear|generic|misc|none|n\/?a|unnamed|a few|several|various|other organizations?|other charities?|others|multiple|unable to (classify|identify|categori[zs]e)|not (specified|identified|provided)|nothing specific)\b/i
  for (const k of Object.keys(mapping)) {
    if (NOISE_RE.test(mapping[k].canonical)) delete mapping[k]
  }

  type Agg = { canonical: string; category: string; count: number; raw: Set<string> }
  const agg: Record<string, Agg> = {}
  for (const raw of allRaw) {
    const map = mapping[raw]
    if (!map) continue  // skipped as noise
    const key = map.canonical
    if (!agg[key]) agg[key] = { canonical: key, category: map.category, count: 0, raw: new Set() }
    agg[key].count += 1
    agg[key].raw.add(raw)
  }

  // Cross-batch dedup pass: merge canonicals where one is a prefix/suffix of another
  // (e.g. "Second Harvest Food Bank" + "Second Harvest Food Bank of Central Florida")
  const canonicals = Object.keys(agg).sort((a, b) => b.length - a.length) // longest first
  for (let i = 0; i < canonicals.length; i++) {
    const longer = canonicals[i]
    if (!agg[longer]) continue
    for (let j = i + 1; j < canonicals.length; j++) {
      const shorter = canonicals[j]
      if (!agg[shorter]) continue
      // Substring or shared 4+ token prefix
      const longLower = longer.toLowerCase()
      const shortLower = shorter.toLowerCase()
      const shortTokens = shortLower.split(/\s+/)
      const longTokens = longLower.split(/\s+/)
      const sharedPrefix = shortTokens.length >= 2 &&
        shortTokens.every((t, idx) => longTokens[idx] === t)
      if (longLower.includes(shortLower) || sharedPrefix) {
        // Merge shorter → longer (use the more-specific name)
        agg[longer].count += agg[shorter].count
        for (const r of agg[shorter].raw) agg[longer].raw.add(r)
        delete agg[shorter]
      }
    }
  }

  const sorted = Object.values(agg).sort((a, b) => b.count - a.count)
  const totalMentions = sorted.reduce((s, r) => s + r.count, 0)
  console.log(`  ${sorted.length} canonical entities · ${totalMentions} total mentions`)
  console.log(`  Top 10:`)
  for (const r of sorted.slice(0, 10)) console.log(`    ${String(r.count).padStart(3)} × ${r.canonical} [${r.category}]`)

  // Category counts
  const catCounts: Record<string, number> = {}
  for (const r of sorted) catCounts[r.category] = (catCounts[r.category] || 0) + r.count
  const catBars = Object.entries(catCounts).sort((a, b) => b[1] - a[1])

  // Representative quotes — one per category (top entity in each)
  const seenCat = new Set<string>()
  const quotes: { text: string }[] = []
  for (const r of sorted) {
    if (seenCat.has(r.category)) continue
    const sample = Array.from(r.raw)[0]
    if (sample) {
      quotes.push({ text: `${r.canonical} — mentioned as: "${sample}"`, attribution: titleCase(r.category) } as any)
      seenCat.add(r.category)
    }
    if (quotes.length >= 6) break
  }

  const top24 = sorted.slice(0, 24)
  const longTail = sorted.slice(24, 48)
  const top24Share = totalMentions > 0 ? Math.round(top24.reduce((s, r) => s + r.count, 0) / totalMentions * 100) : 0

  const slides: SlideSpec[] = []
  slides.push({
    type: 'entity_grid',
    title: `${FIELD_DISPLAY} — Top organisations`,
    subtitle: `${sorted.length.toLocaleString()} distinct organisations · ${totalMentions.toLocaleString()} total mentions`,
    entities: top24.map(r => ({ name: r.canonical, mentions: r.count, category: titleCase(r.category) })),
    accentColor: 'E8B84B',
    insight: `Top ${top24.length} entities account for ${top24Share}% of all mentions.`,
  })
  slides.push({
    type: 'bar_chart',
    title: `${FIELD_DISPLAY} — by category`,
    subtitle: `Total mentions across ${catBars.length} categories`,
    data: catBars.map(([cat, n]) => ({ label: titleCase(cat), value: n, color: CATEGORY_COLORS[cat] || CATEGORY_COLORS.other })),
    insight: catBars[0]
      ? `${titleCase(catBars[0][0])} is the top category — ${Math.round(catBars[0][1] / totalMentions * 100)}% of all mentions.`
      : undefined,
  })
  if (longTail.length > 0) {
    slides.push({
      type: 'entity_grid',
      title: `${FIELD_DISPLAY} — the long tail`,
      subtitle: `Organisations ranked ${25}–${24 + longTail.length}`,
      entities: longTail.map(r => ({ name: r.canonical, mentions: r.count, category: titleCase(r.category) })),
      accentColor: '00B4D8',
    })
  }
  if (quotes.length > 0) {
    slides.push({
      type: 'quotes',
      title: 'Representative mentions',
      subtitle: 'Verbatim phrasing from donors · one per category',
      quotes,
    })
  }

  const deck: DeckSpec = {
    title: `${COLLECTION_DATASET_NAME} — ${FIELD_DISPLAY}`,
    subtitle: 'Entity analysis · add-on to the StoryTime deck',
    slides,
  }

  console.log('Rendering PPTX…')
  const buffer = await renderDeck(deck, COLLECTION_DATASET_NAME)

  const outDir = path.join(homedir(), 'Downloads')
  const outPath = path.join(outDir, 'Coalition-Charities-Entity-Analysis.pptx')
  writeFileSync(outPath, buffer)
  console.log(`\n✓ Wrote ${outPath}`)
  console.log(`  ${(buffer.length / 1024).toFixed(1)} KB · ${slides.length} slides`)
}

main().catch(e => { console.error(e); process.exit(1) })
