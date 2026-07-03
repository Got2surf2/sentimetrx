/* eslint-disable */
// Probe Hope (Foundations Project agent) end-to-end against the live bot.
// Tests:
//   - basic KB grounding (campaign overview, programs, naming, stories)
//   - intent detection (donate / volunteer / more-info)
//   - site-context bias: same question with site=foundations vs site=coalition
//
// Each probe uses its own session id. Reports whether each answer included
// expected anchors (specific dollar figures, contact info, story names).
//
// Run: node_modules/.bin/tsx scripts/_hope_probe.ts

import { readFileSync } from 'fs'
import path from 'path'
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

const BOT_ID = '553f4e7d-3189-4a9f-b943-7830ce76eef0'
const BASE = process.env.PROBE_BASE_URL || 'https://sentimetrx.com'

type Probe = { q: string; expect: RegExp[]; site?: 'foundations' | 'coalition' }

const PROBES: Probe[] = [
  // Campaign overview
  { q: 'What is the Foundations Project?', expect: [/capital/i, /coalition/i, /(women|families)/i] },
  { q: 'What buildings are you constructing?', expect: [/Center for Women/i, /Pathways Administration/i] },
  // Capacity / impact
  { q: 'How many more people will you serve once the project is done?', expect: [/1,?160|40[-–]50%|800/i] },
  { q: 'Tell me about the bridge housing component', expect: [/bridge/i, /96 beds|home-like|lease/i] },
  // Naming
  { q: 'How much does it cost to name the dining room?', expect: [/\$?1[,.]?250/i] },
  { q: 'What naming opportunities are still available?', expect: [/(dining|childcare|intake|day services|outdoor)/i] },
  // Stories
  { q: 'Can you share a story about a mother who came through the Coalition?', expect: [/(Della|Anna|Hilda|Madison|Anglie|mother)/i] },
  // Intent: donate
  { q: 'I want to donate. How do I give?', expect: [/(donorperfect|donate|portal|leon|brad)/i] },
  // Intent: volunteer
  { q: 'How can I volunteer with my company on a group day?', expect: [/(take-action|volunteer|Coalition)/i] },
  // Intent: more info
  { q: 'Can someone follow up with me about a major gift?', expect: [/(Brad|Leon|Butterstein|Kirkpatrick|407)/i] },
  // Site bias — same question, two sites
  { q: 'What programs do you run?', site: 'foundations', expect: [/(capital|center|building|pathways)/i] },
  { q: 'What programs do you run?', site: 'coalition', expect: [/(shelter|kitchen|day services|drop-in|guest)/i] },
]

async function ask(message: string, site?: string): Promise<string> {
  const sessionId = 'hope_probe_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36)
  try {
    const body: any = {
      messages: [{ role: 'user', content: message }],
      session_id: sessionId,
      demo: true,
    }
    if (site) body.site = site
    const res = await fetch(BASE + '/api/bots/' + BOT_ID + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) return '[HTTP ' + res.status + '] ' + await res.text()
    const data = await res.json()
    return data?.reply || data?.message || data?.text || JSON.stringify(data)
  } catch (e: any) {
    return '[ERR] ' + (e?.message || String(e))
  }
}

async function main() {
  console.log('Probing ' + BASE + ' against Hope (bot ' + BOT_ID + ')\n')
  let pass = 0
  for (const p of PROBES) {
    const a = await ask(p.q, p.site)
    const matched = p.expect.every(re => re.test(a))
    if (matched) pass++
    console.log('Q' + (p.site ? ' [' + p.site + ']' : '') + ': ' + p.q)
    console.log(matched ? '   ✓ matched all expectations' : '   ⚠ missing some anchors')
    console.log('A: ' + a.replace(/\n/g, ' ').slice(0, 320) + (a.length > 320 ? '…' : ''))
    console.log('   (' + a.length + ' chars; expected ' + p.expect.map(r => r.source).join(', ') + ')')
    console.log('')
  }
  console.log('Summary: ' + pass + ' / ' + PROBES.length + ' fully matched expectations')
}
main().catch(e => { console.error(e); process.exit(1) })
