# Spec drift report — 2026-W37 (week ending Sep 6)

**Generated**: 2026-09-07T08:09:54Z
**Repository**: Got2surf2/sentimetrx
**Script**: scripts/spec-drift.ts (map: scripts/specMap.ts)
**Companion to**: 2026-W37.md (governance report, same PR)

---


> sentimetrx@0.1.0 spec-drift
> tsx scripts/spec-drift.ts --since 7 days ago

# Spec drift report

**Date**: 2026-09-07
**Range**: `6487592..HEAD` — 49 commits

## Summary

| Status | Count | Specs |
|--------|-------|-------|
| ⚠️ Drift | 2 | `docs/ENGINEERING.md`, `docs/USAGE_ACCOUNTING.md` |
| ✅ Updated in range | 5 | `docs/DATABASE.md`, `docs/db/schema.sql`, `docs/TESTING.md`, `docs/ANALYTICS.md`, `docs/TAXONOMY.md` |
| 💤 Clean (no code touched) | 10 | `docs/SECURITY.md`, `docs/DATA_SOURCES.md`, `docs/SEARCH.md`, `docs/SOCIAL.md`, `docs/CAMPAIGNS.md`, `docs/SURVEYS.md`, `docs/BOTS.md`, `docs/TOWNHALL.md`, `docs/MCO_AGENT.md`, `docs/RECORDINGS.md` |

## Top-level specs

- ⚠️ `SPEC.md` (inventory doc) — module specs drifted, so this likely needs a sweep too.
- ✅ `FEATURES.md` was updated in this range (3 commits).

## Drift detail

### ⚠️ `docs/ENGINEERING.md`

3 commits touched code mapped to this spec; the spec itself was not edited.

- `495785a` 2026-09-02 Sanjay Patel — Story PDF export (interactive machinery stripped) + lint ratchet fix
  - `next.config.js`
- `53ae031` 2026-09-02 Sanjay Patel — American English backstop for AI prose + muted consultant tone for story headlines
  - `CLAUDE.md`
- `91232eb` 2026-09-02 Sanjay Patel — Standing rule: all LLM output in American English, enforced at the AI client
  - `CLAUDE.md`

### ⚠️ `docs/USAGE_ACCOUNTING.md`

1 commit touched code mapped to this spec; the spec itself was not edited.

- `91232eb` 2026-09-02 Sanjay Patel — Standing rule: all LLM output in American English, enforced at the AI client
  - `lib/ai.ts`

## Updated in range

- `docs/DATABASE.md` — 3 edits alongside 3 code commits.
- `docs/db/schema.sql` — 3 edits alongside 3 code commits.
- `docs/TESTING.md` — 21 edits alongside 27 code commits.
- `docs/ANALYTICS.md` — 35 edits alongside 38 code commits.
- `docs/TAXONOMY.md` — 2 edits alongside 2 code commits.

---
*Map source: `scripts/specMap.ts`. Edit there to refine which paths belong to which spec.*
