# 2026-W21 — Dev log (Week of May 18 to May 24)

## 2026-05-18 — Control Reports admin group

Added `/admin/control-reports/` as the parent for weekly machine-generated reports a human reviews and merges. Index lists governance + spec-drift; each links to a trend page that mirrors the existing GovernanceTrend layout.

**Why**: enterprise procurement (Darden DD form) and SOC 2 CC4 expect a single coherent evidence story for continuous human oversight of AI-built code. The two control reports were previously surfaced unevenly — governance had `/admin/governance` + a parseable weekly file, spec-drift only appended to the running devlog with no persistent artifact and no chart.

**What changed**:
- `scripts/spec-drift.ts` gains `--write-weekly` which writes `docs/weekly-reports/YYYY-WXX-drift.md` (parseable: summary metrics table + drift detail).
- `lib/specDriftReports.ts` parses those files; mirrors `lib/governanceReports.ts`.
- New routes: `/admin/control-reports/` (index), `/admin/control-reports/governance/` (existing trend, moved), `/admin/control-reports/spec-drift/` (new trend).
- `/admin/governance` is now a 308 redirect to the sub-route so external bookmarks keep working.
- Top-nav admin entry renamed "Governance Reports" → "Control Reports" pointing at the new index.
- `.claude/commands/spec-drift.md` now instructs the Monday 02:00 ET routine to use `--write-weekly` and commit the standalone file rather than appending to the devlog.
- `docs/weekly-reports/2026-W21-drift.md` produced as the first real drift report (0 drifted, 12 specs updated this range).

**Next**: when the routine runs next Monday it will produce `2026-W22-drift.md`, the trend chart gets its second data point, and week-over-week delta starts showing.

## 2026-05-18 — Two-step opener for all agents + Vindman → Axel surrogate

**Why**: every agent with `askName=true` was concatenating the topical opener and the name ask into one flaky double-question (e.g. `"Hi, I'm Alex! Thanks for stopping by. Tell me what's on your mind. What's your name?"`). Users had to parse two asks at once and often answered only one. Separately, the Vindman agent was scoped as a first-person avatar of the candidate, which is a fundraising-and-FEC liability — needed to repose as a campaign surrogate.

**What changed**:
- `components/ui/ChatBot.tsx`: when `askName` is on, the FIRST assistant message is a name-only ask. After the user provides a name, a SECOND assistant message renders the topical opener (`config.initialMessage`). English path renders directly; non-English path calls the API to translate the opener and personalize it with the name. New `nameExchangeMessages` state filters the name exchange out of future API calls so the server sees a clean turn 1 (preserves `askProfile` behavior).
- Vindman agent (`bots.id = 78991aa1-…`) DB updates: `name`/`config.name` → `Axel`, `config.subtitle` → `Vindman for Senate`, `config.initialMessage` → `"Thanks for stopping by. What's on your mind?"`, full rewrite of `system_prompt` + `personality` from first-person avatar to third-person campaign surrogate ("Alex served…", "the colonel has said…"). Slug stays `alexvindman` (public URL).

**Next**: QA the two-step opener on a couple of agents in production. Revisit Sonnet 4.6 → `fast` revert in the chat route once the Tuesday demo is past.

## 2026-05-18 — Entity catalog: manual curation + soft-delete (Bucket A of entity-views build)

**Why**: brand-level entity catalogs need a curation seam. NER discovery is sample-bound (default 500 rows) and produces both gaps (menu items the sample never saw) and noise (generic nouns slipping past the strict prompt). The pre-existing "Re-discover" button wiped the whole scope's catalog before rebuild, so any future hand-curation would have been destroyed on the next click. This blocks the broader entity-views feature (cloud, compare, sentiment) because there's no point visualising a catalog the user can't trust.

**What changed**:
- `sql/073_entity_catalog_source_hidden.sql`: adds `source TEXT NOT NULL DEFAULT 'discovered' CHECK IN ('discovered','manual')` and `hidden BOOLEAN NOT NULL DEFAULT false`, plus a partial index `WHERE hidden=false` for the read filter. Applied to prod.
- `lib/entityDiscovery.ts`: drops the manual-mode DELETE entirely — all discovery modes are now additive. Upsert pass skips rows where existing `source='manual'` (curation never overwritten) and where `hidden=true` (NER cannot resurface what a user hid). Tracks `skippedManual` / `skippedHidden` counts.
- `lib/entityFilter.ts`: `getEntitiesWithCounts` gains `includeHidden?: boolean`. Default reads hide soft-deleted entries; the Manage panel passes `true` to surface them with `source` + `hidden` flags. Zero-count rows are now retained when `includeHidden` so empty-but-curated entries are visible.
- New API endpoints:
  - `POST /api/datasets/[id]/entities` — single or bulk create. Accepts `{canonical,category?,aliases?}` or `{entities:[...]}` (max 500). Auth via `getCallerOrgContext` + paired `id+org_id` (CLAUDE.md multi-tenancy rule). Logs to `entity_catalog_refresh`.
  - `PATCH /api/datasets/[id]/entities/[slug]` — toggle hidden, edit canonical / category / aliases.
  - `DELETE /api/datasets/[id]/entities/[slug]` — hard-delete `source='manual'` rows only; discovered rows must use hidden.
  - `POST /api/datasets/[id]/entities/reset-discovered` — escape hatch, only wipes `source='discovered'`.
- `components/analyze/ExtractEntitiesPanel.tsx`: adds a "Manage" toggle that swaps the panel from top-12 pill preview to a denser row view with per-row hide/unhide + delete (manual only), inline single-add form, bulk-paste textarea (`Canonical | category | alias1, alias2` per line), and a two-step-confirmed "Reset discovered" admin button. Uses the existing `LottieLoader`.
- `docs/ANALYTICS.md`: Entity Discovery section updated — discovery is fully additive, new "Manual catalog curation" subsection documents the API surface and the menu-PDF seeding workflow, migration 073 added to the migrations list.

**Brand bootstrap workflow this unblocks**: drop a menu PDF into Claude Code, extract dishes / drinks with categories + aliases, POST to the bulk endpoint. Because the catalog is brand-collection-scoped, one POST seeds every dataset under the brand. Re-discovery then accumulates the long tail (competitors, people, off-menu items) on top without ever touching the menu seed.

**Next (Bucket B-F of entity-views build)**: entity cloud (`EntityCloud.tsx` mirroring `WordCloud.tsx`), per-entity sentiment (adapt the clause-aware proximity scan at `WordCloud.tsx:206-240` for multi-word entity spans + alias expansion), entity compare chart (fork or generalise `BreakdownDist.tsx`), `View by Theme | Entity` toggle at the TextMine module top, category-restricted monthly discovery (skip food/drink once menu seed exists), person-at-collection suppression.
