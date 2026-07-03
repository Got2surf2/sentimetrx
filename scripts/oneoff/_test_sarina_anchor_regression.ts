/* eslint-disable */
// Force module scope so top-level identifiers don't collide with other
// tsx scripts at typecheck time.
export {}

// Synthetic regression test for the Sarina anchor-re-ask bug — incident
// bs_mpdjyxz9_lfem0e on 2026-05-20 where the bot asked the User Type
// anchor at turn 9, the resident answered "resident" at turn 10, and
// then the bot asked the same anchor AGAIN at turn 19 because the
// turn-10 answer had been lost to context compression.
//
// This test walks Sarina through a long feedback-path conversation
// that crosses the 12-message compression threshold and explicitly
// verifies that neither anchor is asked twice.
//
// Run: node_modules/.bin/tsx scripts/_test_sarina_anchor_regression.ts

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'
const BASE = 'https://www.sentimetrx.ai'

// Each user turn is sent, then the bot's reply is scored. Replies are
// scanned for anchor-menu patterns — i.e. the bot offering the menu
// of options to choose from. Both anchors share the same shape: a
// disjunction of 3+ category words in close proximity.

// A1 — User Type: must list at least two of (resident, business owner,
// commuter, other) in proximity. Matches:
//   "resident, business owner, commuter, or other?"
//   "would you describe yourself as a resident, business owner, ..."
// Does NOT match a single mention of "resident" in context like
// "as a resident…" — that's an acknowledgment, not a re-ask.
const A1_ANCHOR_RX = /(resident|business owner|commuter)[\s\S]{0,80}?(business owner|commuter|resident)[\s\S]{0,40}?(commuter|other|resident|business owner)/i

// A2 — Priority Category: must list at least THREE of the priority
// categories in a menu-like sequence, separated by list punctuation.
// Earlier 2-word version had a false positive on travel-mode questions
// like "do you walk, bike, or use transit?" (matched "intersection" +
// "transit") which aren't the priority anchor.
const A2_TERM = '(widening|new roads?|safety|intersections?|ped[\\/\\s\\+]+bike|pedestrian.{0,15}bicycle|transit)'
const A2_ANCHOR_RX = new RegExp(A2_TERM + '[,;\\-\\s]{1,40}' + A2_TERM + '[,;\\-\\s]{1,40}' + A2_TERM, 'i')

interface TurnRecord {
  turn: number
  user: string
  bot: string
  a1AnchorAsked: boolean
  a2AnchorAsked: boolean
}

const USER_SCRIPT = [
  'i live near US 441 and want to share my thoughts',
  'traffic is brutal — especially around the SR 436 intersection',
  'mornings are worst, takes 3-4 light cycles',
  'yes',                                             // accept follow-up
  'resident',                                        // A1 anchor expected first time, user answers
  'i live just east of US 441 near downtown apopka',
  'i drive, mostly to and from work in winter park',
  'the US 441 / SR 436 intersection backs up every morning',
  'widening',                                        // A2 anchor expected first time, user answers
  'no, that covers it',
  'thanks, that was helpful',                        // wrap-up signal
  'ok',                                              // post-close affirmation — risky window for re-ask
  'sounds good',                                     // another post-close affirmation
]

async function main() {
  const sessionId = 'sarina_anchor_regression_' + Math.random().toString(36).slice(2)
  const messages: { role: 'user' | 'assistant'; content: string }[] = []
  const records: TurnRecord[] = []
  let a1FirstAskTurn: number | null = null
  let a2FirstAskTurn: number | null = null
  let a1ReaskTurns: number[] = []
  let a2ReaskTurns: number[] = []

  console.log('Sarina anchor-regression test against ' + BASE)
  console.log('Bot id ' + BOT_ID)
  console.log('Session ' + sessionId + '\n')

  for (let i = 0; i < USER_SCRIPT.length; i++) {
    const userTurn = USER_SCRIPT[i]
    messages.push({ role: 'user', content: userTurn })
    const res = await fetch(BASE + '/api/bots/' + BOT_ID + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, session_id: sessionId, debug: true }),
    })
    if (!res.ok) {
      console.error('HTTP ' + res.status + ' on turn ' + (i + 1))
      process.exit(2)
    }
    const data = await res.json()
    const reply = String(data?.reply || '')
    messages.push({ role: 'assistant', content: reply })

    const a1Asked = A1_ANCHOR_RX.test(reply)
    const a2Asked = A2_ANCHOR_RX.test(reply)

    records.push({ turn: i + 1, user: userTurn, bot: reply, a1AnchorAsked: a1Asked, a2AnchorAsked: a2Asked })

    if (a1Asked) {
      if (a1FirstAskTurn === null) a1FirstAskTurn = i + 1
      else a1ReaskTurns.push(i + 1)
    }
    if (a2Asked) {
      if (a2FirstAskTurn === null) a2FirstAskTurn = i + 1
      else a2ReaskTurns.push(i + 1)
    }

    console.log('T' + (i + 1).toString().padStart(2) + ' user: ' + userTurn)
    const tags = (a1Asked ? '[A1]' : '') + (a2Asked ? '[A2]' : '')
    console.log('     bot' + (tags ? ' ' + tags : '') + ': ' + reply.replace(/\n+/g, ' / ').slice(0, 220))

    // Check for debug context info
    const dbg: string[] = Array.isArray(data?._debug) ? data._debug : []
    const ctxLine = dbg.find(d => /Context: compressed/.test(d))
    if (ctxLine) console.log('     [' + ctxLine + ']')

    await new Promise(r => setTimeout(r, 700))
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('VERDICT')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('User turns:                       ' + USER_SCRIPT.length)
  console.log('A1 (User Type) first asked on:    ' + (a1FirstAskTurn ?? 'never'))
  console.log('A1 re-ask turns:                  ' + (a1ReaskTurns.length === 0 ? 'none ✓' : a1ReaskTurns.join(', ') + ' ✗'))
  console.log('A2 (Priority) first asked on:     ' + (a2FirstAskTurn ?? 'never'))
  console.log('A2 re-ask turns:                  ' + (a2ReaskTurns.length === 0 ? 'none ✓' : a2ReaskTurns.join(', ') + ' ✗'))

  const passed = a1ReaskTurns.length === 0 && a2ReaskTurns.length === 0
  console.log('\n' + (passed ? '✅ PASS — neither anchor was re-asked' : '❌ FAIL — at least one anchor was re-asked'))
  process.exit(passed ? 0 : 1)
}

main().catch(e => { console.error(e); process.exit(2) })
