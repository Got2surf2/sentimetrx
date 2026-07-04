#!/usr/bin/env tsx
// Promote a configured entity between the TEST and PROD projects — "config
// flows up" (prod/test isolation block part 3; scripts/clone-org-to-test.ts
// is the "data flows down" counterpart).
//
//   npx tsx scripts/promote.ts export <agent|pulseiq|survey> <id-or-slug> [--from test|prod] [--out <file>]
//   npx tsx scripts/promote.ts import <manifest.json> --org <org-uuid> [--to prod|test] [--by <email>] [--yes]
//
// export — reads ONE entity's config from the source database (default:
//   TEST, where new things get built) and writes a versioned JSON manifest
//   to promotions/ (gitignored — manifests can carry client config). The
//   file IS the review step: open it, check prompts/questions/guide, then
//   import.
// import — applies a manifest to the target database (default: PROD).
//   Entities land dormant — agents draft, PulseIQ sessions draft (their
//   dedicated facilitator agent paused), surveys draft with a FRESH guid —
//   so nothing goes live until activated in the UI. Importing into prod is
//   a production change and requires --yes.
//
// Runtime data (conversations, responses, turns, topics) never travels;
// PulseIQ seed topics regenerate on activate, knowledge chunks re-embed
// on demand in the agent UI.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import {
  buildAgentManifest, buildPulseiqManifest, buildStudyManifest,
  applyAgentManifest, applyPulseiqManifest, applyStudyManifest,
  parseManifest, slugify,
} from '@/lib/promotion'

type Env = 'test' | 'prod'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function envLocal(name: string): string | null {
  const strip = (v: string) => v.trim().replace(/^["']|["']$/g, '')
  if (process.env[name]) return strip(process.env[name]!)
  try {
    const line = readFileSync('.env.local', 'utf8').split('\n').find(l => l.startsWith(name + '='))
    return line ? strip(line.slice(name.length + 1)) : null
  } catch { return null }
}

function clientFor(env: Env): { db: SupabaseClient; host: string } {
  const testUrl = envLocal('SUPABASE_TEST_URL')
  const prodUrl = envLocal('NEXT_PUBLIC_SUPABASE_URL')
  if (testUrl && prodUrl && testUrl === prodUrl) {
    console.error('Refusing: SUPABASE_TEST_URL equals the prod URL — the test/prod split is misconfigured.')
    process.exit(1)
  }
  const url = env === 'test' ? testUrl : prodUrl
  const key = env === 'test' ? envLocal('SUPABASE_TEST_SERVICE_ROLE_KEY') : envLocal('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !key) {
    console.error((env === 'test' ? 'SUPABASE_TEST_*' : 'prod Supabase') + ' creds missing from .env.local')
    process.exit(1)
  }
  return { db: createClient(url, key, { auth: { persistSession: false } }), host: url.replace(/^https?:\/\//, '') }
}

function usage(): never {
  console.error([
    'Usage:',
    '  npx tsx scripts/promote.ts export <agent|pulseiq|survey> <id-or-slug> [--from test|prod] [--out <file>]',
    '  npx tsx scripts/promote.ts import <manifest.json> --org <org-uuid> [--to prod|test] [--by <email>] [--yes]',
  ].join('\n'))
  process.exit(2)
}

function flag(args: string[], name: string): string | null {
  const i = args.indexOf(name)
  return i >= 0 ? (args[i + 1] ?? null) : null
}

// Resolve an export selector (uuid / slug / survey guid) to a row id.
async function resolveId(db: SupabaseClient, type: string, selector: string): Promise<string> {
  const table = type === 'agent' ? 'agents' : type === 'pulseiq' ? 'pulseiq_sessions' : 'studies'
  if (UUID_RE.test(selector)) {
    const { data } = await db.from(table).select('id').eq('id', selector).maybeSingle()
    if (data) return data.id as string
    if (type === 'survey') {
      const { data: byGuid } = await db.from(table).select('id').eq('guid', selector).maybeSingle()
      if (byGuid) return byGuid.id as string
    }
  } else {
    const { data } = await db.from(table).select('id').eq('slug', selector).maybeSingle()
    if (data) return data.id as string
  }
  console.error('No ' + type + ' matches "' + selector + '" (tried ' + (UUID_RE.test(selector) ? 'id' + (type === 'survey' ? ' and guid' : '') : 'slug') + ').')
  process.exit(1)
}

async function runExport(args: string[]) {
  const [type, selector] = args.filter(a => !a.startsWith('--'))
  if (!type || !selector || !['agent', 'pulseiq', 'survey'].includes(type)) usage()
  const from = (flag(args, '--from') || 'test') as Env
  if (!['test', 'prod'].includes(from)) usage()

  const { db, host } = clientFor(from)
  const id = await resolveId(db, type, selector)

  const manifest = type === 'agent'
    ? await buildAgentManifest(db, id, { sourceHost: host })
    : type === 'pulseiq'
      ? await buildPulseiqManifest(db, id, { sourceHost: host })
      : await buildStudyManifest(db, id, { sourceHost: host })

  const nameish = (manifest as { source_bot_slug?: string | null; source_session_slug?: string | null; source_study_name?: string | null })
  const label = slugify(String(nameish.source_bot_slug || nameish.source_session_slug || nameish.source_study_name || selector), type)
  const outPath = flag(args, '--out')
    || path.join('promotions', type + '_' + label + '_' + new Date().toISOString().slice(0, 10) + '.json')
  mkdirSync(path.dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n')

  const extra = type === 'agent' ? ' (' + (manifest as { chunks: unknown[] }).chunks.length + ' knowledge chunks)' : ''
  console.log('==> Exported ' + type + ' from ' + from.toUpperCase() + ' (' + host + ')' + extra)
  console.log('==> Manifest: ' + outPath)
  console.log('Review the JSON, then promote with:')
  console.log('  npx tsx scripts/promote.ts import ' + outPath + ' --org <target-org-uuid> --yes')
}

async function runImport(args: string[]) {
  const file = args.find(a => !a.startsWith('--') && a !== flag(args, '--org') && a !== flag(args, '--to') && a !== flag(args, '--by'))
  const orgId = flag(args, '--org')
  const to = (flag(args, '--to') || 'prod') as Env
  const byEmail = flag(args, '--by')
  if (!file || !orgId || !['test', 'prod'].includes(to)) usage()
  if (!UUID_RE.test(orgId)) { console.error('--org must be an org uuid.'); process.exit(2) }

  let parsed: ReturnType<typeof parseManifest>
  try {
    parsed = parseManifest(JSON.parse(readFileSync(file, 'utf8')))
  } catch (e) {
    console.error('Cannot read manifest: ' + (e instanceof Error ? e.message : String(e)))
    process.exit(1)
  }

  // Gate BEFORE any prod connection: an unconfirmed prod import must exit
  // without touching production at all.
  if (to === 'prod' && !args.includes('--yes')) {
    console.error('==> Import ' + parsed.type + ' → PROD, org ' + orgId)
    console.error('This writes to PRODUCTION. Re-run with --yes to confirm.')
    process.exit(2)
  }

  const { db, host } = clientFor(to)
  const { data: org } = await db.from('organizations').select('id, name').eq('id', orgId).maybeSingle()
  if (!org) { console.error('Org ' + orgId + ' not found in ' + to.toUpperCase() + ' (' + host + ').'); process.exit(1) }

  // created_by: --by email, else the target org's earliest user, else null
  // (the column is nullable on all three tables).
  let createdBy: string | null = null
  if (byEmail) {
    const { data: u } = await db.from('users').select('id').eq('email', byEmail).maybeSingle()
    if (!u) { console.error('No user with email ' + byEmail + ' in ' + to.toUpperCase() + '.'); process.exit(1) }
    createdBy = u.id as string
  } else {
    const { data: u } = await db.from('users').select('id').eq('org_id', orgId).order('created_at', { ascending: true }).limit(1).maybeSingle()
    createdBy = (u?.id as string) ?? null
  }

  console.log('==> Import ' + parsed.type + ' → ' + to.toUpperCase() + ' (' + host + '), org "' + org.name + '" (' + orgId + ')')

  if (parsed.type === 'agent') {
    const r = await applyAgentManifest(db, parsed.manifest, { orgId, createdBy })
    console.log('==> Agent "' + r.name + '" landed as DRAFT: slug ' + r.slug + ', id ' + r.id)
    console.log('    ' + r.chunksInserted + ' knowledge chunks imported (without embeddings — re-embed from the agent Knowledge tab).')
    if (r.chunkError) console.error('    ⚠ chunk insert error: ' + r.chunkError)
  } else if (parsed.type === 'pulseiq') {
    const r = await applyPulseiqManifest(db, parsed.manifest, { orgId, createdBy })
    console.log('==> PulseIQ session landed as DRAFT: slug ' + r.slug + ', id ' + r.id)
    console.log('    Dedicated facilitator agent (paused): slug ' + r.agentSlug + ', id ' + r.agentId)
    console.log('    Seed topics regenerate when the session is activated.')
  } else {
    const r = await applyStudyManifest(db, parsed.manifest, { orgId, createdBy })
    console.log('==> Survey landed as DRAFT: guid ' + r.guid + (r.slug ? ', slug ' + r.slug : '') + ', id ' + r.id)
    console.log('    Fresh guid — the public /s/ link differs from the source project by design.')
  }
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  if (cmd === 'export') await runExport(rest)
  else if (cmd === 'import') await runImport(rest)
  else usage()
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
