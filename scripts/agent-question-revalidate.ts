/* eslint-disable */
// Re-validate an agent's OPEN logged_questions and mark false positives
// (statements, acks, shared context, fragments) as status='n_a' so the
// Questions admin page self-cleans — the same AI validation the Agent Study
// uses for its open-questions section.
//
// Usage (server-only AI → needs the react-server condition):
//   node --conditions=react-server --import tsx scripts/agent-question-revalidate.ts --bot <id>            # dry-run
//   node --conditions=react-server --import tsx scripts/agent-question-revalidate.ts --bot <id> --apply    # write
//   node --conditions=react-server --import tsx scripts/agent-question-revalidate.ts --all  [--apply]      # every bot with open questions
//
// Writes are service-role and pair bot_id + org_id. Dry-run by default.

import { readFileSync } from 'fs'
const env = readFileSync('.env.local', 'utf-8')
for (const l of env.split('\n')) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '') }

import { createClient } from '@supabase/supabase-js'
import { revalidateOpenQuestions } from '../lib/agentStudy'

async function main() {
  const args = process.argv.slice(2)
  const apply = args.includes('--apply')
  const all = args.includes('--all')
  const botArg = args[args.indexOf('--bot') + 1]

  const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

  let botIds: string[] = []
  if (all) {
    const { data } = await service.from('logged_questions').select('bot_id').eq('status', 'open')
    botIds = [...new Set((data || []).map((r: any) => r.bot_id))]
  } else if (botArg) {
    botIds = [botArg]
  } else {
    console.error('Pass --bot <id> or --all'); process.exit(1)
  }

  console.log(`${apply ? 'APPLYING' : 'DRY-RUN'} across ${botIds.length} bot(s)\n`)
  let totalFiltered = 0
  for (const botId of botIds) {
    const r = await revalidateOpenQuestions(botId, { apply })
    totalFiltered += r.filtered.length
    if (r.total === 0) continue
    console.log(`${botId}: ${r.total} open → keep ${r.kept}, filter ${r.filtered.length}`)
    for (const f of r.filtered) console.log(`   ✗ "${f.question.slice(0, 70)}" — ${f.reason.slice(0, 80)}`)
  }
  console.log(`\n${apply ? 'Marked' : 'Would mark'} ${totalFiltered} false-positive(s) as n_a.`)
}
main().catch(e => { console.error('ERR', e); process.exit(1) })
