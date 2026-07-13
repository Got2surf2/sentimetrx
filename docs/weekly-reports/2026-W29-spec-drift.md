# Spec drift report — 2026-W29 (week ending Jul 12)

**Generated**: 2026-07-13T08:10:00Z
**Repository**: Got2surf2/sentimetrx
**Script**: scripts/spec-drift.ts (map: scripts/specMap.ts)
**Companion to**: 2026-W29.md (governance report, same PR)

---

# Spec drift report

**Date**: 2026-07-13
**Range**: `5f15f93..HEAD` — 49 commits

## Summary

| Status | Count | Specs |
|--------|-------|-------|
| ⚠️ Drift | 4 | `docs/SOCIAL.md`, `docs/CAMPAIGNS.md`, `docs/SURVEYS.md`, `docs/RECORDINGS.md` |
| ✅ Updated in range | 8 | `docs/DATABASE.md`, `docs/db/schema.sql`, `docs/ENGINEERING.md`, `docs/TESTING.md`, `docs/USAGE_ACCOUNTING.md`, `docs/ANALYTICS.md`, `docs/TAXONOMY.md`, `docs/BOTS.md` |
| 💤 Clean (no code touched) | 5 | `docs/SECURITY.md`, `docs/DATA_SOURCES.md`, `docs/SEARCH.md`, `docs/TOWNHALL.md`, `docs/MCO_AGENT.md` |

## Top-level specs

- ⚠️ `SPEC.md` (inventory doc) — module specs drifted, so this likely needs a sweep too.
- ✅ `FEATURES.md` was updated in this range (2 commits).

## Drift detail

### ⚠️ `docs/SOCIAL.md`

1 commit touched code mapped to this spec; the spec itself was not edited.

- `726ae30` 2026-07-12 Sanjay Patel — Breadcrumbs across every internal page; admin rooted at Settings & Admin
  - `app/social/page.tsx`

### ⚠️ `docs/CAMPAIGNS.md`

1 commit touched code mapped to this spec; the spec itself was not edited.

- `726ae30` 2026-07-12 Sanjay Patel — Breadcrumbs across every internal page; admin rooted at Settings & Admin
  - `app/studies/[id]/campaigns/page.tsx`

### ⚠️ `docs/SURVEYS.md`

1 commit touched code mapped to this spec; the spec itself was not edited.

- `726ae30` 2026-07-12 Sanjay Patel — Breadcrumbs across every internal page; admin rooted at Settings & Admin
  - `app/studies/[id]/campaigns/page.tsx`

### ⚠️ `docs/RECORDINGS.md`

1 commit touched code mapped to this spec; the spec itself was not edited.

- `726ae30` 2026-07-12 Sanjay Patel — Breadcrumbs across every internal page; admin rooted at Settings & Admin
  - `app/recordings/[id]/setup/page.tsx`
  - `app/recordings/new/page.tsx`
  - `app/recordings/page.tsx`

## Updated in range

- `docs/DATABASE.md` — 4 edits alongside 7 code commits.
- `docs/db/schema.sql` — 2 edits alongside 7 code commits.
- `docs/ENGINEERING.md` — 3 edits alongside 0 code commits.
- `docs/TESTING.md` — 12 edits alongside 17 code commits.
- `docs/USAGE_ACCOUNTING.md` — 1 edit alongside 1 code commit.
- `docs/ANALYTICS.md` — 15 edits alongside 26 code commits.
- `docs/TAXONOMY.md` — 4 edits alongside 4 code commits.
- `docs/BOTS.md` — 3 edits alongside 1 code commit.

---
*Map source: `scripts/specMap.ts`. Edit there to refine which paths belong to which spec.*
