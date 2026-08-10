# Spec drift report — 2026-W33 (week ending Aug 09)

**Generated**: 2026-08-10T08:10:03Z
**Repository**: Got2surf2/sentimetrx
**Script**: scripts/spec-drift.ts (map: scripts/specMap.ts)
**Companion to**: 2026-W33.md (governance report, same PR)

---

> sentimetrx@0.1.0 spec-drift
> tsx scripts/spec-drift.ts --since 7 days ago

# Spec drift report

**Date**: 2026-08-10
**Range**: `870242a..HEAD` — 9 commits

## Summary

| Status | Count | Specs |
|--------|-------|-------|
| ⚠️ Drift | 1 | `docs/TESTING.md` |
| ✅ Updated in range | 2 | `docs/ANALYTICS.md`, `docs/TAXONOMY.md` |
| 💤 Clean (no code touched) | 14 | `docs/DATABASE.md`, `docs/db/schema.sql`, `docs/SECURITY.md`, `docs/ENGINEERING.md`, `docs/USAGE_ACCOUNTING.md`, `docs/DATA_SOURCES.md`, `docs/SEARCH.md`, `docs/SOCIAL.md`, `docs/CAMPAIGNS.md`, `docs/SURVEYS.md`, `docs/BOTS.md`, `docs/TOWNHALL.md`, `docs/MCO_AGENT.md`, `docs/RECORDINGS.md` |

## Top-level specs

- ⚠️ `SPEC.md` (inventory doc) — module specs drifted, so this likely needs a sweep too.
- ⚠️ `FEATURES.md` (inventory doc) — module specs drifted, so this likely needs a sweep too.

## Drift detail

### ⚠️ `docs/TESTING.md`

2 commits touched code mapped to this spec; the spec itself was not edited.

- `21150c5` 2026-08-07 Sanjay Patel — Outlet action plan: name the specific outlet + guarantee real verbatims
  - `tests/unit/outletActionPlan.test.ts`
- `a3d0091` 2026-08-07 Sanjay Patel — Dimensions: rating-based sentiment fallback for neutral "who" subs
  - `tests/unit/insightAlerts.test.ts`
  - `tests/unit/taxonomyRollup.test.ts`

## Updated in range

- `docs/ANALYTICS.md` — 5 edits alongside 7 code commits.
- `docs/TAXONOMY.md` — 1 edit alongside 2 code commits.

---
*Map source: `scripts/specMap.ts`. Edit there to refine which paths belong to which spec.*
