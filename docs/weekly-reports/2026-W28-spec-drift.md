# Spec drift report — 2026-W28 (week ending Jul 12)

**Generated**: 2026-07-06T08:04:54Z
**Repository**: Got2surf2/sentimetrx
**Script**: scripts/spec-drift.ts (map: scripts/specMap.ts)
**Companion to**: 2026-W28.md (governance report, same PR)

---

# Spec drift report

**Date**: 2026-07-06
**Range**: `5f3393c..HEAD` — 49 commits

## Summary

| Status | Count | Specs |
|--------|-------|-------|
| ⚠️ Drift | 3 | `docs/SEARCH.md`, `docs/SOCIAL.md`, `docs/CAMPAIGNS.md` |
| ✅ Updated in range | 13 | `docs/DATABASE.md`, `docs/db/schema.sql`, `docs/SECURITY.md`, `docs/ENGINEERING.md`, `docs/TESTING.md`, `docs/USAGE_ACCOUNTING.md`, `docs/DATA_SOURCES.md`, `docs/ANALYTICS.md`, `docs/TAXONOMY.md`, `docs/SURVEYS.md`, `docs/BOTS.md`, `docs/TOWNHALL.md`, `docs/MCO_AGENT.md` |
| 💤 Clean (no code touched) | 1 | `docs/RECORDINGS.md` |

## Top-level specs

- ⚠️ `SPEC.md` (inventory doc) — module specs drifted, so this likely needs a sweep too.
- ⚠️ `FEATURES.md` (inventory doc) — module specs drifted, so this likely needs a sweep too.

## Drift detail

### ⚠️ `docs/SEARCH.md`

1 commit touched code mapped to this spec; the spec itself was not edited.

- `11ef822` 2026-07-04 Sanjay Patel — Taxonomy embed: verdicts move into the row blob (sql/151; drop staged as 152)
  - `components/analyze/textmine/SearchPanel.tsx`

### ⚠️ `docs/SOCIAL.md`

2 commits touched code mapped to this spec; the spec itself was not edited.

- `bf90a85` 2026-07-04 Sanjay Patel — DD efficiency audit: 33 verified findings fixed-or-documented; CAPACITY.md; k6 suite x4
  - `app/api/cron/social-sync/route.ts`
- `2f222eb` 2026-07-03 Sanjay Patel — Admin-org feature auto-grant: sweep 17 gate sites (owner-found bug)
  - `app/api/cron/social-sync/route.ts`
  - `app/api/social/auto-config/route.ts`

### ⚠️ `docs/CAMPAIGNS.md`

2 commits touched code mapped to this spec; the spec itself was not edited.

- `bf90a85` 2026-07-04 Sanjay Patel — DD efficiency audit: 33 verified findings fixed-or-documented; CAPACITY.md; k6 suite x4
  - `app/api/cron/campaign-scheduler/route.ts`
- `2f222eb` 2026-07-03 Sanjay Patel — Admin-org feature auto-grant: sweep 17 gate sites (owner-found bug)
  - `app/studies/[id]/campaigns/page.tsx`

## Updated in range

- `docs/DATABASE.md` — 6 edits alongside 6 code commits.
- `docs/db/schema.sql` — 6 edits alongside 6 code commits.
- `docs/SECURITY.md` — 2 edits alongside 0 code commits.
- `docs/ENGINEERING.md` — 5 edits alongside 6 code commits.
- `docs/TESTING.md` — 8 edits alongside 13 code commits.
- `docs/USAGE_ACCOUNTING.md` — 1 edit alongside 0 code commits.
- `docs/DATA_SOURCES.md` — 1 edit alongside 3 code commits.
- `docs/ANALYTICS.md` — 3 edits alongside 6 code commits.
- `docs/TAXONOMY.md` — 6 edits alongside 5 code commits.
- `docs/SURVEYS.md` — 1 edit alongside 4 code commits.
- `docs/BOTS.md` — 4 edits alongside 5 code commits.
- `docs/TOWNHALL.md` — 11 edits alongside 12 code commits.
- `docs/MCO_AGENT.md` — 1 edit alongside 0 code commits.

---
*Map source: `scripts/specMap.ts`. Edit there to refine which paths belong to which spec.*
