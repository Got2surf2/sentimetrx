// scripts/cleanup-reviews.js
// One-off cleanup for the Google Reviews state. Two operations:
//   A. Clear error_message on review_source_locations stuck on transient
//      DataforSEO errors so the next cron picks them up via Phase 2 / 3.
//   B. Delete review_sources that have no linked dataset (orphans from
//      failed setup attempts).
//
// Prints a plan, executes, prints the result counts.

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// .env.local loader (same as check-reviews.js)
const envPath = path.join(__dirname, '..', '.env.local')
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
  if (!m) continue
  const key = m[1]; let val = m[2]
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1)
  if (!process.env[key]) process.env[key] = val
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

async function main() {
  // ── A: Clear non-pending error_message on selected locations ───────────
  // Anything stuck on a DataforSEO error code (40601 Task Handed, 40401 Task
  // Not Found, 40602 Task In Queue, "API returned 0 reviews", "All review
  // API attempts failed") gets reset. Pending refs (`pending_task:%`) are
  // left alone — those are valid in-flight work.
  const { data: stuck, error: queryErr } = await supabase
    .from('review_source_locations')
    .select('id, name, city, state, review_source_id, error_message')
    .not('error_message', 'is', null)
    .not('error_message', 'like', 'pending_task:%')
    .eq('selected', true)

  if (queryErr) { console.error('Query failed:', queryErr); process.exit(1) }

  console.log(`A. Clearing error_message on ${stuck.length} stuck location(s):`)
  for (const l of stuck) {
    const where = [l.city, l.state].filter(Boolean).join(', ')
    console.log(`   - ${l.name}${where ? ' (' + where + ')' : ''}`)
  }

  if (stuck.length > 0) {
    const ids = stuck.map(l => l.id)
    const { error: clearErr } = await supabase
      .from('review_source_locations')
      .update({ error_message: null })
      .in('id', ids)
    if (clearErr) { console.error('Clear failed:', clearErr); process.exit(1) }
    console.log(`   ✅ Cleared.\n`)
  } else {
    console.log('   (nothing to clear)\n')
  }

  // ── B: Delete orphan review_sources (no linked dataset) ─────────────────
  const { data: orphans, error: orphanErr } = await supabase
    .from('review_sources')
    .select('id, brand_name, status, error_message, dataset_id')
    .is('dataset_id', null)

  if (orphanErr) { console.error('Orphan query failed:', orphanErr); process.exit(1) }

  console.log(`B. Deleting ${orphans.length} orphan review_source(s) with no dataset:`)
  for (const s of orphans) {
    console.log(`   - ${s.brand_name} (${s.id})`)
  }

  if (orphans.length > 0) {
    // Cascade delete child review_source_locations first
    const sourceIds = orphans.map(s => s.id)
    const { error: locDelErr } = await supabase
      .from('review_source_locations')
      .delete()
      .in('review_source_id', sourceIds)
    if (locDelErr) { console.error('Location delete failed:', locDelErr); process.exit(1) }

    const { error: srcDelErr } = await supabase
      .from('review_sources')
      .delete()
      .in('id', sourceIds)
    if (srcDelErr) { console.error('Source delete failed:', srcDelErr); process.exit(1) }
    console.log(`   ✅ Deleted ${orphans.length} source(s) + their locations.\n`)
  } else {
    console.log('   (nothing to delete)\n')
  }

  // ── Reset any source with status='error' so cron retries them ──────────
  const { data: errorSources } = await supabase
    .from('review_sources')
    .select('id, brand_name')
    .eq('status', 'error')

  if (errorSources && errorSources.length > 0) {
    console.log(`C. Resetting ${errorSources.length} source(s) from status='error' → 'active':`)
    for (const s of errorSources) console.log(`   - ${s.brand_name}`)
    await supabase
      .from('review_sources')
      .update({ status: 'active', error_message: null })
      .in('id', errorSources.map(s => s.id))
    console.log(`   ✅ Reset.\n`)
  }

  console.log('Done.')
}

main().catch(e => { console.error(e); process.exit(1) })
