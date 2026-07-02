 
// Brand-level entity extraction for Ruth's Chris + Capital Grille (the primary
// Google-reviews dataset for each), so we have an entity-level competitive
// compare alongside the taxonomy one. Haiku NER over a sample; idempotent
// upsert into entity_catalog (mode 'initial' on a currently-empty catalog).
import { readFileSync } from 'fs'; import path from 'path'
const env = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const l of env.split('\n')) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') }
import { createClient } from '@supabase/supabase-js'
import { discoverEntities } from '../lib/entityDiscovery'

async function main() {
  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  for (const name of ['Ruths Chris Reviews', 'Capital Grille Reviews']) {
    const { data: ds } = await service.from('datasets').select('id,row_count').eq('name', name).order('row_count', { ascending: false }).limit(1)
    if (!ds?.length) { console.error(`not found: ${name}`); continue }
    process.stderr.write(`Discovering entities for "${name}" (${ds[0].row_count} rows)...\n`)
    const r = await discoverEntities({ service, datasetId: ds[0].id, mode: 'initial', sampleSize: 800 })
    console.log(`  ${name}: ${r.entities_new} new / ${r.entities_after} total, sampled ${r.sample_size}, ~${r.cost_est_cents}¢${r.error ? ' err:' + r.error : ''}`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
