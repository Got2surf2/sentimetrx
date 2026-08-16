// k6 load test for survey response ingestion — simulates N concurrent
// respondents loading a public /s/[guid] survey and submitting answers.
//
// IMPORTANT: Run against the TEST project via `npm run dev` (TARGET defaults
// to http://localhost:3000, which dev-mode points at the Sentimetrx-Test
// Supabase project). NEVER point TARGET at production — every submit is a
// real `responses` row on a real study.
//
// No AI cost: /api/respond is pure parse → validate → upsert (plus optional
// contentGuard flagging, which is regex/heuristic, not an LLM call), so this
// script can push far higher VUS than chat-turn/townhall.
//
// Setup:
//   1. brew install k6                        (if not already installed)
//   2. npm run dev                            (serves the TEST project)
//   3. Create a survey, set it ACTIVE, and copy its public GUID from the
//      /s/<guid> share link. Use a throwaway "Load Test" study.
//   4. The study must ALLOW multiple responses (config.allowMultipleResponses
//      not false — that's the default). All VUs share the k6 host IP, and the
//      device-limit check dedups final submits by ip_hash — a locked-down
//      study would 409 everything after the first submit. Each VU also sends
//      a unique deviceFingerprint + session_id so fp-hash dedup and the
//      session upsert can't collapse submissions either.
//
// Run:
//   SURVEY_GUID=<guid> TARGET=http://localhost:3000 \
//     k6 run tests/loadtest/survey-submit.k6.js
//
// Or with overrides:
//   VUS=25 ITERATIONS_PER_VU=4 RAMP_UP_S=30 HOLD_DURATION=3m \
//   SURVEY_GUID=... TARGET=... k6 run tests/loadtest/survey-submit.k6.js
//
// What each virtual user does (mirrors components/survey/SurveyWidget.tsx):
//   1. GET  /s/{guid}          → survey page render (SSR study lookup)
//   2. POST /api/respond       → partial save   (status='incomplete')
//   3. POST /api/respond       → final submit   (status='complete', same
//                                session_id → upserts the partial row)
//
// Limits this exercises:
//   - Per-IP 120 requests/min rate limit in app/api/respond/route.ts — ALL
//     VUs share the k6 host IP. Defaults (25 VUs x 2 POSTs per ~30s
//     iteration ≈ 100 POSTs/min) sit just under it; crank VUS past ~30 and
//     you're load-testing the 429 path, which also trips the rate==0
//     threshold below by design.
//   - proxy.ts CSRF guard: /api/respond is NOT on the bypass list, so every
//     POST here carries an Origin header matching TARGET (k6 sends no
//     Origin/Sec-Fetch-Site/Referer by default and would be 403'd).

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter } from 'k6/metrics'

const BASE = __ENV.TARGET || 'http://localhost:3000'
const GUID = __ENV.SURVEY_GUID
if (!GUID) {
  throw new Error('Set SURVEY_GUID env var to an active study GUID (the /s/<guid> link)')
}

const VUS  = parseInt(__ENV.VUS || '25', 10)
const ITER = parseInt(__ENV.ITERATIONS_PER_VU || '4', 10)
const RAMP = parseInt(__ENV.RAMP_UP_S || '30', 10)
const HOLD = __ENV.HOLD_DURATION || '3m'

const rateLimited   = new Counter('respond_rate_limited_429')
const dedupRejected = new Counter('respond_already_completed_409')
const submitErrors  = new Counter('respond_non_200')

export const options = {
  scenarios: {
    survey_submit: {
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
    // Ingestion must be error-free: any non-2xx/3xx (429s, 409 dedup, 5xx)
    // fails the run.
    http_req_failed: ['rate==0'],
    'http_req_duration{name:respond}': ['p(95)<2000'],
    'http_req_duration{name:survey_page}': ['p(95)<3000'],
  },
}

// ── Varied plausible answers ────────────────────────────────────────────────
// Base fragments get shuffled + suffixed per submission so no two payloads
// are identical (keeps any content-hash or exact-dup logic from collapsing
// them, and produces realistic spread in the analysis modules).

const Q_FRAGMENTS = [
  'The staff were friendly and the process was quick.',
  'Wait times were longer than I expected.',
  'Everything was clearly explained and easy to follow.',
  'The signage was confusing near the entrance.',
  'I appreciated the follow-up communication.',
  'Parking was a hassle but the visit itself went smoothly.',
  'The online booking saved me a lot of time.',
  'One team member went out of their way to help me.',
  'It would help to have more seating in the waiting area.',
  'Honestly, no complaints — it just worked.',
  'The check-in kiosk was down so we had to queue twice.',
  'Great experience overall, would recommend to a friend.',
]

const SUFFIX_WORDS = ['Overall pretty good.', 'Could be better.', 'Just my two cents.', 'Hope that helps.', 'Thanks for asking.', '']

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)] }

function openAnswer() {
  // 1-2 fragments + a varying suffix + a unique tail so dedup logic can
  // never see two identical strings
  let s = pick(Q_FRAGMENTS)
  if (Math.random() < 0.4) s += ' ' + pick(Q_FRAGMENTS)
  const suffix = pick(SUFFIX_WORDS)
  if (suffix) s += ' ' + suffix
  return s + ' (ref ' + Math.random().toString(36).slice(2, 7) + ')'
}

function sentimentFor(score) {
  return score >= 4 ? 'positive' : score >= 3 ? 'neutral' : 'negative'
}

// Origin required: /api/respond is a cookie-less public POST but proxy.ts
// still runs its CSRF same-origin check on it (not on the bypass list).
const JSON_HEADERS = { 'Content-Type': 'application/json', 'Origin': BASE }

export default function surveySubmitScenario() {
  // 1. Load the survey page (SSR study lookup — what a real respondent does)
  const pageRes = http.get(BASE + '/s/' + GUID, { tags: { name: 'survey_page' } })
  if (!check(pageRes, { 'survey page 200': r => r.status === 200 })) {
    return
  }

  // Reading/answering time before anything is saved: 3-8s
  sleep(3 + Math.random() * 5)

  const sessionId   = 'k6-' + __VU + '-' + __ITER + '-' + Math.random().toString(36).slice(2, 10)
  const fingerprint = 'k6-fp-' + __VU + '-' + __ITER + '-' + Math.random().toString(36).slice(2, 12)
  const npsScore    = 1 + Math.floor(Math.random() * 5)   // 1-5 scale
  const expScore    = 1 + Math.floor(Math.random() * 5)   // 1-5 scale

  const payload = {
    agent: 'k6-loadtest',
    timestamp: new Date().toISOString(),
    npsRecommend:     { score: npsScore, label: String(npsScore) },
    experienceRating: { score: expScore, label: String(expScore), sentiment: sentimentFor(expScore) },
    openEnded: { q1: openAnswer(), q2: openAnswer(), q3: openAnswer(), q4: openAnswer() },
    psychographics: { decision_style: pick(['planner', 'spontaneous', 'researcher']) },
    demographics:   { age_range: pick(['18-24', '25-34', '35-44', '45-54', '55+']) },
    deviceFingerprint: fingerprint,
  }

  function post(status, tagName) {
    const res = http.post(
      BASE + '/api/respond',
      JSON.stringify({
        study_guid: GUID,
        payload: payload,
        duration_sec: 60 + Math.floor(Math.random() * 240),
        session_id: sessionId,
        status: status,
      }),
      { headers: JSON_HEADERS, tags: { name: 'respond', step: tagName } },
    )
    if (res.status === 429)      rateLimited.add(1)
    else if (res.status === 409) dedupRejected.add(1)
    else if (res.status !== 200) submitErrors.add(1)
    return res
  }

  // 2. Partial save mid-survey (the widget saves after each question; one
  //    partial is enough to exercise the upsert-by-session_id path)
  post('incomplete', 'partial')

  // Finishing the remaining questions: 8-15s
  sleep(8 + Math.random() * 7)

  // 3. Final submit — same session_id upserts the partial row to complete
  const finalRes = post('complete', 'final')
  check(finalRes, { 'final submit 200': r => r.status === 200 })

  // Pace iterations so total POST volume stays under the 120/min per-IP cap
  sleep(10 + Math.random() * 8)
}
