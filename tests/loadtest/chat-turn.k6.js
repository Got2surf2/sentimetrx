// k6 load test for public agent chat — simulates N concurrent visitors each
// holding a short conversation with a /b/[slug] widget agent.
//
// IMPORTANT: Run against the TEST project via `npm run dev` (TARGET defaults
// to http://localhost:3000, which dev-mode points at the Sentimetrx-Test
// Supabase project). NEVER point TARGET at production — every chat turn is a
// real DB write and a real Anthropic API call.
//
// 💸 COST WARNING: each chat turn hits Anthropic for real (chatCore can make
// MULTIPLE model calls per turn: reply + signal extraction + guards). At
// default settings (3 VUs x 3 turns) that's ~9 turns per full cycle — cheap
// but not free. Do NOT crank VUS the way you would for survey-submit; this
// script defaults deliberately low. Also note the route's per-IP rate limit:
// 30 chat requests/min (app/api/bots/[id]/chat/route.ts) — all VUs share the
// k6 host IP, so more than ~4-5 VUs at default think times just farms 429s.
//
// Setup:
//   1. brew install k6                        (if not already installed)
//   2. npm run dev                            (serves the TEST project)
//   3. Create/activate an agent and note its public slug (the /b/<slug> URL),
//      e.g. /b/mvp-plus → BOT_SLUG=mvp-plus. Use a throwaway "Load Test"
//      agent so synthetic conversations don't pollute a real agent's data.
//
// Run:
//   BOT_SLUG=<slug> TARGET=http://localhost:3000 \
//     k6 run tests/loadtest/chat-turn.k6.js
//
// Or with overrides:
//   VUS=4 ITERATIONS_PER_VU=2 TURNS_PER_CONVO=4 \
//   BOT_SLUG=... TARGET=... k6 run tests/loadtest/chat-turn.k6.js
//
//   # If slug→id scraping ever breaks, pass the agent UUID directly:
//   BOT_ID=<uuid> TARGET=... k6 run tests/loadtest/chat-turn.k6.js
//
// What each virtual user does (mirrors components/ui/ChatBot.tsx):
//   setup: GET /b/{BOT_SLUG}                  → scrape agent UUID from the
//          page payload (the widget resolves slug→id server-side and POSTs
//          to /api/bots/{id}/chat — the chat route takes the UUID, not slug)
//   1. Loop: POST /api/bots/{id}/chat with { messages: [full history],
//      session_id } — accumulating history exactly like the widget does
//   2. Think time 8-15s between turns
//
// Limits this exercises:
//   - Per-IP 30/min chat cap in app/api/bots/[id]/chat/route.ts (all VUs
//     share the k6 host IP)
//   - Anthropic Tier 4 (measured 2026-07-04): 10K RPM, 10M input TPM, 2M
//     output TPM — not the bottleneck at these VU counts
//   - chatCore turn latency (multi-call orchestration) under concurrency

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'

const BASE = __ENV.TARGET || 'http://localhost:3000'
const SLUG = __ENV.BOT_SLUG
const BOT_ID_OVERRIDE = __ENV.BOT_ID || null
if (!SLUG && !BOT_ID_OVERRIDE) {
  throw new Error('Set BOT_SLUG (public agent slug from /b/<slug>) or BOT_ID (agent UUID)')
}

const VUS   = parseInt(__ENV.VUS || '3', 10)               // deliberately modest — real AI spend
const ITER  = parseInt(__ENV.ITERATIONS_PER_VU || '1', 10) // conversations per VU
const TURNS = parseInt(__ENV.TURNS_PER_CONVO || '3', 10)   // messages per conversation

const rateLimited = new Counter('chat_rate_limited_429')
const chatErrors  = new Counter('chat_non_200')

export const options = {
  scenarios: {
    chat_turn: {
      executor: 'per-vu-iterations',
      vus: VUS,
      iterations: ITER,
      maxDuration: '10m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    // AI turns are slow by nature (multi-call orchestration in chatCore)
    'http_req_duration{name:chat}': ['p(95)<15000'],
  },
}

const SAMPLE_MESSAGES = [
  "Hi! I'm curious what this is all about — can you give me the short version?",
  "What kind of questions can you help me with?",
  "I'm evaluating options for my team. What makes this different?",
  "Can you tell me more about pricing or how to get started?",
  "That's helpful, thanks. One more thing — who do I contact for a demo?",
  "I read something about this online but I'm not sure it applies to us.",
  "How does this handle data privacy?",
  "Interesting. Can you give me a concrete example?",
]

function pickMessage() {
  return SAMPLE_MESSAGES[Math.floor(Math.random() * SAMPLE_MESSAGES.length)]
}

const UUID_RE = /\\?"id\\?"\s*:\s*\\?"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\\?"/i

// Resolve BOT_SLUG → agent UUID once. /b/[slug]/page.tsx looks the agent up
// server-side and serializes { id, name, slug, config } into the page payload
// for BotClient; we pull the first UUID `id` out of that payload. If Next's
// serialization ever changes shape, pass BOT_ID directly instead.
export function setup() {
  if (BOT_ID_OVERRIDE) return { botId: BOT_ID_OVERRIDE }
  const res = http.get(BASE + '/b/' + SLUG, { tags: { name: 'bot_page' } })
  if (res.status !== 200) {
    throw new Error('GET /b/' + SLUG + ' returned ' + res.status + ' — is the agent active and the slug correct?')
  }
  const m = UUID_RE.exec(res.body)
  if (!m) {
    throw new Error('Could not scrape agent UUID from /b/' + SLUG + ' page payload — pass BOT_ID=<uuid> instead')
  }
  return { botId: m[1] }
}

// Origin is harmless here (the chat route is CSRF-bypassed + wildcard CORS,
// and localhost is always in the agent-embed allowlist) but keeps requests
// browser-shaped.
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Origin': BASE }

export default function (data) {
  const botId = data.botId
  // Fresh conversation per iteration — mirrors the widget's localStorage
  // cb_sid_* session id (chatCore gates transcript persistence on session_id).
  const sessionId = 'k6-' + __VU + '-' + __ITER + '-' + Math.random().toString(36).slice(2, 10)
  const messages = []

  for (let i = 0; i < TURNS; i++) {
    messages.push({ role: 'user', content: pickMessage() })

    const res = http.post(
      BASE + '/api/bots/' + botId + '/chat',
      JSON.stringify({
        messages: messages,
        session_id: sessionId,
        user_name: 'LoadTest',
      }),
      { headers: JSON_HEADERS, tags: { name: 'chat' }, timeout: '60s' },
    )

    if (check(res, { 'chat 200': r => r.status === 200 })) {
      const body = res.json()
      messages.push({ role: 'assistant', content: body.reply || '' })
      if (body.ended === true) break
    } else if (res.status === 429) {
      rateLimited.add(1)
      messages.pop() // turn never happened; retry-shaped back-off
      sleep(20)
      continue
    } else {
      chatErrors.add(1)
      break
    }

    // Think time between messages: 8-15s (also keeps 3 VUs well under the
    // 30/min per-IP cap)
    sleep(8 + Math.random() * 7)
  }
}
