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
