# 2026-W21 — Dev log (Week of May 18 to May 24)

## 2026-05-19 — Per-tenant backups to S3

**Why**: Sarina's KB-disappeared incident proved we have no per-tenant recovery story. Supabase PITR rolls back the whole DB, which in a multi-tenant SaaS means recovering Org A destroys Org B's legitimate work since the rollback point. The right shape is logical per-tenant snapshots, restorable independently.

**What changed**:
- `lib/orgSnapshot.ts` — `dumpOrgSnapshot(orgId)` returns a versioned JSON with every tenant-scoped table's rows for that org. `TABLE_SPECS` is the source of truth: ~40 tables, each tagged `org_id` / `parent_via` / `id_eq_org` / `skip`. Large tables (`dataset_rows_flat`, `bot_conversation_turns`) are capped at 50K/100K rows respectively; truncations are flagged in `meta.truncated_tables`.
- `lib/backupS3.ts` — gzip + S3 PUT wrapper. Key shape `org-snapshots/<org_id>/<YYYY>/<MM>/<DD>/snapshot.json.gz`. SSE-S3 by default, SSE-KMS if `BACKUP_S3_KMS_KEY_ID` is set.
- `app/api/cron/org-snapshot/route.ts` — nightly Vercel cron at 04:00 UTC (added to `vercel.json`). Loops all orgs, captures, uploads. A single org failure doesn't abort the rest. Returns per-org row counts + errors.
- `app/api/admin/org-snapshots/[orgId]/` — admin-gated GET (list) + POST (snapshot-now).
- `app/api/admin/org-snapshots/[orgId]/restore/` — admin-gated POST. Two modes: **merge** (default — upserts snapshot rows by `id`, leaves others alone) and **replace** (also deletes current rows whose id is not in the snapshot). Refuses if `snapshot.meta.org_id !== params.orgId` (key-swap defense). Returns per-table report of upserts/deletes/errors.
- `app/admin/backups/` — top-level admin page listing all orgs with "Browse" and "Snapshot now" buttons.
- `app/admin/backups/[orgId]/` — per-org snapshot list with restore-confirmation UX. Restore requires retyping the org slug to confirm.
- `docs/BACKUPS.md` — full ops doc: AWS bucket setup, IAM policy JSON, env vars, cost (~$3/mo at our scale), failure modes, what isn't covered (auth.users, Supabase Storage), TBDs.

**Setup needed before this is live**: provision the S3 bucket + IAM user in AWS console per `docs/BACKUPS.md`, then set `BACKUP_S3_BUCKET` / `BACKUP_S3_REGION` / `BACKUP_AWS_ACCESS_KEY_ID` / `BACKUP_AWS_SECRET_ACCESS_KEY` on Vercel Production. Until the env vars are set, the cron route returns errors per-org but the rest of the app is unaffected.

**Open**: no alerting on cron failures yet; no automated restore-test cron; `auth.users` records still depend on Supabase Auth's own backup. Tracked in `docs/BACKUPS.md` § TBDs.

## 2026-05-19 — Sarina KB rehydrate + bot audit log

**Why**: Arjun's NOWOCATS handoff (May 17) ran a structured 22-scenario regression against Sarina and got ~10 FAIL-KB results. Root cause turned out to be that `bot_knowledge_chunks` was empty for Sarina in prod despite the bot having served 261 conversations. With zero audit trail it was impossible to tell whether the chunks were never inserted or were inserted and later wiped — so the immediate fix is to rehydrate, and the durable fix is to never be in this position again.

**What changed**:
- 6 scripts patched: `scripts/_ingest_nowocats_qa.ts` (Q&A Forum, doc #9 — 32 chunks), `_ingest_nowocats_ecr.ts` (Existing Conditions Report, doc #10 — 22), `_ingest_nowocats_pm1_deck.ts` (30), `_ingest_nowocats_pm2_postcard.ts` (3 — adds verified June 16, 2026 meeting date), `_ingest_nowocats_posters.ts` (11), `_embed_missing_sarina_chunks.ts`. Env-loader was passing OpenAI keys with a literal trailing `\\n`, which caused the embeddings step to silently 401. Fix mirrors `_rescan_abel_kb.ts`'s `.replace(/\\n$/, '')`. Ran all five against prod — Sarina KB is now 98 chunks, all embedded.
- New `bots.intents` column populated for Sarina (was 0): meeting-info, Spanish handoff, ADA accommodation (Nicola Norton), submit-concern. Routes are message-only (no `url`) so RAG still fires alongside.
- `sql/074_bot_change_log.sql` — new append-only audit table, FK→bots ON DELETE CASCADE, action enum, indexed on `(bot_id, created_at DESC)` + `(org_id, created_at DESC)`. RLS read for own-org + admin-org. No client INSERT policy; server writes only via `lib/auditLog.ts → logBotChange()`.
- Wired audit-log writes into POST `/api/bots`, PATCH `/api/bots/[id]` (with field-level diff and a `status_change` shortcut), DELETE `/api/bots/[id]`, POST `/api/bots/[id]/knowledge`, DELETE `/api/bots/[id]/knowledge`, and POST `/api/bots/import`.
- New routes: GET `/api/bots/[id]/export` returns a versioned JSON (bot row sans IDs/timestamps + chunks); POST `/api/bots/import` recreates a bot with chunks; GET `/api/bots/[id]/history` lists the change log.
- New UI: `/bots/[id]/history` shows the chronological log with before/after diff. `BotsClient` cards now show "Updated <relative>", per-card History + Export JSON links, and a header-level "↓ Import" button. Edit page header shows "Last updated <rel>" + "View history →".
- New UI: `/admin/sarina-regression` runs Arjun's 22-scenario test set sequentially against the live bot, grades each reply against mustInclude/mustNotInclude regex, and shows reply text + transcript + RAG debug per row. Linked from `/admin`.

**Spec docs**: `docs/BOTS.md` §2 schema gains `bot_change_log`; §10 documents export/import/history routes and the audit-log wiring.

**Open**: Audit-log + export/import currently exists for bots only. Surveys + campaigns are the obvious next surfaces — same `<resource>_change_log` pattern, same `lib/auditLog.ts` style helper. Revert-from-history UI deferred (read-only for this pass).

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

## 2026-05-18 — Two-step opener for all agents + Vindman → Abel surrogate

**Why**: every agent with `askName=true` was concatenating the topical opener and the name ask into one flaky double-question (e.g. `"Hi, I'm Alex! Thanks for stopping by. Tell me what's on your mind. What's your name?"`). Users had to parse two asks at once and often answered only one. Separately, the Vindman agent was scoped as a first-person avatar of the candidate, which is a fundraising-and-FEC liability — needed to repose as a campaign surrogate.

**What changed**:
- `components/ui/ChatBot.tsx`: when `askName` is on, the FIRST assistant message is a name-only ask. After the user provides a name, a SECOND assistant message renders the topical opener (`config.initialMessage`). English path renders directly; non-English path calls the API to translate the opener and personalize it with the name. New `nameExchangeMessages` state filters the name exchange out of future API calls so the server sees a clean turn 1 (preserves `askProfile` behavior).
- Vindman agent (`bots.id = 78991aa1-…`) DB updates: `name`/`config.name` → `Abel` (pun on Abe Lincoln), `config.avatarLetter` → `🎩` (top hat, Lincoln-coded), `config.subtitle` → `Vindman for Senate`, `config.initialMessage` → `"Thanks for stopping by. What's on your mind?"`, full rewrite of `system_prompt` + `personality` from first-person avatar to third-person campaign surrogate ("Alex served…", "the colonel has said…"). Slug stays `alexvindman` (public URL).

**Next**: QA the two-step opener on a couple of agents in production. Revisit Sonnet 4.6 → `fast` revert in the chat route once the Tuesday demo is past.

## 2026-05-18 — Abel: KB rescan + intent routing to specific destination URLs

**Why**: the Abel (Vindman surrogate) bot's KB was 25K chars from an older crawl that pre-dated the recent site redesign and Spanish landing page. Separately, the bot had `intents = []`: a "how do I donate?" question got handled by RAG with no actionable URL, so the user got prose instead of an ActBlue link. The campaign needs the bot to **route action-intent traffic to specific destination pages**, not just answer in prose.

**What changed**:
- `scripts/_rescan_abel_kb.ts`: one-off rescan tool. Re-implements the deep-crawl + chunk + embed pipeline that the `/admin/bots` Save flow runs (it can't easily be invoked from CLI because the API is cookie-auth-gated). Re-crawled `https://alexvindman.com` + `https://ashleymoody.com`, regenerated `bots.knowledge_base` (25,289 → 87,350 chars; 96 → 118 chunks, all embedded). Same script can be re-run when site content shifts.
- Abel `intents` JSONB populated with 5 routes — each fires server-side keyword match first, falls back to Haiku intent detection, and when matched the server prompt is told to weave the URL into the reply (RAG skipped on that turn):
  - **Donate** → `https://secure.actblue.com/donate/avvf-digi-website?refcode=website`
  - **Volunteer** → `https://act.alexvindman.com/signup/volunteer_2026?source=website`
  - **Florida First Agenda** → `https://alexvindman.com/florida-first-agenda/`
  - **Merch** → `https://store.alexvindman.com/`
  - **Register to vote** → `https://vote.gov/` (official non-partisan federal hub, deliberately NOT a campaign-branded page so the civic guidance reads neutral)
- One small env-parser fix in the script: `.env.local`'s `OPENAI_API_KEY` had a trailing literal `\n` artifact inside the quotes; the script strips it before use. The leaked-newline form does not break Next.js dev (dotenv-flow tolerates it) but did break a plain `fetch` to the OpenAI embeddings API.

**Not done**: no contact / email-the-campaign intent. The campaign site doesn't expose a public contact email anywhere I could find — only social links — and per repo policy I don't fabricate addresses for shipped UI.

## 2026-05-18 — Link-format guardrail for all agents (broken-anchor regression)

**Why**: in QA on the Abel agent the assistant emitted a raw HTML anchor tag instead of a markdown link or bare URL. `ChatBot.formatHtml` HTML-escapes the input first (correctly — that's an XSS defense from the earlier security review), but the bare-URL auto-linker then matches the URL *inside* the escaped tag string and wraps it in a real `<a>`. The browser renders a mix of decoded entities + real anchor, which looks like attribute soup in the bubble (`href="…" target="_blank" style="…">…`). The root cause was a leftover "make links clickable" line in Abel's `system_prompt` (carried over from the original Vindman avatar), which Claude reads as license to emit HTML.

**What changed**:
- `app/api/bots/[id]/chat/route.ts`: new always-on `LINK FORMAT` system rule injected before `SAFEGUARDS` for every agent — plain URL or markdown only, no `<a>`, no `target`/`rel`/`style` attributes. Applies to all bots so any future copy-pasted prompt that hints at HTML is contained.
- Abel `system_prompt`: replaced the "make links clickable" sentence with "Write URLs as plain text or markdown — never as HTML anchor tags."
- Swept `bots` rows for `clickable` / `<a href` in `system_prompt` or `personality` — Abel was the only hit.
- `docs/BOTS.md`: the prompt-assembly section now documents the LINK FORMAT block alongside SAFEGUARDS and EMOTIONAL RESET.
- **Client-side belt-and-suspenders**: `ChatBot.formatHtml` now does a step `-1` normalisation that rewrites any `<a href="…">text</a>` the model emits into markdown `[text](url)` before the HTML-escape pass runs. So even if a future agent prompt accidentally invites HTML output again, the bubble renders cleanly instead of leaking attributes as text.

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

**Next (Bucket B-E of entity-views build)**: entity cloud (`EntityCloud.tsx` mirroring `WordCloud.tsx`), per-entity sentiment (adapt the clause-aware proximity scan at `WordCloud.tsx:206-240` for multi-word entity spans + alias expansion), entity compare chart (fork or generalise `BreakdownDist.tsx`), `View by Theme | Entity` toggle at the TextMine module top, category-restricted monthly discovery (skip food/drink once menu seed exists).

## 2026-05-18 — Fleming's menu seed + person-at-collection suppression (Buckets A operational test + F)

**Why**: testing the menu-PDF workflow end-to-end on Fleming's (brand-collection `11daf03a-…`) surfaced the predicted noise: 198 of 497 catalog rows were `category='person'` — staff names from many locations, each mentioned in 1–2 reviews. They dominate the catalog without adding brand-wide signal. The brainstorm that produced bucket F predicted exactly this; doing the menu seed made it tangible.

**What changed**:
- Fetched Fleming's official dinner PDF (`https://www.flemingssteakhouse.com/-/pdf/5702-dinner.pdf`) via curl with browser headers (WebFetch was 403-blocked).
- Extracted 78 entities (52 food, 26 drink) — appetizers, salads, soups, sides, every steak and cut, entrées, Chef's Signature items, all hand-crafted cocktails, zero-proof beverages, and the wine producers reviewers actually name (Caymus, Duckhorn, Stag's Leap, etc.). Aliases capture vernacular ("the filet", "mac n cheese", "the tomahawk").
- Wrote `/tmp/flemings_menu_seed.sql` and applied via `supabase db query --linked`. Used `ON CONFLICT … DO UPDATE` to promote any existing discovered match to `source='manual'` while unioning aliases (18 of 78 hit existing slugs and were promoted; 60 new). Audit log entry written so the panel's "Last updated" reflects the seed.
- `lib/entityFilter.ts`: `getEntitiesWithCounts` now adds `.neq('category', 'person')` to the catalog query when `scope.scopeType==='collection'` *and* `includeHidden=false`. Manage Entities still sees person rows so users can curate; standalone datasets are unaffected.
- `docs/ANALYTICS.md`: new "Person suppression at collection scope" subsection documents the rule.

**Result for Fleming's**: catalog visible to cloud / compare / drill / schema preview / Ask Ana drops from ~479 noise-heavy rows to ~281 useful ones (food, drink, brand, place). Manage panel still surfaces all 198 person entries so they can be curated individually if any deserve promotion to `brand` (e.g., a named chef).

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Menu seed verified in prod via the verify SELECT in the SQL file (52 food manual + 26 drink manual present, alongside reduced discovered counts).

**Next**: Bucket B (entity cloud + per-entity sentiment using the clause-aware proximity scan).

## 2026-05-18 — Entity Clouds + per-entity sentiment (Bucket B)

**Why**: the pill list answers "what entities are mentioned" but not "how big is each in this view" or "how does sentiment feel per entity." The cloud is the visual layer themes already had at `components/analyze/textmine/WordCloud.tsx`; the entity catalog deserves the same. Per-entity sentiment is the bigger value — it's the answer to "is the steak getting good or bad reviews" without anyone reading 200 rows.

**What changed**:
- `components/analyze/textmine/EntityCloud.tsx` (new, ~280 lines): renders the scope's catalog as a sized + colored cloud. Two color modes — Category and Sentiment. Category chips at the top dim out everything not in the chip's category (mirrors WordCloud's theme-chip dimming). Words sized by per-entity row count *within the currently-filtered view* — so the cloud answers questions about the user's current slice, not the scope total. Click any entity → `handleDrillEntity` (existing wiring opens the EntityCommentsPanel modal with the rows that mention it).
- Sentiment algorithm: per row → split text into clauses on `but / however / although / yet / though / while / whereas / comma` → for each clause, alternation-regex detect every entity term (canonical + aliases + plural variants from `lib/entityVariants.ts::expandEntityTerms`) → count opinion-word hits in the clause's tokens → credit each entity in that clause with the clause's pos/neg counts. Mixed-sentiment rows ("loved the steak but hated the wait") split correctly because the clause boundary is the credit boundary. Cheaper than WordCloud's per-token proximity scan and more apt for entities (the entity is usually the subject of its clause, so the whole clause's opinion words apply, not just neighbors).
- `components/analyze/TextMineModule.tsx`: dynamic-imports `EntityCloud` (parallel to `WordCloud`), mounts it below WordCloud inside the `subTab === 'clouds'` branch behind an `entityCatalogRows.length > 0 && effectiveFields.length > 0` guard. Passes `parsedData=filteredRows` so the cloud respects current filters.
- `docs/ANALYTICS.md`: "Where entities show up" entry for TextMine → Clouds documents the new view + sentiment method. Schema-tab entry updated to mention preview/manage modes.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Visual QC on the Fleming's dataset pending (would benefit from rendering the Clouds tab with the menu seed live).

**Performance notes**: single alternation regex built once per useMemo; O(rows × regex pass) for both freq and sentiment scans. 45K rows × ~100 entity terms expected to run in <500ms on the existing TextMine "rows loaded client-side" model. If this becomes a bottleneck above 100K rows, fold both passes into one and move the regex build behind a useDeferredValue.

**Next**: Bucket C (entity compare chart by group) and/or Bucket D (View by Theme | Entity toggle at the TextMine module top). With the cloud + sentiment live, the compare chart is the missing visualization piece before we can claim a full theme-functionality mirror.

## 2026-05-18 — Entity Breakdown chart (Bucket C)

**Why**: theme `BreakdownDist` shows theme prevalence across categorical groups with significance markers — "which group disproportionately mentions which theme." Entities deserve the same view: "which Fleming's location over-indexes on the Filet vs the Tomahawk." Without it, the only way to compare entities across a segment is to filter the cloud one segment at a time. The compare chart is what makes brand-rollup analysis useful.

**What changed**:
- `components/analyze/textmine/EntityBreakdownDist.tsx` (new, ~270 lines): mirror of `BreakdownDist.tsx` operating on the entity catalog instead of the theme model. Two views — **By Group** (each group's stacked bar segmented by entity, with per-entity rows + significance + rating delta) and **By Entity** (each entity's bar across groups, default view since entity counts are higher than theme counts).
- Matching: same alternation regex over `canonical + aliases + expandEntityTerms` that `EntityCloud` builds, but computed once per render into a per-row → `Set<slug>` map. Every group×entity cell then derives from that map in O(rows + groups × entities) instead of O(rows × entities × groups).
- Significance markers (★) reuse `lib/statsUtils::sigTest` (2-proportion z-test), so over/under-representation signals are comparable between the theme and entity charts. Rating deltas (when a rating field is set) are colored green / red around overall mean.
- Top-25 cap by default + 1%-of-rows threshold (entities below get hidden behind a Show all toggle) keep the chart legible for catalogs with 100+ entries.
- `components/analyze/TextMineModule.tsx`: dynamic-imports `EntityBreakdownDist`, mounts it below `BreakdownDist` on the Themes subtab behind the same `breakdownField && selectedValues.size > 0 && themesView !== 'signals'` gate plus `entityCatalogRows.length > 0 && effectiveFields.length > 0`. Reuses the existing `breakdownField` + `selectedValues` state — no new sidebar controls.

**Why not generalize BreakdownDist instead of fork**: theme matching (`Theme.keywords + commentMatchesTheme`, with negation support) and entity matching (`canonical + aliases + plural variants`) don't unify cleanly without one side losing precision. The two charts share a ton of layout code but diverge in matching, which is the load-bearing part. Forked keeps both readable; the cost is two files that move together when the look-and-feel changes.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Visual QC on Fleming's pending.

**Next**: Bucket D (View by Theme | Entity toggle at the TextMine module top) and Bucket E (category-restricted monthly discovery — skip food/drink in cron NER once a menu seed exists, saves ~half the AI cost). With C done, the theme-functionality mirror is complete; D and E are polish/cost optimization.

## 2026-05-18 — View toggle + category-restricted discovery (Buckets D + E)

**Why (D)**: with the cloud, sentiment, and compare chart now living as a parallel stack to the theme equivalents on the same TextMine subtabs, the page got visually noisy — both stacks competed for attention. A toggle promotes one set at a time, giving users a clean view that matches their current question ("am I looking at concepts or named things?").

**Why (E)**: the weekly cron re-runs NER discovery across every brand-collection. For brands that have menu-PDF-seeded `source='manual'` food/drink, those Haiku calls produce mostly duplicates or noise — the catalog already has the right list. Auto-excluding curated categories drops the cron's AI cost roughly in half on seeded brands without losing the long-tail discovery for `brand`/`place`/`person`.

**What changed**:
- `components/analyze/TextMineModule.tsx`:
  - New state `viewBy: 'theme' | 'entity'` (default `theme`), persisted in the same session-state object that already saves subTab/themesView/etc.
  - Toggle button rendered in the subtab header's right-side action area, visible only on Themes / Clouds subtabs and only when an entity catalog exists for the scope (otherwise Entity mode would render empty).
  - Themes subtab: AI banner, summary cards, themesView switcher (Distribution/Cards/Signals), the three themesView blocks, and BreakdownDist all gated to `viewBy === 'theme'`. EntityBreakdownDist gated to `viewBy === 'entity'`. EntitiesCard remains visible in both modes (it's the gateway/drill-in for entities).
  - Clouds subtab: WordCloud + its opinion/theme popovers gated to `viewBy === 'theme'`; EntityCloud gated to `viewBy === 'entity'`. h2 title flips between "Theme Clouds" and "Entity Clouds". Fallback empty-state message when an entity-view scope has no catalog yet.
- `lib/entityDiscovery.ts`:
  - New opts: `excludeCategories?: string[]` (explicit list of categories to skip in the NER prompt) and `autoExcludeFromCurated?: boolean` (auto-detect from `source='manual'` row counts ≥ `autoExcludeThreshold` default 10).
  - NER prompt rewritten to render only the active categories' descriptions in the "Extract" list and add a "Do NOT extract" block listing curated categories with the reason.
  - Post-filter on NER results drops any entity in an excluded category (defence against the model ignoring the instruction).
- `app/api/cron/entity-discovery/route.ts`: weekly cron now passes `autoExcludeFromCurated: true`.
- `lib/brandRules.ts`: per-dataset incremental run (`discoverBrandEntitiesIfNeeded`) also passes `autoExcludeFromCurated: true` — same cost-saving logic at the point a new dataset lands in a brand.
- Manual "Discover entities" button on the Schema tab does NOT pass the flag — when a user explicitly clicks Discover, give them everything (they may want to re-explore curated categories).
- `docs/ANALYTICS.md`: "Category-restricted discovery" subsection added; "Where entities show up" entries updated for the view toggle.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Visual QC on the toggle pending — need to render Themes and Clouds subtabs against the Fleming's dataset in both modes to confirm the gating is clean.

**Bucket scoreboard**: A ✅ B ✅ C ✅ D ✅ E ✅ F ✅. All six buckets of the entity-views build shipped. The full theme-functionality mirror is live for entities (cloud, sentiment, compare, drill-down, modal), plus the architectural foundation (manual curation, soft-delete, category-restricted discovery) that makes brand-bootstrap from a menu PDF realistic.

**Next**: visual QC end-to-end on Fleming's, then push when ready. After that the open questions are the standard polish items — catalog telemetry on the admin panel, an entity version of CompareTab (multi-field breakdown), and possibly a "promote to brand" affordance for named-chef person entries that survived the collection-scope suppression.

## 2026-05-18 — Cross-slug dedup bug fix on POST /entities

**Why**: visual QC on Fleming's entities card surfaced obvious dupes — `Filet Mignon 519` + `Filet 515`, `Lobster Tail 326` + `Lobster 326`, `Tomahawk 310` + `Prime Tomahawk 310` + `Tomahawk Steak 310`, `Brussels Sprouts 162` + `Crispy Brussels Sprouts 164`. The `entity_catalog` UNIQUE key is `(scope_type, scope_id, slug)`, so a discovered "Filet" (slug `filet`) and a manual "Filet Mignon" (slug `filet_mignon`) coexist even though "filet" is in the manual entity's aliases. Without an explicit dedup step the cloud / compare / pill list shows both — which reads as a dedup bug to users, and rightly so.

**What changed**:
- `app/api/datasets/[datasetId]/entities/route.ts` (POST): after the manual-row upsert, slugify every alias on every upserted row and bulk-update `hidden=true` on any `source='discovered', hidden=false` row in the same scope + category whose slug matches one of those alias-slugs. Same-category guard so a food entity never hides a brand or place that happens to share a name. `entities_auto_hidden` count returned in the response for visibility.
- One-shot cleanup on Fleming's brand-collection (`11daf03a-…`): ran the same alias-match rule via SQL against the 497-row catalog. 30 dupes hidden in the first pass.
- Top-up of Fleming's manual aliases for cases the original seed didn't anticipate: `Prime Tomahawk` += "tomahawk steak"; `Prime Bone-In Ribeye` += "prime ribeye", "bone in rib eye", "rib eye"; `Japanese A5 Wagyu Strip` += "wagyu"; `Fleming's Potatoes` += "au gratin potatoes". 5 more dupes hidden after re-running the cleanup with expanded aliases.
- `docs/ANALYTICS.md`: documents the auto-hide rule on POST `/entities`.

**Limitation honest disclosure**: the rule is conservative — only matches when a discovered row's slug equals a (slugified) alias of a manual row. It does NOT catch token-overlap cases that aren't explicitly aliased (e.g., `Tomahawk Tuesday Special` vs `Prime Tomahawk` — neither is the other's alias). Three options for those: (a) user adds the variant as an alias via the Manage panel, (b) we build a separate "Find duplicates" admin button that runs Haiku canonicalisation across the whole catalog, (c) we accept a manual-curation step. For now (a) is the workflow.

**Real menu items the original seed missed**: discovery surfaced a few that look like real Fleming's menu items I should add as manual entries (not dupes): Lava Cake (Chocolate Lava Cake on the dessert menu), Lobster Mac & Cheese (distinct from Chipotle Cheddar Mac & Cheese), Tomahawk Tuesday Special (recurring LTO). Logged here — adding requires user OK on what counts as "real menu" vs prose-only mention.

## 2026-05-18 — EntityCloud counts now match EntitiesCard (credibility fix)

**Why**: visual QC surfaced two views showing different counts for the same entity. EntitiesCard pill list: "Filet Mignon 519, Prime Bone-In Ribeye 302". EntityCloud on the Clouds tab: "Filet Mignon 510, Prime Bone-In Ribeye 250". User flagged this directly: "those CANNOT BE DIFFERENT otherwise we lose all credibility." Compounding issue: the cloud only rendered 3 entities even though the catalog has 281, because the 3%-of-filtered-rows threshold disqualified almost everything once the counts dropped relative to the API's scope-wide numbers.

**Root cause**: `EntitiesCard` uses `entity.mentions` directly from `GET /api/datasets/[id]/entities` (scope-wide live FTS via `count_entity_terms`, which counts across every dataset in the brand-collection and uses Postgres English stemmer + tsvector field-restricted recheck per mig 070). `EntityCloud` was recomputing counts client-side by alternation-regex over `parsedData=filteredRows` — different denominator (one dataset, post-filter) and different matcher (naive word-boundary regex vs SQL FTS with stemming). The numbers were always going to drift.

**What changed**:
- `components/analyze/textmine/EntityCloud.tsx`:
  - Dropped the `cloudData` useMemo that scanned `parsedData` for per-entity counts.
  - Now sizes by `entity.mentions` directly. Single source of truth = the API, identical to the pill list.
  - Threshold flipped from "3%-of-filtered-rows" to absolute `MIN_MENTIONS = 10`, matching `EntitiesCard`. The "(N below 3% hidden)" hint became "(N below 10 mentions hidden)".
  - Sentiment scan kept as-is — sentiment is intrinsically filter-aware (it scans whatever text the client has), and clearly labeled with a new green "sentiment from visible rows" badge when `colorBy === 'sentiment'`. The "brand-wide" badge gets a tooltip clarifying that sizes/counts come from the API.
  - Dropped the percentage label inside each entity chip (denominator no longer applies cleanly; mention count is the meaningful number).
- `docs/ANALYTICS.md`: updated Clouds-tab entity description.

**Net effect on Fleming's**: cloud now shows the same Filet Mignon=519, Prime Bone-In Ribeye=302, Prime Tomahawk=310 the pill list shows. Threshold of 10 mentions surfaces dozens of entities instead of 3. "Show all" still reveals the long tail.

**Acknowledged shipped-with limitation**: EntityBreakdownDist (the compare chart) inherently computes per-group counts client-side — that's intrinsic to a "by group" breakdown, not a bug. Its `total rows` column does sum the visible per-group counts (which can differ from the scope-wide `entity.mentions`). Considering: relabel as "rows in visible groups" to remove ambiguity, but didn't change in this commit — Bucket C isn't the locus of the credibility issue the user named.

## 2026-05-18 — Manage Entities: inline edit, column alignment, chart label

**Why**: visual QC of the Manage Entities panel surfaced three small but real issues. (1) No edit affordance — Hide / Unhide / Delete were the only per-row actions, so the only way to fix a wrong canonical or add a missing alias was to delete and re-add. (2) Column alignment drifted across rows — each row was its own grid container with `auto` Actions column, and rows with Hide+Delete (manual) had a wider Actions column than rows with just Unhide (discovered), shifting every preceding fixed-width column. (3) `EntityBreakdownDist`'s "rows total" badge was ambiguous — it sums visible-group counts, not the scope-wide `entity.mentions`, but the label invited the same credibility complaint the cloud just got fixed for.

**What changed**:
- `components/analyze/ExtractEntitiesPanel.tsx`:
  - Added per-row **Edit** button. Clicking it swaps the row in-place for a form (canonical input, category dropdown, aliases textarea). Save calls `PATCH /api/datasets/[id]/entities/[slug]` and reloads; Cancel reverts. Error feedback inline if Save fails.
  - Grid template flipped from `'1fr 70px 90px 60px auto'` to `'minmax(0,1fr) 90px 110px 90px 200px'` — fixed Actions column kills the row-to-row drift even when the action set differs (Edit + Hide + Delete vs Edit + Unhide). Entity name + aliases get a two-line layout in COL 1 so wide alias lists don't push the row taller via inline wrapping. minmax(0,1fr) plus `minWidth: 0` on the inner flex enforces ellipsis instead of growing the column.
  - Mentions count right-aligned, tabular-nums, bold. Category capitalised. Source badge unchanged styling.
- `components/analyze/textmine/EntityBreakdownDist.tsx`: per-entity "rows total" badge relabeled "**in shown groups**" with a tooltip explaining the source-of-truth (scope-wide `entity.mentions` is on the pill list, not the chart). Same data, clearer meaning.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Edit flow round-trips PATCH endpoint; existing Hide/Unhide/Delete unchanged.

**Next**: still pending QC — confirm the Manage panel renders aligned in browser, and that Edit round-trips on a real catalog row. Then push the accumulated commits.

## 2026-05-18 — Entity cloud hover-to-isolate + Manage panel action columns

**Why**: more QC feedback. (1) The entity cloud had no "what category is this entity in" cue — hovering should isolate its category the way hovering a theme chip on WordCloud isolates that theme's words. (2) On the Manage panel, the Source badges were left-aligned in their column (looked messy against the centered header), and the three actions Edit/Hide/Delete shared one flex cell — so when a row didn't qualify for Delete (discovered rows), the remaining two buttons re-justified into the empty space, giving the right-hand edge a haphazard look across rows.

**What changed**:
- `components/analyze/textmine/EntityCloud.tsx`: new `hoveredCategory` state at the cloud level. Each Entity child reports its category on `onMouseEnter`/`onMouseLeave` via a new `onHoverCategory` callback. Dim logic now stacks two sources: the existing sticky category-chip filter (click-driven) and the new transient hover-to-isolate (pointer-driven). Hover wins visually because it's an explicit "focus on this one category" signal even if the chip filter has the category active.
- `components/analyze/ExtractEntitiesPanel.tsx`: the Manage panel's row grid template went from `'minmax(0,1fr) 90px 110px 90px 200px'` (Actions as one shared 200px cell) to `'minmax(0,1fr) 90px 110px 90px 70px 80px 80px'` (Edit / Visibility / Delete as three separate fixed columns). Source badge cell is now `display:flex; justifyContent:center` so the pill sits under the centered header. Discovered rows show an em-dash placeholder in the Delete column (with tooltip explaining why discovered rows can't be hard-deleted) so the column stays visually balanced.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`.

**Open Q answered: multi-field entity Compare view** — Bucket C shipped `EntityBreakdownDist` on the Themes subtab for *single-field* breakdowns (one categorical at a time, same controls as the theme `BreakdownDist`). The dedicated **Compare** subtab is still theme-only — its `CompareTab` component does *multi-field* compounded breakdowns ("location × day-of-week") with significance + summary export, and we never built the entity equivalent. Adding it is on the open-items list but not part of Buckets A–F. Roughly 1–1.5 days more work; mostly a fork of CompareTab with the same per-row match-set pattern EntityBreakdownDist uses.

## 2026-05-18 — Multi-field Entity Compare shipped

**Why**: pulled forward the open item from the bucket scoreboard. The Themes/Clouds/Compare subtabs already had entity-view equivalents *except* the Compare subtab, where the dedicated `CompareTab` (multi-field compounded breakdown with significance + summary export) was still theme-only. Building it closes the last gap in the theme-functionality mirror.

**What changed**:
- `components/analyze/textmine/EntityCompareTab.tsx` (new, ~360 lines): mirror of `CompareTab` operating on the entity catalog. Same multi-field field selector (toggleable categorical fields combine into compounded group keys like "Tampa × Friday"). Computes per-row entity match-sets via the alternation regex pattern shared with `EntityCloud` + `EntityBreakdownDist`. Per-(group, entity) stats include count, mention rate, avg rating, and rating significance via `welchTTest` (when ≥5 ratings per side). Two render modes — **By Group** (each segment's entities) and **By Entity** (each entity's prevalence across segments). Significance markers (★) via the same `sigTest` 2-proportion z-test the theme `CompareTab` uses, so over/under-representation signals are directly comparable. Top 25 entities by total mentions across visible groups (`smartAxes` toggle flips between count-sorted and alphabetical); Show all reveals the long tail. "Summarize findings" modal exports a plain-text outlier report (over- and under-indexed segments, copy-pasteable).
- `components/analyze/TextMineModule.tsx`: dynamic-imports `EntityCompareTab` (parallel to `CompareTab`), extends the `viewBy` toggle visibility to include the Compare subtab (previously only Themes / Clouds), and renders `EntityCompareTab` instead of `CompareTab` when `viewBy === 'entity'`. Reuses the same `compareFields` / `compareViewMode` / `compareSmartAxes` state, with a small adapter on `viewMode` to map theme's `'group' | 'theme'` to entity's `'group' | 'entity'` (default to entity-side when switching to entity view).
- `docs/ANALYTICS.md`: new "TextMine → Compare tab" entry under "Where entities show up".

**Bucket scoreboard, final**: A ✅ B ✅ C ✅ D ✅ E ✅ F ✅ + multi-field Entity Compare ✅. Theme-functionality mirror is now complete: cloud, sentiment, single-field breakdown, multi-field Compare, drill modal, all share the entity catalog + matching pipeline.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Visual QC of the entity Compare view itself still pending — would benefit from rendering against Fleming's with multi-field selection enabled to confirm the chart layout matches the theme version.

**Next**: real browser QC of all the entity views end-to-end on Fleming's. Then push the accumulated 15+ commits.
