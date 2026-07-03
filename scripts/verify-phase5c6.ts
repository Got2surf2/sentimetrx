// scripts/verify-phase5c6.ts
//
// Phase 5 commit 6 verification — invokes lib/townHallAdapter directly
// against the live sarina-cohort row and prints the projected JSON.
// Used to validate the adapter without browser auth gymnastics.
//
// Run: npx tsx scripts/verify-phase5c6.ts
//
// Safe to delete after Phase 5 lands.

import { createClient } from '@supabase/supabase-js'
import { config } from 'dotenv'
config({ path: '.env.local' })

import { getTownHallAsLegacy, listTownHallsAsLegacy } from '../lib/townHallAdapter'

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
) as any

async function main() {
  console.log('--- listTownHallsAsLegacy(null) ---')
  const list = (await listTownHallsAsLegacy(db, null)) || []
  console.log('count:', list.length)
  for (const r of list) {
    console.log('  ', r.slug, r.status, 'participants=' + r.participants, 'turns=' + r.turns)
  }

  console.log('')
  console.log('--- getTownHallAsLegacy(sarina-cohort) ---')
  const detail = await getTownHallAsLegacy(db, 'sarina-cohort')
  if (!detail) { console.log('NULL — no pulseiq_sessions row resolved'); return }
  console.log('session.id     :', detail.session.id)
  console.log('session.slug   :', detail.session.slug)
  console.log('session.status :', detail.session.status, '(mapped from pulseiq_sessions.status)')
  console.log('session.name   :', detail.session.name)
  console.log('themes count   :', detail.themes.length)
  for (const t of detail.themes) {
    console.log('  -', t.label, '(' + t.source + '/' + t.state + ')  rc=' + t.response_count + ' mc=' + t.mention_count)
  }
  console.log('stats          :', JSON.stringify(detail.stats))
  console.log('participants   :', detail.participants.length)

  console.log('')
  console.log('--- getTownHallAsLegacy(sarina-cohort, analyticsMode) ---')
  const det2 = await getTownHallAsLegacy(db, 'sarina-cohort', { analyticsMode: true })
  if (det2 && det2.themes[0]) {
    const keys = Object.keys(det2.themes[0]).filter(k =>
      ['sentiment','match_count','example_quotes','quote_matches','top_keywords','percentage'].includes(k)
    )
    console.log('themes[0] analytics keys present:', keys)
    console.log('overall_sentiment    :', JSON.stringify(det2.overall_sentiment))
    console.log('responses_over_time  :', det2.responses_over_time.length, 'buckets')
    console.log('topic_frequency      :', det2.topic_frequency.length, 'entries')
  }
}

main().catch(e => { console.error('VERIFY ERROR:', e); process.exit(1) })
