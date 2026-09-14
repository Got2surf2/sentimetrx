# 2026-W38 devlog

---

## 2026-09-14 — W38 governance: report verified, critical Next advisory patched (npm audit 8 → 2)

**Why**: the W38 report (PR #36) was the first run on the corrected routine
prompt, so it was checked twice — for whether the routine's fixes took, and for
what it asked. The fixes took: it read `2026-W37-devlog.md` (the COVERED week,
not the run week), honored the documented `image-size` acceptance, and credited
last week's remediations by sha. Its new findings were verified against a fresh
`npm audit --json`, not trusted: four real new roots, including `next` 16.3.1's
CRITICAL unauthenticated RCE in the Image Optimization API — the exact class
that matters for a public Vercel app. One cosmetic error in the report: its
correlation table calls last week's `collectionRecompute` finding CRITICAL (it
was MEDIUM).

**What**: `npm audit fix` (non-force) → `next` 16.3.5, `sharp` 0.35.4,
`js-yaml` 4.3.2; explicit `vitest`/`@vitest/coverage-v8` 4.1.11 (audit fix
skipped it although `^4.1.5` allowed it). Lockfile delta reviewed — `pptxgenjs`
untouched. Verified: tsc clean; 2,203 tests green on the OLD runner, then again
on the NEW one; a real `next build --webpack` on 16.3.5 (36 pages, proxy
compiled). Audit back to the 2 documented highs. PR #36 merged (docs-only —
gate skipped the build, as the new annotation now says in words).

**Not done, by design**: progression #2 (a CI `npm audit --audit-level=high`
gate) is SECURITY.md TBD #2 — an owner policy call, though this week is the
argument for it; progression #3 (coverage ratchet) waits for a measured
`coverage-summary.json`, per the rule the audit itself now carries. PR #33 (the
W36 report) is still open and unmerged.
