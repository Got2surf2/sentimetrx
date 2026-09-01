# 2026-W36 devlog

---

## 2026-09-01 — Fix the parseCSV interior-quote-dropping bug (W36 audit item #1)

**Why**: the W36 governance audit's top progression item, live in production
since the ANES load: the upload parser in `UploadClient.tsx` toggled `inQ` on
every `"` and never emitted one, so interior quote marks were silently dropped —
2,796 of 125,897 prod ANES rows had verbatim text mangled. It also split on
newlines BEFORE parsing fields, so a quoted field containing a line break broke
its row apart entirely (a second defect of the same class, found while fixing
the first).

**What**: extracted all upload parsing into `lib/csv.ts` — a single-pass RFC4180
parser (`parseCSVRecords`) that treats `""` as a literal quote and separators
inside quotes as data, plus `parseCSV`, `parseTSV`, `isSurveyMonkeyCSV`, and
`parseSurveyMonkeyCSV` ported onto it. `UploadClient.tsx` now imports from
`lib/csv`. Moving the code into `lib/` also puts it inside the vitest coverage
surface (`lib/**` + `app/api/**`) — part of the W36 plan to raise actual
coverage with tests that matter.

**Verification**: 24 unit tests in `tests/unit/csv.test.ts` (escaped quotes,
embedded newlines/commas, CRLF, BOM, blank lines, SurveyMonkey header merging);
full suite 1,840 green; and the real browser flow against the TEST project — a
CSV with `""` escapes and an embedded newline uploaded via `/analyze/new`,
stored rows read back byte-identical (quotes and newline intact, 3 rows not 4).
The old dead "Check 4" (`dataLike`, computed but never used) in
`isSurveyMonkeyCSV` was dropped in the port.

**Not done here**: re-running the ANES loader to repair the 2,796 mangled prod
rows (the server-side loader already parses correctly; repair is a separate,
owner-timed operation). The campaigns respondent uploader
(`CampaignDetailClient.tsx`) handles `""` correctly but still line-splits first;
the content-guard admin harness uses a naive `split(',')` — both noted, left
untouched.

## 2026-09-01 — chatCore turn tests (4% → 27%) + coverage floor ratchet

**Why**: week plan item #2 from the W36 coverage work. `lib/chatCore.ts` is the
designated only chat engine (docs/CONVERGENCE.md) and sat at 4% statement
coverage — 979 uncovered statements, the single largest untested `lib/` file.
The audit rubric scores Tests on the ENFORCED floor tracking actual coverage,
so every suite that lands also ratchets `vitest.config.ts`.

**What**: `tests/unit/chatCoreTurn.test.ts` — 13 turn-level tests with
`callAI`/embeddings/usage mocked and a permissive Proxy-based fake service
client (documented in TESTING.md as the harness to extend). Covers the
silence-probe fast path exhaustively, the org AI-off gate, byo-anthropic key
propagation, the standard 1200-char input cap, and turn persistence numbering
(plain T0/T1 and askName+greeting T0–T4). chatCore statements 4% → 26.9%.

**Ratchet**: overall coverage measured 32.16 st / 25.41 br / 35.17 fn /
32.78 ln (was 31.41/24.64/34.69/31.95 before today's two suites); floors raised
30/23/33/30 → **31/24/34/31**, staying ~1pp under actual so environment
variance can't redden CI while regressions still trip it.

## 2026-09-01 — Aux route org-scoping gates (7 untested routes)

**Why**: week plan item #3, and the W36 audit's route-auth finding ("132
routes without auth references… no systematic audit of unauthenticated routes
was done"). Route-handler org filters are not covered by RLS tests (CLAUDE.md
invariant), and these seven handlers — including `filter-options`, shipped
only last week with sql/194 — had zero route tests.

**What**: `tests/integration/dataset-bot-aux-routes-gate.test.ts` — 26 tests
in the established gate pattern (401 / cross-org 404-or-403 / admin bypass +
one cheap post-gate status proving the gate passed) over datasets
search·filter-options·taxonomy-rows and bots crawl-job·batches·workbook·probes.
The batches listing additionally asserts the service-role `question_batches`
read stays paired with the agent's org. All gates already held — no defects
found, now locked in. Lines floor 31 → 32 (actual 33.23).

## 2026-09-01 — Internal deck generators out of the coverage surface

**Why**: owner decision — no standalone deck ever reaches a client; they are
internal consumption only, and their generation code "should not be subject to
the audit rules." (A repo split was considered and rejected: the deck routes
read live app data through the app's DB clients, so they can't run outside
the repo; the coverage `include` is the audit-facing boundary we control.)

**What**: `vitest.config.ts` coverage `exclude` now drops every top-level
`app/api/*-deck/**` route (22 of them) and the 11 `lib/pptx` builders only
those routes import. The rule is structural (documented in TESTING.md
"Coverage surface" + the audit rubric's Category 5) so future decks inherit
it without name-by-name judgment. Customer-facing PPTX stays in scope:
shared/slideRenderer/styles, the dataset-scoped deck routes, and the
dataset/agent/recording/collection export builders. Denominator 44,205 →
39,538 statements; measured 33.76 st / 25.82 br / 35.85 fn / 34.69 ln;
floors ratcheted **31/24/34/32 → 32/25/35/33**. Noticed in passing:
`lib/pptx/diligenceDeck.ts` is imported by nothing (pre-existing dead code,
left in place).

**Follow-up (same day, owner: "delete it")**: `lib/pptx/diligenceDeck.ts`
removed. It was runtime-dead but not source-dead — `operationalReviewDeck.ts`
imported its `DiligenceOpts` type, so the 6-line interface moved there (the
operational deck already carried the copied slide logic; its header notes the
origin). Coverage exclude entry dropped; fresh-cache `tsc` + full suite green.

## 2026-09-01 — chatCore RAG / super / town-hall scenarios (27% → 34%)

**Why**: continue week plan item #2 — the RAG injection block, the super
tool-loop stream path, and the town-hall entry were the biggest untested
branches left in the engine after the morning suite.

**What**: 8 more tests on the same harness (now with an `rpc` handler + call
recorder on the fake service): confidence bands (>85% answer-only framing /
mid honest-answer / <5% skip), negative-only → deflect instruction, semantic
RPC failure → keyword fallback with rank→confidence normalization (the D1
KB-suppression regression), contrast_mode opponent injection, super capability
(multi-query rewrite hits retrieval twice, stream path with 1200-token knob,
`chat_super` + `query_rewrite` usage rows, never plain `chat`), and a
town-hall turn with no topics (facilitation skips; the mirror is awaited with
the townHallId). chatCore 26.9% → 34.2% statements / 38.3% lines. Overall
33.95/26.05/36.05/34.90; floors → **33/25/35/34**.
