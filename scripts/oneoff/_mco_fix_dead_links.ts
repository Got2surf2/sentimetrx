/* eslint-disable */
// Idempotent: rewrite dead flymco.com URLs in AskAna's personality,
// system_prompt, and guardrails to live equivalents. Discovered via
// curl probe — flymco.com/flight-status returns 404; the live URL is
// flymco.com/flights (the flight tracking page).
//
// Re-runnable: if no dead URLs remain, exits as a no-op.
//
// Run:
//   DRY_RUN=1 node_modules/.bin/tsx scripts/_mco_fix_dead_links.ts
//   node_modules/.bin/tsx scripts/_mco_fix_dead_links.ts

import { readFileSync } from 'fs'
import path from 'path'
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}
import { createClient } from '@supabase/supabase-js'

const BOT_ID = '920c571b-5a09-4d3a-a20e-904a417d20b3'
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'

// Each entry: [dead url (regex-escaped substring), replacement live url].
// flymco's actual sitemap.xml lists /flight-status but the page 404s; the
// real flight tracker lives at /flights. Verified via curl 2026-05-27.
const REPLACEMENTS: Array<[string, string]> = [
  ['flymco.com/flight-status', 'flymco.com/flights'],
]

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: bot, error } = await s.from('bots').select('id, personality, system_prompt, guardrails').eq('id', BOT_ID).maybeSingle()
  if (error || !bot) { console.error(error); process.exit(1) }

  const newPersonality = applyReplacements(String(bot.personality || ''))
  const newSystemPrompt = applyReplacements(String(bot.system_prompt || ''))
  const oldGuardrails: string[] = Array.isArray(bot.guardrails) ? bot.guardrails as string[] : []
  const newGuardrails = oldGuardrails.map(applyReplacements)

  const changed = {
    personality: newPersonality !== bot.personality,
    system_prompt: newSystemPrompt !== bot.system_prompt,
    guardrails: JSON.stringify(newGuardrails) !== JSON.stringify(oldGuardrails),
  }
  if (!changed.personality && !changed.system_prompt && !changed.guardrails) {
    console.log('✓ no dead URLs found — no changes.')
    return
  }
  console.log('[changes]', JSON.stringify(changed))
  if (DRY_RUN) { console.log('[dry-run] would update bot row. Re-run without DRY_RUN=1 to apply.'); return }
  const { error: uErr } = await s.from('bots').update({
    personality: newPersonality,
    system_prompt: newSystemPrompt,
    guardrails: newGuardrails,
  }).eq('id', BOT_ID)
  if (uErr) { console.error('[update] failed:', uErr.message); process.exit(1) }
  console.log('✓ updated')
}

function applyReplacements(text: string): string {
  let out = text
  for (const [dead, live] of REPLACEMENTS) {
    out = out.split(dead).join(live)
  }
  return out
}

main().catch(e => { console.error(e); process.exit(1) })
