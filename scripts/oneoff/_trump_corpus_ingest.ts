/**
 * Ingest the Trump corpus into Sentimetrx as two datasets.
 *
 *   node_modules/.bin/tsx scripts/oneoff/_trump_corpus_ingest.ts
 *
 * Flags:
 *   --target test|prod   which Supabase project (DEFAULT test — prod requires
 *                        typing it explicitly, and prints a warning)
 *   --limit N            cap rows per dataset (smoke tests)
 *   --recreate           drop + rebuild datasets that already exist by name
 *   --only spoken|posts  ingest just one side
 *
 * Reads ~/Downloads/trump-corpus/trump_corpus.ndjson (built by
 * _trump_corpus_fetch.ts). Idempotent by dataset name.
 *
 * TWO datasets, deliberately, not one:
 *
 *  1. Spoken paragraphs — his words only (`trump_text`), split on paragraph
 *     breaks. Whole documents run a median of 2,317 words and up to 18,927,
 *     which is far too long to be a single verbatim; themes extracted from a
 *     blob that size come back generic. Paragraphs land at a median of 40
 *     words, the size the extractor is tuned for. Fragments under 15 words
 *     ("Thank you." / "Yes.") are dropped as noise.
 *
 *  2. Truth Social posts — one row per post, already short (median 10 words).
 *     Posts with no text at all (media/link only) are skipped.
 *
 * Keeping them apart matters analytically: pooled, the 10,583 posts would
 * swamp the spoken side and any "theme share" would really be measuring
 * Truth Social. It also keeps each dataset under the 50,000-row threshold
 * where Statistics switches to sampling — combined they would be 56,731.
 *
 * Every spoken row carries `ofr_subjects`, the Federal Register editors'
 * hand-assigned subject headings for its parent document. That is a
 * professionally labeled comparison set: run our own extraction, then check
 * it against those labels before trusting it on the unlabeled posts.
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

// .env.local → process.env (same loader the other one-off scripts use)
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

const CORPUS = path.join(homedir(), 'Downloads', 'trump-corpus', 'trump_corpus.ndjson')
const BATCH_SIZE = 500
const MIN_PARAGRAPH_WORDS = 15

const SPOKEN_NAME = 'Trump — Spoken Remarks (paragraphs)'
const POSTS_NAME = 'Trump — Truth Social Posts'

const args = process.argv.slice(2)
const flag = (n: string) => {
  const i = args.indexOf(n)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}
const target = (flag('--target') ?? 'test').toLowerCase()
const limit = flag('--limit') ? Math.max(1, parseInt(flag('--limit')!, 10)) : null
const recreate = args.includes('--recreate')
const only = flag('--only')

if (target !== 'test' && target !== 'prod') throw new Error('--target must be test or prod')

interface CorpusItem {
  id: string
  source: 'govinfo_dcpd' | 'truth_social'
  channel: string
  type: string
  date: string
  datetime: string | null
  title: string
  topic: string | null
  url: string
  trump_text: string
  word_count: number
  trump_word_count: number
  subjects: string | null
  categories: string | null
  media_count: number | null
  replies_count: number | null
  reblogs_count: number | null
  favourites_count: number | null
}

type Row = Record<string, unknown>

// `ReturnType<typeof createClient>` picks the bare generic instantiation, which
// is not what a real createClient(url, key) call produces — hence a type via an
// actual call expression instead.
const makeDb = (url: string, key: string) => createClient(url, key)
type Db = ReturnType<typeof makeDb>

/**
 * The Federal Register editors' subject headings, as FIELDS — never folded into
 * `text`. The extractor must see only his actual words; if the pre-existing tags
 * were concatenated into the body it would rediscover them and we would have
 * proved nothing.
 *
 * Three shapes, because they answer different questions:
 *   ofr_subjects      raw string, kept verbatim for reference
 *   ofr_subject_tags  the 1,922 full headings, e.g. "Russia, conflict in Ukraine"
 *   ofr_topics        collapsed to the head term before the comma → 1,127 topics,
 *                     e.g. "Russia". The full headings are too granular to trend;
 *                     the head terms are the grain you actually chart.
 */
function ofrFields(subjects: string | null) {
  if (!subjects) return { ofr_subjects: null, ofr_subject_tags: [], ofr_topics: [] }
  const tags = subjects.split(';').map((t) => t.trim().replace(/\.$/, '')).filter(Boolean)
  const topics = [...new Set(tags.map((t) => t.split(',')[0].trim()).filter(Boolean))]
  return { ofr_subjects: subjects, ofr_subject_tags: tags, ofr_topics: topics }
}

function buildSpokenRows(items: CorpusItem[]): Row[] {
  const rows: Row[] = []
  for (const doc of items) {
    if (doc.source !== 'govinfo_dcpd') continue
    const paras = doc.trump_text.split('\n\n').map((p) => p.trim()).filter(Boolean)
    const ofr = ofrFields(doc.subjects)
    let kept = 0
    for (const p of paras) {
      const wc = p.split(/\s+/).length
      if (wc < MIN_PARAGRAPH_WORDS) continue
      rows.push({
        // `text` is the verbatim and nothing else — no titles, no subject tags.
        text: p,
        word_count: wc,
        date: doc.date,
        month: doc.date.slice(0, 7),
        channel: 'spoken',
        doc_type: doc.type,
        doc_title: doc.title,
        doc_topic: doc.topic,
        doc_url: doc.url,
        doc_id: doc.id,
        paragraph_index: kept++,
        ofr_categories: doc.categories,
        ...ofr,
      })
    }
  }
  return rows
}

function buildPostRows(items: CorpusItem[]): Row[] {
  return items
    .filter((p) => p.source === 'truth_social' && p.trump_text.trim().length > 0)
    .map((p, i) => ({
      text: p.trump_text,
      word_count: p.trump_word_count,
      date: p.date,
      month: p.date.slice(0, 7),
      posted_at: p.datetime,
      channel: 'posted',
      doc_type: 'truth_social_post',
      doc_url: p.url,
      doc_id: p.id,
      post_index: i,
      replies_count: p.replies_count,
      reblogs_count: p.reblogs_count,
      favourites_count: p.favourites_count,
      has_media: (p.media_count ?? 0) > 0,
      // 13.6% of posts with text are reposts of someone else's words. Kept
      // (sharing something is still a signal of attention) but flagged, so
      // "what HE said" can exclude them in one filter.
      is_repost: /^RT[\s@:]/.test(p.trump_text),
    }))
}

async function ingest(
  service: Db,
  orgId: string,
  userId: string,
  name: string,
  rows: Row[],
  description: Record<string, unknown>,
) {
  const { data: existing, error: exErr } = await service
    .from('datasets').select('id, row_count').eq('org_id', orgId).eq('name', name).limit(1)
  if (exErr) throw exErr

  if (existing?.length) {
    if (!recreate) {
      console.log(`  "${name}" already exists (${existing[0].id}, ${existing[0].row_count} rows). --recreate to rebuild.`)
      return
    }
    console.log(`  --recreate: deleting ${existing[0].id}…`)
    const { error } = await service.from('datasets').delete().eq('id', existing[0].id).eq('org_id', orgId)
    if (error) throw error
  }

  const { data: created, error: createErr } = await service
    .from('datasets')
    .insert({
      org_id: orgId,
      name,
      created_by: userId,
      source: 'upload',
      row_count: 0,
      description: JSON.stringify(description),
    })
    .select('id')
    .single()
  if (createErr) throw createErr
  const datasetId = created!.id as string

  const slice = limit ? rows.slice(0, limit) : rows
  let inserted = 0
  for (let i = 0; i < slice.length; i += BATCH_SIZE) {
    const batch = slice.slice(i, i + BATCH_SIZE).map((data, j) => ({
      dataset_id: datasetId,
      row_index: i + j,
      data,
    }))
    const { error } = await service.from('dataset_rows_flat').insert(batch)
    if (error) throw error
    inserted += batch.length
    if (inserted % 5000 === 0) console.log(`    ${inserted}/${slice.length}`)
  }

  await service.from('datasets')
    .update({ row_count: inserted, updated_at: new Date().toISOString() })
    .eq('id', datasetId).eq('org_id', orgId)

  console.log(`  ✓ ${name}: ${inserted} rows → ${datasetId}`)
}

async function main() {
  let url: string | undefined
  let key: string | undefined
  if (target === 'test') {
    url = process.env.SUPABASE_TEST_URL
    key = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
    console.log(`▶ TEST project (${url?.replace('https://', '').replace('.supabase.co', '')})`)
  } else {
    url = process.env.NEXT_PUBLIC_SUPABASE_URL
    key = process.env.SUPABASE_SERVICE_ROLE_KEY
    console.log('▶ ⚠️  PRODUCTION database — this writes real datasets to the live org.')
  }
  if (!url || !key) throw new Error(`Missing Supabase creds for target=${target}`)
  const service = makeDb(url, key)

  // Resolve org + user in whichever database we're pointed at, rather than
  // hardcoding prod UUIDs that don't exist in the test project.
  // Membership is a column on users, not a join table. Drive off users rather
  // than organizations: the test project carries orphan [CLONE] orgs with no
  // members, and datasets.created_by must reference a real user.
  const { data: users, error: userErr } = await service
    .from('users').select('id, email, org_id, role').not('org_id', 'is', null)
    .order('created_at', { ascending: true })
  if (userErr) throw userErr
  if (!users?.length) throw new Error('No users with an org in target database')

  const { data: orgs, error: orgErr } = await service.from('organizations').select('id, name')
  if (orgErr) throw orgErr
  const orgName = new Map((orgs ?? []).map((o) => [String(o.id), String(o.name)]))

  // Prefer the owner's own org; fall back to a Datanautix-named one, then any.
  const owner =
    users.find((u) => String(u.email).toLowerCase() === 'got2surf2@gmail.com') ??
    users.find((u) => /datanautix/i.test(orgName.get(String(u.org_id)) ?? '')) ??
    users[0]

  const org = { id: String(owner.org_id), name: orgName.get(String(owner.org_id)) ?? '(unnamed)' }
  console.log(`  org:  ${org.name} (${org.id})`)
  console.log(`  user: ${owner.email}`)
  const members = [owner]

  const items = readFileSync(CORPUS, 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as CorpusItem)
  console.log(`  corpus: ${items.length} items`)

  const orgId = org.id as string
  const userId = members[0].id as string
  const built = new Date().toISOString()

  if (only !== 'posts') {
    const rows = buildSpokenRows(items)
    console.log(`\nSpoken paragraphs: ${rows.length}`)
    await ingest(service, orgId, userId, SPOKEN_NAME, rows, {
      corpus: 'trump_corpus', side: 'spoken', unit: 'paragraph',
      min_paragraph_words: MIN_PARAGRAPH_WORDS, source: 'GovInfo DCPD', built,
    })
  }

  if (only !== 'spoken') {
    const rows = buildPostRows(items)
    console.log(`\nTruth Social posts: ${rows.length}`)
    await ingest(service, orgId, userId, POSTS_NAME, rows, {
      corpus: 'trump_corpus', side: 'posted', unit: 'post',
      source: 'CC0 Truth Social archive', built,
    })
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
