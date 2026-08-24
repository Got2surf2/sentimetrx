# 2026-W35 devlog

---

## 2026-08-24 — Close the two W35 audit findings

**Why**: the W35 governance audit scored 80.0/100, down 1.0 from W34. Every
category held except **Documentation, 9 → 8**, on a single spec-drift finding.
Both items below come straight from that report.

### 1. `docs/MCO_AGENT.md` spec drift — the doc had become factually wrong

Commit `8767a919` converted the four MCO logo `<img>` tags to `next/image`.
`scripts/specMap.ts:332` maps `app/demo/mco/**` → `docs/MCO_AGENT.md`, two of the
four call sites live there, and the commit staged only the devlog — so the
pre-commit spec check fired, was bypassed with `SKIP_SPEC_CHECK=1`, and the
bypass was **never justified in the commit message**, which CLAUDE.md requires.

This was not a pedantic mapping hit. §3 of MCO_AGENT.md carried an "Image
rendering (2026-08-16)" note ending: *"The MCO logo marks (`CanvasShell`,
`WelcomeCard`) are static local assets where `next/image` would be correct; they
remain on the lint ratchet as real debt rather than being suppressed."* After
`8767a919` that sentence described the opposite of the shipped code. The mapping
did exactly its job; the bypass is what broke.

The note now records the conversion, and keeps two things a future editor needs:
that every call site sizes by **CSS height with `width:auto`** (the intrinsic
275×120 is passed only so `next/image` can reserve an aspect ratio), and the QC
trap that `.avatar-mco img` uses `object-fit: contain`, so its rendered box ratio
never matched the asset and a ratio assertion there fails while looking exactly
like conversion distortion. The QR and indoor-map exceptions are unchanged and
still correct — verified both still carry their scoped disables.

### 2. The outlet-reporting backfill now has a numbered migration

`sql/193_outlet_reporting_grandfather.sql`. The audit's point was that
`cd84dedf` changed production state through a script invocation only, so the
`schema_migrations` ledger doesn't reflect it and a buyer's DD can't reconstruct
it from the git trail without asking a human.

The migration reproduces the grandfather rule in SQL — `google_reviews` +
`active` + ≥ 5 `review_source_locations` + a non-null `schema_config` — and is
idempotent by construction: the WHERE clause excludes rows already carrying the
flag. **Verified against production read-only before committing: 12 datasets
qualify, all 12 already flagged, 0 rows would be written, 0 skipped for a missing
`schema_config`.** So it is a true no-op there, and the set matches `cd84dedf`'s
commit message exactly:

> BareBurger · Capital Grille · Capital Grille (demo) · Ruth's Chris · Zuma ·
> Flemings (demo) · Eddie V's · Tabla · Nobu · Cheddar's · US National Park ·
> Rubio's Coastal Grill

It deliberately skips datasets with a NULL `schema_config`, for the same reason
the original script did: writing a bare `{"outletReporting":true}` there would
invent a `schema_config` the rest of the app then treats as authoritative for
field types and hierarchy levels. Prod has none, but the guard belongs in the
file rather than in someone's memory.

Being a DATA migration, there is no DDL and `docs/db/schema.sql` does not move.

### What this week's drop actually says about the rubric

Worth writing down, because the instinct was that a heavy docs week should have
pushed the score up. It can't. The spec-drift companion credits the work — 10
specs updated in range, `ANALYTICS.md` 18 edits alongside 18 code commits,
`TESTING.md` 17 alongside 17 — and the report says it plainly: those changes
*"don't move the score up on their own but keep it from moving down."*
Documentation sat at 9/10, joint-highest in the repo. Keeping specs in sync is
the baseline expectation, not a bonus; **drift is the only lever that moves that
number, and it only moves down.** One unjustified bypass therefore costs a full
point that no amount of good docs work can earn back in the same week.
