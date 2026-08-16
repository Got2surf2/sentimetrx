// k6 load test for the TextMine bulk rows fetch — the heaviest read endpoint
// in the app. Each request makes the server page an entire dataset out of
// dataset_rows_flat (reservoir-sampled to 50K rows max) and JSON-serialize
// it, exactly like RowsContext does when an admin opens a TextMine module.
//
// IMPORTANT: Run against the TEST project via `npm run dev` (TARGET defaults
// to http://localhost:3000, which dev-mode points at the Sentimetrx-Test
// Supabase project). NEVER point TARGET at production — a handful of VUs
// hammering a 50K-row bulk fetch is exactly the kind of load that starves
// real users.
//
// This is an AUTHENTICATED admin surface (cookie-authed Supabase session; the
// route 401s without one). Real-world concurrency is single-digit admins, so
// keep VUS low — the point is payload-size + latency under light concurrent
// fan-out, not throughput.
//
// Setup:
//   1. brew install k6                        (if not already installed)
//   2. npm run dev                            (serves the TEST project)
//   3. Log in at http://localhost:3000 in a browser with an account that can
//      see the dataset.
//   4. Grab the auth cookie from that session: DevTools → Network tab →
//      click any /api/ request → Request Headers → copy the ENTIRE `cookie:`
//      header value. (Copy the whole header, not just one cookie — Supabase
//      splits large JWTs into chunked sb-<project-ref>-auth-token.0 / .1
//      cookies and the server needs all of them.) Export it:
//        export SUPABASE_AUTH='sb-xxxx-auth-token.0=...; sb-xxxx-auth-token.1=...'
//      The cookie expires with the session — re-copy if you start seeing 401s.
//   5. Copy the dataset UUID from the /analyze/<id> URL.
//
// Run:
//   DATASET_ID=<uuid> SUPABASE_AUTH='<cookie header value>' \
//   TARGET=http://localhost:3000 k6 run tests/loadtest/rows-fetch.k6.js
//
// Or with overrides:
//   VUS=4 DURATION=3m SAMPLE_MAX=50000 \
//   DATASET_ID=... SUPABASE_AUTH=... TARGET=... k6 run tests/loadtest/rows-fetch.k6.js
//
// What each virtual user does (mirrors components/analyze/RowsContext.tsx):
//   Loop: GET /api/datasets/{id}/rows?all=true&withRowIds=true&sampleMax=50000
//         → measure latency + payload size, 5-10s between fetches
//
// Limits this exercises:
//   - BULK_ROWS_HARD_CAP (50K) reservoir sampling in
//     app/api/datasets/[datasetId]/rows/route.ts
//   - The route's maxDuration = 30s serverless budget
//   - JSON serialization + transfer of a multi-MB response under concurrency

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Trend } from 'k6/metrics'

const BASE = __ENV.TARGET || 'http://localhost:3000'
const DATASET = __ENV.DATASET_ID
if (!DATASET) {
  throw new Error('Set DATASET_ID env var to a dataset UUID (from the /analyze/<id> URL)')
}
const AUTH_COOKIE = __ENV.SUPABASE_AUTH
if (!AUTH_COOKIE) {
  throw new Error('Set SUPABASE_AUTH to the Cookie header of a logged-in browser session (see header comment)')
}

const VUS        = parseInt(__ENV.VUS || '3', 10)   // heavy fan-out endpoint; admin concurrency is single-digit
const DURATION   = __ENV.DURATION || '2m'
const SAMPLE_MAX = parseInt(__ENV.SAMPLE_MAX || '50000', 10)

const fetchErrors  = new Counter('rows_fetch_non_200')
const unauthorized = new Counter('rows_fetch_401_403')
const payloadKb    = new Trend('rows_payload_kb')
const rowsReturned = new Trend('rows_returned')

export const options = {
  scenarios: {
    rows_fetch: {
      executor: 'constant-vus',
      vus: VUS,
      duration: DURATION,
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // Server budget is maxDuration=30s; a healthy 50K fetch should land well
    // inside it even under concurrent fan-out
    'http_req_duration{name:rows}': ['p(95)<25000'],
  },
}

const URL = BASE + '/api/datasets/' + DATASET +
  '/rows?all=true&withRowIds=true&sampleMax=' + SAMPLE_MAX

export default function rowsFetchScenario() {
  const res = http.get(URL, {
    headers: { 'Cookie': AUTH_COOKIE },
    tags: { name: 'rows' },
    timeout: '60s',
  })

  const ok = check(res, {
    'rows 200': r => r.status === 200,
    'has rows array': r => {
      if (r.status !== 200) return false
      try { return Array.isArray(r.json('rows')) } catch { return false }
    },
  })

  if (ok) {
    payloadKb.add(res.body.length / 1024)
    const rows = res.json('rows')
    rowsReturned.add(rows.length)
  } else if (res.status === 401 || res.status === 403) {
    unauthorized.add(1) // expired/wrong cookie — re-copy SUPABASE_AUTH
  } else {
    fetchErrors.add(1)
  }

  // Space out fetches — a real admin reopens a module occasionally, not in a
  // tight loop
  sleep(5 + Math.random() * 5)
}
