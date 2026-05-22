/* eslint-disable */
// Probe AskAna with common deflection-prone questions and report what she
// answers vs deflects. Heuristics flag a response as a "deflection" if it
//   - is < 200 chars AND contains "flymco.com" or the customer service phone
//   - OR contains the literal phrase "I don't have" / "check the website"
//
// Each probe gets its own fresh session id so they don't poison each other.
//
// Run: node_modules/.bin/tsx scripts/_mco_probe_deflection.ts

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
  'Are there any bookstores at MCO?',
  'Where can I charge my phone or laptop?',
  "I'm in Terminal A. What's good to eat there?",
  'How do I get to lost and found?',
  'Where are the nursing rooms?',
  'Where are the smoking areas?',
  'How early should I arrive for an international flight?',
  'What is Annie\'s Space?',
  'How does the APM train work?',
  'Where do rideshares pick up?',
]

const DEFLECT_RE = /(check\s+(?:the\s+)?(?:website|flymco)|i don't have|please contact|reach (?:out|us) at)/i

function isDeflection(text: string): boolean {
  if (!text) return true
  const hasUrl = /flymco\.com\//.test(text)
  const hasPhone = /407.?825.?3177/.test(text)
  const trigger = DEFLECT_RE.test(text)
  // Short responses that ONLY point to URLs/phones with no specific content
  if (text.length < 250 && (hasUrl || hasPhone) && trigger) return true
  return false
}

async function ask(message: string): Promise<string> {
  const sessionId = 'probe_' + Math.random().toString(36).slice(2, 9) + '_' + Date.now().toString(36)
  try {
    const res = await fetch(BASE + '/api/bots/' + BOT_ID + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: message }],
        session_id: sessionId,
        demo: true,
      }),
    })
    if (!res.ok) return '[HTTP ' + res.status + '] ' + await res.text()
    const data = await res.json()
    return data?.message || data?.reply || data?.text || JSON.stringify(data)
  } catch (e: any) {
    return '[ERR] ' + (e?.message || String(e))
  }
}

async function main() {
  console.log('Probing ' + BASE + ' against bot ' + BOT_ID + '\n')
  let deflections = 0
  for (const q of PROBES) {
    const a = await ask(q)
    const def = isDeflection(a)
    if (def) deflections++
    console.log('Q: ' + q)
    console.log(def ? '   ⚠ DEFLECTION' : '   ✓ answered inline')
    console.log('A: ' + a.replace(/\n/g, ' ').slice(0, 220) + (a.length > 220 ? '…' : ''))
    console.log('   (' + a.length + ' chars)')
    console.log('')
  }
  console.log('Summary: ' + (PROBES.length - deflections) + ' / ' + PROBES.length + ' answered inline')
}
main().catch(e => { console.error(e); process.exit(1) })
