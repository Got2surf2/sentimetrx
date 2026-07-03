/* eslint-disable */
// TEMP read-only verification — checks the entity canonicalisation prompt at
// BATCH=50 actually merges the near-duplicates (Filet/Filet Mignon, Brussels
// Sprouts/Brussel Sprouts, Tomahawk/Tomahawk Steak). Reads the live Fleming's
// catalog, calls Haiku directly (no DB writes), prints the merge groups.
//
// Run: node_modules/.bin/tsx scripts/_verify_canon.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'

const SCOPE_ID = '11daf03a-9aaa-4f11-876a-cc694657f8c4'
const MODEL = 'claude-haiku-4-5-20251001'
const BATCH = 50

function canonicalisePrompt(canonicals: string[]): string {
  return `You are normalising a list of named entities extracted from customer reviews. For each input, output the canonical (cleanest standard) form and a category.

Merge obvious variants of the SAME thing under one canonical:
- "Filet" / "Filet Mignon" / "Mignon" -> "Filet Mignon"
- "Brussels Sprout" / "Brussels Sprouts" -> "Brussels Sprouts"
- "Mac & Cheese" / "Mac and Cheese" / "mac n cheese" -> "Mac & Cheese"

PRESERVE real distinctions — do NOT over-merge different things:
- "Lobster" and "Lobster Mac & Cheese" are DIFFERENT dishes — keep separate
- "Ribeye" and "Filet Mignon" are different cuts — keep separate
- "Old Fashioned" and "Manhattan" are different cocktails — keep separate

Categories (pick the single best fit; lower-case): food | drink | place | person | brand | other

Return ONLY a JSON object, no prose, no markdown fences. Keys are the raw inputs verbatim. Values are { "canonical": "...", "category": "..." }.

Inputs:
${canonicals.map(c => `- ${c}`).join('\n')}`
}

async function callHaiku(prompt: string): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY!,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 6000,
      system: 'You are a precise data normaliser. Output valid JSON only.',
      messages: [{ role: 'user', content: prompt }],
    }),
  })
  if (!res.ok) throw new Error('Anthropic ' + res.status + ': ' + (await res.text()).slice(0, 300))
  const data: any = await res.json()
  return (data.content?.[0]?.text || '').trim()
}

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  )
  const { data: catalog } = await service
    .from('entity_catalog')
    .select('canonical, category')
    .eq('scope_type', 'collection')
    .eq('scope_id', SCOPE_ID)
  const entries = (catalog || []) as Array<{ canonical: string; category: string }>
  console.log(`Read ${entries.length} catalog entities. Canonicalising in batches of ${BATCH}...`)

  const mapping: Record<string, string> = {}
  const rawList = entries.map(e => e.canonical)
  for (let i = 0; i < rawList.length; i += BATCH) {
    const batch = rawList.slice(i, i + BATCH)
    try {
      const text = await callHaiku(canonicalisePrompt(batch))
      const start = text.indexOf('{')
      const end = text.lastIndexOf('}')
      if (start < 0 || end <= start) { console.log(`  batch ${i / BATCH}: no JSON found`); continue }
      const parsed = JSON.parse(text.slice(start, end + 1))
      let n = 0
      for (const [k, v] of Object.entries(parsed)) {
        const vv = v as any
        if (vv && typeof vv.canonical === 'string') { mapping[k] = vv.canonical.trim(); n++ }
      }
      console.log(`  batch ${i / BATCH}: ${n} mapped`)
    } catch (e: any) {
      console.log(`  batch ${i / BATCH}: FAILED — ${e?.message || e}`)
    }
  }

  // Group raw names by their resulting canonical.
  const groups: Record<string, string[]> = {}
  for (const raw of rawList) {
    const canon = mapping[raw] || mapping[raw.trim().toLowerCase()] || raw
    ;(groups[canon] ||= []).push(raw)
  }
  const merges = Object.entries(groups).filter(([, raws]) => raws.length > 1)
  console.log(`\n${rawList.length} entities -> ${Object.keys(groups).length} after merge. ${merges.length} merge groups:`)
  for (const [canon, raws] of merges.sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  "${canon}"  <-  ${raws.join(' | ')}`)
  }

  // Spot-check the ones the user flagged.
  console.log('\nFlagged cases:')
  for (const probe of ['Filet', 'Filet Mignon', 'Tomahawk', 'Tomahawk Steak', 'Brussels Sprouts', 'Brussel Sprouts']) {
    const found = rawList.find(r => r.toLowerCase() === probe.toLowerCase())
    if (found) console.log(`  ${found} -> ${mapping[found] || mapping[found.trim().toLowerCase()] || '(unmapped)'}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
