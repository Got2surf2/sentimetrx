# Spec drift report — 2026-W35 (week ending Sun 23 Aug)

**Generated**: 2026-08-24T08:02:28Z
**Repository**: Got2surf2/sentimetrx
**Script**: scripts/spec-drift.ts (map: scripts/specMap.ts)
**Companion to**: 2026-W35.md (governance report, same PR)

---


> sentimetrx@0.1.0 spec-drift
> tsx scripts/spec-drift.ts --since 7 days ago

# Spec drift report

**Date**: 2026-08-24
**Range**: `daf2c0a..HEAD` — 34 commits

## Summary

| Status | Count | Specs |
|--------|-------|-------|
| ⚠️ Drift | 1 | `docs/MCO_AGENT.md` |
| ✅ Updated in range | 10 | `docs/SECURITY.md`, `docs/ENGINEERING.md`, `docs/TESTING.md`, `docs/DATA_SOURCES.md`, `docs/SOCIAL.md`, `docs/ANALYTICS.md`, `docs/SURVEYS.md`, `docs/BOTS.md`, `docs/TOWNHALL.md`, `docs/RECORDINGS.md` |
| 💤 Clean (no code touched) | 6 | `docs/DATABASE.md`, `docs/db/schema.sql`, `docs/USAGE_ACCOUNTING.md`, `docs/SEARCH.md`, `docs/TAXONOMY.md`, `docs/CAMPAIGNS.md` |

## Top-level specs

- ⚠️ `SPEC.md` (inventory doc) — module specs drifted, so this likely needs a sweep too.
- ⚠️ `FEATURES.md` (inventory doc) — module specs drifted, so this likely needs a sweep too.

## Drift detail

### ⚠️ `docs/MCO_AGENT.md`

1 commit touched code mapped to this spec; the spec itself was not edited.

- `8767a91` 2026-08-18 Sanjay Patel — Convert the four MCO logo <img> tags to next/image
  - `app/demo/mco/CanvasShell.tsx`
  - `app/demo/mco/components/WelcomeCard.tsx`

## Updated in range

- `docs/SECURITY.md` — 1 edit alongside 1 code commit.
- `docs/ENGINEERING.md` — 6 edits alongside 2 code commits.
- `docs/TESTING.md` — 17 edits alongside 17 code commits.
- `docs/DATA_SOURCES.md` — 1 edit alongside 1 code commit.
- `docs/SOCIAL.md` — 1 edit alongside 1 code commit.
- `docs/ANALYTICS.md` — 18 edits alongside 18 code commits.
- `docs/SURVEYS.md` — 4 edits alongside 6 code commits.
- `docs/BOTS.md` — 1 edit alongside 1 code commit.
- `docs/TOWNHALL.md` — 1 edit alongside 1 code commit.
- `docs/RECORDINGS.md` — 1 edit alongside 1 code commit.

---
*Map source: `scripts/specMap.ts`. Edit there to refine which paths belong to which spec.*
