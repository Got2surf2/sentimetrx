// scripts/draft-reo-goldset.ts
//
// Scale-up: LLM-draft REO labels for the sampled reviews (scripts/reo-draft-sample.json)
// and seed them into reo_gold_review as `pending` for human spot-check in the UI.
// Reviews that produce no observations are skipped (nothing to judge). Idempotent
// on (org_id, ext_review_id); never clobbers a row the owner has already reviewed.
//
//   npx tsx scripts/draft-reo-goldset.ts
//
// Spends Anthropic budget (~$0.50–1 for ~500 rows on Haiku 4.5).

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { config } from 'dotenv'
import { classifyReviewReo } from '../lib/reoExtractor'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing SUPABASE env'); process.exit(1) }
const service = createClient(url, key, { auth: { persistSession: false } })

const CONCURRENCY = 8

interface SampleRow { source_row_id: number; dataset_id: string; review_id: string; rating: number | null; txt: string; bucket: string }

async function main() {
  const { data: org } = await service.from('organizations').select('id, name').eq('is_admin_org', true).limit(1).single()
  if (!org) { console.error('No admin org'); process.exit(1); return }
  const orgId: string = org.id

  const rows = JSON.parse(readFileSync(resolve('scripts/reo-draft-sample.json'), 'utf8')) as SampleRow[]
  console.log(`classifying ${rows.length} reviews (Haiku 4.5, concurrency ${CONCURRENCY})…`)

  let done = 0, seeded = 0, noSignal = 0, failed = 0, obsTotal = 0
  const queue = [...rows]

  async function worker() {
    while (queue.length) {
      const r = queue.shift()!
      try {
        const obs = await classifyReviewReo(r.txt, r.rating)
        if (obs.length === 0) { noSignal++ }
        else {
          // skip if already present (e.g. re-run) and already reviewed
          const { data: existing } = await service.from('reo_gold_review')
            .select('id, status').eq("org_id", orgId).eq('ext_review_id', r.review_id).maybeSingle()
          if (existing && existing.status !== 'pending') { /* keep owner's work */ }
          else {
            const { error } = await service.from('reo_gold_review').upsert({
              org_id: orgId,
              source_dataset_id: r.dataset_id,
              source_row_id: r.source_row_id,
              ext_review_id: r.review_id,
              rating: r.rating,
              review_text: r.txt,
              proposed: obs,
              status: 'pending',
              updated_at: new Date().toISOString(),
            }, { onConflict: 'org_id,ext_review_id' })
            if (error) { failed++; if (failed <= 5) console.error('upsert', r.review_id, error.message) }
            else { seeded++; obsTotal += obs.length }
          }
        }
      } catch (e) { failed++; if (failed <= 5) console.error('classify', r.review_id, (e as Error).message) }
      if (++done % 50 === 0) console.log(`  ${done}/${rows.length} — seeded ${seeded}, no-signal ${noSignal}, failed ${failed}`)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  console.log(`\nDONE. classified ${done} | seeded ${seeded} (${obsTotal} observations) | no-signal ${noSignal} | failed ${failed}`)

  const { count } = await service.from('reo_gold_review').select('id', { count: 'exact', head: true }).eq("org_id", orgId).eq('status', 'pending')
  console.log(`reo_gold_review now has ${count} pending reviews awaiting spot-check.`)
}

main().then(() => process.exit(0))
