# 2026-W31 devlog (Jul 27 – Aug 2)

Brief WHY entries for meaningful commits/ops this week. The Monday governance routine reads this.

## chatCore: pair `org_id` on the `last_session_at` update (Jul 27)

WHY: W31 governance (PR #26) carried this MEDIUM forward from W29/W30 — `lib/chatCore.ts:1857` did `service.from('agents').update({ last_session_at }).eq('id', bot.id)` with no `org_id` pair, violating the CLAUDE.md multi-tenancy invariant ("service-role queries must pair id with org_id"). Not reachable cross-tenant in practice (`bot` is loaded after auth gating, so `bot.id` is already org-verified), but the invariant is a class-level safety net and this was the last bare-id **write** in chatCore. `bot.org_id` was already in scope one line above (the `logUsage` call). tsc clean, 1576 tests green.

## Ops: `npm audit fix` evaluated and REJECTED — does not fix the W31 CVEs, and inflates the audit surface (Jul 27, no commit)

WHY: W31 governance lists 4 high CVEs and prescribes `npm audit fix` as a 5-minute fix. Ran it; it is **not** a fix. Two findings, both verified rather than assumed:

1. **The headline Next.js CVEs are not currently fixable.** `npm audit fix` bumps next 16.2.10 → 16.2.12 and reports success, but the advisory range is `14.3.0-canary.0 – 16.3.0-preview.7` — **16.2.12 is still inside it**, and 16.2.12 *is* `latest` on npm. The only builds past the range are `preview` (16.3.0-preview.9) and `canary`. So there is no released version that clears `GHSA-6gpp-xcg3-4w24` (proxy/middleware bypass — relevant to our `proxy.ts` CSRF gate), the Server Actions DoS/SSRF, or the cache-confusion advisory. npm's own post-fix suggestion is to *downgrade* to next@14.2.35 (`isSemVerMajor: true`), which is not on the table. Correct posture: **wait for 16.3.0 stable**, then upgrade deliberately.
2. **The fix made the audit metric worse: 6 vulns → 27.** Verified this is our change and not an advisory-DB refresh, by re-auditing the pristine `HEAD` lockfile in a scratch dir against the same DB *at the same moment*: it still reports 4 high / 6 total. The bumps re-materialize nested `brace-expansion`/`minimatch` copies under `@oclif/core`, `@vercel/queue`, `@typescript-eslint/*`, `filelist`, `readdir-glob`, `workflow`, which cascades "vulnerable dependency" status up into 24 additional parents (eslint, eslint-config-next, exceljs, archiver, ejs, jake, rimraf, glob…).

Lockfile reverted (`git checkout package-lock.json && npm ci`); `npm audit` back to 4 high / 6 total, `package.json` untouched. What `npm audit fix` *does* legitimately clear is only `fast-uri` (high) plus the `body-parser`/`dompurify` lows — reachable via targeted `overrides` (the pattern package.json already uses) **if** we want them, but deliberately not done unilaterally: an override on `dompurify` sits on the pinned `isomorphic-dompurify`/`jsdom@26` cluster that we have a standing do-not-bump constraint on. Owner decision.

**Correction for the governance report:** W31 lists DOMPurify as one of the 4 highs. It is **low**; the actual 4th high is **`sharp` <0.35.0** (transitive via next), which W31 omits entirely.

## Deps: targeted `overrides` for fast-uri + body-parser — the safe subset of the rejected audit fix (Jul 27)

WHY: Follow-up to the `npm audit fix` rejection above. Of the six advisories, three were genuinely fixable by a patch bump; the blanket fix was unusable because it also de-hoisted `brace-expansion`/`minimatch` into 24 new flagged parents. Pinning the two clean ones directly via `overrides` (the pattern package.json already uses) gets the win without the cascade:

- `fast-uri` 3.1.3 → **3.1.4** (high, GHSA-v2hh-gcrm-f6hx host confusion) — transitive via `@sentry/nextjs` → webpack → schema-utils → ajv.
- `body-parser` 1.20.5 → **1.20.6** (low, GHSA-v422-hmwv-36x6 DoS) — transitive via `workflow` → `@workflow/cli` → `@workflow/web` → express.

**`dompurify` deliberately left alone** (low, 3.4.11 → 3.4.12 available). It sits on the pinned `isomorphic-dompurify`/`jsdom@26` cluster that carries a standing do-not-bump constraint; a 1-severity-low gain is not worth poking it. Owner call, deliberately deferred.

Result: `npm audit` **6 → 4** (4 high → 3 high, 2 low → 1 low). Remaining: `next` + `sharp` (no released fix — see above) and `brace-expansion`. Lockfile diff is **2 package entries / 12 lines**, vs 26 package paths for the blanket fix — the containment is the whole point. Verified beyond the usual gates: `npm run build` run locally because both packages live in the *build* toolchain (webpack schema validation / CLI express), where unit tests exercise nothing. tsc clean, 1576 tests green, build succeeded.

## Repo hygiene: archive 4 delivered one-off generators + close the `scripts/_*.mts` gitignore gap (Jul 28)

WHY: `git status` had accumulated 40 untracked files, which makes it impossible to see at a glance whether real work is uncommitted. Two distinct causes, two fixes:

1. **`.gitignore` covered `scripts/_*.{ts,mjs,js,sql,json}` but not `.mts`.** The active verify/backfill harnesses (`_verify_*.mts`, `_backfill_*.mts`, `_spacy_kb_*.mts`, `_copy_townhalls_prod_to_test.mts` — 35 files) are deliberately untracked per the convention in `scripts/oneoff/README.md`, but every one of them showed as `??` because the ignore patterns predate the `.mts` extension. Added `scripts/_*.mts` so the documented intent actually holds.
2. **Four delivered generators were still sitting in `scripts/oneoff/` untracked.** The convention (gitignore comment + `scripts/oneoff/README.md`) is: one-offs start untracked in `scripts/`, then move to `scripts/oneoff/` **committed** once the work ships, as the provenance trail for regenerating a delivered artifact. All four shipped and were never archived: `_nowocats_recap_deck.ts` (VHB engagement recap PPTX, 7/27), `_kimleyhorn_public_engagement_brief_pdf.ts` (partner brief v2, 7/28), `_ppfl_canvasser_onepager_pdf.ts` (delivered 7/14), `_ppfl_proposal_deck.ts`. Secret-scanned before staging; all four read env from `.env.local` like their 90 tracked peers.

Also lands the orphaned `docs/ENGINEERING.md` §6 addition (written 7/15, left unstaged by a parallel session): the **pptxgenjs `shadow` corruption** gotcha. `shadow` on `addText` serializes out-of-range OOXML values *and* mutates the passed options object, so corruption compounds across slides that reuse it — LibreOffice renders it fine (so pixel-QC passes) but PowerPoint declares the file corrupt and strips shapes. Discovered on the PPFL proposal deck, whose `shadowText()` offset-copy workaround the doc now cites — which only works as a reference because the deck script is now tracked.

`next-env.d.ts` churn (`.next/dev/types` ↔ `.next/types`, flips between `next dev` and `next build`) reverted, not committed — the committed variant is the CI-green one.
