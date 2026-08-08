/**
 * Mine themes from the Trump corpus with our own AI, then measure each theme
 * month by month.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_mine.ts [--target prod] [--write]
 *
 * Uses the platform's own mining stack — callAI + lib/themeMining's real
 * keyword matcher — rather than a bespoke prompt, so the themes are the ones
 * Sentimetrx would produce. Two departures from the API route, both deliberate:
 *
 *  1. The route's prompt asks whether the corpus is restaurant feedback. That
 *     question is meaningless here, so this asks for political-speech themes.
 *  2. The route mines one sample of the whole corpus. A 19-month corpus mined
 *     that way returns only themes that are big ACROSS the whole window, which
 *     is exactly wrong for a question about how attention SHIFTS — a theme that
 *     dominated one quarter and vanished never surfaces. So this mines several
 *     time slices independently and unions the keyword sets.
 *
 * Coverage is then measured with scanThemes (the same matcher the product
 * counts with), so every number reported is a measured keyword match, never the
 * model's own estimate of prevalence. --write persists the union to
 * dataset_state.theme_model; without it the script only reports.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

import { createClient } from '@supabase/supabase-js'
import { callAI } from '../../lib/ai'
import { scanThemes, pruneDeadKeywords, applyMeasuredCoverage, type MinedTheme } from '../../lib/themeMining'

const args = process.argv.slice(2)
const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined }
const target = (flag('--target') ?? 'prod').toLowerCase()
const doWrite = args.includes('--write')
const OUT = path.join(homedir(), 'Downloads', 'trump-corpus')

const SAMPLE_PER_SLICE = 220   // texts sent to the model per slice
const MIN_WORDS = 20           // skip procedural fragments when sampling

interface RowData { text: string; date: string; month: string; is_repost?: boolean; ofr_topics?: string[] }

const makeDb = (u: string, k: string) => createClient(u, k)
type Db = ReturnType<typeof makeDb>

async function fetchAll(db: Db, datasetId: string): Promise<RowData[]> {
  const out: RowData[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db.from('dataset_rows_flat')
      .select('data').eq('dataset_id', datasetId)
      .order('row_index', { ascending: true }).range(from, from + PAGE - 1)
    if (error) throw error
    if (!data?.length) break
    out.push(...data.map((r) => r.data as unknown as RowData))
    if (data.length < PAGE) break
  }
  return out
}

/** Deterministic spread across a slice — no Math.random, so runs reproduce. */
function sampleEvenly<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items
  const step = items.length / n
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * step)])
}

async function mineSlice(label: string, texts: string[]): Promise<MinedTheme[]> {
  const corpus = texts.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const userMsg =
    `Thematic analysis of ${texts.length} passages of political speech by a sitting US President ` +
    `(${label}). Identify 5-8 distinct SUBSTANTIVE themes — what he is actually talking about and ` +
    `how he frames it. Ignore procedural filler (greetings, thanking people, introducing officials).\n\n` +
    `For each theme give 8-15 keywords. Keywords are matched against passages by word stem ` +
    `(multi-word phrases match their words in order, allowing a few words between), so every keyword ` +
    `must be wording that LITERALLY appears in the passages:\n` +
    `- Prefer single distinctive words he actually said ("tariffs", "invasion", "witch hunt")\n` +
    `- Include his own characteristic phrasings and epithets\n` +
    `- A 2-3 word phrase ONLY when a single word is too ambiguous ("border security", "drill baby")\n` +
    `- Never invent paraphrases he did not say\n\n` +
    `Passages:\n${corpus}\n\n` +
    `Return ONLY raw JSON:\n` +
    `{"themes":[{"id":"t1","name":"Name","description":"One sentence.",` +
    `"keywords":["term","variant"],"sentiment":"neutral","count":0,"percentage":0,"relatedThemes":[]}],` +
    `"summary":"2-3 sentences."}`

  const res = await callAI({
    tier: 'standard',
    maxTokens: 4000,
    timeoutMs: 120000,
    system: 'You are a political discourse analyst. Return ONLY raw JSON — no markdown, no backticks. Start with { and end with }.',
    messages: [{ role: 'user', content: userMsg }],
  })
  const clean = res.text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()
  const parsed = JSON.parse(clean) as { themes?: MinedTheme[] }
  return parsed.themes ?? []
}

/**
 * Mining each slice separately rediscovers the same theme under different
 * wording — "Border Security, Immigration & Crime", "Immigration Enforcement
 * and Border Security" and "Border Security, Immigration Enforcement &
 * Deportation" all came back from different half-years. Name-matching cannot
 * merge those, and leaving them split counts the same passages under three
 * labels, so every share in a report would be wrong. This asks the model to
 * collapse them into a canonical, mutually-exclusive set; keywords of merged
 * themes are unioned and coverage is then re-measured from scratch.
 */
async function consolidate(themes: MinedTheme[]): Promise<MinedTheme[]> {
  const listing = themes.map((t, i) => `${i + 1}. ${t.name} — ${t.description ?? ''}`).join('\n')
  const res = await callAI({
    tier: 'standard',
    maxTokens: 3000,
    timeoutMs: 120000,
    system: 'You are a political discourse analyst. Return ONLY raw JSON — no markdown. Start with { and end with }.',
    messages: [{
      role: 'user',
      content:
        `These themes were mined independently from different time periods of one corpus, so several ` +
        `describe the SAME underlying topic in different words. Collapse them into a canonical set of ` +
        `8-14 mutually exclusive themes.\n\n${listing}\n\n` +
        `Rules:\n` +
        `- Merge only genuine duplicates. Keep distinct topics apart even if adjacent ` +
        `(e.g. "immigration enforcement" and "crime in cities" are different).\n` +
        `- Give each canonical theme a short, neutral, descriptive name (2-5 words).\n` +
        `- List the ORIGINAL numbers that map into it.\n\n` +
        `Return: {"canonical":[{"name":"Short Name","description":"One sentence.","members":[1,4,9]}]}`,
    }],
  })
  const clean = res.text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()
  const parsed = JSON.parse(clean) as { canonical?: { name: string; description: string; members: number[] }[] }
  const canon = parsed.canonical ?? []
  if (!canon.length) return themes

  return canon.map((c, i) => {
    const members = c.members.map((n) => themes[n - 1]).filter(Boolean)
    return {
      id: `c${i + 1}`,
      name: c.name,
      description: c.description,
      keywords: [...new Set(members.flatMap((m) => m.keywords))],
      sentiment: 'neutral',
      count: 0,
      percentage: 0,
      relatedThemes: [],
    } as MinedTheme
  })
}

/** Merge themes from several slices, unioning keywords of same-named themes. */
function unionThemes(all: MinedTheme[][]): MinedTheme[] {
  const byName = new Map<string, MinedTheme>()
  for (const set of all) {
    for (const t of set) {
      const key = t.name.toLowerCase().replace(/[^a-z ]/g, '').trim()
      const hit = byName.get(key)
      if (hit) hit.keywords = [...new Set([...hit.keywords, ...t.keywords])]
      else byName.set(key, { ...t, keywords: [...new Set(t.keywords)] })
    }
  }
  return [...byName.values()]
}

async function run(db: Db, name: string, datasetId: string) {
  console.log(`\n═══ ${name} ═══`)
  const rows = await fetchAll(db, datasetId)
  console.log(`  loaded ${rows.length} rows`)

  // His own words only: reposts are someone else's.
  const own = rows.filter((r) => !r.is_repost && String(r.text ?? '').trim())
  const longEnough = own.filter((r) => String(r.text).split(/\s+/).length >= MIN_WORDS)
  console.log(`  own words: ${own.length}   >=${MIN_WORDS} words: ${longEnough.length}`)

  // Slice by half-year so themes that rose or vanished can surface.
  const slices = new Map<string, RowData[]>()
  for (const r of longEnough) {
    const [y, m] = r.month.split('-').map(Number)
    const key = `${y}-H${m <= 6 ? 1 : 2}`
    if (!slices.has(key)) slices.set(key, [])
    slices.get(key)!.push(r)
  }

  const mined: MinedTheme[][] = []
  for (const [label, items] of [...slices.entries()].sort()) {
    const sample = sampleEvenly(items, SAMPLE_PER_SLICE).map((r) => r.text)
    process.stdout.write(`  mining ${label} (${items.length} rows, ${sample.length} sampled)… `)
    // One retry: a truncated/!malformed JSON body would otherwise drop a whole
    // period out of theme DISCOVERY, silently biasing which themes exist.
    let got: MinedTheme[] | null = null
    for (let attempt = 0; attempt < 2 && !got; attempt++) {
      try { got = await mineSlice(label, sample) } catch (e) {
        if (attempt === 1) console.log(`FAILED twice: ${(e as Error).message}`)
      }
    }
    if (got) { console.log(`${got.length} themes`); mined.push(got) }
  }

  let themes = unionThemes(mined)
  console.log(`\n  union: ${themes.length} themes`)
  themes = await consolidate(themes)
  console.log(`  consolidated: ${themes.length} canonical themes, ${themes.reduce((n, t) => n + t.keywords.length, 0)} keywords`)

  // Measure with the REAL matcher over EVERY row, not the sample.
  const allTexts = own.map((r) => r.text)
  let scan = scanThemes(allTexts, themes)
  themes = pruneDeadKeywords(themes, scan)
  scan = scanThemes(allTexts, themes)
  themes = applyMeasuredCoverage(themes, scan, allTexts.length)
  themes.sort((a, b) => (b.count ?? 0) - (a.count ?? 0))

  console.log(`\n  MEASURED COVERAGE (keyword match over all ${allTexts.length} passages):`)
  for (const t of themes) {
    console.log(`    ${String(t.percentage ?? 0).padStart(5)}%  ${String(t.count ?? 0).padStart(6)}  ${t.name}`)
  }

  // Theme x month, as a share of that month's passages.
  const months = [...new Set(own.map((r) => r.month))].sort()
  const series: Record<string, Record<string, number>> = {}
  for (const t of themes) {
    series[t.name] = {}
    for (const m of months) {
      const inMonth = own.filter((r) => r.month === m)
      if (!inMonth.length) continue
      // ThemeScan.perTheme is a plain number[] aligned to the themes array —
      // not keyed by theme.id, and not Sets. Indexing by id (or reading .size)
      // yields undefined and silently produces an all-zero series.
      const s = scanThemes(inMonth.map((r) => r.text), [t])
      series[t.name][m] = Math.round((100 * (s.perTheme[0] ?? 0)) / inMonth.length)
    }
  }

  if (doWrite) {
    const { error } = await db.from('dataset_state')
      .update({ theme_model: { themes, aiGenerated: true, version: 1 } })
      .eq('dataset_id', datasetId)
    if (error) throw error
    console.log('\n  ✓ theme_model written to dataset_state')
  }

  return { name, datasetId, rows: own.length, months, themes, series }
}

async function main() {
  const url = target === 'prod' ? process.env.NEXT_PUBLIC_SUPABASE_URL! : process.env.SUPABASE_TEST_URL!
  const key = target === 'prod' ? process.env.SUPABASE_SERVICE_ROLE_KEY! : process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!
  console.log(`▶ ${target.toUpperCase()}`)
  const db = makeDb(url, key)

  const { data: ds } = await db.from('datasets').select('id, name').ilike('name', 'Trump —%')
  const out = []
  for (const d of (ds ?? []).sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
    out.push(await run(db, String(d.name), String(d.id)))
  }

  mkdirSync(OUT, { recursive: true })
  writeFileSync(path.join(OUT, 'themes.json'), JSON.stringify(out, null, 2))
  console.log(`\nWrote ${path.join(OUT, 'themes.json')}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
