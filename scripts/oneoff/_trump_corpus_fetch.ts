/**
 * Trump corpus builder — everything he SAID or POSTED, 20 Jan 2025 → today.
 *
 * One-off research corpus. Not wired into the app; run it by hand:
 *   npx tsx scripts/oneoff/_trump_corpus_fetch.ts
 *
 * Sources (both free, both public-domain / CC0, neither requires a key):
 *   1. GovInfo "Compilation of Presidential Documents" (DCPD) — the official
 *      record of remarks, news conferences, interviews and statements. Package
 *      IDs come from the per-year sitemaps; each package's .htm is one request
 *      that yields title, date, full text, speaker labels and subject metadata.
 *   2. The CC0 Truth Social archive (CNN mirror of stiles/trump-truth-social-archive)
 *      — a single JSON file, updated every few minutes.
 *
 * Scope: things that reveal what he is thinking. Executive orders, proclamations,
 * memoranda, notices and administrative listings are NOT in the corpus — they are
 * written to excluded_documents.ndjson with their full text so anything with a
 * narrative preamble can be pulled back in without re-fetching.
 *
 * Speaker attribution: DCPD renders each turn as
 *   <p class="s2">The President. <span class="p">…utterance…</span></p>
 * so the label is the paragraph text outside the span. That gives an exact split
 * between Trump's words and everyone else's (reporters, cabinet secretaries),
 * rather than a text heuristic. Every row records which method was used.
 */

import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const START_DATE = '2025-01-20' // inauguration
const OUT_DIR = join(homedir(), 'Downloads', 'trump-corpus')
const CACHE_DIR = join(OUT_DIR, '.cache')
const DCPD_YEARS = [2025, 2026]
const TRUTH_URL = 'https://ix.cnn.io/data/truth-social/truth_archive.json'
const CONCURRENCY = 8

/** Types we keep: he spoke them, or they went out in his voice. */
const INCLUDED_TYPES = new Set([
  'remarks',
  'news_conference',
  'interview',
  'address',
  'statement',
])

type Channel = 'spoken' | 'written_statement' | 'posted' | 'document'

interface Item {
  id: string
  source: 'govinfo_dcpd' | 'truth_social'
  channel: Channel
  type: string
  date: string
  datetime: string | null
  title: string
  topic: string | null
  url: string
  text: string
  trump_text: string
  word_count: number
  trump_word_count: number
  speakers: string[]
  attribution_method: string
  categories: string | null
  names: string | null
  subjects: string | null
  media_count: number | null
  replies_count: number | null
  reblogs_count: number | null
  favourites_count: number | null
}

// ---------------------------------------------------------------- helpers

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0)

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
    mdash: '—', ndash: '–', hellip: '…',
  }
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => named[n.toLowerCase()] ?? m)
}

const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()

async function fetchText(url: string, tries = 3): Promise<string> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': 'trump-corpus-research/1.0' } })
      if (res.ok) return await res.text()
      if (res.status === 404) throw new Error('404')
      throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      if (i === tries - 1) throw err
      await new Promise((r) => setTimeout(r, 500 * (i + 1)))
    }
  }
  throw new Error('unreachable')
}

/** Fetch with an on-disk cache so re-runs cost nothing. */
async function cachedFetch(url: string, key: string): Promise<string> {
  const path = join(CACHE_DIR, key)
  if (existsSync(path)) return readFile(path, 'utf8')
  const body = await fetchText(url)
  await writeFile(path, body)
  return body
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (cursor < items.length) {
        const i = cursor++
        out[i] = await fn(items[i], i)
      }
    }),
  )
  return out
}

// ---------------------------------------------------------------- DCPD

function classify(title: string): { type: string; channel: Channel } {
  const t = title.trim()
  if (/^Executive Order\b/i.test(t)) return { type: 'executive_order', channel: 'document' }
  if (/^Proclamation\b/i.test(t)) return { type: 'proclamation', channel: 'document' }
  if (/^Memorandum\b/i.test(t)) return { type: 'memorandum', channel: 'document' }
  if (/^Notice[—-]/i.test(t)) return { type: 'notice', channel: 'document' }
  if (/^(Nominations Submitted|Checklist of White House|Digest of Other White House|Acts Approved)/i.test(t))
    return { type: 'administrative', channel: 'document' }
  if (/^(Message to the Congress|Letter to|Memorandum of)/i.test(t))
    return { type: 'message', channel: 'document' }
  if (/^Message on\b/i.test(t)) return { type: 'ceremonial_message', channel: 'document' }
  if (/^Joint Statement\b/i.test(t)) return { type: 'joint_statement', channel: 'document' }
  if (/^(Order|Presidential Determination|National Security Presidential|Presidential Permit|Executive Grant)/i.test(t))
    return { type: 'administrative', channel: 'document' }
  if (/News Conference/i.test(t)) return { type: 'news_conference', channel: 'spoken' }
  if (/^Interview/i.test(t)) return { type: 'interview', channel: 'spoken' }
  if (/Address/i.test(t)) return { type: 'address', channel: 'spoken' }
  if (/^(Remarks|Videotaped Remarks|Telephone Remarks|Toast)/i.test(t)) return { type: 'remarks', channel: 'spoken' }
  if (/^Statement/i.test(t)) return { type: 'statement', channel: 'written_statement' }
  return { type: 'other', channel: 'written_statement' }
}

const TRAILER = /^(Categories|Names|Subjects|Locations|DCPD Number|Note):/i

/** Split a DCPD paragraph into { speaker, utterance }. */
function parseParagraph(html: string): { speaker: string | null; text: string } {
  const spanIdx = html.search(/<span class="p"/)
  if (spanIdx === -1) return { speaker: null, text: stripTags(html) }
  const label = stripTags(html.slice(0, spanIdx))
  const body = stripTags(html.slice(spanIdx))
  if (!label) return { speaker: null, text: body }
  // "Q" + ". What did you think?" — the period leads the utterance.
  return { speaker: label.replace(/\.$/, '').trim(), text: body.replace(/^\.\s*/, '') }
}

function parseDcpd(pkgId: string, html: string): Item | null {
  const bodyStart = html.indexOf('<body')
  if (bodyStart === -1) return null
  const paras = [...html.slice(bodyStart).matchAll(/<(?:p|h1)[^>]*>([\s\S]*?)<\/(?:p|h1)>/g)].map((m) => m[1])
  const plain = paras.map((p) => stripTags(p))

  const admin = plain[0] ?? ''
  if (!/Donald J\. Trump/i.test(admin)) return null // Biden's Jan 1–19 2025 documents

  const dateIdx = plain.findIndex((l, i) => i > 0 && i < 8 && /^[A-Z][a-z]+ \d{1,2}, \d{4}$/.test(l))
  if (dateIdx === -1) return null
  const title = plain.slice(1, dateIdx).join(' ').trim()
  const date = new Date(`${plain[dateIdx]} UTC`).toISOString().slice(0, 10)

  let end = plain.findIndex((l, i) => i > dateIdx && TRAILER.test(l))
  if (end === -1) end = plain.length

  // A subject/topic line sometimes sits between the date and the first turn.
  let bodyStartIdx = dateIdx + 1
  let topic: string | null = null
  const firstIsTopic =
    plain[bodyStartIdx] && plain[bodyStartIdx].includes('/') && !/<span class="p"/.test(paras[bodyStartIdx] ?? '')
  if (firstIsTopic) {
    topic = plain[bodyStartIdx]
    bodyStartIdx++
  }

  const turns: { speaker: string; text: string }[] = []
  let current = 'UNLABELED'
  for (let i = bodyStartIdx; i < end; i++) {
    const { speaker, text } = parseParagraph(paras[i] ?? '')
    if (!text) continue
    if (speaker) current = speaker
    const last = turns[turns.length - 1]
    if (last && last.speaker === current) last.text += `\n\n${text}`
    else turns.push({ speaker: current, text })
  }

  const labeled = turns.some((t) => t.speaker !== 'UNLABELED')
  const { type, channel } = classify(title)

  // DCPD labels him "The President" normally but "President Trump" whenever a
  // foreign head of state is in the room, so bilateral meetings and joint news
  // conferences need both. The trailing (\.|\s|$) is load-bearing: it keeps
  // "The President's daughter-in-law Lara J. Trump" from matching. The length
  // guard drops stage directions that DCPD renders in the label position, e.g.
  // "President Trump and Prime Minister Anutin signed the agreement…".
  // Family members ("Mr. Trump" is Donald Trump, Jr.; "Kai M. Trump") never match.
  const isTrump = (s: string) => s.length < 40 && /^(The President|President Trump)(\.|\s|$)/i.test(s)

  let trumpText: string
  let attribution: string
  if (labeled) {
    trumpText = turns.filter((t) => isTrump(t.speaker)).map((t) => t.text).join('\n\n')
    attribution = 'speaker_labels'
  } else {
    // Unbroken prose (a formal address, a written statement) — the whole
    // document is his, by definition of the document type.
    trumpText = turns.map((t) => t.text).join('\n\n')
    attribution = 'whole_document'
  }

  const trailer = (label: string): string | null => {
    const i = plain.findIndex((l) => new RegExp(`^${label}:`, 'i').test(l))
    if (i === -1) return null
    const inline = plain[i].replace(new RegExp(`^${label}:\\s*`, 'i'), '').trim()
    return inline || plain[i + 1]?.replace(/\.$/, '') || null
  }

  const text = turns.map((t) => (labeled ? `${t.speaker}: ${t.text}` : t.text)).join('\n\n')

  return {
    id: `dcpd:${pkgId}`,
    source: 'govinfo_dcpd',
    channel,
    type,
    date,
    datetime: null,
    title,
    topic,
    url: `https://www.govinfo.gov/app/details/${pkgId}`,
    text,
    trump_text: trumpText,
    word_count: words(text),
    trump_word_count: words(trumpText),
    speakers: [...new Set(turns.map((t) => t.speaker))].filter((s) => s !== 'UNLABELED'),
    attribution_method: attribution,
    categories: trailer('Categories'),
    names: trailer('Names'),
    subjects: trailer('Subjects'),
    media_count: null,
    replies_count: null,
    reblogs_count: null,
    favourites_count: null,
  }
}

async function collectDcpd(): Promise<Item[]> {
  const pkgIds: string[] = []
  for (const year of DCPD_YEARS) {
    const xml = await fetchText(`https://www.govinfo.gov/sitemap/DCPD_${year}_sitemap.xml`)
    const ids = [...new Set(xml.match(/DCPD-\d+/g) ?? [])]
    console.log(`  sitemap ${year}: ${ids.length} packages`)
    pkgIds.push(...ids)
  }
  pkgIds.sort()

  let done = 0
  const parsed = await mapLimit(pkgIds, CONCURRENCY, async (pkgId) => {
    let item: Item | null = null
    try {
      const html = await cachedFetch(
        `https://www.govinfo.gov/content/pkg/${pkgId}/html/${pkgId}.htm`,
        `${pkgId}.htm`,
      )
      item = parseDcpd(pkgId, html)
    } catch {
      item = null
    }
    if (++done % 200 === 0) console.log(`  fetched ${done}/${pkgIds.length}`)
    return item
  })

  return parsed.filter((x): x is Item => x !== null && x.date >= START_DATE)
}

// ---------------------------------------------------------------- Truth Social

interface TruthPost {
  id: string
  created_at: string
  content: string
  url: string
  media?: unknown[]
  replies_count?: number
  reblogs_count?: number
  favourites_count?: number
}

async function collectTruth(): Promise<Item[]> {
  // Always fetched fresh — this feed updates every few minutes, and a cached
  // copy would silently truncate the most recent posts on a re-run.
  const raw = await fetchText(TRUTH_URL)
  const posts = JSON.parse(raw) as TruthPost[]
  return posts
    .filter((p) => p.created_at >= START_DATE)
    .map((p) => {
      const text = stripTags(p.content ?? '')
      return {
        id: `truth:${p.id}`,
        source: 'truth_social' as const,
        channel: 'posted' as const,
        type: 'truth_social_post',
        date: p.created_at.slice(0, 10),
        datetime: p.created_at,
        title: text.slice(0, 120),
        topic: null,
        url: p.url,
        text,
        trump_text: text,
        word_count: words(text),
        trump_word_count: words(text),
        speakers: ['The President'],
        attribution_method: 'account_owner',
        categories: null,
        names: null,
        subjects: null,
        media_count: Array.isArray(p.media) ? p.media.length : 0,
        replies_count: p.replies_count ?? null,
        reblogs_count: p.reblogs_count ?? null,
        favourites_count: p.favourites_count ?? null,
      }
    })
    .sort((a, b) => (a.datetime! < b.datetime! ? -1 : 1))
}

// ---------------------------------------------------------------- output

/**
 * The CSV is an INDEX, not the text. Single transcripts run past 130,000
 * characters and Excel truncates any cell over 32,767, so shipping full text
 * here would corrupt silently the moment anyone opened it. Full text lives in
 * the NDJSON; this file is for sorting, filtering and picking out what to read.
 */
const CSV_COLS: (keyof Item | 'excerpt')[] = [
  'id', 'source', 'channel', 'type', 'date', 'datetime', 'title', 'topic', 'url',
  'word_count', 'trump_word_count', 'attribution_method', 'speakers',
  'categories', 'names', 'subjects',
  'media_count', 'replies_count', 'reblogs_count', 'favourites_count',
  'excerpt',
]

function toCsv(items: Item[]): string {
  const esc = (v: unknown): string => {
    if (v === null || v === undefined) return ''
    const s = Array.isArray(v) ? v.join('; ') : String(v)
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [CSV_COLS.join(',')]
  for (const it of items) {
    lines.push(
      CSV_COLS.map((c) =>
        c === 'excerpt' ? esc(it.trump_text.replace(/\s+/g, ' ').slice(0, 500)) : esc(it[c]),
      ).join(','),
    )
  }
  return lines.join('\n')
}

const ndjson = (items: Item[]) => items.map((i) => JSON.stringify(i)).join('\n')

function manifest(corpus: Item[], excluded: Item[], generatedAt: string): string {
  const byType = new Map<string, number>()
  for (const i of corpus) byType.set(i.type, (byType.get(i.type) ?? 0) + 1)
  const byMonth = new Map<string, number>()
  for (const i of corpus) {
    const m = i.date.slice(0, 7)
    byMonth.set(m, (byMonth.get(m) ?? 0) + 1)
  }
  const spoken = corpus.filter((i) => i.channel === 'spoken')
  const lastSpoken = spoken.length ? spoken[spoken.length - 1].date : 'n/a'
  const lastPost = corpus.filter((i) => i.source === 'truth_social').at(-1)?.date ?? 'n/a'
  const trumpWords = corpus.reduce((n, i) => n + i.trump_word_count, 0)

  return `# Trump corpus — what he said and posted

Generated ${generatedAt}. Window: ${START_DATE} (inauguration) → present.

## Contents

| file | rows | what |
|---|---|---|
| \`trump_corpus.ndjson\` | ${corpus.length} | **the corpus, full text** — one JSON object per line |
| \`trump_corpus.csv\` | ${corpus.length} | the same rows as a browsable index: metadata, word counts and a 500-character excerpt. Open this one in Excel |
| \`excluded_documents.ndjson\` | ${excluded.length} | executive orders, proclamations, memoranda, notices, ceremonial messages, administrative listings — kept with full text so anything with a narrative preamble can be recovered without re-fetching |

The CSV deliberately carries an excerpt rather than the transcript: single documents
run past 130,000 characters and Excel silently truncates any cell over 32,767. Use
\`trump_corpus.ndjson\` for anything that reads the actual words.

Each row carries both \`text\` (every speaker, prefixed with who said it) and
\`trump_text\` (his words only). For sentiment or theme work, use \`trump_text\` —
otherwise reporters' questions get scored as if he said them.

Trump-attributed words in the corpus: **${trumpWords.toLocaleString()}**.

## Composition

${[...byType.entries()].sort((a, b) => b[1] - a[1]).map(([t, n]) => `- ${t}: ${n}`).join('\n')}

## Sources

1. **GovInfo Compilation of Presidential Documents (DCPD)** — the official published
   record. Public domain (US Government work). Package list from the per-year sitemaps;
   full text from each package's HTML rendition. No API key required.
2. **Truth Social archive** — the CC0 \`stiles/trump-truth-social-archive\` dataset via
   its CNN mirror, refreshed every few minutes.

Federal Register was deliberately not used: DCPD already carries executive orders and
proclamations in full text, so it would only have produced duplicates.

## Speaker attribution

DCPD marks each turn with a speaker label. Where labels are present, \`trump_text\`
contains only paragraphs attributed to **"The President" or "President Trump"** — DCPD
switches to the second form whenever a foreign head of state is present, so bilateral
meetings and joint news conferences need both. Reporters' questions, cabinet remarks
and family members ("Mr. Trump" in the Turning Point call is Donald Trump, Jr.) stay in
\`text\` but are excluded from \`trump_text\`. Where a document is unbroken prose (a
formal address, a written statement), the whole document is treated as his. Each row
records which rule applied in \`attribution_method\`:

${[...new Set(corpus.map((i) => i.attribution_method))].map((m) => `- \`${m}\`: ${corpus.filter((i) => i.attribution_method === m).length} rows`).join('\n')}

## Known gaps — read before drawing conclusions

- **Spoken record ends ${lastSpoken}; posts run to ${lastPost}.** DCPD publishes on a
  lag of roughly five weeks, so the most recent weeks of speeches are not yet in the
  official record. Truth Social is current. Any month-over-month comparison that
  crosses that boundary will show a false collapse in speech volume.
- **whitehouse.gov does not publish remarks transcripts** — its sitemap carries exactly
  one (the 2025 inaugural), so it cannot fill the tail. Closing that gap needs Roll Call
  Factba.se, which is a commercial licence, not a download.
- **Podcast and cable interviews** are not official documents and reach DCPD
  inconsistently.
- **Deleted Truth Social posts** survive only if the upstream scraper caught them
  before deletion.
- **Reposts are not distinguished from original posts**, and ${corpus.filter((i) => i.source === 'truth_social' && !i.text).length} posts carry no text at
  all (media or link only). Filter on \`word_count > 0\` for text analysis.
- DCPD transcripts are edited for the official record; they are not verbatim ASR.

## Volume by month

${[...byMonth.entries()].sort().map(([m, n]) => `- ${m}: ${n}`).join('\n')}
`
}

// ---------------------------------------------------------------- main

async function main() {
  await mkdir(CACHE_DIR, { recursive: true })

  console.log('Truth Social archive…')
  const truth = await collectTruth()
  console.log(`  ${truth.length} posts since ${START_DATE}`)

  console.log('GovInfo DCPD…')
  const dcpd = await collectDcpd()
  console.log(`  ${dcpd.length} Trump documents since ${START_DATE}`)

  const kept = dcpd.filter((d) => INCLUDED_TYPES.has(d.type))
  const excluded = dcpd.filter((d) => !INCLUDED_TYPES.has(d.type))

  const corpus = [...kept, ...truth].sort((a, b) =>
    (a.datetime ?? `${a.date}T00:00:00Z`) < (b.datetime ?? `${b.date}T00:00:00Z`) ? -1 : 1,
  )

  const generatedAt = new Date().toISOString()
  await writeFile(join(OUT_DIR, 'trump_corpus.ndjson'), ndjson(corpus))
  await writeFile(join(OUT_DIR, 'trump_corpus.csv'), toCsv(corpus))
  await writeFile(join(OUT_DIR, 'excluded_documents.ndjson'), ndjson(excluded))
  await writeFile(join(OUT_DIR, 'MANIFEST.md'), manifest(corpus, excluded, generatedAt))

  console.log(`\nCorpus:   ${corpus.length} items (${kept.length} spoken/statement + ${truth.length} posts)`)
  console.log(`Excluded: ${excluded.length} orders/proclamations/administrative`)
  console.log(`Written to ${OUT_DIR}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
