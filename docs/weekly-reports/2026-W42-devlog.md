# 2026-W42 devlog

---

## 2026-10-12 — Governance audits W39–W42 worked and committed; audit gate back to green

Four weekly governance PRs (#46 W39, #49 W40, #55 W41, #59 W42) were open and
unreviewed. Their findings, worked in one pass:

- **Dependencies (W41/W42 CRITICAL/HIGH).** `main` failed its own CI audit
  gate — 18 blocking root advisories, including criticals in `next`
  (GHSA-vcvr-r3jv-pc5j, RCE in `next/og`) and `piscina`. No push had run CI
  in three weeks, so nothing turned red. `next` 16.3.5 → 16.4.0 (Dependabot
  #58's version, landed by hand); the stale exact overrides that held
  `piscina` (5.2.0) and `devalue` (5.9.2) at vulnerable versions repointed to
  caret floors, plus `undici`, `fast-uri`, `brace-expansion@1`; plain
  `npm audit fix` (never `--force`) moved `sharp`, `source-map-js`,
  `http-cache-semantics` in-major. `mammoth` (floated to 1.13.0 by audit fix,
  not needed) and `dompurify` (3.4.17, published today, inside the 7-day
  cooldown) were held back to 1.12.2 / 3.4.16. jsdom 26, isomorphic-dompurify
  2.26.0, pptxgenjs 4.0.1, the puppeteer/chromium pair: unchanged. Gate:
  18 blocking → 0; npm audit 38 → 14 (all collateral or allowlisted).
- **`braces` acceptance.** No patched release exists; reachable only from
  build/dev tooling over repo-authored globs. Allowlisted to 2027-01-15 with
  the verification in ENGINEERING.md.
- **Why it keeps happening (third time).** Exact override pins age into the
  vulnerable range and block `npm audit fix`. Fix is structural: caret floors,
  and `audit-gate.ts` now prints "HELD BY OUR PIN" when our override covers a
  blocked root (unit-tested).
- **Maintainability (W39–W42 MEDIUM).** All 36 `eslint-disable` directives
  without a `-- <reason>` are resolved: 8 `no-explicit-any` removed outright
  (the admin simulator's study config now has a `SimConfig` type; the PulseIQ
  content-safety merge casts to `TownHallConfig`), 28 `react-hooks` ones carry
  the concrete reason the dependency is omitted. Comment-only for the hooks —
  no dependency array changed. Lint count unchanged on the touched files.
  Each of the six mapped specs (ANALYTICS, SURVEYS, BOTS, TOWNHALL, MCO_AGENT,
  RECORDINGS) gains a short section naming its sites and reasons; none had a
  statement this made false.
- **W39 spec drift (10 specs)** was already closed by `55777ff9`; the W39
  devlog exists (it was local/unpushed when the routine ran, hence its
  "no devlog" lines).

Verified: `tsc` clean, `npm test` green, `next build --webpack` green on
16.4.0, Playwright smoke 6/6 against a production build pointed at TEST.

Deferred, with reasons: **branch coverage floor 38% → 50%** (needs a targeted
test campaign, not a sweep — floors move only after measured gains);
**Tailwind 4** (clears `braces` + `postcss-selector-parser` but is a
behavior-sensitive major — queue project); **`sprintf-js`** moderate (npm's
only fix is a `mammoth` downgrade to 0.3.x); **7 modules > 1,500 lines**
(report-only per the rubric).

The four reports are committed under `docs/weekly-reports/` as reviewed.
