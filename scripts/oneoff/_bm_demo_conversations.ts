/* eslint-disable */
// Drive a handful of realistic demo conversations through the LIVE PROD Blue
// Mountains agent, so there are genuine, shareable conversations for prospects
// (and a real transcript for the deck's sample-conversation slide). Each persona
// mirrors a real Blue Mountains interest. Uses the public chat API + a stable
// session_id per persona so the turns persist (bot_conversation_turns).
//
// Run: node --conditions=react-server --import tsx scripts/oneoff/_bm_demo_conversations.ts
// Prints each transcript; writes them to the path in argv[2] if given.

import { writeFileSync } from 'fs'

const BASE = 'https://www.sentimetrx.ai'
const AGENT_ID = '5845cdb8-f33e-4a2e-9500-5ed0b37e471c' // prod Blue Mountains agent
const CHAT = `${BASE}/api/bots/${AGENT_ID}/chat`

type Msg = { role: 'user' | 'assistant'; content: string }

// Each persona = an ordered list of user turns. The assistant replies are fetched
// live and threaded back in, so it's a real multi-turn conversation.
const PERSONAS: { key: string; label: string; turns: string[] }[] = [
  { key: 'rancher', label: 'Grazing permittee (rancher)', turns: [
    'How does the proposed action affect grazing?',
    'I run cattle on a Wallowa-Whitman allotment and I\'m worried the new plan cuts my access. What can I do?',
    'Okay — help me put that into a comment that actually counts.',
  ] },
  { key: 'conservationist', label: 'Conservation-minded resident', turns: [
    'What is the 21-inch rule and does the proposed action change it?',
    'That worries me — I care about old-growth and wildlife habitat. Which alternative protects large trees the most?',
    'How do I make that concern part of the record so the Forest Service has to respond?',
  ] },
  { key: 'hunter', label: 'Hunter / recreationist', turns: [
    'Will this plan close roads I use to get into the backcountry to hunt?',
    'I mostly care about keeping motorized access open in the Malheur. Is that on the table?',
    'When\'s the deadline to weigh in?',
  ] },
  { key: 'timber', label: 'Local resident (jobs / timber)', turns: [
    'Is it true logging could triple under the plan?',
    'Our town depends on the mill — more harvest would help. Which alternative supports that, and how do I say I support it?',
  ] },
]

async function chat(sessionId: string, messages: Msg[]): Promise<string> {
  const res = await fetch(CHAT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, messages }),
  })
  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  // Strip the trailing dynamic-chips marker for a clean transcript.
  return String(data.reply || '').replace(/\n*\[\[chips:[^\]]*\]\]\s*$/i, '').trim()
}

async function main() {
  const out: string[] = []
  for (const p of PERSONAS) {
    const sid = `demo-${p.key}-2026-07`
    const messages: Msg[] = []
    out.push(`\n${'='.repeat(70)}\n${p.label}   (session ${sid})\n${'='.repeat(70)}`)
    console.log(out[out.length - 1])
    for (const userTurn of p.turns) {
      messages.push({ role: 'user', content: userTurn })
      const reply = await chat(sid, messages)
      messages.push({ role: 'assistant', content: reply })
      const block = `\nUSER: ${userTurn}\n\nAGENT: ${reply}`
      out.push(block)
      console.log(block)
    }
  }
  if (process.argv[2]) { writeFileSync(process.argv[2], out.join('\n')); console.log(`\n\nwrote transcript → ${process.argv[2]}`) }
}

main().catch(e => { console.error(e); process.exit(1) })
