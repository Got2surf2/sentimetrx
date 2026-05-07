// scripts/check-reviews.js
// One-off diagnostic — prints the state of every review_source plus any
// stuck (non-pending) errored review_source_locations. Read-only.
//
// Run from repo root:   node scripts/check-reviews.js
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.local.

const fs = require('fs')
const path = require('path')
const { createClient } = require('@supabase/supabase-js')

// Tiny .env.local parser — handles KEY=value, KEY="value", strips comments.
const envPath = path.join(__dirname, '..', '.env.local')
if (!fs.existsSync(envPath)) {
  console.error('No .env.local at ' + envPath)
  process.exit(1)
}
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i)
  if (!m) continue
  const key = m[1]
  let val = m[2]
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1)
  }
  if (!process.env[key]) process.env[key] = val
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(url, key, { auth: { persistSession: false } })

function fmtDate(d) {
  if (!d) return '(never)'
  const dt = new Date(d)
  const ms = Date.now() - dt.getTime()
  const hours = Math.round(ms / 3600000)
  const days = Math.round(hours / 24)
  const ago = ms < 0 ? `in ${-hours}h` : (hours < 48 ? `${hours}h ago` : `${days}d ago`)
  return `${dt.toISOString().slice(0, 16)}Z (${ago})`
}

async function main() {
  console.log('\n=== REVIEW SOURCES ===\n')
  const { data: sources, error: srcErr } = await supabase
    .from('review_sources')
    .select('id, brand_name, status, sync_frequency_hours, last_synced_at, next_sync_at, error_message, created_at')
    .order('created_at', { ascending: false })
  if (srcErr) {
    console.error('Failed to query review_sources:', srcErr.message)
    process.exit(1)
  }
  if (!sources?.length) {
    console.log('No review_sources rows.')
  } else {
    for (const s of sources) {
      const flag = s.status === 'active' ? '✅' : (s.status === 'error' ? '❌' : '⏸️')
      console.log(`${flag} ${s.brand_name}  [${s.status}]  freq=${s.sync_frequency_hours}h`)
      console.log(`   last_synced  : ${fmtDate(s.last_synced_at)}`)
      console.log(`   next_sync_at : ${fmtDate(s.next_sync_at)}`)
      if (s.error_message) console.log(`   error        : ${s.error_message.slice(0, 200)}`)
      console.log(`   id: ${s.id}`)
      console.log('')
    }
  }

  console.log('\n=== STUCK LOCATIONS (non-pending error_message) ===\n')
  const { data: stuck, error: locErr } = await supabase
    .from('review_source_locations')
    .select('id, review_source_id, name, city, state, last_synced_at, error_message, selected')
    .not('error_message', 'is', null)
    .not('error_message', 'like', 'pending_task:%')
    .eq('selected', true)
    .order('review_source_id')
  if (locErr) {
    console.error('Failed to query review_source_locations:', locErr.message)
    process.exit(1)
  }
  if (!stuck?.length) {
    console.log('No stuck locations. ✅')
  } else {
    console.log(`${stuck.length} location(s) with non-pending errors blocking refresh:\n`)
    let lastSrc = ''
    for (const l of stuck) {
      if (l.review_source_id !== lastSrc) {
        const src = sources?.find(s => s.id === l.review_source_id)
        console.log(`-- ${src?.brand_name || l.review_source_id} --`)
        lastSrc = l.review_source_id
      }
      const where = [l.city, l.state].filter(Boolean).join(', ')
      console.log(`   ${l.name}${where ? ' (' + where + ')' : ''}`)
      console.log(`     last_synced: ${fmtDate(l.last_synced_at)}`)
      console.log(`     error      : ${(l.error_message || '').slice(0, 200)}`)
    }
  }

  console.log('\n=== PENDING (in-flight) LOCATIONS ===\n')
  const { count: pendingCount } = await supabase
    .from('review_source_locations')
    .select('id', { count: 'exact', head: true })
    .like('error_message', 'pending_task:%')
    .eq('selected', true)
  console.log(`${pendingCount || 0} location(s) currently waiting on DataforSEO results.\n`)
}

main().catch(e => { console.error(e); process.exit(1) })
