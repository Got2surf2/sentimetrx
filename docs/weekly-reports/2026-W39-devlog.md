# 2026-W39 devlog

---

## 2026-09-21 — Signed-in verification of the night's upgrades + two permanent smoke tests

The two earlier entries ended "not verified: signed-in flows (local login
required)". That was wrong about what was possible: the repo's own Playwright
smoke suite mints a throwaway TEST-project login and seeds a dataset, so a
signed-in browser check needs nobody's credentials. Used it:

- The existing four smoke tests pass on the upgraded stack (real `sb-*` auth
  cookie through `@supabase/ssr` 0.12.6 / `supabase-js` 2.116, React 19.2.8).
- A scratch spec (deleted) computed analytics on the seeded dataset and cycled
  all twelve chart types in the real Charts tab on Plotly 4.0.0: nine render
  with their titles, three show their normal "assign fields" empty state (the
  seed has one numeric field and no date), zero console or page errors.
  Statistics tab: distribution renders with both axis titles.

Two of those checks are now permanent in `smoke.spec.ts`: a real chart with
asserted title nodes (the gap that let "no test renders a chart" stand), and
the `lib/hardNavigate` document-load after the first Schema save. Both pass on
the dev server AND against a production build pointed at TEST (the way CI runs
them; 6 passed in 14.6s). The e2e seeder's password had the same
password-policy defect as the env-gated suites and now uses
`tests/helpers/testPassword.ts`.

## 2026-09-21 — Push `21aabd0d` landed; lint ceiling 167 → 166

Six commits pushed; CI green on the exact SHA (all five jobs incl. production
deploy), CodeQL green with **0 open alerts** (#71 auto-closed as fixed),
Dependabot closed PRs 37–42 on its own and its re-run confirms the new ignores
hold (the fresh prod group PR carries neither `isomorphic-dompurify` nor
`puppeteer-core`). The two new e2e smoke tests passed in CI against the
production build (6 passed). The Node 20 action deprecation warning is gone.
CI's lint step reported **166** warnings against the 167 ceiling, so the
ceiling drops to 166 — the ratchet tracks the real count, never slack. The new
Next rule has zero hits. Remaining Dependabot alerts: the two allowlisted
`image-size` advisories (no upstream fix).

## 2026-09-21 — W39 audit: Documentation 9 → 5 explained, ten specs synced, CodeQL now a required check

**Why the score fell.** The W39 report scored Documentation 5/10 on one input:
ten module specs "drifted". The drift tool is mechanical — a commit touched a
file mapped to a spec and did not edit that spec — and the rubric puts ≥4
flagged specs in the 4–5 band. Last week's security work was cross-cutting by
nature (the 189-call `console.*` → `lib/log` migration alone touched files
under eight specs; the CodeQL backlog, the shared resource gate and the import
cycle fix touched the rest), and each commit used `SKIP_SPEC_CHECK` as
"mechanics only" without running the drift tool afterwards — which is the
standing rule for sweep commits. Two of the flagged commits were mine from the
night of 9/20 (`cbc92bc8`, `24549088`).

**It was not all mechanical.** Reading the ten specs against the code found six
with statements the sweep had made FALSE: SOCIAL (two places still said
`console.log` / `console.error`), USAGE_ACCOUNTING (`console.warn`), TOWNHALL
(described `gateSessionAccess` as an inline helper "queued for extraction" —
it was extracted to `lib/auth/gate.ts` on 9/14), BOTS (session ids documented
as `Math.random`, ~30 bits — now WebCrypto via `lib/clientId`), SEARCH (no
mention of the `assertDatasetsBelongToOrg` single-tenant assertion on
collection fan-out), DATA_SOURCES (Substack fetches now go through
`lib/safeFetch`; SSRF guard undocumented). All six corrected. The other four
(CAMPAIGNS, SURVEYS, RECORDINGS, MCO_AGENT) had nothing false; each gained the
one accurate note the touching commits warranted (full-page-load navigation via
`lib/hardNavigate`; WebCrypto session ids).

**CodeQL is a required status check on `main`** as of today (branch
protection: `typecheck + tests`, the isolation job, `CodeQL`) — the recorded
plan once alerts reached 0, which they did after the 9/21 push. SECURITY.md §9
and the workflow header no longer say "not yet".

**Process fix.** Two devlog entries dated 9/21 had been appended to the W38
file; they are moved here (the routine reads the file named for the ISO week
the entries fall in).

## 2026-09-21 — The spec-drift rule becomes a gate (pre-push), because remembering it failed three times

**Why**: the owner asked the right question about the W39 score — "isn't running
the drift tool a standing instruction? If you don't run it, who will?" It is,
and every commit in that range was written by a Claude session, so "nobody ran
it" meant the assistant did not. It was the THIRD miss of the same rule
(2026-07-06, 2026-07-13, week of 2026-09-14), each recorded in memory with a
firmer wording than the last. Firmer wording did not work. Measured, the
bypass had quietly become the default: commits mentioning `SKIP_SPEC_CHECK`
were 4% of all commits in May, 18% in June, 35% in July, 54% in August, 31% so
far in September — and the hook is all-or-nothing, so each bypass dropped
coverage for every spec the commit touched.

**What changed**: `.githooks/pre-push` runs `scripts/spec-drift.ts origin/main
--fail-on-drift` (new flag, exit 2 on drift) on any push to `main` and blocks
while a module spec in the unpushed range has code against it and no edit. The
pre-commit bypass still exists but now prints the specs it leaves OWED instead
of exiting silently. On its first run the gate caught this morning's own two
bypasses — and one of them was real: TESTING.md still gave the lint ceiling as
172 (it is 166). Both paid in this commit. CLAUDE.md, ENGINEERING.md and
TESTING.md describe the gate; the doctrine line is in ENGINEERING.md: a
standing instruction that matters gets a mechanical gate — memory is for
context, not enforcement.
