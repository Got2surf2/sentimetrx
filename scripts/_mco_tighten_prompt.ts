/* eslint-disable */
// Tighten AskAna's prompt + guardrails so she stops deflecting to flymco.com
// URLs and the +1-407-825-3177 number when the KB has the answer.
//
// Three edits:
//   1. personality — soften the "if KB silent, point to official source" line
//      to "use KB generously inline; only point to URLs as a supplement"
//   2. system_prompt — rewrite the equivalent RULES bullet to prefer KB
//      answers inline; reserve the phone number for emergencies / off-scope.
//   3. guardrails — add four anti-deflection rules (idempotent: only append
//      if not already present, by exact-text match).
//
// Idempotent: re-running this script is safe — duplicated guardrails are
// skipped, and the personality/system_prompt rewrites match a stable
// marker substring before replacing.
//
// Writes one row to bot_change_log for audit trail.
//
// Run:
//   DRY_RUN=1 node_modules/.bin/tsx scripts/_mco_tighten_prompt.ts
//   node_modules/.bin/tsx scripts/_mco_tighten_prompt.ts

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

const NEW_PERSONALITY_SUFFIX = "Never speculate. Use your knowledge base as the source of truth — and when a user asks about something it covers (a topic, a list, a procedure, a service), share what you know inline. Only point to flymco.com or external sources as a SUPPLEMENT to your direct answer, never as a substitute. Reserve the +1-407-825-3177 Customer Experience number for true emergencies (medical, safety, missing person) and questions that fall outside MCO operations entirely (employment, vendor enquiries)."

const OLD_PERSONALITY_SUFFIX_MARKER = "Never speculate; if the answer isn't in your knowledge base"

const NEW_SYSTEM_RULE = "- Use ONLY facts present in your knowledge base — but use them generously. When the user asks about a topic the KB covers (dining, parking, accessibility, security, ground transport, lost & found, family amenities, customs, the airport app, etc.), give a direct, specific answer inline: name shops by name, name lots by name, describe the process step-by-step. Pointing to flymco.com should be a SUPPLEMENT to your answer (\"for the full list, see…\"), not a substitute for it. Customer Experience (+1-407-825-3177) is reserved for emergencies and questions truly outside MCO operations."

const OLD_SYSTEM_RULE_MARKER = "- Use ONLY facts present in your knowledge base. If a question's answer isn't there"

const NEW_GUARDRAILS = [
  "Prefer KB answers over URL deflection. When asked about a topic the KB covers (shops, restaurants, parking, accessibility, ground transport, lost & found, family amenities, security, customs, MCO Reserve, terminal services), give the specific information inline. Suggesting flymco.com URLs is only appropriate as a 'for more detail, see…' supplement after you have given a direct answer.",
  "If the user mentions a terminal (e.g. 'I'm in Terminal A') while asking about food, shopping, or services, scope your answer to that terminal. Do NOT treat it as a navigation request — name the actual shops, restaurants, or services available at that terminal from your directory.",
  "Do not include the +1-407-825-3177 Customer Experience phone number in every response. It's reserved for true emergencies, safety issues, and questions truly outside MCO operations (employment, vendor enquiries, complaints requiring a human). Routine wayfinding, dining, parking, accessibility, etc. should be answered without it.",
  "When naming specific shops, restaurants, or services, prefer entries from your directory KB over generic suggestions. The directory has 600+ entries grouped by terminal — use them.",
]

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data: bot, error: rErr } = await s.from('bots')
    .select('id, name, personality, system_prompt, guardrails')
    .eq('id', BOT_ID)
    .maybeSingle()
  if (rErr || !bot) { console.error('read failed:', rErr); process.exit(1) }

  console.log('[read] bot ' + bot.id + ' ("' + bot.name + '")')

  // 1. Personality rewrite
  let newPersonality = bot.personality as string
  if (newPersonality && newPersonality.includes(OLD_PERSONALITY_SUFFIX_MARKER)) {
    // Replace from the marker through end-of-string (the original line is the last sentence)
    newPersonality = newPersonality.replace(/Never speculate;[^"]*$/m, '').trim() + ' ' + NEW_PERSONALITY_SUFFIX
    console.log('[personality] rewritten (old suffix removed, new one appended)')
  } else if (newPersonality && newPersonality.includes('Use your knowledge base as the source of truth')) {
    console.log('[personality] already updated — skipping')
  } else {
    console.log('[personality] WARN: old marker not found; appending new line at end')
    newPersonality = (newPersonality || '').trim() + ' ' + NEW_PERSONALITY_SUFFIX
  }

  // 2. System prompt RULES bullet rewrite
  let newSystemPrompt = bot.system_prompt as string
  if (newSystemPrompt && newSystemPrompt.includes(OLD_SYSTEM_RULE_MARKER)) {
    // Replace just the matching bullet
    newSystemPrompt = newSystemPrompt.replace(
      /- Use ONLY facts present in your knowledge base\. If a question's answer isn't there, say so plainly and point to the official channel.*/,
      NEW_SYSTEM_RULE,
    )
    console.log('[system_prompt] rewrote KB-deflection rule')
  } else if (newSystemPrompt && newSystemPrompt.includes('but use them generously')) {
    console.log('[system_prompt] already updated — skipping')
  } else {
    console.log('[system_prompt] WARN: old rule marker not found; no rewrite applied')
  }

  // 3. Guardrails append (dedupe by exact text)
  const existing: string[] = Array.isArray(bot.guardrails) ? bot.guardrails as string[] : []
  const newGuardrails = existing.slice()
  let appended = 0
  for (const g of NEW_GUARDRAILS) {
    if (!newGuardrails.includes(g)) { newGuardrails.push(g); appended++ }
  }
  console.log('[guardrails] ' + existing.length + ' existing + ' + appended + ' new = ' + newGuardrails.length + ' total')

  const changes: Record<string, any> = {}
  if (newPersonality !== bot.personality) changes.personality = { old: (bot.personality as string)?.slice(0, 80) + '…', new: newPersonality.slice(0, 80) + '…' }
  if (newSystemPrompt !== bot.system_prompt) changes.system_prompt_updated = true
  if (appended > 0) changes.guardrails_appended = appended

  if (Object.keys(changes).length === 0) {
    console.log('[done] no changes needed — prompt already tightened.')
    return
  }

  console.log('[changes] summary:', JSON.stringify(changes, null, 2))

  if (DRY_RUN) {
    console.log('\n--- DRY_RUN — new personality (full) ---\n')
    console.log(newPersonality)
    console.log('\n--- new system_prompt (full) ---\n')
    console.log(newSystemPrompt)
    console.log('\n--- new guardrails (count: ' + newGuardrails.length + ') ---\n')
    newGuardrails.forEach((g, i) => console.log((i + 1) + '. ' + g))
    console.log('\n[dry-run] skipping write. Re-run without DRY_RUN=1 to apply.')
    return
  }

  const { error: uErr } = await s.from('bots').update({
    personality: newPersonality,
    system_prompt: newSystemPrompt,
    guardrails: newGuardrails,
  }).eq('id', BOT_ID)
  if (uErr) { console.error('[update] failed:', uErr.message); process.exit(1) }
  console.log('[update] ✓')

  // Audit log
  const { error: lErr } = await s.from('bot_change_log').insert({
    bot_id: BOT_ID,
    change_type: 'prompt_update',
    summary: 'Anti-deflection prompt + guardrails — prefer KB answers inline, reserve 407-825-3177 for emergencies, anti-URL-redirect rule',
    details: changes,
  })
  if (lErr) console.warn('[audit] log insert failed: ' + lErr.message + ' (continuing — main update applied)')
  else console.log('[audit] bot_change_log row written')

  console.log('\n✔ Prompt + guardrails tightened.')
}

main().catch(e => { console.error(e); process.exit(1) })
