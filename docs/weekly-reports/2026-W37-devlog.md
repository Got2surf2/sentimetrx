# 2026-W37 devlog

---

## 2026-09-07 — npm audit 8 → 2: the stale-override-pin class recurred (W37 governance item #1)

**Why**: the W37 governance report flagged 4 high npm advisories and prescribed
`npm audit fix`. Verified first: two of the highs (`image-size` via `pptxgenjs`)
are the documented, code-verified acceptance in ENGINEERING.md — the only
"fix" npm offers is a semver-major DOWNGRADE of pptxgenjs that breaks every
deck export. The other two were real and new (September advisories).

**What**: plain `npm audit fix` moved `fast-uri` 3.1.5→3.1.7 and `browserslist`
4.28.2→4.28.9 (9 packages, all patch/minor). That exposed a `qs` root (2
moderate, fixed in 6.16.0) with 7 collateral packages that could NOT move
because our own `overrides` pinned `body-parser` to exactly `1.20.6` — forcing
`express@5` back onto body-parser 1.x whose `qs ~6.15.1` excluded the fix.
Scoped the pin to the major it was meant for (`"body-parser@1": "^1.20.6"`);
express keeps 2.x, `qs` reaches 6.16.0. Result: **8 → 2**, the two remaining
being the documented `image-size` acceptance. `pptxgenjs` untouched (verified in
the lockfile delta). Typecheck clean; 2,199 tests pass incl. the real-pptxgenjs
slide-renderer suite. ENGINEERING.md's npm-audit section carries the dated
follow-up; rule restated there: exact `overrides` pins age into blockers.

## 2026-09-07 — collectionRecompute: pair every service-role lookup with org_id (W37 governance item #3)

**Why**: the W37 report's one code finding that held up — `lib/collectionRecompute.ts`
updated `datasets` by bare `.eq('id', …)` on the service-role client. Verified:
both entry points (compute route, sync cascade) already 404 on an org mismatch
upstream, so this was defense-in-depth, not a live leak — but it is the exact
shape of the six May-2026 CRITICALs, and the parent-collection resolution
(`collection_members → collections`) had the same gap.

**What**: `recomputeCollectionAnalytics`, `refreshCollection`, and
`recomputeParentCollections` now take the RESOURCE's `org_id` (never the
caller's — admins act cross-org) and pair it on the `collections` lookup, which
runs FIRST so nothing per-dataset is read or written for a wrong-org id, and on
the `datasets` update. The three callers pass `dataset.org_id` /
`collection.org_id` they already held. `tests/unit/collectionRecompute.test.ts`
(4 tests) pins it on the real query chains with a recording fake that honors
`org_id` filters — wrong org → null with zero writes; right org → update carries
`org_id`. 43 tests across the touched suites pass; tsc + lint clean.

## 2026-09-07 — Governance routine: the devlog week was off by one (W37 report re-evaluated)

**Why**: the W37 governance report (PR #34) reported "W37 devlog missing" and
built its narrative + every "not mentioned in devlog" correlation from git log.
The devlog existed — `2026-W36-devlog.md`, 77 entries covering exactly the
audited Aug 31–Sep 6 (ISO W36). Root cause is in the remote routine's prompt:
it computes WK with `date +%G-W%V` on Monday morning and calls that "the
just-completed week", but on Monday that is the NEW week. Reports have always
been named by run-week (W36 report = Aug 24–30), so the report names stay; the
devlog lookup was the bug. Two further findings were false for a different
reason: the report recommended `npm audit fix` for advisories ENGINEERING.md
already documents as verified-unreachable (and whose only npm "fix" is a
deck-breaking major downgrade), and called the coverage floors "conservative"
when they are ratcheted ~1pp under measured by design.

**What**: remote routine `trig_016jefXaLhZYTJZi2zzkdtxs` updated — WK (run
week, names the files; unchanged convention) vs COVERED (`date -d yesterday`,
names the devlog + date range); it must `ls` the devlogs and state which it
used. `.claude/commands/audit-codebase.md`: Dependencies now separates
advisory roots from collateral (`via[]` object vs string), honors documented
acceptances, and never recommends a semver-major "fix"; Tests notes the floors
are deliberately ratcheted, so slack needs a measured report. Docs closed from
the drift companion: `USAGE_ACCOUNTING.md` records that `AMERICAN_ENGLISH_RULE`
rides every system prompt (~50 input tokens per call, all providers);
`ENGINEERING.md` gets `/story/[slug]/pdf` in the chromium route mirror plus the
dated deps follow-up. The `CLAUDE.md → ENGINEERING.md` spec-map entry was kept
on purpose: CLAUDE.md is where engineering policy is written first, and the
one false positive this week doesn't outweigh that guard.

## 2026-09-08 — CI red on the lint ratchet: 168 warnings vs ceiling 167 (ContextCloud)

**Why**: the 11-commit push landed red on `lint:ci` while typecheck, tests, RLS
and e2e were green. `7e070186` (CommentsPanel retired) lowered the ceiling 172 →
167 for the 5 warnings that file carried, but `2fea6be3` (Context dimensions →
server-side, same stack) added a `react-hooks/set-state-in-effect` in
`ContextCloud.tsx:91` — `setDimChips(null)` as a synchronous reset at the top of
the fetch effect — so the tree netted −4, one over the ceiling. Neither commit
could see the other's effect locally (`eslint .` OOMs; only CI counts).

**What**: the reset is gone. Dimension chips are now stored tagged with the
subset ids + field key they were fetched for and derived as null on mismatch —
the exact staleness pattern `computed` already uses a few lines up in the same
file — so a new subset/question shows no stale chips mid-fetch and disabling
Dimensions hides them, as before. Ceiling stays 167 (never raised); file lints
at 0; tsc clean; `contextCloud`/`contextConcepts` suites 12/12. Reasoned +
unit-tested, not browser-driven: the change is structural and the tag identity
(`conceptsSync.subsetRowIds` is a stable reference until recompute) is the same
one the effect already keyed on.

## 2026-09-09 — sql/202 applied to prod: Ana's "since you last looked" digest is live

**Why**: the digest shipped in code on 9/08 (`c1d8f8f7` deploy) but degraded to a
digest-less briefing in prod because `dataset_visit_snapshots` didn't exist
there yet. Prod DDL from this network only works through the Management API
(pooler :5432 dead), and the auto-mode classifier blocks Claude from running
prod-credential commands — so the owner ran the script.

**What**: `scripts/_apply_202_prod.mjs` (untracked, cloned from the 194 template
and improved: idempotent pre-check, ledger upsert, RLS verify). Owner-run 04:21
UTC; verified in the same call: table exists, RLS enabled, exactly one
org-scoped SELECT policy, zero write policies, unique (user_id, dataset_id),
`schema_migrations` row recorded as `owner-mgmt-api`. `docs/db/schema.sql`
regenerated from prod (`npm run schema:snapshot`) — diff is the 38 lines of the
new table and nothing else, so prod and the committed snapshot are otherwise
in sync. Gotcha recorded: the dump runs pg_dump in Docker and on a Docker
failure it truncates the snapshot to 0 lines — `git checkout` it back, start
Docker, re-run.

## 2026-09-09 — Deploy gate legibility: "production deploy: success" ≠ deployed

**Why**: after the docs-only `e82e137c` push the checks tab read "production
deploy (after green): success" and I reported a build had happened. It hadn't
— dug in: the job's conclusion is the GATE step's; the "Trigger Vercel
production build" step was `skipped` (`docs-only push → no deploy needed`) on
both docs-only pushes this week, and `vercel ls --prod` confirms the last
production build is `c1d8f8f7` (the code push). The mechanism works; the name
misleads, and a DD reviewer skimming the checks tab would misread it the same
way. The governance routine's prompt also credited the wrong mechanism ("Vercel
Ignored Build Step" — retired for main on 2026-07-04; it now only skips
previews).

**What**: the gate emits a `::notice title=Deploy gate::` annotation in every
branch (TRIGGERED / NO production build, with the reason) so the run summary
says it in words; no behavior change. ENGINEERING.md §deploy-behind-CI gains
the how-to-read-it sentence. Routine prompt updated live to name the CI gate
and to warn that green ≠ built. Memory rule: read the Trigger step, never the
job name.
