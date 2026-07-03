/* eslint-disable */
// Throwaway: ingests the MVP+ public-listening corpus (scratchpad/mvp_corpus.json)
// as an 'upload' dataset on the Datanautix admin org, then enriches it (compute →
// themes → entities) so it opens fully clickable in TextMine for the EA demo.
//
// Run: node --conditions=react-server --import tsx scripts/_mvp_listening_ingest.ts [--recreate]
//
// Not committed. Demo data only — additive, deletable from the UI.

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

import { createClient } from '@supabase/supabase-js'
import { autoDetectSchema, emptyThemeModel } from '../../lib/datasetUtils'
import { computeAnalyticsSQL } from '../../lib/analyticsCompute'
import { callAI } from '../../lib/ai'
import { discoverEntities } from '../../lib/entityDiscovery'

const ADMIN_ORG_ID = 'b72e9ee6-0466-459a-8440-988a8bd6d3c5'  // Datanautix
const ADMIN_USER_ID = '99c52954-36a5-4137-b511-a0a336c220ea'  // got2surf2@gmail.com
const CORPUS_PATH = path.join(
  '/private/tmp/claude-501/-Users-sanjaypatel-Developer-GitHub-sentimetrx',
  'ea99aac0-8f2f-4776-870a-6723db8abb48/scratchpad/mvp_corpus.json',
)
const DATASET_NAME = 'MVP+ Membership — Public Listening Sample'
const recreate = process.argv.slice(2).includes('--recreate')

async function mineThemes(texts: string[]) {
  const systemPrompt =
    'You are a qualitative research expert. Return ONLY raw JSON -- no markdown, no backticks. Start with { and end with }.'
  const corpusText = texts.map((t, i) => `${i + 1}. ${t}`).join('\n')
  const fieldLabel = 'comment'
  const userMsg =
    'Thematic analysis on ' + texts.length + ' responses for field \'' + fieldLabel + '\'.' +
    '\n\nResponses:\n' + corpusText +
    '\n\nIdentify 4-7 distinct themes. For each theme, provide 8-15 keywords that include:\n' +
    '- Core terms that define the theme\n- Common synonyms and related phrases respondents might use\n' +
    '- Informal/colloquial variants (e.g. "pricey" for expensive, "meh" for mediocre)\n' +
    '- Short phrases (2-3 words) where a single word is ambiguous\n\n' +
    '\n\nAlso judge whether these responses are reviews or feedback about a ' +
    'RESTAURANT, bar, café, or other food-service venue, as opposed to a hotel, retailer, clinic, app, or anything non-food-service. ' +
    'Return that as a boolean "foodService".\n\n' +
    'Return:\n{"themes":[{"id":"t1","name":"Name","description":"One sentence.",' +
    '"keywords":["core term","synonym1","synonym2","informal variant","short phrase"],' +
    '"sentiment":"positive","count":0,"percentage":0,"relatedThemes":[]}],' +
    '"summary":"2-3 sentences.","fieldName":"' + fieldLabel + '","foodService":false}'
  const result = await callAI({
    tier: 'standard', maxTokens: 4000, timeoutMs: 60000,
    system: systemPrompt, messages: [{ role: 'user', content: userMsg }],
  })
  const clean = result.text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()
  return JSON.parse(clean) as { themes: unknown[]; summary?: string; foodService?: boolean }
}

async function main() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error('Missing SUPABASE env vars')
  const service = createClient(SUPABASE_URL, SUPABASE_KEY)

  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as {
    _meta: { description: string }
    comments: Record<string, string>[]
  }
  console.log(`Corpus: ${corpus.comments.length} comments`)

  // Idempotency
  const { data: existing } = await service.from('datasets')
    .select('id').eq('org_id', ADMIN_ORG_ID).eq('name', DATASET_NAME).limit(1)
  if (existing && existing.length) {
    if (!recreate) { console.log(`Already exists: ${existing[0].id}. Pass --recreate to rebuild.`); return }
    console.log(`--recreate: deleting ${existing[0].id}...`)
    await service.from('datasets').delete().eq('id', existing[0].id).eq('org_id', ADMIN_ORG_ID)
  }

  // Build rows — `comment` FIRST so autoDetectSchema makes it primaryTextField
  const flatData = corpus.comments.map((c) => ({
    comment: c.comment,
    author: c.author,
    source: c.source,
    thread: c.thread,
    posted: c.posted,
    platform: c.platform || '(unspecified)',
    region: c.region || '(unspecified)',
    game: c.game,
    url: c.url,
  }))
  const schema = autoDetectSchema(flatData)
  console.log(`Schema: primaryTextField=${schema.primaryTextField}, fields=${schema.fields.map((f: any) => `${f.field}:${f.type}`).join(', ')}`)

  // 1. dataset
  const { data: created, error: cErr } = await service.from('datasets').insert({
    org_id: ADMIN_ORG_ID, name: DATASET_NAME, created_by: ADMIN_USER_ID,
    source: 'upload', row_count: 0, visibility: 'private', taxonomy_enabled: false,
    description: JSON.stringify({ demo: 'ea_mvp_listening_sample', note: corpus._meta.description, ingested_at: new Date().toISOString() }),
  }).select('id').single()
  if (cErr) throw cErr
  const datasetId = created.id
  console.log(`Created dataset ${datasetId}`)

  // 2. dataset_state
  const { error: sErr } = await service.from('dataset_state').insert({
    dataset_id: datasetId, schema_config: schema, theme_model: emptyThemeModel(),
  })
  if (sErr) throw sErr

  // 3. rows
  const rows = flatData.map((data, i) => ({ dataset_id: datasetId, row_index: i, data }))
  const { error: rErr } = await service.from('dataset_rows_flat').insert(rows)
  if (rErr) throw rErr
  await service.from('datasets').update({ row_count: rows.length, updated_at: new Date().toISOString() }).eq('id', datasetId).eq('org_id', ADMIN_ORG_ID)
  console.log(`Inserted ${rows.length} rows`)

  // 4. analytics compute (metric strip / charts)
  try {
    const analytics = await computeAnalyticsSQL(service, datasetId, schema)
    await service.from('dataset_state').update({ analytics }).eq('dataset_id', datasetId)
    console.log('Computed analytics')
  } catch (e: any) { console.warn('analytics compute skipped:', e.message) }

  // 5. themes
  try {
    const parsed = await mineThemes(flatData.map((d) => d.comment))
    const theme_model = {
      themes: parsed.themes, summary: parsed.summary || '',
      fieldName: 'comment', fieldNames: ['comment'], themeSource: 'ai', themeLibName: null,
      samplingInfo: { sampled: flatData.length, total: flatData.length },
      aiGenerated: true, version: 1,
    }
    await service.from('dataset_state').update({ theme_model }).eq('dataset_id', datasetId)
    if (parsed.foodService === false) await service.from('datasets').update({ taxonomy_suppressed: true }).eq('id', datasetId)
    console.log(`Mined ${(parsed.themes as any[]).length} themes: ${(parsed.themes as any[]).map((t: any) => t.name).join(' · ')}`)
  } catch (e: any) { console.warn('theme mining failed:', e.message) }

  // 6. entities
  try {
    const res = await discoverEntities({ service, datasetId, mode: 'manual', triggeredByUser: ADMIN_USER_ID })
    console.log(`Discovered entities:`, JSON.stringify(res).slice(0, 200))
  } catch (e: any) { console.warn('entity discovery failed:', e.message) }

  console.log(`\nDONE. Open: /analyze/${datasetId}/textmine?section=themes&view=overview`)
}

main().catch((e) => { console.error(e); process.exit(1) })
