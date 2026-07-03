/* eslint-disable */
// Force module scope so top-level identifiers (runScenario, main) don't
// collide with sibling tsx scripts that also declare names like `main`.
// Without an export the file is treated as a global script and TS2393s
// on duplicate top-level names across scripts/*.ts and prototype/*.ts.
export {}

// Synthetic CLI test for the Sir O'Gate pilot — three scenarios that
// each test a different probe trigger + the warmth + the no-chain
// discipline. Each scenario runs in a fresh session.
//
// Run: node_modules/.bin/tsx scripts/_test_sirogate_pilot.ts

const BOT_ID = 'e0581028-9a61-4ae3-8b5e-cf1b39ab7a7f'
const BASE = 'https://www.sentimetrx.ai'

interface Scenario {
  id: string
  description: string
  turns: string[]
  expectProbeFiresOnTurn?: number  // assistant turn (1-indexed of assistant replies) where probe should appear
}

const SCENARIOS: Scenario[] = [
  {
    id: 'A',
    description: 'Action-link trigger — voter asks to volunteer; probe should fire BEFORE the link',
    turns: [
      'what are alex\'s priorities?',
      'tell me about cost of living',
      'I want to volunteer',
    ],
    expectProbeFiresOnTurn: 3,
  },
  {
    id: 'B',
    description: 'Wrap-up trigger — voter signals close with "thanks"',
    turns: [
      'what does alex think about insurance reform',
      'and gas prices?',
      'thanks, that\'s helpful',
    ],
    expectProbeFiresOnTurn: 3,
  },
  {
    id: 'C',
    description: 'Turn-6 fallback — voter never signals close, 6 substantive turns',
    turns: [
      'tell me about alex',
      'what are his priorities',
      'and on healthcare?',
      'what about education',
      'how does he feel about florida growth',
      'his views on energy',
    ],
    expectProbeFiresOnTurn: 6,
  },
]

const EMPATHY_OPENERS = /^(yeah|got it|good question|fair|honestly|look|wish|ha[,!.]|sure|absolutely|same|alright|i hear|you'?re right|smart|that'?s|exactly|big one|tough|fair point|of course)/i
const PROBE_RX = /what'?s a concern about (alex|the campaign|him)|heard from (a |your )?(neighbor|family|friend|coworker)/i
const ACTION_LINK_RX = /actblue|alexvindman\.com\/(florida-first|signup|store)|vote\.gov|store\.alexvindman/i

async function runScenario(s: Scenario) {
  const sessionId = 'sirogate_test_' + Math.random().toString(36).slice(2)
  const messages: { role: 'user' | 'assistant'; content: string }[] = []
  const assistantReplies: string[] = []
  let probeFiredOnTurn: number | null = null
  let actionLinkFiredOnTurn: number | null = null

  for (let i = 0; i < s.turns.length; i++) {
    messages.push({ role: 'user', content: s.turns[i] })
    const res = await fetch(BASE + '/api/bots/' + BOT_ID + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, session_id: sessionId, debug: true }),
    })
    if (!res.ok) {
      console.log('  HTTP ' + res.status + ' on turn ' + (i + 1))
      return
    }
    const data = await res.json()
    const reply = String(data?.reply || '')
    messages.push({ role: 'assistant', content: reply })
    assistantReplies.push(reply)
    if (probeFiredOnTurn === null && PROBE_RX.test(reply)) probeFiredOnTurn = i + 1
    if (actionLinkFiredOnTurn === null && ACTION_LINK_RX.test(reply)) actionLinkFiredOnTurn = i + 1
    await new Promise(r => setTimeout(r, 700))
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('SCENARIO ' + s.id + ' — ' + s.description)
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  let warmCount = 0
  for (let i = 0; i < s.turns.length; i++) {
    const userTurn = s.turns[i]
    const reply = assistantReplies[i]
    const warm = EMPATHY_OPENERS.test(reply.trim())
    if (warm) warmCount++
    console.log('\nT' + (i + 1) + ' user: ' + userTurn)
    console.log('  bot' + (warm ? ' ✓warm' : ' ✗no-empathy-beat') + ': ' + reply.replace(/\n/g, ' / ').slice(0, 280))
  }

  console.log('\n--- VERDICT ---')
  console.log('  Empathy beats: ' + warmCount + ' / ' + s.turns.length + ' replies opened with an empathy beat')
  if (s.expectProbeFiresOnTurn) {
    const ok = probeFiredOnTurn === s.expectProbeFiresOnTurn
    console.log('  Probe fired on turn: ' + (probeFiredOnTurn ?? 'NEVER') + ' (expected: ' + s.expectProbeFiresOnTurn + ')  ' + (ok ? '✓' : '✗'))
  } else {
    console.log('  Probe fired on turn: ' + (probeFiredOnTurn ?? 'NEVER'))
  }
  if (actionLinkFiredOnTurn !== null && probeFiredOnTurn !== null) {
    const order = probeFiredOnTurn < actionLinkFiredOnTurn ? '✓ probe BEFORE link' : (probeFiredOnTurn === actionLinkFiredOnTurn ? '⚠ probe SAME turn as link' : '✗ probe AFTER link')
    console.log('  Action link order: probe@T' + probeFiredOnTurn + ', link@T' + actionLinkFiredOnTurn + '  ' + order)
  } else if (actionLinkFiredOnTurn !== null) {
    console.log('  Action link fired T' + actionLinkFiredOnTurn + ' but probe never fired ✗')
  }
}

async function main() {
  console.log('Testing pilot ' + BOT_ID + ' at ' + BASE)
  for (const s of SCENARIOS) await runScenario(s)
}

main().catch(e => { console.error(e); process.exit(1) })
