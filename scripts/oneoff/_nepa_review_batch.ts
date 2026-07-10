/* eslint-disable */
// Seed a shareable /review/<token> batch of the REAL top Blue Mountains open
// questions, tied to the prod Blue Mountains agent. On the public review page a
// reviewer walks each question and clicks "generate" to get a draft response
// grounded in the agent's KB (draftAnswerFromKB), then edits/accepts. DB-only —
// the /review page + /api/review route already exist on prod. No build.
//
// Run: node --import tsx scripts/oneoff/_nepa_review_batch.ts [--prod]   (default TEST)
//   --token <t>  reuse/replace an existing batch's questions (idempotent re-seed)

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const mm = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}
import { createClient } from '@supabase/supabase-js'

const PROD = process.argv.includes('--prod')
const ORG_ID = 'b72e9ee6-0466-459a-8440-988a8bd6d3c5'          // Datanautix (same on both)
const BOT_ID = PROD
  ? '5845cdb8-f33e-4a2e-9500-5ed0b37e471c'                     // prod Blue Mountains agent
  : '71f8e700-0502-46be-b342-0a032daf03eb'                     // TEST Blue Mountains agent
const BASE = PROD ? 'https://www.sentimetrx.ai' : 'http://localhost:3000'

// Curated from the real extracted open questions — weighted to the core-debate
// questions the deployed agent handles well, with a few it only partly answers
// (honest range). Every one is a real, most-asked question from the record.
const QUESTIONS = [
  'Does Alternative 2 eliminate the 21-inch rule that has protected large old trees since 1994?',
  'By how much would Alternative 2 increase commercial logging compared to current levels?',
  'Will the revised plan continue to restrict motorized access in existing designated Wilderness and Wilderness Study Areas?',
  'Does the revised forest plan include provisions for expanding trail access and investing in infrastructure improvements?',
  'Will the revised Forest Plan retain the Eastside Screens that protect mature and old-growth trees?',
  'Does the revised plan contain significant protections for trees greater than 21 inches in diameter?',
  'Does the plan include active management — timber harvest, thinning, and prescribed fire — for fish and wildlife habitat?',
  'Will the revised Forest Plan keep and strengthen the protective standards for large trees that have been in place for the past 30 years?',
  'How many acres of public land would be affected by the proposed plan?',
  'Will cross-country travel be protected in areas where families have historically accessed wood, hunting, or traditional routes?',
  'Will the revised Forest Plan include strong and enforceable standards (not just guidelines) for habitat connectivity across the three forests?',
  'How does this draft Forest Plan differ from the version that was withdrawn in 2019?',
  'What is the stated fuel-treatment objective, and how does it compare to the prior plan?',
  'Does the revised plan provide protections for roadless areas regardless of the future of the Roadless Rule?',
]

async function main() {
  const url = PROD ? process.env.NEXT_PUBLIC_SUPABASE_URL! : process.env.SUPABASE_TEST_URL!
  const key = PROD ? process.env.SUPABASE_SERVICE_ROLE_KEY! : process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!
  if (!url || !key) throw new Error('missing supabase creds for ' + (PROD ? 'prod' : 'test'))
  const db = createClient(url, key, { auth: { persistSession: false } })

  const tokIdx = process.argv.indexOf('--token')
  let token = tokIdx >= 0 ? process.argv[tokIdx + 1] : null
  let batchId: string

  if (token) {
    const { data, error } = await db.from('question_batches').select('id').eq('share_token', token).single()
    if (error || !data) throw new Error('batch not found for token ' + token)
    batchId = data.id
    await db.from('logged_questions').delete().eq('batch_id', batchId)   // replace question set
    console.log('re-seeding existing batch', batchId)
  } else {
    token = randomBytes(18).toString('base64url')
    const expires = new Date(Date.now() + 550 * 24 * 3600 * 1000).toISOString()
    const { data, error } = await db.from('question_batches').insert({
      org_id: ORG_ID, bot_id: BOT_ID, label: 'Blue Mountains — sample public-comment questions',
      source_kind: 'paste', share_token: token, share_enabled: true, share_expires_at: expires,
    }).select('id').single()
    if (error) { console.error(error.message); process.exit(1) }
    batchId = data.id
    console.log('created batch', batchId)
  }

  const rows = QUESTIONS.map((q, i) => ({
    org_id: ORG_ID, bot_id: BOT_ID, batch_id: batchId,
    session_id: 'nepa-review-seed', user_message: q, original_comment: null,
    classification: 'external', source: 'external', status: 'open',
  }))
  const { error: qErr } = await db.from('logged_questions').insert(rows)
  if (qErr) { console.error(qErr.message); process.exit(1) }

  console.log(`\n✔ seeded ${rows.length} questions → ${PROD ? 'PROD' : 'TEST'}`)
  console.log(`   ${BASE}/review/${token}`)
  if (tokIdx < 0) console.log(`   (re-seed with --token ${token})`)
}
main().catch(e => { console.error(e); process.exit(1) })
