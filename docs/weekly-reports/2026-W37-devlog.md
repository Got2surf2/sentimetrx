# 2026-W37 devlog

---

## 2026-09-07 — npm audit 8 → 2: the stale-override-pin class recurred (W37 governance item #1)

**Why**: the W37 governance report flagged 4 high npm advisories and prescribed
`npm audit fix`. Verified first: two of the highs (`image-size` via `pptxgenjs`)
are the documented, code-verified acceptance in ENGINEERING.md — the only
"fix" npm offers is a semver-major DOWNGRADE of pptxgenjs that breaks every
deck export. The other two were real and new (September advisories).

**What**: plain `npm audit fix` moved `fast-uri` 3.1.5→3.1.7 and `browserslist`
4.28.2→4.28.9 (9 packages, all patch/minor). That exposed a `qs` root (2
moderate, fixed in 6.16.0) with 7 collateral packages that could NOT move
because our own `overrides` pinned `body-parser` to exactly `1.20.6` — forcing
`express@5` back onto body-parser 1.x whose `qs ~6.15.1` excluded the fix.
Scoped the pin to the major it was meant for (`"body-parser@1": "^1.20.6"`);
express keeps 2.x, `qs` reaches 6.16.0. Result: **8 → 2**, the two remaining
being the documented `image-size` acceptance. `pptxgenjs` untouched (verified in
the lockfile delta). Typecheck clean; 2,199 tests pass incl. the real-pptxgenjs
slide-renderer suite. ENGINEERING.md's npm-audit section carries the dated
follow-up; rule restated there: exact `overrides` pins age into blockers.

## 2026-09-07 — collectionRecompute: pair every service-role lookup with org_id (W37 governance item #3)

**Why**: the W37 report's one code finding that held up — `lib/collectionRecompute.ts`
updated `datasets` by bare `.eq('id', …)` on the service-role client. Verified:
both entry points (compute route, sync cascade) already 404 on an org mismatch
upstream, so this was defense-in-depth, not a live leak — but it is the exact
shape of the six May-2026 CRITICALs, and the parent-collection resolution
(`collection_members → collections`) had the same gap.

**What**: `recomputeCollectionAnalytics`, `refreshCollection`, and
`recomputeParentCollections` now take the RESOURCE's `org_id` (never the
caller's — admins act cross-org) and pair it on the `collections` lookup, which
runs FIRST so nothing per-dataset is read or written for a wrong-org id, and on
the `datasets` update. The three callers pass `dataset.org_id` /
`collection.org_id` they already held. `tests/unit/collectionRecompute.test.ts`
(4 tests) pins it on the real query chains with a recording fake that honors
`org_id` filters — wrong org → null with zero writes; right org → update carries
`org_id`. 43 tests across the touched suites pass; tsc + lint clean.
