// k6 load test for Town Hall chat — simulates N concurrent participants.
//
// Setup:
//   1. brew install k6                        (if not already installed)
//   2. Create a Town Hall session via the UI (/townhall/new) and start it.
//   3. Copy the session UUID or slug.
//
// Run:
//   SESSION_ID=<uuid-or-slug> TARGET=http://localhost:3000 \
//     k6 run tests/loadtest/townhall.k6.js
//
// Or with overrides:
//   VUS=200 ITERATIONS_PER_VU=8 RAMP_UP_S=60 \
//   SESSION_ID=... TARGET=... k6 run tests/loadtest/townhall.k6.js
//
// What each virtual user does:
//   1. POST /api/townhall/join/{sessionId}    → server-issued participant_id
//   2. Loop: POST /api/townhall/chat with a sample message, ~1 every 4s
//   3. POST /api/townhall/responses           → demographics + psychographics
//
// Limits this exercises:
//   - Per-participant 20/min chat cap (each VU ~15/min, comfortable)
//   - Per-IP 600/min backstop (all VUs share the k6 host IP — simulates venue
//     wifi NAT; if you blow this, raise the backstop or rerun with fewer VUs)
//   - Anthropic Tier 4 (account measured 2026-07-04): 10K RPM, 10M input TPM,
//     2M output TPM — no longer the bottleneck; the per-IP backstop above is
//     the binding limit at these VU counts
//
// IMPORTANT: Run against the TEST project via `npm run dev` (dev-mode points
// localhost:3000 at the Sentimetrx-Test Supabase project). Pointing TARGET at
// production hits real DB writes, real Anthropic spend, and real rate limits.
// Use a clearly-named throwaway "Load Test" session and ideally run outside
// business hours.

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'

const BASE = __ENV.TARGET || 'http://localhost:3000'
const SESSION = __ENV.SESSION_ID
if (!SESSION) {
  throw new Error('Set SESSION_ID env var to a Town Hall session UUID or slug')
}

const VUS  = parseInt(__ENV.VUS || '200', 10)
const ITER = parseInt(__ENV.ITERATIONS_PER_VU || '8', 10)
const RAMP = parseInt(__ENV.RAMP_UP_S || '60', 10)
const HOLD = __ENV.HOLD_DURATION || '5m'

const rateLimited = new Counter('chat_rate_limited_429')
const chatErrors  = new Counter('chat_non_200')

export const options = {
  scenarios: {
    townhall: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: RAMP + 's', target: VUS },
        { duration: HOLD, target: VUS },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    'http_req_duration{name:chat}': ['p(95)<6000'],
  },
}

const SAMPLE_MESSAGES = [
  "I think the new policy is great but I'm worried about how it will affect commute times.",
  "Honestly, I haven't had time to think about it much. Day to day stuff is taking priority.",
  "What I really want is more transparency on how decisions get made.",
  "The team has been so supportive lately, I feel really lucky.",
  "I'm not sure — there are good arguments on both sides.",
  "We need to focus on the basics first before we worry about the bigger stuff.",
  "I appreciate the question. My biggest concern is around equity.",
  "Honestly, I just want things to be a bit simpler.",
  "I've been thinking about this a lot. The communication needs to improve.",
  "From what I can see, things are heading in the right direction.",
]

function pickMessage() {
  return SAMPLE_MESSAGES[Math.floor(Math.random() * SAMPLE_MESSAGES.length)]
}

// Origin required: /api/townhall/* is not on proxy.ts's CSRF bypass list, so
// mutating requests with no Origin/Sec-Fetch-Site/Referer are 403'd — k6
// sends none of those by default.
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Origin': BASE }

export default function townHallScenario() {
  // 1. Join — server generates participant_id
  const joinRes = http.post(
    BASE + '/api/townhall/join/' + SESSION,
    JSON.stringify({ language: 'en' }),
    { headers: JSON_HEADERS, tags: { name: 'join' } },
  )
  if (!check(joinRes, { 'join 200': r => r.status === 200 })) {
    return
  }
  const join = joinRes.json()
  const pid = join.participant_id
  // Join resolves slug → UUID; /api/townhall/responses accepts ONLY the
  // UUID (chat happens to resolve slugs too — don't rely on it).
  const sessionId = join.session_id || SESSION
  let turn = join.turn_number || 1
  let themeId = join.theme_id || null
  if (!pid) return

  // Brief pause to mimic reading the welcome message
  sleep(2 + Math.random() * 3)

  // 2. Chat loop
  for (let i = 0; i < ITER; i++) {
    const chatRes = http.post(
      BASE + '/api/townhall/chat',
      JSON.stringify({
        session_id: sessionId,
        participant_id: pid,
        message: pickMessage(),
        turn_number: turn,
        theme_id: themeId,
        language: 'en',
      }),
      { headers: JSON_HEADERS, tags: { name: 'chat' } },
    )

    if (chatRes.status === 200) {
      const c = chatRes.json()
      turn = c.turn_number || (turn + 1)
      themeId = c.theme_id || themeId
      if (c.is_final) break
    } else if (chatRes.status === 429) {
      rateLimited.add(1)
      sleep(5)
    } else {
      chatErrors.add(1)
    }

    // Think time between messages: 3-8s
    sleep(3 + Math.random() * 5)
  }

  // 3. Responses (demographics + psychographics)
  http.post(
    BASE + '/api/townhall/responses',
    JSON.stringify({
      session_id: sessionId,
      participant_id: pid,
      psychographics: { sample_q: 'option_a' },
      demographics: { age_range: '25-34' },
    }),
    { headers: JSON_HEADERS, tags: { name: 'responses' } },
  )
}
