/* eslint-disable */
// Idempotent rebrand of the MCO agent (920c571b-…) to align with the
// "MCO Concierge" framing the user wants for the demo:
//
//   - bot.name:                 "AskAna" → "MCO Concierge"
//   - bot.config.name:          "Avia"   → "Ana"           (used by /b/<slug> widget header)
//   - bot.config.initialMessage rewritten to "Hi, I'm Ana, the MCO Concierge…"
//   - bot.personality opening rewritten to "You are Ana, the MCO Concierge"
//
// Why: Originally we minted "AskAna" as a separate brand. User flagged
// that as flak risk — invented branding for someone else's airport. The
// safe move is to keep "Ana" as her name and use "MCO Concierge" as her
// role, so she's clearly identified as MCO's helper rather than as a
// rival third-party brand.
//
// Re-runnable: if the values already match the target, exits as a no-op.
//
// Run:
//   DRY_RUN=1 node_modules/.bin/tsx scripts/_mco_rebrand_to_concierge.ts
//   node_modules/.bin/tsx scripts/_mco_rebrand_to_concierge.ts

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

const NEW_NAME = 'MCO Concierge'
const NEW_CONFIG_NAME = 'Ana'
const NEW_INITIAL_MESSAGE = "Hi, I'm Ana, the MCO Concierge — your guide to Orlando International Airport. Ask me about parking, terminals, security, ground transportation, accessibility, or anything else about flying through MCO."
const NEW_PERSONALITY_OPENING = "You are Ana, the MCO Concierge — the digital concierge for Orlando International Airport. You always introduce yourself as \"Ana, the MCO Concierge\" or just \"Ana\" in continued conversation; never as \"AskAna,\" \"Avia,\" or \"the assistant.\" You speak the way an experienced airport guest-services agent would: warm, plain-spoken, and always practical."
const OLD_PERSONALITY_OPENING_PATTERN = /^You are AskAna[^.]*\. You always refer to yourself as Ana[^.]*\. You speak the way an experienced airport guest-services agent would: warm, plain-spoken, and always practical\./

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: bot, error } = await s.from('bots').select('id, name, personality, config').eq('id', BOT_ID).maybeSingle()
  if (error || !bot) { console.error(error); process.exit(1) }

  const oldName = bot.name as string
  const oldCfg = (bot.config || {}) as Record<string, any>
  const oldPersonality = String(bot.personality || '')

  const changes: Record<string, any> = {}

  // bot.name
  let newName = oldName
  if (oldName !== NEW_NAME) {
    newName = NEW_NAME
    changes.name = { old: oldName, new: newName }
  }

  // bot.config.name + initialMessage
  const newCfg = { ...oldCfg }
  if (oldCfg.name !== NEW_CONFIG_NAME) { newCfg.name = NEW_CONFIG_NAME; changes.config_name = { old: oldCfg.name, new: NEW_CONFIG_NAME } }
  if (oldCfg.initialMessage !== NEW_INITIAL_MESSAGE) {
    newCfg.initialMessage = NEW_INITIAL_MESSAGE
    changes.config_initialMessage = { old: (oldCfg.initialMessage || '').slice(0, 60) + '…', new: NEW_INITIAL_MESSAGE.slice(0, 60) + '…' }
  }

  // personality — rewrite the opening sentence(s) that reference AskAna.
  let newPersonality = oldPersonality
  if (oldPersonality.startsWith('You are Ana, the MCO Concierge')) {
    // already rebranded — no change
  } else if (OLD_PERSONALITY_OPENING_PATTERN.test(oldPersonality)) {
    newPersonality = oldPersonality.replace(OLD_PERSONALITY_OPENING_PATTERN, NEW_PERSONALITY_OPENING)
    changes.personality = 'rewrote opening'
  } else if (oldPersonality.includes('AskAna')) {
    // Fallback: blanket replace AskAna mentions
    newPersonality = oldPersonality.split('AskAna').join('Ana, the MCO Concierge')
    changes.personality = 'replaced AskAna mentions'
  }

  if (Object.keys(changes).length === 0) {
    console.log('✓ no changes needed — already on the new brand.')
    return
  }
  console.log('[changes]', JSON.stringify(changes, null, 2))
  if (DRY_RUN) { console.log('[dry-run] would update bot row. Re-run without DRY_RUN=1 to apply.'); return }

  const { error: uErr } = await s.from('bots').update({
    name: newName,
    personality: newPersonality,
    config: newCfg,
  }).eq('id', BOT_ID)
  if (uErr) { console.error('[update] failed:', uErr.message); process.exit(1) }
  console.log('✓ updated bot row')
}
main().catch(e => { console.error(e); process.exit(1) })
