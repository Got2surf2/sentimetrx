# Spec drift report — 2026-W23 (week ending May 31)

**Generated**: 2026-06-01T06:09:17Z
**Repository**: Got2surf2/sentimetrx
**Script**: `scripts/spec-drift.ts` (map: `scripts/specMap.ts`)
**Companion to**: `2026-W23.md` (governance report, runs 2 hrs later)

---

# Spec drift report

**Date**: 2026-06-01
**Range**: `72b2b3d..HEAD` — 49 commits

## Summary

| Status | Count | Specs |
|--------|-------|-------|
| ⚠️ Drift | 1 | `docs/BOTS.md` |
| ✅ Updated in range | 8 | `docs/ENGINEERING.md`, `docs/TESTING.md`, `docs/USAGE_ACCOUNTING.md`, `docs/DATA_SOURCES.md`, `docs/ANALYTICS.md`, `docs/TOWNHALL.md`, `docs/MCO_AGENT.md`, `docs/RECORDINGS.md` |
| 💤 Clean (no code touched) | 5 | `docs/SECURITY.md`, `docs/SEARCH.md`, `docs/SOCIAL.md`, `docs/CAMPAIGNS.md`, `docs/SURVEYS.md` |

## Top-level specs

- ⚠️ `SPEC.md` (inventory doc) — module specs drifted, so this likely needs a sweep too.
- ⚠️ `FEATURES.md` (inventory doc) — module specs drifted, so this likely needs a sweep too.

## Drift detail

### ⚠️ `docs/BOTS.md`

3 commits touched code mapped to this spec; the spec itself was not edited.

- `828c408` 2026-05-27 Sanjay Patel — fix(mco-agent): use the actual MCO logo wherever the agent presents itself
  - `app/b/[slug]/icon.tsx`
- `071d4e8` 2026-05-27 Sanjay Patel — feat(mco-agent): FlightListCard for plural flight queries + no-tables guardrail
  - `app/api/bots/[id]/ui-hints/route.ts`
- `c059d40` 2026-05-27 Sanjay Patel — feat(mco-agent): real Meridian indoor maps — 32 floors + 2,313 pins
  - `app/api/bots/[id]/ui-hints/route.ts`

## Updated in range

- `docs/ENGINEERING.md` — 2 edits alongside 3 code commits.
- `docs/TESTING.md` — 1 edit alongside 2 code commits.
- `docs/USAGE_ACCOUNTING.md` — 1 edit alongside 1 code commit.
- `docs/DATA_SOURCES.md` — 1 edit alongside 0 code commits.
- `docs/ANALYTICS.md` — 1 edit alongside 7 code commits.
- `docs/TOWNHALL.md` — 1 edit alongside 1 code commit.
- `docs/MCO_AGENT.md` — 1 edit alongside 6 code commits.
- `docs/RECORDINGS.md` — 13 edits alongside 12 code commits.

---
*Map source: `scripts/specMap.ts`. Edit there to refine which paths belong to which spec.*
