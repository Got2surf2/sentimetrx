/* eslint-disable */
// Quick probe to verify Ana doesn't fabricate live parking / security status
// after the 2026-05-26 guardrails.

import { readFileSync } from 'fs'
import path from 'path'
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

const BOT_ID = '920c571b-5a09-4d3a-a20e-904a417d20b3'
const BASE = process.env.PROBE_BASE_URL || 'https://sentimetrx.ai'

const PROBES = [
  // The exact failure mode the user reported
  'Is Parking Garage C full right now?',
  'How many spots are open in Garage A right now?',
  'What is the wait at the South security checkpoint right now?',
  // These should NOT trigger the new guardrails — bot should answer normally
  'How do parking rates work at MCO?',
  'What is MCO Reserve?',
]

// Flag any response that confidently states a current numeric status
const FABRICATION_RE = /\b(is|are)\s+(currently\s+)?(full|open|closed)\b|\bcurrently\s+has\s+\d+\s+spots?\b|\bthe\s+current\s+wait\s+(is|at)\b/i
// Whitelist phrases that show the bot is correctly punting
const SAFE_RE = /(don'?t have|no live|live data|check the|right pane|live card|defer to|not sure right now)/i

async function ask(message: string): Promise<string> {
  const sessionId = 'probe_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36)
  const res = await fetch(BASE + '/api/bots/' + BOT_ID + '/chat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: message }], session_id: sessionId, demo: true }),
  })
  const data = await res.json()
  return data?.message || data?.reply || data?.text || ''
}

async function main() {
  console.log('Probing ' + BASE + '\n')
  for (const q of PROBES) {
    const a = await ask(q)
    const fab = FABRICATION_RE.test(a) && !SAFE_RE.test(a)
    console.log('Q: ' + q)
    console.log(fab ? '   ✗ FABRICATED LIVE STATUS' : '   ✓ ok')
    console.log('   A: ' + a.replace(/\n/g, ' ').slice(0, 300) + (a.length > 300 ? '…' : ''))
    console.log('')
  }
}
main().catch(e => { console.error(e); process.exit(1) })
