// scripts/seed-help-agent.mts
// Seed / refresh the single platform "Help" agent (Guide, 🛟) and ingest the
// curated help articles under docs/help-kb/ into its knowledge base.
//
// The Help agent is ONE platform-owned `agents` row (slug HELP_AGENT_SLUG) in
// the internal/admin org, standard tier, status 'paused' (so it is NOT served
// on the public /b/[slug] surface — the authed /api/help/chat route loads it by
// slug regardless of status). See docs/HELP_AGENT.md.
//
// Idempotent: re-running upserts the agent row and wipes + re-ingests every KB
// chunk, so it always matches the articles on disk + the prompt in code.
//
// Run against the TEST project (default) or prod (--prod). Server-only modules
// are imported, so it MUST run under the react-server condition:
//
//   node --conditions=react-server --import tsx scripts/seed-help-agent.mts
//   node --conditions=react-server --import tsx scripts/seed-help-agent.mts --prod
//
// Optional: HELP_AGENT_ORG_ID=<uuid> pins the home org; otherwise the first
// is_admin_org (or, failing that, the oldest org) is used.

import { readFileSync, readdirSync } from 'fs'
import path from 'path'

// ── Load .env.local ───────────────────────────────────────────────────────
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

// ── Pick the target DB BEFORE any client is built ─────────────────────────
const isProd = process.argv.includes('--prod')
if (!isProd) {
  if (!process.env.SUPABASE_TEST_URL || !process.env.SUPABASE_TEST_SERVICE_ROLE_KEY) {
    console.error('SUPABASE_TEST_* missing from .env.local — cannot seed the TEST project.')
    process.exit(1)
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.SUPABASE_TEST_URL
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY
}
console.log('Seeding Help agent against ' + (isProd ? 'PROD' : 'TEST') + ': ' + process.env.NEXT_PUBLIC_SUPABASE_URL)

const { createClient } = await import('@supabase/supabase-js')
const { ingestKnowledgeText } = await import('../lib/botKnowledge/ingest')
const { HELP_AGENT_SLUG, HELP_AGENT_NAME, HELP_KB_SOURCE_TYPE, HELP_SYSTEM_PROMPT } = await import('../lib/helpAgent')

const service = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
)

async function resolveOrgId(): Promise<{ id: string; name: string | null }> {
  const pinned = process.env.HELP_AGENT_ORG_ID
  if (pinned) {
    const { data } = await service.from('organizations').select('id, name').eq('id', pinned).single()
    if (!data) throw new Error('HELP_AGENT_ORG_ID ' + pinned + ' not found')
    return data
  }
  const { data: admin } = await service
    .from('organizations').select('id, name').eq('is_admin_org', true).order('created_at', { ascending: true }).limit(1)
  if (admin && admin.length) return admin[0]
  const { data: first } = await service
    .from('organizations').select('id, name').order('created_at', { ascending: true }).limit(1)
  if (first && first.length) return first[0]
  throw new Error('No organizations found in the target project')
}

async function main() {
  const org = await resolveOrgId()
  console.log('Home org: ' + (org.name || '(unnamed)') + ' (' + org.id + ')')

  // ── Upsert the agent row by slug ─────────────────────────────────────────
  const { data: existing } = await service
    .from('agents').select('id, org_id, status').eq('slug', HELP_AGENT_SLUG).maybeSingle()

  let botId: string
  if (existing) {
    const { error } = await service.from('agents').update({
      name: HELP_AGENT_NAME,
      system_prompt: HELP_SYSTEM_PROMPT,
      capability: 'standard',
      status: 'paused',
    }).eq('id', existing.id)
    if (error) throw new Error('agent update failed: ' + error.message)
    botId = existing.id
    console.log('Updated existing Help agent ' + botId)
  } else {
    const { data, error } = await service.from('agents').insert({
      org_id: org.id,
      name: HELP_AGENT_NAME,
      slug: HELP_AGENT_SLUG,
      system_prompt: HELP_SYSTEM_PROMPT,
      capability: 'standard',
      capability_config: {},
      config: { internal: true },
      status: 'paused',
      knowledge_base: '',
    }).select('id').single()
    if (error) throw new Error('agent insert failed: ' + error.message)
    botId = data.id
    console.log('Created Help agent ' + botId)
  }

  // ── Wipe existing KB chunks (clean re-seed) ──────────────────────────────
  const { error: delErr } = await service.from('agent_knowledge_chunks').delete().eq('bot_id', botId)
  if (delErr) throw new Error('KB wipe failed: ' + delErr.message)

  // ── Ingest every article (append mode; README excluded) ──────────────────
  const kbDir = path.join(process.cwd(), 'docs', 'help-kb')
  const files = readdirSync(kbDir).filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md').sort()
  const bot = { id: botId, org_id: org.id }
  let totalStored = 0
  for (const file of files) {
    const text = readFileSync(path.join(kbDir, file), 'utf-8')
    const res = await ingestKnowledgeText(service, bot, text, { source: file, sourceType: HELP_KB_SOURCE_TYPE })
    totalStored += res.stored
    console.log('  ' + file.padEnd(34) + ' → ' + res.stored + ' chunk(s)' + (res.near_dup_skipped ? ' (' + res.near_dup_skipped + ' near-dup skipped)' : ''))
  }

  const { count } = await service.from('agent_knowledge_chunks').select('id', { count: 'exact', head: true }).eq('bot_id', botId)
  console.log('\nDone. ' + files.length + ' articles → ' + totalStored + ' chunks stored (' + (count ?? '?') + ' total in KB).')
  console.log('Help agent id: ' + botId + '  slug: ' + HELP_AGENT_SLUG)
}

main().catch((e) => { console.error(e); process.exit(1) })
