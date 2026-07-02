// scripts/seed-reo-goldset.ts
//
// One-time seed for the REO gold set. Upserts the 30 hand-drafted reviews +
// proposed labels (scripts/reo-goldset-seed-data.json) into reo_gold_review,
// owned by the admin org. Idempotent on (org_id, ext_review_id).
//
//   npx tsx scripts/seed-reo-goldset.ts
//
// Reads SUPABASE env from .env.local. Safe to re-run — existing rows that have
// already been reviewed (gold not null / status != 'pending') are left untouched
// so a re-seed never clobbers your review work.

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { config } from 'dotenv'

config({ path: '.env.local' })

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Missing SUPABASE env'); process.exit(1) }

const service = createClient(url, key, { auth: { persistSession: false } })

async function main() {
  // admin org owns the gold set
  const { data: org, error: orgErr } = await service
    .from('organizations').select('id, name').eq('is_admin_org', true).limit(1).single()
  if (orgErr || !org) { console.error('No admin org found', orgErr); process.exit(1) }

  // source dataset (provenance link, best-effort)
  const { data: ds } = await service
    .from('datasets').select('id').eq('name', 'Ruths Chris Reviews').limit(1).maybeSingle()

  const rows = JSON.parse(
    readFileSync(resolve('scripts/reo-goldset-seed-data.json'), 'utf8')
  ) as Array<{ ext_review_id: string; rating: number; review_text: string; proposed: any[] }>

  let inserted = 0, skipped = 0
  for (const r of rows) {
    // don't clobber a review the user has already worked on
    const { data: existing } = await service
      .from('reo_gold_review')
      .select('id, status')
      .eq('org_id', org.id).eq('ext_review_id', r.ext_review_id).maybeSingle()
    if (existing && existing.status !== 'pending') { skipped++; continue }

    const { error } = await service.from('reo_gold_review').upsert({
      org_id: org.id,
      source_dataset_id: ds?.id ?? null,
      ext_review_id: r.ext_review_id,
      rating: r.rating,
      review_text: r.review_text,
      proposed: r.proposed,
      status: 'pending',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id,ext_review_id' })
    if (error) { console.error('upsert failed', r.ext_review_id, error.message); continue }
    inserted++
  }
  console.log(`seeded into org "${org.name}": ${inserted} upserted, ${skipped} left untouched (already reviewed)`)
}

void main().then(() => process.exit(0))
