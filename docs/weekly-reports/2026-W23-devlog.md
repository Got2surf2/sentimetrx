# 2026-W23 — Dev log (Week of Jun 1 to Jun 7)

## 2026-06-05 — TextMine Compare: % ↔ ★ Rating bar-metric toggle

**Why**: Owner — on the Group Comparison chart, wanted to toggle the bars between the current % view and average rating (the rating was already shown as a number on the right, just not visualized).

**What changed** (`TextMineModule.tsx` `CompareTab` + `EntityCompareTab.tsx`, UI-only): a **% / ★ Rating** toggle (shown only when a rating field exists) next to the By Group/By Theme control. In rating mode each bar's width = `avgRating / ratingMax` (absolute scale from the rating field's schema `max`, NPS→10/else 5) and is colored on a red→green ramp; share mode is the existing relative `mentionRate / maxShare`. The right-hand %, n, and ★ columns stay visible in both modes — only the bar encoding changes. `CompareBar` is a closure so it reads `effectiveBarMetric`/`ratingMax` directly (no prop threading); `EntityCompareTab` uses a shared `barStyle()` helper at both its bar render sites. Falls back to share when no rating field.

**Verify**: tsc clean (cache-cleared); 461 tests pass. Browser pixel-render pending (auth-gated). Spec ANALYTICS.md updated. **Local-only.**

## 2026-06-05 — TextMine: drillable Dimensions chips on Theme Clouds (parity)

**Why**: Owner asked whether the pill-drill applies to dimensions too. It did on the theme **cards** (`handleDrillDimension`), but the **Theme Clouds** had no Dimensions row at all — only an Items (entity) row — so dimensions weren't at parity with entities there.

**What changed** (`WordCloud.tsx` + `TextMineModule.tsx`, UI-only): `WordCloud` gains a **"Dimensions" chip row** per theme (reuses the `serverThemeDimensions` map already computed for the cards, keyed by theme id) plus an `onDimensionClick` prop; chips are axis-dot colored and **drill into the Comments filter**. Wired in `TextMineModule` (`themeDimensions={serverThemeDimensions}`, `onDimensionClick → handleDrillDimension`). Now both Items and Dimensions chips appear and drill on cards *and* clouds.

**Verify**: tsc clean (cache-cleared); 461 tests pass. Browser pixel-render pending (auth-gated). Spec ANALYTICS.md updated. **Local-only.**

## 2026-06-05 — Surveys: per-prompt clarifier depth (Q3/Q4)

**Why**: Owner — prospect work (Carrabba's guest-feedback). Open-end clarifiers were single-shot per prompt with only a session-wide `maxClarifierCount`; needed a per-prompt depth dial so a high-value open-end can drill 2–3 follow-ups deep while a low-value one stays single-shot — without multi-probing every prompt (drop-off risk).

**What changed**:
- `lib/types.ts` — added `q3ClarifyDepth?` / `q4ClarifyDepth?` (number, default 1) to StudyConfig.
- `components/survey/useSurveyEngine.ts` — `showClarifyInput` now takes a `depthSoFar` arg and re-probes (via a new `showClarifyInputRef`) up to the configured depth, re-checking `shouldClarify` each turn so a specific answer stops it early; still gated by the session-wide `maxClarifierCount` and deflection/decline. Accumulated answer is threaded into `buildClarify` so the re-probe sees prior context.
- `components/creator/StepConversation.tsx` — `ClarifyDepthPicker` (1/2/3) rendered only when that prompt's clarifier toggle is on.

**Verify**: tsc clean (cache-cleared, exit 0). Backward-compatible — absent value `?? 1` = prior single-shot behavior. Builder UI not pixel-rendered (auth-gated creator flow). Spec SURVEYS.md updated. **Local-only.**

## 2026-06-05 — TextMine: make every count pill drill into the Comments filter

**Why**: Owner — follow-up to the unified Comments filter: any entity/dimension/theme pill should be clickable to see the comments behind it. Several were static.

**What changed** (`TextMineModule.tsx` + `WordCloud.tsx`, UI-only):
- Theme card **Co-occurs** pills → `handleDrillTheme(otherTheme)` (drills that theme).
- Theme card **Items mentioned** entity pills → `handleDrillEntity` (+ selects the card's theme → theme ∧ entity); aliases looked up from `entityCatalogRows`.
- Theme-cloud (`WordCloud`) **Items** chips → new `onEntityClick` prop, wired to `handleDrillEntity`.
- (Already drillable, unchanged: Entities card, Entity cloud, theme-card Dimensions chip + title, Dimensions-tab axis/sub drawer, cloud theme-title popover which shows its comments inline.)

**Verify**: tsc clean (cache-cleared); 461 tests pass. Browser pixel-render pending (auth-gated). Spec ANALYTICS.md updated. **Local-only.**

## 2026-06-05 — TextMine Comments: unified entity + dimension + theme filter (AND)

**Why**: Owner — the Comments tab could filter by theme (strip) OR drill one entity OR drill one dimension, but never combine them. Wanted to filter comments by entity AND dimension AND theme simultaneously ("show me *steak* comments tagged *temperature* that mention *the ribeye*").

**Decision**: client rows (`/rows`) carry only `data` — no flat `id`/`row_index` — so dimension tags (keyed by `row_id`) can't be joined client-side, and exposing a join key pollutes 4+ `Object.keys(row)` consumers (FrequencyChart/signalTier/termInsights/datasetUtils). Entity + dimension drills are already server-side, so the surgical path is a **combined server endpoint** (chosen with owner over a forced client-side join).

**What changed**:
- `sql/113_get_rows_by_filters.sql` — RPC returning rows matching ALL active facets (AND across, OR within): theme + entity reuse the `get_rows_by_entity` FTS prefilter + open-ended recheck (independent `websearch_to_tsquery` per facet); dimension is an axis array-overlap on `dataset_row_taxonomy` (one `text[]` of selected subs per axis). `count(*) OVER()` carries the total.
- `lib/commentFilter.ts` — `getRowsByFilters`: resolves the comment scope (collection→members, else the dataset itself — *not* brand siblings, matching what `/rows` loads), builds the theme/entity tsqueries (reuses `buildThemeQuery`/`buildEntityQuery`, now exported) + per-axis sub arrays, calls the RPC.
- `POST /api/datasets/[id]/comments` — org-gated; flattens selected themes' keywords, entities (canonical+aliases), dimension {axis,sub}; returns `{rows, total}`.
- `components/analyze/textmine/FilteredCommentsPanel.tsx` (new) — server-filtered results panel (card/sort/grid/infinite-scroll adapted from the old EntityCommentsPanel) with multi-term highlight + an active-filter summary header.
- `TextMineModule.tsx` — Comments tab now has a **3-row filter bar** (Themes strip + Entities picker + Dimensions picker). `commentsServerMode = any entity/dimension selected` → `FilteredCommentsPanel` (debounced fetch on facet change); themes-alone keeps the rich client `CommentsPanel`. Entity drill (`handleDrillEntity`) + the theme-card **Dimensions chip** (`handleDrillDimension`) now add to the facets and open the tab pre-filtered. Removed the now-orphaned `EntityCommentsPanel.tsx` (its single-entity drill is subsumed). Dimension facet options fetched once from `/taxonomy` (axes+subs).

**Verify**: tsc clean (cache-cleared); 461 tests pass; `sql/113` APPLIED to prod + verified end-to-end (Cheddar's theme `steak` ∧ dimension `product:steak` → 948 total, paged). Degrades gracefully if the RPC is absent (endpoint errors → empty results, filter bar still renders). Browser pixel-render pending (auth-gated). Specs ANALYTICS.md + specMap updated. **Local-only.**

## 2026-06-05 — Dimensions rollup: dynamic rating field + aliases (open item #3)

**Why**: The Dimensions per-axis/per-sub ★ ratings hardcoded `data->>rating` (`taxonomyRollup.ts`), so on surveys whose rating field has a different key (and aliased text values) — e.g. Carrabba's GSS, where the field is literally the satisfaction question text with `valueAliases` "Highly Satisfied"→5 — every per-dimension ★ came back blank. (The metric strip already handled this via `field_aliased_avg`; the rollup didn't.)

**What changed**:
- `lib/taxonomyRollup.ts` — `computeTaxonomyRollup` now **detects the rating field dynamically** (`detectRatingField`: first numeric field with `sqt` rating/nps/likert or `scoreField`, from `dataset_state.schema_config` — same rule as the strip) and resolves **remapped** values (label→number via the field's `valueAliases`) per row before averaging. Per-page values come from a new `dataset_field_values(dataset, field, ids[])` RPC (sql/112) — the field is a **bind param**, so survey keys with spaces/commas/apostrophes/"?" work (a PostgREST select string can't express them; the select parser splits on the comma in the question text). A plain `rating`-named field still uses the direct `data->>rating` select, so existing google_reviews rollups don't depend on the new RPC.
- `sql/112_dataset_field_values.sql` — read-only SECURITY-DEFINER helper; org access enforced by the caller (pairs dataset_id+org_id).

**Verify**: tsc clean; 461 tests pass; logic validated read-only vs prod — Carrabba's GSS now computes overall ★4.14 (matches the strip) + per-dimension ★ (attribute·flavor 4.20, ·accuracy 2.68, ·temp 2.35 — sensible, low on accuracy/temp complaints), all blank before the fix. **sql/112 must be applied to prod before the deployed rollup picks up aliased fields** (degrades gracefully without it: the RPC errors → ratings null → ★ blank, same as today). NB: Carrabba's still carries the owner's "Somewhat Satisfied"→1 alias typo (open item #4, owner fixes in Schema editor). **Local-only.**

## 2026-06-05 — Per-theme Dimensions row on theme cards (open item #2)

**Why**: Owner asked (deferred mid the Dimensions arc) — the theme cards already show "Items mentioned" (entities within a theme); the classification analog was missing. "When people talk about *steak*, which Dimensions (service/food/drinks/…) do they discuss?"

**What changed**:
- `sql/111_theme_dimension_counts.sql` — new `theme_dimension_counts(dataset, field_keys, keywords, limit)` RPC: matches rows by the theme's keyword regex (`\m(kw1|kw2|…)`, same as `count_theme_matches`) → joins `dataset_row_taxonomy` → unnests all 7 axis arrays → returns top `(axis, sub, count)`. Read-only, SECURITY DEFINER.
- `app/api/datasets/[datasetId]/theme-counts/route.ts` — new optional `dimensions` flag: per theme, calls the RPC (summed across member datasets for collections), returns `dimensions: {themeId → [{axis, sub, count}]}`.
- `components/analyze/TextMineModule.tsx` — `fetchServerThemeCounts` passes `dimensions: dimensionsEnabled` (gate = `datasetSource==='google_reviews' || taxonomyEnabled`, same as the Dimensions sub-tab); stores `serverThemeDimensions`; theme card renders a **"Dimensions" chip row** (top 6, axis-dot colored, after "Items mentioned") via `DIM_AXIS_LABEL`/`dimSubLabel`. Renders only when the dataset is classified and the theme's matched rows carry tags.

**Verify**: tsc clean; 461 tests pass; RPC logic validated read-only vs prod (Cheddar's steak theme → product·steak 1044, touchpoint·server 418, attribute·flavor 339 — sensible). Route degrades gracefully if the RPC isn't applied (empty → suppressed). **sql/111 must be applied to prod** for the row to populate after deploy. Browser pixel-render pending (auth-gated). Specs ANALYTICS.md + TAXONOMY.md updated. **Local-only.**

## 2026-06-05 — Town Hall: post-upload brand/agent link + prompt cleanups

Four follow-ups from the open-items review:
- **Post-upload brand/agent link (the recurring gap).** `PATCH /api/recordings/[id]` now accepts `{name?, brand_tag?, underlying_agent_id?}` (owner/admin; agent verified in-org) alongside rename + org-transfer — an existing recording can finally be tagged to a brand/agent after upload. UI: an owner-only "Brand & linked agent" editor in the report's Export & Share tab (brand input + agent picker fed by a new org-agents fetch in `report/page.tsx` → `ReportData.agents`). Set it, then re-extract to apply spelling correction (§3.5c).
- **Typology reframe (§3.5).** The extraction + curator prompts no longer frame non-`ask` typologies as "kept for the appendix / not actionable" — typology is now described as a descriptive label only (all pairs retained equally; it just drives the report's filter). Matches the unified Q&A tab and discourages under-classifying real questions as commentary.
- **Curator agenda-string fix (§3.6 issue 1, deeper).** `buildQaCuratorPrompt` B-GROUP now copies a matching agenda topic's string **verbatim** (no re-casing) and only Title-Cases topics it invents — stops the casing drift at the source (the display-layer normalize stays as a backstop).
- **Entity dedupe (data op, prod).** Folded `Hatem A. Abou-Senna` into `Hatem Abou-Senna`'s aliases and deleted the duplicate catalog row in Sarina's bot scope. Catalog now has one Hatem with aliases `Hatham | Hatham Abou-Senna | Hatem A. Abou-Senna`.

Typecheck clean. Specs RECORDINGS.md §3.6/§5.4 updated. **Local-only.**

## 2026-06-05 — Agent entities: wire Delete (full CRUD on manual)

**Why**: After manual-add, the only "removal" in the UI was Hide (soft-delete). Manual rows the user added by mistake should be truly deletable.

**What changed** (`app/bots/[id]/entities/EntitiesClient.tsx`): a **Delete** button on **manual rows only** (red, with confirm) → `DELETE /api/bots/[id]/entities/[entityId]` → reload. The DELETE endpoint already existed and is correct — it hard-deletes `source='manual'` only and returns 400 ("Hide discovered entities instead") for discovered rows, so re-discovery can't resurface admin-rejected noise. So bot entities now have full CRUD: Create (POST) · Read (GET) · Update (PATCH) · Delete (DELETE, manual-only); Hide/Unhide remains for discovered rows. Typecheck clean; BOTS.md §9.y updated. **Local-only.**

## 2026-06-05 — Agent entities: manual add (survives re-extraction)

**Why**: You could edit/hide discovered entities on `/bots/[id]/entities`, but there was no way to *create* one the NER never caught (e.g. a panel member). The preservation half already existed — `entity_catalog.source='manual'` (sql/073), and both `entityDiscovery.ts` (dataset) + `botEntityExtraction.ts` (bot) skip/preserve manual rows — but the create path was missing for bot scope.

**What changed**:
- `app/api/bots/[id]/entities/route.ts` — new **`POST`**: creates an `entity_catalog` row (`scope_type='bot'`, `source='manual'`, slug via `slugify`). Idempotent: if the slug already exists (even hidden), it unhides it, flips to `manual`, and merges aliases instead of erroring — so "add" also rescues a hidden row. Same paired `(id, org_id)` gate as GET/PATCH.
- `app/bots/[id]/entities/EntitiesClient.tsx` — "+ Add entity" button → inline form (name / aliases / category, 16px iOS-safe inputs). Note explains manual rows survive re-extraction and that aliases drive ASR spelling correction for the brand's recordings (§3.5c) — i.e. how to add "Hatem Abou-Senna" + the "Hatham" alias via UI instead of SQL.

Manual rows are NEVER overwritten/removed by re-extraction (verified). Typecheck clean for these files; spec BOTS.md §9.y updated. **Local-only.** NOTE: the **dataset-scope** manual-add (`ExtractEntitiesPanel.tsx`) is being built in a **parallel session** (uncommitted, mid-edit, has its own tsc error) — left untouched; this is the bot/agent-scope counterpart.

## 2026-06-05 — Action-item transcript traceability + NOWOCATS entity alias

**Why**: Action items had no link back to the transcript (synthesis creates them without timestamps), so a reviewer couldn't verify where each came from. And the panel member "Hatem Abou-Senna" kept rendering as ASR's "Hatham" — the canonical was in Sarina's catalog but had no alias to map the misspelling.

**What changed**:
- `lib/recordings/transcriptRoles.ts` — new `traceActionItem(segments, description)`: locates the best ±2-segment window by **distinctive content-word** overlap (stopword-filtered, raw count — a sliding sum so a multi-segment discussion beats any single short line) with the paraphrased description; returns the anchor + window, or null on a weak match. First attempt (fraction-of-segment-words, no stopwords) anchored on junk like "the the," — fixed with the content-word approach; re-verified on Meeting 2 (SR 429→"four twenty nine Wakaiwa Parkway", Christina Moore, follow-up date all anchor correctly).
- `app/recordings/[id]/report/ReportClient.tsx` — Action items tab gains a `↪ Source · {time}` chip → `ActionSourceModal` showing the derived transcript window (anchor bolded). Tests in `tests/unit/recordings/transcriptRoles.test.ts` (2 new).
- **Entity alias (data op, prod, authorized):** added `Hatham` + `Hatham Abou-Senna` as aliases of `Hatem Abou-Senna` in Sarina's `entity_catalog` (bot scope) → all future NOWOCATS recordings auto-correct the ASR misspelling via §3.5c brand convergence. (Meeting 2's existing data was brute-forced separately.)

68 recordings unit tests pass; typecheck clean; trace QC'd on real data. Spec §5.4 updated. **Local-only.**

## 2026-06-05 — Town Hall report: unified Q&A list + Coverage-first nav

**Why**: Owner pushed back on the two-group split — the "Appendix" tab held clarifications + question-bearing complaints, which ARE questions, so the "Q&A summary (6)" headline under-represented the ~14 questions actually asked. The split dates to the first recordings spec commit (`38a18d13`, 2026-05-30); the extraction prompt routes `ask`→main / rest→appendix. Owner chose: one unified list, typology as a filter not a hide.

**What changed** (`app/recordings/[id]/report/ReportClient.tsx`):
- **Removed the Appendix tab.** The Q&A tab (renamed "Q&A") now shows **all** `qa_pair` rows (every typology), keeping By-topic / In-order. A **typology filter** (All / ask / clarification / complaint / commentary chips, with counts) narrows the list; each card already shows its typology chip. Deleted the dead `AppendixTab` + the ask/non-ask split memo.
- **Coverage is now the first tab AND the default landing** (was default-but-3rd, which was incoherent). Bar order: Coverage · Q&A · Action items · Transcript · Export & Share.
- Fixed the Coverage "flagged" copy that referenced the removed Appendix tab.
- The deck, `/th` share, and PDF already rendered all pairs (never split on `ask`), so no change needed there.

Spec `RECORDINGS.md §5.4` updated (unified tab + filter, renumbered). Typecheck clean; 66 recordings tests pass. **Also (data op, not code):** brute-forced `Hatham`→`Hatem` across Meeting 2's transcript / extractions / summary / derived dataset (ASR misspelled panel member Hatem Abou-Senna; the canonical is in Sarina's catalog but had no `Hatham` alias — root-cause fix = add the alias, pending). **Local-only.**

## 2026-06-05 — Town Hall report: auditability overhaul (Coverage timeline, transcript marking, span tightening)

**Why**: Auditing a recording's Q&A extraction was hard — the report mislabeled counts, the Coverage view was broken/confusing, and there was no way to see *where* in the meeting each Q&A came from or *what* the raw transcript said. Owner wanted the report to make extraction trustworthy at a glance, and flagged two recorded issues in `docs/RECORDINGS.md §3.6`.

**What changed**:
- **Q&A count fix** — the report header + Status page counted ALL extraction rows (incl. `action_item`) as "Q&A pairs" (showed 22 vs the real 17). Both now count `unit_type='qa_pair'` only. New **Action items** tab surfaces the 5 action items (were invisible in the UI, deck-only). `ReportClient.tsx`, `app/api/recordings/[id]/route.ts`.
- **Coverage tab overhaul** — recomputes live from current pairs (excludes action items; self-heals without re-extract). Fixed the empty confidence histogram (CSS %-height collapse → px heights + count labels). New **meeting timeline**: one block per pair placed/sized by time, green/amber (clean/flagged), circled numbers, time axis, **click → transcript modal** (Q bold / A bold-italic).
- **Transcript marking** — `lib/recordings/transcriptRoles.ts` `buildTranscriptRoles` maps each segment to question/answer via monotonic word-overlap; Transcript tab renders Q **bold** / A ***bold-italic*** / ignored plain. Verified the Q→A boundary lands correctly on Meeting 2.
- **Issue 1 FIXED (per-topic false flag)** — `perTopic` reconciled agenda↔topic by exact string; curator's emergent casing split "Project timeline (0 ⚠)" from "Project Timeline (9)". Now normalized (`trim().toLowerCase()`). `lib/recordings/coverage.ts` + regression test.
- **Issue 2 FIXED (overlapping timeline blocks)** — confirmed NOT a duplicate (#10/#11 are distinct Qs with overlapping Opus spans). Root-cause fix: `tightenSpansFromTranscript` re-anchors each pair's `start_sec/end_sec` to its matched segments' real ASR timestamps (global one-segment-one-pair assignment) at analyze-time — deterministic, $0, beats a second AI pass. On Meeting 2: #11 start 1443→1470, all overlaps gone (2 lanes → 1). `packLanes` lane-staggering kept as backstop for genuine simultaneity. `scripts/backfill-recording-spans.ts <id>|--all` tightens existing recordings (no AI) — **run on Meeting 2 (the only complete recording) 2026-06-05: 15/17 pairs tightened, 0 overlaps confirmed in prod.**
- **Timeline on all 4 surfaces** — shared `lib/recordings/timeline.ts` (geometry + lanes + HTML renderer) drives the Coverage tab, the public `/th` share page, the PDF report (`reportHtml.ts`), and the PPTX deck (`recordingDeck.ts`). External surfaces use a single brand colour and **never show the flagged state** (internal QC). Span columns + `source_duration_sec` threaded through the PDF + PPTX routes.

Verified: 66 recordings unit tests pass (new: timeline, transcriptRoles incl. tightening, coverage casing); typecheck clean; PDF + PPTX timeline rendered to PNG and eyeballed (deck shows 17 numbered blocks, 1 lane, teal, Datanautix footer). Specs: `RECORDINGS.md §3.6` both issues marked fixed + §3.8/timeline. **Local-only — owner pushes.**

## 2026-06-04 — Town Hall cards: ℹ️ lifecycle progress popover

**Why**: Owner — recordings don't require every step, so users get confused about what's done / what's optional. An at-a-glance progress checklist per recording.

**What changed**:
- `app/recordings/RecordingsListClient.tsx` — an **ℹ️** button in the card's top-right cluster opens a **Progress** popover: Uploaded · Transcribed · Entities reviewed *(opt)* · Q&A generated · Polished edits *(opt)* · Public link shared *(opt)*, each ✓ (green) / ○ (gray) with "optional" marked and a footer note "only upload + generate are required." Steps derived by `lifecycleSteps()` from `status` + flags. Click-away shared with the ⋯ menu.
- `app/recordings/page.tsx` — the query now selects `share_enabled` + `entity_map` and runs one JSONB query (`payload->>edited_at` not null) to flag which recordings have human edits; maps `entities_reviewed` / `has_edits` / `shared` onto each card.

Verified: popover QC'd via throwaway route + Playwright (complete card all ✓, edits predicate confirmed against prod); /recordings compiles; tsc clean. Spec §5.5 updated. **Local-only.**

## 2026-06-04 — Town Hall: human edit layer for Q&A pairs (§3.5d)

**Why**: Owner wants the AI polish to be hand-correctable — and explicitly to **retain** the AI version when a human edits, so a botched edit can't destroy it ("stops people from fucking up royally"). A third text layer.

**What changed**:
- `QaPairPayload` gains `edited_question`/`edited_answer`/`edited_at` (JSONB — **no migration**). Three layers: verbatim → AI polished → human-edited, none overwriting the prior.
- `lib/recordings/qaDisplay.ts` (new) — `displayQuestion`/`displayAnswer` resolve precedence `edited → polished → verbatim` (with a `verbatim` override). The single source of truth; **all four display surfaces** (report card, `/th`, PDF `reportHtml`, PPTX deck) now import it instead of inlining `polished || verbatim`.
- `PATCH /api/recordings/[id]/extractions/[extractionId]` (new) — writes `edited_*` only (a side stored only when it differs from AI; null clears → revert). Same-tenant gate, qa_pair-only. The verbatim-keyed `dataset_rows_flat` mirror is left untouched.
- Report Q&A card — **✎ Edit** pill → a modal showing, per side, **Verbatim (reference) · AI (read-only) · editable box**, with Save / Revert to AI / Cancel. The `EditLayer` is module-level (hoisted out of the modal so the textareas don't lose focus per keystroke). Card badge now distinguishes Human-edited / Polished / Verbatim.
- `tests/integration/recording-edit-pair-gate.test.ts` (5 cases): edited write + stamp, null-reverts-to-AI, cross-org 404, non-qa_pair 400, empty-body 400.

Verified: edit modal QC'd via a throwaway route + Playwright (3 layers per side render, verbatim shown as reference per the owner's ask); 446 tests pass (5 new); tsc clean. Spec §3.5d + §4 added. **Local-only.**

## 2026-06-04 — Town Hall polish: 3 consistency fixes (road format, redundant parenthetical, theme slides)

**Why**: Reviewing the upgraded deck against the vendor PDF surfaced three small inconsistencies.

**What changed**:
- `buildQaPolishPrompt` — road designations now use **one consistent abbreviated form per answer** (no more "State Road 441 and SR 436" mixing → "SR 441 and SR 436"); the `(specifically …)` parenthetical is appended **only when it adds info not already in the question** (kills the redundant "(specifically Kelly Park Road…)" on questions that already name the place).
- `lib/pptx/recordingDeck.ts` — the **Conversation Themes** slides' representative exchanges were verbatim while the appendix was polished. Now a `polishExchange` lookup maps each exchange back to its pair's polished text (matched by normalized question, prefix-overlap fallback), so theme slides read consistently (incl. FDOT-style acronym expansion). Shares the `usePolished` flag with the appendix.

Verified: cheap targeted polish run (~$0.02) confirmed "SR 441 and SR 436" + no redundant parenthetical; cache-rebuilt deck shows the theme slides now polished (SunRail question synthesized, FDOT expanded). tsc clean. Spec §3.5/§4.13 updated. Prompt + deck-render only — the prompt refinements apply on the next analyze; the theme-slide fix applies on the next deck export. **Local-only.**

## 2026-06-04 — Town Hall report: "In order" Q&A view

**Why**: Owner — the Q&A tab only grouped by topic; there was no way to see all questions in the sequence they were actually asked. Added a chronological view.

**What changed** (`app/recordings/[id]/report/ReportClient.tsx`, QATab): a **By topic / In order** segmented toggle next to Expand/Collapse. "In order" flattens every pair into one list sorted by `start_sec` (sort_order tiebreaker), each numbered via a new optional `QACard ordinal` prop. Same cards, same controls, just re-sorted. tsc clean. Spec §5 Q&A-tab updated. **Local-only.**

## 2026-06-04 — Town Hall polish pass: vendor-grade Q&A (synthesis + road numbers)

**Why**: Owner shared the competitor's NOWOCATS "Q&A Forum" PDF as the bar to beat, and flagged that road numbers came out as words ("forty one State Road" instead of SR 441) and inconsistently. The polish pass was a faithful cleanup of both Q and A; it needed to match the vendor's *synthesized* question style + correct domain terminology.

**What changed** (`lib/recordings/prompts/qa.ts`, `buildQaPolishPrompt`):
- **Question → synthesized** into one crisp standalone question (strip preamble/cross-speaker references) that keeps the resident's specific concern in `(specifically …)` — the vendor's technique.
- **Answer → faithful cleanup** (unchanged intent: no invented facts, keep every figure/commitment) but explicitly in complete, neutral, professional sentences.
- **Terminology rules (both sides):** road/route designations as numerals with prefix (`SR 436` / `US 441` / `I-4`), converting spoken number-words in road context ("four thirty six State Road" → State Road 436); agency/program acronyms expanded on first use (FDOT, ITS).

Verified on real Meeting 2 verbatim pairs via a throwaway harness (read-only on the recording; ~$0.02): the exact failure case now polishes "four forty one State Road and four thirty six" → "**SR 441 and SR 436**"; questions gain the `(specifically …)` treatment; FDOT/US 441 render correctly. tsc clean. Prompt-only — takes effect on the next extract/polish (re-extract Meeting 2 to apply to the existing deck). Spec §3.5 pass-4 updated. **Local-only — owner pushes.**

## 2026-06-04 — Town Hall share link: polished vs verbatim Q&A (owner setting)

**Why**: Owner — the public share link should let the owner choose polished (default) vs verbatim Q&A for what recipients see; some meetings read better as the exact words. (The page already preferred polished with per-pair fallback — this adds explicit control.)

**What changed**:
- **`sql/104`** — `recordings.share_verbatim BOOLEAN NOT NULL DEFAULT FALSE` (false = polished, the existing behavior).
- `app/th/[token]/page.tsx` — when `share_verbatim`, render `question`/`answer` (verbatim); else `polished_* || verbatim` (default). The meeting transcript is still never shown.
- `POST /api/recordings/[id]/share` — accepts `show_verbatim`; updates `share_verbatim` only when the key is present (so enable/disable doesn't clobber the choice, and vice-versa); returns it. GET `/api/recordings/[id]` returns `share.verbatim`.
- Report Export & Share tab — a **Polished/Verbatim segmented control** on the enabled link (`postShare` always sends the current state of the other field). Default Polished.

Verified: `sql/104` applied + verified on prod (boolean, default false); /th + report routes compile and query clean post-migration; typecheck clean. Spec §4.6/§4.7 updated. **Local-only — owner pushes.**

## 2026-06-04 — Town Hall: brand-entity convergence (§3.5c)

**Why**: Owner — a brand's agent (e.g. Sarina/NOWOCATS) already has a curated entity catalog; a Town Hall meeting of that brand should reuse it to correct ASR spellings, not start from a blank slate, and the meeting should feed brand-level analysis back. The brand infra already exists for *datasets* (brand_tag → collection → entity_catalog); bots were the island (no collection membership). Approach chosen: brand_tag + agent link with a read-time union (no membership surgery); auto-seed at extraction, still reviewable at the gate.

**What changed**:
- **`sql/103`** — `recordings.brand_tag TEXT` + `underlying_agent_id UUID` (FK bots, nullable). Both null = unchanged behavior.
- `lib/recordings/brandGlossary.ts` (new) — `fetchBrandEntities()` unions the brand collection's `entity_catalog` (collection scope, resolved from brand_tag via the sql/062 `slugify`) + the linked agent's bot-scope catalog (the bot→brand bridge, read-time). `mergeBrandEntities()` folds them into the meeting's extracted map (brand canonical/type win on slug match; meeting variants unioned; unmentioned brand entities still seeded). Category→EntityType mapping.
- `runEntityExtraction` (`workflows/recordings.ts`) — fetches brand entities, passes their canonicals into the extraction prompt (new "Known entities for this organization" block in `buildEntityExtractionPrompt`) so ASR phonetic variants cluster under the right spelling, then merges + persists. `extractEntities` gains an optional `knownEntities` param.
- `lib/recordings/mirror.ts` — stamps `brand_tag` on the derived dataset (reverse direction: meeting → brand collection via the existing trigger).
- New Town Hall wizard — "Brand & known entities" block: brand-tag input + optional agent picker (`/recordings/new/page.tsx` fetches the org's agents). Create route stores both; insert omits the keys when unset so creation still works pre-sql/103.
- `tests/unit/recordings/brandGlossary.test.ts` — 4 cases on the deterministic merge.

Verified: 441 tests pass (4 new); typecheck clean. **`sql/103` APPLIED to prod 2026-06-04** (owner-authorized) — first apply failed because the FK targeted `bots` (a backward-compat VIEW); fixed to reference `agents` (the real table) and re-applied, both columns verified. Spec §3.5c added. Discovered along the way: the §3.5b claim was right — `extractEntities` *does* run in `runEntityExtraction` (it lives in `workflows/`, outside lib/app, which earlier greps missed). **Local-only — owner pushes.**

## 2026-06-04 — Town Hall: cross-org recording transfer (#3c)

**Why**: Final part of the card overhaul (#3) — a platform admin needs to move a recording to the right tenant (e.g. built in the Datanautix sandbox, hand to the client org). Unlike the shallow dataset transfer (top-row org_id only), a recording is a graph: report/PDF/export all pair recording_id WITH org_id, so a shallow move would orphan the children and read empty in the new org. And storage paths embed `<org_id>/`, reconstructed from the *current* org in the audio/transcribe paths — so the objects must physically move too.

**What changed**:
- **`sql/102_recording_org_transfer.sql`** — `transfer_recording_org(p_recording_id, p_from_org, p_to_org)` RPC: one transaction re-org_id'ing `recordings` + `recording_files` + `recording_transcripts` + `recording_extractions` + the derived `datasets` row (each paired on `p_from_org` as the cross-tenant guard) and rewriting the `<org>/` prefix in the file storage-path columns. `dataset_rows_flat` follows via `dataset_id` (no org_id). `SECURITY DEFINER` + `SET search_path`; **exec revoked from anon/authenticated, granted only to service_role** so a tenant can't call it via PostgREST to bypass the route gate. Also extends the `org_transfers` resource_type CHECK to `'recording'`.
- `app/api/recordings/[id]/route.ts` — PATCH now branches: `{ org_id }` → transfer (platform-admin only, 403 else), `{ name }` → rename. `transferRecordingOrg()` helper moves storage objects first (rollback on failure), then runs the RPC (rollback storage on RPC failure), then `recordOrgTransfer` audit. `lib/orgTransfer.ts` `TransferableResource` gains `'recording'`.
- `RecordingsListClient.tsx` — admin-only "Move to org" ⋯-menu item + a transfer modal (org picker, "everything it owns" copy, disabled until an org is chosen). `app/recordings/page.tsx` fetches active `allOrgs` + passes `isAdmin` when the caller is platform-admin.
- `tests/integration/recording-transfer-gate.test.ts` — 3 cases: non-admin transfer → 403 (no RPC), admin transfer → RPC fires with (id, from, to) + audit-logged, plain rename never enters the transfer path.

Verified: card QC'd (menu + modal) via throwaway route + Playwright; 437 tests pass (3 new); typecheck clean. **`sql/102` NOT yet applied** — transfer 500s until it lands on prod (owner-authorized; the RPC is the security-sensitive bit, worth a look before applying). Spec §4.3b + intro added. **Local-only — owner pushes.**

## 2026-06-04 — Town Hall cards: favorite star + ⋯ menu (rename/delete)

**Why**: Open-item #3 (card overhaul), parts a+b. The Town Hall list cards only had a bare delete 🗑; the Analyze/Surveys card family has a favorite star + a ⋯ menu. Bring the cards up to parity.

**What changed**:
- `app/recordings/RecordingsListClient.tsx` — top-right now renders a shared `<FavoriteStar>` + a ⋯ menu (Rename / Delete). Rename is an inline overlay input (optimistic PATCH, reverts on failure, 16px font per the iOS-zoom rule); Delete still opens the existing confirm modal. Click-away closes the menu.
- `app/api/recordings/[id]/route.ts` — new **PATCH** handler: updates `name` only, same owner/org-admin/platform-admin gate as DELETE, service-role read pairs id+org_id (404 cross-org), trims + 200-char cap.
- `app/recordings/page.tsx` — hydrates each card's `favorited` from `user_favorites` (per-user, resource_type `'recording'`).
- Favorites plumbing for the new type: `app/api/favorites/route.ts` (ResourceType + VALID_TYPES + TYPE_MAP + byType bucket) and `components/ui/FavoriteStar.tsx` (type union) gain `'recording'`.
- **`sql/101_favorites_recording.sql`** — extends the `user_favorites` resource_type CHECK to include `'recording'`. **APPLIED + verified on prod 2026-06-04** (owner-authorized; `pg_get_constraintdef` confirms the 6-value list).
- Date bug: `RecordingsListClient.fmtDate` now formats in **UTC** (caught in visual QC — a `2026-05-21` meeting_date rendered as the 20th). Completes the sweep started in `reportHtml.ts` + `app/th/[token]/page.tsx`.

Verified: card QC'd in all three states (default / ⋯ menu / rename overlay) via a throwaway public route + Playwright screenshots — star/kebab/rename render correctly, long titles clamp, dates now correct; typecheck clean; 434 tests pass. Spec §intro list + card-actions updated. **Local-only — owner pushes.**

## 2026-06-04 — Town Hall: PDF report export (Q&A + selectable transcript)

**Why**: Open-item #2 from the Town Hall pickup queue — principals want a PDF handoff, not just the web share link. Owner: "Q&A + transcript but user-selectable."

**What changed**:
- `lib/recordings/reportHtml.ts` (new) — `renderTownHallReportHtml`, a pure function that bakes a self-contained inline-styled HTML doc mirroring `app/th/[token]/page.tsx` (meeting meta + exec summary + polished Q&A by topic, polished→verbatim fallback, Datanautix footer). Optional **Full Transcript** appendix on its own page using the spelling-corrected view (`normalizeSegments` applies the reviewed `entity_map`; raw ASR never mutated), consecutive same-speaker segments merged into paragraphs.
- `app/api/recordings/[id]/report/pdf/route.ts` (new, POST) — renders that HTML via puppeteer-core + `@sparticuz/chromium` (`page.setContent` → `page.pdf`, mirrors the Agent Study PDF route; Chrome resolved off `process.platform`, not `VERCEL`). Body `{ includeTranscript }`. Cross-org gate mirrors `export/pptx` (`getCallerOrgContext` + service-role read pairing id+org_id → 404 cross-org, 409 until complete). Streams the PDF (no Storage round-trip); fire-and-forget `logDeckDownload`.
- `app/recordings/[id]/report/ReportClient.tsx` — Export & Share tab: new "PDF report" card + "Include full transcript appendix" checkbox (default on) + Download button; dropped the now-built "PDF" bullet from the follow-ups list.
- Bug fix (both surfaces): `fmtDate` now formats `meeting_date` in **UTC** — a date-only value like `2026-05-21` was rendering as the 20th in negative-UTC zones. Applied to `reportHtml.ts` and `app/th/[token]/page.tsx` so the PDF and web report stay consistent and correct.

Also fixed the stale `scripts/specMap.ts` mapping: `app/th/**` moved from TOWNHALL.md (PulseIQ) → RECORDINGS.md, since `/th` is the Town Hall public-share prefix — so `/th` edits no longer need a SKIP_SPEC_CHECK bypass.

QC'd via a throwaway render harness (fake data → HTML → local Chrome PDF → pdftoppm → visual inspect): layout faithful to `/th`, transcript breaks to its own page, entity normalization + Datanautix wordmark correct, date fixed. Spec §4.5 + §3.8 export list updated. tsc clean. **Local-only — owner pushes.**

## 2026-06-04 — Taxonomy tab: Severity Alerts moved to the top

**Why**: Owner — the Severity Alerts buttons (food safety / pests) sat below the axes + sub-topics, requiring a scroll. They're the most urgent thing on the page.

**What changed**: `components/analyze/TaxonomyModule.tsx` — moved the Severity Alerts block to render right after the KPI row (above the By-axis / Top-sub-topics columns), `marginBottom` instead of `marginTop`. No logic change. tsc clean.

## 2026-06-03 — Taxonomy comment drawer: snap evidence highlight to word boundaries

**Why**: Owner saw the evidence highlight in the taxonomy comment drawer cutting words in half ("w as really good… were ju", "k ey west… rece ived"). Stored evidence is a fixed-width char window, and `highlight()` was wrapping it verbatim.

**What changed**: `components/analyze/TaxonomyModule.tsx` `highlight()` now expands each match left/right to the nearest word boundary (Unicode letter/number test) before wrapping it in `<mark>`, and advances the regex past the expanded span so matches can't overlap. The highlight never cuts a word now.

Note on the separate "view resets to the taxonomy start" report: not a bug in this component (no internal remount/poll/timer). The dev-server log showed multiple Fast-Refresh full reloads — a concurrent session editing files on the same dev server forces full reloads that wipe React state (closes the drawer, refetches). Isolate by running a dedicated dev server. tsc clean.

## 2026-06-03 — Transcripts: Q&A-pairs export

**Why**: Owner needs to be able to produce a clean list of every question/answer pair on demand. The existing export was one-row-per-turn (Session/Turn/Role/Content) — usable but not paired.

**What changed**:
- `app/api/bots/[id]/conversations/export/route.ts`: added `?shape=pairs`. Pairs each user question with the agent's next reply (skipping greeting preamble + the historical prompt-leak), emitting one row per pair: `#, Session ID, Timestamp, Question (user), Answer (agent), Language`. Default `shape=turns` unchanged. Added `source`/`content_en`/`content_flags` to the turn selects.
- **Review-gated (per owner)**: the pairs export reuses `autoFlagReasons`/`resolveReviewStatus`/`includedInReports` + `duplicateFingerprintSet` from `lib/conversationReview` to drop auto-flagged (troll/bot/duplicate/wholly-off-topic) and reviewer-excluded conversations — same gate as the report. So it's "every Q&A from the *good* conversations." Short one-word exchanges are kept. (`shape=turns` stays ungated.)
- `ConversationsClient.tsx`: a second **Q&A pairs** download button (CSV/XLSX) next to the existing Download.

**Verification**: replicated on live Sarina read-only — gate drops the 6 auto-flagged/excluded sessions (0 human exclusions), leaving the good conversations' pairs; sample Q→A correct, 100% with a non-empty answer. tsc clean.

## 2026-06-03 — Agent Study PDF: fix local launch + wordmark spelling

**Why**: The PDF button threw "PDF engine failed to start" locally (`spawn ENOEXEC`) — `.env.local` sets `VERCEL=1`, so the route tried to exec the Linux `@sparticuz/chromium` binary on macOS. Also: owner says the brand is "datanautix", not "data·nautix".

**What changed**:
- `app/api/bots/[id]/study/pdf/route.ts`: detect the serverless runtime by `process.platform === 'linux'` instead of `process.env.VERCEL`, so macOS/Windows dev uses an installed local Chrome and only the actual Linux Vercel runtime uses `@sparticuz/chromium`.
- Wordmark dropped the middle dot → "datanautix" (data=teal, nautix=orange) in `ReportClient.tsx` + `lib/agentStudyHtml.ts`. (The PPTX deck still uses the dotted form per CLAUDE.md — flagged to owner.)

tsc clean.

## 2026-06-03 — Agent Study: server-rendered PDF (replaces browser print)

**Why**: The first PDF button used `window.print()` — a browser print dialog whose output varies by browser/OS (Safari ≠ Chrome) and loses formatting. Owner wanted a proper, consistent PDF.

**What changed**:
- New `POST /api/bots/[id]/study/pdf` (`maxDuration: 120`, org-gated like `/study`): renders the baked `renderAgentStudyHtml(study)` with headless Chrome's `page.pdf()` (A4, `printBackground`) and returns it as a file download. The bake's print rule still strips every drill-down, so the PDF is a flat summary.
- Chrome resolution: `@sparticuz/chromium` on Vercel/Lambda; a local Chrome (`/Applications/Google Chrome.app/...`, with a candidate list + `PUPPETEER_EXECUTABLE_PATH` override) in dev.
- `ReportClient.tsx`: the **PDF** button now POSTs to the route and downloads the blob (no more iframe/print), with a "Generating…" state.
- Deps: `puppeteer-core` + `@sparticuz/chromium`. `next.config.js`: added `serverExternalPackages` for both so webpack doesn't bundle the chromium binary. (npm reports 2 moderate transitive vulns from puppeteer's deps — noted, not blocking.)

**Why it's better cross-browser**: generation happens server-side, so every recipient downloads the identical file regardless of browser/OS — no client-side print engine involved.

**Verification**: local path verified end-to-end — puppeteer-core + system Chrome renders the baked HTML to a 2-page A4 PDF (`pdfinfo` confirms A4); pdftoppm PNG confirms a faithful layout (wordmark, bar counts, depth chip). tsc clean. **Prod path (`@sparticuz/chromium` on Vercel) NOT yet verified — needs a deploy; may require a function memory bump.**

## 2026-06-03 — Agent Study: activity-bar counts + Datanautix wordmark

**Why**: Owner — show the per-day count on the activity bars, and brand the report/export with the Datanautix wordmark (top-right).

**What changed** (`ReportClient.tsx` + `lib/agentStudyHtml.ts`):
- Activity Over Time: each day's conversation count now renders on top of its bar.
- Datanautix wordmark ("data" teal · "nautix" orange) top-right of the report header (live + baked HTML) — per the deck/report-export branding rule. `DN_WORDMARK` const in the bake.

tsc clean; screenshot confirms counts-on-bars + wordmark.

## 2026-06-03 — Transcripts: included vs set-aside split + absolute timestamps

**Why**: Owner — the Transcripts grid was cluttered with low-signal drive-bys (≤2-turn "Learn" chip taps) and excluded/flagged conversations mixed in; relative "1d ago / 3d ago" times read as odd.

**What changed** (`ConversationsClient.tsx`):
- Extracted the card into `renderCard` and split the default ("All") view into **Included** (the conversations worth reading) and a **Set-aside** group = excluded/auto-flagged **plus** low-signal drive-bys (`turn_count <= 2`). Set-aside collapses into a toggleable, dashed-border box (collapsed by default) with a count breakdown ("N low-signal · M flagged/excluded · not counted in reports"). Specific flag filters (Flagged/Clean/Needs review) still show their exact set, unsplit.
- Card timestamps now use the existing `fmtDate` (absolute date + time) instead of relative "Xd ago". Open Questions "Logged" (report + baked HTML) likewise switched to a date. Removed the now-unused `fmtRelative` helper.

tsc clean.

## 2026-06-03 — Agent Study: PDF export (flat summary, no drill-downs)

**Why**: Owner wants to hand out the report as a PDF without giving recipients the interactive drill-downs (real conversation snippets, before/after, suggested-KB).

**What changed**:
- New **PDF** button on the report (`ReportClient.tsx`, next to Share/Export PPTX). `downloadPdf()` renders the clean baked HTML (`renderAgentStudyHtml`, no nav/buttons) into a hidden iframe and calls `print()` → user saves as PDF. Client-side, zero server cost (no headless-chromium dependency).
- `lib/agentStudyHtml.ts` `@media print` rule: `details>:not(summary){display:none!important}` + `print-color-adjust:exact`. Guarantees drill-down bodies are stripped from the PDF **even in browsers that auto-expand `<details>` when printing**, so transcripts never leak into the handout. Card colors preserved.

**Verification**: Playwright `page.pdf()` on a fixture with every `<details>` force-opened + sentinel "SENSITIVE" text in all drill-downs → `pdftotext` finds **0** occurrences (no leak); `pdftoppm` PNG confirms a clean flat layout (KPIs, depth bars, focus labels only, open-question lines with depth chips, bulleted insights). tsc clean.

## 2026-06-03 — Agent Study: open-question depth chips + bulleted insight lists

**Why**: Owner — make Open Questions richer, and the insight lists (Most Common Topics / Knowledge Gaps / Recommendations) had no clear separation between multi-line entries.

**What changed**:
- **Conversation-depth metadata** on each open question: `open[].sessionPairs` = the Q&A-pair count of the session that raised it (`buildExchanges(session).length`). Rendered as a color-coded chip (`depthChip`) next to the classification badge — gray (1 exchange / drive-by) → light teal → deep teal (7+ / engaged). Surfaces that an unanswered question from a long, engaged chat is a higher-value gap. Cache `STUDY_SCHEMA_VERSION` bumped to v3.
- **Bulleted insight lists**: replaced the plain `<ul>` with rows that carry a teal bullet dot + a 1px top-border divider between entries, so multi-line items read as distinct. (`ReportClient.tsx` + `lib/agentStudyHtml.ts`.)

tsc clean; Playwright screenshot confirms depth chips scale by engagement and the insight entries are clearly separated.

## 2026-06-03 — Agent Study: version the cache key so shape changes self-heal

**Why**: `agent_study_cache` keys on pair-count + focuses + intents, not the object shape. The day's changes added fields (`totalSessions`, `answerRatePct`/`answeredPairs`, `open[].after`) and dropped language intents — but a study cached before the change kept the same key, so the report would serve an old-shape object and render `undefined` (e.g. "Conversations: undefined", no Answer Rate tile) until a manual force-refresh.

**Fix**: added `STUDY_SCHEMA_VERSION` ('v2') into `cacheKeyFor`. Any shape change → bump the version → all caches miss and recompute fresh on next view. No manual refresh, no migration. `lib/agentStudy.ts`. tsc clean.

## 2026-06-03 — ChatBot: render mailto:/tel: markdown links (broken contact blocks)

**Why**: Mason's contact bubble rendered `[Leon.Kirkpatrick@cflhomeless.org](mailto:…)` as raw text — visible `[ ]` and `(mailto:…)`. The agent emits a valid markdown email link; the renderer just didn't parse it.

**Root cause**: `formatHtml` in `components/ui/ChatBot.tsx` only matched `http(s)://` in its markdown-link regex (`\[…\]\((https?://…)\)`). `mailto:`/`tel:` links fell through to the bare-email autolinker, which wrapped the address inside the brackets and inside `(mailto:…)` separately, leaving the literal brackets/parens.

**Fix**: extended the regex to `(?:https?://|mailto:|tel:)` and skip `target=_blank` for mailto/tel (no blank tab). Affects every agent, not just Mason. DOMPurify already allows mailto/tel hrefs. Verified the exact bubble text now yields one clean `<a href="mailto:…">` with no leftover `(mailto:`. tsc clean.

## 2026-06-03 — Agent Study: exclude language-routing intents from analytics

**Why**: Owner — "Spanish should not be an intent." On Sarina, "Spanish" is configured as an intent but it's a routing handler (switch to Spanish + refer other languages to Natalia Garcia), and it's redundant with the Conversations-by-Language panel. Showing it in "Intents Detected" reads as a language masquerading as a top intent.

**What changed**: `lib/agentStudy.ts` — `getAgentStudy` filters intents whose label matches a `LANGUAGE_INTENT_LABELS` denylist out of `intentsArr`, so language-routing intents are dropped from Intents Detected on the report, baked HTML, and deck. Decision was "hide from report only" — the chat-time handler/behavior is untouched, no agent-config change. tsc clean. Commit-only.

## 2026-06-03 — Agent Study: Answer Rate metric, beacon-hide, open-Q before/after, Transcripts reorder

**Why**: Owner feedback on the live report — (1) wanted a positive "strength" number, (2) the freshly-deployed beacon showed "Widget Opens 1 / Response Rate 3600%", (3) open questions needed the agent's *answer* shown for context, not just the lead-in, (4) ignored conversations cluttered the top of the Transcripts page.

**What changed**:
- **Answer Rate** (`lib/agentStudy.ts`): `totals.answerRatePct = answeredPairs / totalPairs`, `answeredPairs = totalPairs − validated open questions` (deflections excluded — they're intentional). Green KPI on the report, baked HTML, and deck ("Answer Rate 95% · 102 of 107 answered").
- **Beacon-hide**: Widget Opens + Response Rate (+ activity-chart opens overlay + methodology line) only render when `impressions >= totalSessions` (`showOpens`). Until the beacon has real coverage they're omitted instead of showing 1/3600%. (`ReportClient.tsx`, `lib/agentStudyHtml.ts`, `lib/pptx/agentStudyDeck.ts`.)
- **Open questions before + after**: added `findFollowingAgentLine` + `open[].after` so the report shows AGENT BEFORE → USER → AGENT AFTER (the uncertain reply that got logged). Caption "validated" → "unanswered".
- **Transcripts reorder** (`ConversationsClient.tsx`): auto-flagged + excluded sessions stable-sort to the bottom and dim to 0.55 opacity — still reachable for review, out of the way.
- **Wider activity bars**: the Activity Over Time bar width now scales to the day count (`barW = clamp(12..40, 560/days)`) instead of a fixed thin 7px — fat bars on short spans, capped for a 3-week view. (report + baked HTML.)

**Verification**: `rm tsconfig.tsbuildinfo && npx tsc --noEmit` clean; re-rendered the bake fixture + Playwright screenshot confirms Answer Rate present, Widget Opens/Response Rate hidden on an immature beacon, and before/after in open questions. Commit-only; staged my files only by explicit path.

## 2026-06-03 — Agent Study: fix 3600% response rate + anchor headline to the official session count

**Why**: Owner caught two issues on a live shared report (Sarina): (1) a **3600% response rate**, and (2) the report's lead count disagreed with the agent card — "the agent card is the official record."

**Root causes**:
- *3600%*: `responseRatePct = conversations7d ÷ opens7d`. The widget-open beacon only started logging at today's deploy, so `opens7d = 1` while `conversations7d = 36` (counted from turn rows that predate the beacon) → 36 ÷ 1 = 3600%. No window alignment, no clamp.
- *Count mismatch*: report led with "Useful Conversations 36 (of 55 initiated)"; the card shows **61** (distinct sessions, `bot_session_counts_for_ids` RPC). The report *did* reconcile to 61 (36 useful + 19 one-word + 2 no-input + 4 flagged) — but only in the depth-chart fine print, so the headline read as a contradiction.

**What changed** (`lib/agentStudy.ts` + both renderers):
- `computeHealth`: response rate now aligns the conversation window to the beacon's first record (`max(now−7d, firstBeaconAt)`), requires `MIN_OPENS_FOR_RATE = 10` opens before showing any rate (else `null` → "— / gathering open data"), and clamps at 100%. Verified read-only against live Sarina: `responseRatePct` went 3600 → `null` (opens7d=1 < 10).
- Added `totals.totalSessions` (= sum of the four session buckets = the card's distinct-session count) and led the Overview KPIs (`ReportClient.tsx`, `lib/agentStudyHtml.ts`) **and** the PPTX deck (`lib/pptx/agentStudyDeck.ts`) with it: "Conversations 61 / all sessions", then "Useful Conversations 36 / of 61 total". Headline now matches the agent card.

**Verification**: `rm tsconfig.tsbuildinfo && npx tsc --noEmit` clean; read-only `getAgentHealth` on live Sarina confirms the null rate; re-rendered the bake fixture + Playwright screenshot confirms the new headline (Conversations 61, Useful 36 of 61, Response Rate "—"). Commit-only; staged my files only by explicit path.

## 2026-06-03 — Conversation review gate (trolls/bots/off-topic out of reports, human-in-the-loop)

**Why**: Most agent data is public-record, so the issue with reports/shares isn't exposure — it's signal quality. A report that silently includes a troll rant or a bot flood isn't defensible. Owner asked for robust guardrails: auto-exclude trolls/bots/off-topic from reports but keep them in the DB, with a mechanism to flag conversations for human review and never include flagged ones unless a human pushes them to the record.

**Built** (`lib/conversationReview.ts` + `sql/096 conversation_reviews`, RLS + org SELECT):
- **Live auto-flag** (not persisted): safety flags (profanity/slur/threat/sexual/insult/spam) on any turn; bot-like (repeated identical messages, a substantive-message-set fingerprint shared across sessions, or ≥4 substantive turns in <20s); or **every** substantive exchange deflected as outside_scope (whole-conversation off-topic only — a tangent doesn't trip it). `resolveReviewStatus(human, auto)` → clean|auto_flagged|approved|excluded.
- **Reports honor it**: `getAgentStudy` + `getAgentHealth` call `partitionByReview` first — only `clean`+`approved` are counted/classified; `totals.flaggedExcluded` added to the reconciliation. Flagged stays in DB.
- **Human review on the Transcripts page**: conversations list returns `review_status`+`review_reasons` (live auto-flag merged with the human row); UI gains a "Needs review (N)" filter + per-card **Approve / Exclude / Reset** → `POST /api/bots/[id]/conversations/[sessionId]/review` (service-role, org-paired). `isSubstantive` moved into `conversationReview` (shared with agentStudy, one-way dep, no drift).

**Verification**: tsc clean (0). Ran the auto-flag against real Sarina data (no AI) — **4 sessions auto-flagged `duplicate`** (identical message sets = test/QA runs), 1 shared fingerprint; reconciles (those 4 move from useful→flaggedExcluded, still sums to 60). Specs: `docs/BOTS.md` review-gate bullet + specMap. `sql/096` NOT applied to prod (gate degrades to all-clean without the table). Commit-only.

## 2026-06-03 — Agent Study refinements (owner review pass)

**Why**: Reviewing the first Sarina sample, the owner caught three real problems. (1) The headline "60 conversations" was wrong — 18 of those 60 were one-word chip taps ("Learn"/"Yes"), opened-but-not-entered, not real conversations. (2) The Open Questions slide was noise — fragments and even mis-captured agent text flagged as "questions." (3) Two Spanish chats opened with garbage; the openings were AI leakage. Plus a slide-12 overflow + a request for larger deck fonts (older audience at the client).

**Fixed**:
- **Useful vs initiated counts** (`lib/agentStudy.ts`): a turn is *substantive* only if ≥3 words or contains `?`. Headline = useful conversations (≥1 substantive); `initiated` (any user turn) shown secondary; `initiatedNotEntered` = the difference, surfaced as a bottom note and excluded from the depth chart + classification. Verified on Sarina: 39 useful / 58 initiated / 19 not-entered / 2 no-input.
- **Open-question validation**: pull the agent's preceding line for context, AI-validate + restate each open question, filter false positives (`autoFiltered`). Hardened live capture in `lib/logQuestion.ts` (`looksLikeQuestionOrRequest`; deflect exempt). One-time backfill `scripts/agent-question-revalidate.ts` marks existing false positives `status='n_a'` + notes (no migration). **Ran --apply on Sarina: 9 open → 5 kept, 4 marked n_a** (the exact fragments the owner flagged). Questions admin page now self-clean.
- **Non-English greeting leak**: root cause in `ChatBot.tsx` — the localized-greeting call POSTed "Greet the user warmly…" WITH a session_id, so chatCore persisted the prompt as a user turn for every non-English chat. Fixed by dropping session_id on that internal call; `agentStudy` also filters historical leaks (`isLeakedTurn`). (The fix landed in commit 0252c056 — a parallel session swept my uncommitted ChatBot edit into its dynamicChips commit.)
- **slideRenderer**: insight-box height is now adaptive (no more 2-line bleed below the box on bullets slides); body-font floor raised toward 12 (insight 11→12, quotes 10→12 + shorter trim, table 9.5→11) for the older client audience. Shared by 6 decks — re-QC'd the agent study; bigger fonts + autoFit, low regression risk.

**Verification**: clean `rm tsconfig.tsbuildinfo && npx tsc --noEmit` (0 errors). Re-ran getAgentStudy read-only vs Sarina; pixel-QC'd slides 2/10/12 — engagement note correct, open questions now 5 clean restated questions + "4 auto-filtered", knowledge-gaps overflow gone, languages reconcile (en 37/95%, es 2/5%). Backfill dry-run before --apply. Specs: `docs/BOTS.md` Agent Study section. Commit-only.

**Follow-up (owner: "58 initiated but 60 in DB — what dropped?")**: nothing silently dropped. The 2 are Spanish sessions whose ONLY user turns were the leaked greeting prompt → after `isLeakedTurn` filtering they have no real message → `abandonedNoInput`. Added a full reconciliation under the depth chart (report + deck): `useful + initiatedNotEntered + abandonedNoInput = total sessions` (39 + 19 + 2 = 60). `abandonedNoInput` was previously computed but not surfaced.

## 2026-06-03 — Agent Study: comprehensive agent-analytics report (replaces Deck + Mine Conversations)

**Why**: The agent conversations page had two thin, disconnected analytics buttons — "Deck" (a fixed 8-slide PPTX) and "Mine Conversations" (an AI text blob). Neither let you analyze by focus area, see entities, read the actual exchanges, or know your response rate. The owner wanted one comprehensive "agent study": engagement depth, per-focus analysis with entity cross-tab, intents, languages, open questions, and a quick health view on the agent card — as an HTML report you can drill into, with a PPTX export of the same thing.

**Key data-model finding** (`lib/chatCore.ts:1002`): turn rows are written only on the user's first message — the greeting/name preamble is persisted retroactively with that first turn. So every stored session already has ≥1 user turn, and pure widget-opens leave **no trace**. Confirmed against Sarina (NOWOCATS): 60 sessions, 0 with zero pairs. True invocation/response-rate is therefore unmeasurable from turn tables → built a beacon.

**Built (one unit)**:
- **Beacon** — `agent_impressions` table (sql/095, RLS + org SELECT) + public `POST /api/bots/[id]/impression` (CSRF-bypassed in `proxy.ts`, wildcard CORS, rate-limited 30/min, 204-always, no PII), fired once on mount in `components/ui/ChatBot.tsx`. The only source of true opens → `responseRate = conversations ÷ opens`.
- **Two-tier compute** (`lib/agentStudy.ts`): Tier-1 health (no AI — conversations 7/30d + trend, opens, response rate, median normalized depth, open-question count, daily series, green/amber/red/idle dot); Tier-2 study (AI, memoized in `agent_study_cache` keyed on a pair-count+config hash, self-healing). Normalize = strip `source='greeting'` preamble, count `source='normal'` user turns as Q&A pairs, **exclude 0-pair sessions** from classification. Each question is batch-classified (Haiku) to one focus and **its paired answer inherits the same focus**; user-named entities extracted per exchange (URLs + agent-name filtered out for credibility) → focus×entity cross-tab. Intents from `intent:` flags; languages reported by source `language` but analyzed on `content_en`; open questions from `logged_questions`; narrative insights fold in the old report prompt.
- **Surfaces**: HTML report `/bots/[id]/report` (expand/collapse into real Q&A snippets, open-question context, entities, intents) + `GET /study` (compute-if-stale, `?force=1`); `POST /study/pptx` flattens the same object via new `lib/pptx/agentStudyDeck.ts` → `slideRenderer` with a **net-new `column_chart`** vertical-bar slide type. Agent-card health strip in `BotsClient` (dot + `N open questions` badge + Report link; open-question counts via one grouped read in `GET /api/bots`). Removed the Deck + Mine Conversations buttons from `ConversationsClient` (+ orphaned handlers/state).

**Verification**: clean `rm tsconfig.tsbuildinfo && npx tsc --noEmit` (my files 0 errors; the 3 remaining are a parallel session's recordings WIP); `npm test` green except 2 in that same parallel `recordings/analyze.test.ts`. Ran the full pipeline read-only against real Sarina data — numbers reconcile exactly to a SQL probe (60 convos, 189 pairs, depth 27/15/4/4/5/5, 55en/5es, 9 open questions; focuses mapped to real NW Orange County roads). Pixel-QC'd both net-new column-chart slides + the focus table + entity grid via LibreOffice → no overflow. Specs: `docs/BOTS.md` (new Agent Study section + UI/card updates), `docs/SECURITY.md` + `docs/ENGINEERING.md` (beacon in the CSRF bypass allowlist), `scripts/specMap.ts`.

**Not done**: sql/095 not applied to prod (getAgentStudy degrades gracefully without the tables — cache/impression reads error silently). Commit-only, not pushed.

## 2026-06-02 — Restaurant taxonomy productized: classifier + in-app Taxonomy tab + critical-category audit + decks

**Why**: The Ruth's Chris pilot was a pile of one-off scripts; the Chuy's analytics-manager demo (Thu) and the Darden pitch both needed it as a reusable, demonstrable capability — classify any review dataset, view it in-app, and back the "we beat your CX vendor" claim with evidence.

**Built (keyword tier; AI tier deferred)**:
- **Layered classifier** — `lib/taxonomyDictionary.ts` (`resolveDictionary(core|rc|chuys)` = shared core ⊕ per-brand overlay), `lib/taxonomyClassify.ts` (persists tags to `dataset_row_taxonomy`, idempotent on `(dataset_id,row_id)`, pairs `org_id`; strips NUL/C0/**surrogate** chars — emoji-split evidence windows produced lone surrogates that Postgres jsonb rejects), `lib/taxonomyRollup.ts` (`aggregateTaxonomy` pure + unit-tested, `computeTaxonomyRollup` org-scoped). CLI `scripts/taxonomy-classify.ts`. Classified to prod: Chuy's 1,217 + RC 20,695.
- **In-app Taxonomy tab** — `app/analyze/[datasetId]/taxonomy/{page,…}` + `components/analyze/TaxonomyModule.tsx` (axis bars, top subs + sentiment, severity alerts), org-gated `GET /api/datasets/[datasetId]/taxonomy`, tab added to `DatasetHeader.TABS` (shown only for `google_reviews`).
- **Back-door fix** — script-ingested review datasets had no `dataset_state` → `/analyze` 404'd. New `scripts/repair-review-dataset-state.ts` (canonical `buildGoogleReviewsSchema` + `mergeSchemaStats`) + patched `pull-chuys-reviews.ts` to create state on future pulls.

**Critical-category audit (Ruth's Chris, 43,196-review CSV)**:
- Re-verified vendor coverage on the current classifier: 98.6% tagged vs 95.3%, 90.4% topic recall, +4.1% added, 20.8% vendor "TEST" leak.
- **Food safety** — independent Haiku judge over all 1,140 vendor food-safety alerts (`scripts/pilot-rc-foodsafety-audit.ts`, conservative rubric): **~62% are false alarms** (703/1,140; 437 genuine). Defensible lower bound.
- **Pests** — fixed a mapping bug (`Alert - Bug` mapped to invalid sub `bug` → silently dropped → `bug`/`bugs`→`pests` alias in `lib/taxonomyMapping.ts`), then expanded + tightened the pests dictionary in `lib/taxonomyKeywords.ts` to **~99% precision** (dropped bare `fly`/`ant` — travel idioms + "and/sent" typos; added real surface forms incl. roaches/mice/rat/insect/caterpillar/centipede/maggot). `scripts/pilot-rc-alert-compare.ts`.

**Decks** — `lib/pptx/reviewIntelligenceDeck.ts` + `app/api/review-intelligence-deck` (`?mode=full|alerts|capability`), 3 entries in `/admin/decks`; Datanautix-branded (deck-export convention), Sentimetrx as the platform in content. Pixel-QC'd via LibreOffice. Also added the standalone RC-vs-CG competitive deck (`scripts/pilot-rc-cg-deck.ts`).

**Verification**: clean `rm tsconfig.tsbuildinfo && npx tsc --noEmit`; `vitest tests/unit/taxonomyRollup.test.ts` 4/4; dev-server smoke (tab API 401, page 307; deck route 404 unauth = requireAdmin); pixel-QC of all deck slides. Specs: new `docs/TAXONOMY.md` + `docs/ANALYTICS.md` Taxonomy-tab section + `scripts/specMap.ts` entry.

## 2026-06-02 — StoryTime PPTX entity overhaul (deck-fix backlog #4–#7)

**Why**: The Coalition deck's entity slides had four problems flagged in review. (#4) The by-category chart showed NER types ("Brand 95%") instead of charity focus areas. (#5) Non-charities bled in — "Datanautix" (our platform), "Camping World Stadium", "Downtown Orlando" — because the catalog read counts every open-ended field, not the selected one. (#6) The long-tail slide showed every singleton at the same "10%" (percentage computed against the per-slide subset, not the global total). (#7) The "representative mentions" slide was circular junk ("Salvation Army — mentioned as: salvation army").

**Fixes** (`lib/entityFilter.ts`, `lib/entityAnalysis.ts`, export route):
- **#5 field-scoping**: `getEntitiesWithCounts` gains an optional `textFieldKeys` that narrows `count_entity_terms`'s `p_text_fields` to the selected entity field(s), intersected with eligibility (default unchanged — safe for the shared cloud/compare/drill read path). The export passes the selected `entityFields` + drops platform self-references. Verified live: Coalition 34 → 30 entities, the 4 dropped being exactly Datanautix / Camping World Stadium / Downtown Orlando / Charity Navigator.
- **#4 focus areas**: new `categoriseEntityNames` runs one Haiku pass to re-bucket the catalog's NER categories into charity focus areas (community/humanitarian/health/religious/youth/…) for the by-category chart; keeps NER category on AI failure. Per-export (not persisted yet).
- **#6 global pct**: `entitySlideSpecs` attaches each entity's `pct` against the global total (renderer already preferred `ent.pct`). Top grid now reads 15/9/7/5/4/2%; long tail a true 2%, not "10%".
- **#7**: `entitySlideSpecs` gains `includeQuotes` (default true for the standalone deck); export passes `false` to drop the circular quotes slide.

**Verification**: clean `tsc --noEmit`. **Pixel-QC'd this time** — installed LibreOffice, rendered the real edited functions against live Coalition data via a throwaway `--conditions=react-server` harness (entity libs are `server-only`), rasterised with `pdftoppm`, and visually confirmed all three entity slides: real charities only, focus-area chart, varying percentages, no quotes slide, no layout overflow. Remaining backlog: #8 provenance honesty, #9 branding (footer still "datanautix.com"/"Generated by Ana"), #10 recap slide, #11 collection-recompute root cause.

## 2026-06-02 — StoryTime PPTX count consistency (deck-fix backlog #1–#3)

**Why**: The regenerated Coalition Donor deck review surfaced three count problems on the export route. (1) The headline total disagreed across slides — title/summary showed a stale **62** (persisted `analytics.totalRows` / collection `row_count`) while the provenance slide showed the live **108**; collection aggregates never recompute when members gain rows. (2) The Executive Summary's TOP THEMES panel rendered **"Insufficient data" ×4** because it used the raw persisted themes (count/percentage = 0) instead of recomputing like the theme slides do. (3) The `N comments · M signals` meta shipped on theme slides 5–12 but was missing wherever else a response count appears.

**Fixes** (`app/api/datasets/[datasetId]/export/pptx/route.ts`):
- **#1 live counts**: `displayRows` and `knownTotal` now source from the live fetched rows / flat-table count (`allRows.length` / `flatCount`) instead of the stale snapshot, so title, summary, about, and provenance all agree. (Band-aid for the collection-recompute cascade — backlog #11 is the root fix.)
- **#2 exec-summary themes**: recompute themes against the dominant open-ended field via `computeFieldThemes` before `buildSummarySlide`, so the panel shows live percentages, not zeros → no more "Insufficient data".
- **#3 signals everywhere**: threaded the comments·signals `meta` into `buildSummarySlide` (right of TOP THEMES), the OE-overview **Responses** KPI sub-line, and `buildCommentsSlide` (verbatim slide subtitle via `withCounts`). New surfaces reuse already-shipped layout slots (label-left/stat-right row, `kpiCard` sub, `hdr` subtitle).

**Verification**: clean `rm tsconfig.tsbuildinfo && npx tsc --noEmit` passes. Pixel-QC not possible in this environment (no headless LibreOffice; the export route needs an auth session) — static layout review only; visual confirmation deferred to a UI deck regeneration on the next deploy against live Coalition data. Spec: `docs/ANALYTICS.md` Export Features updated. Backlog items #4–#11 (entity overhaul, provenance honesty, branding, recap slide, collection-recompute root cause) remain.

## 2026-06-01 — Recordings pipeline brought live end-to-end (pilot wiring) + feature/accounting/UX

**Why**: First real run of the productized recordings pipeline against NOWOCATS meeting video surfaced a chain of blockers (the pipeline had never been exercised with a real upload). Fixed each to get upload → extract → transcribe → analyze → report working, and reworked feature gating, extraction quality, accounting, and the list/delete UX per pilot feedback.

**Fixes (sequential pipeline blockers)**:
- **`getUserContext` selected a non-existent `users.is_admin` column** → PostgREST errored → every recordings page bounced to `/login`. Now derives `isAdmin` from `org.is_admin_org` (matches sibling pages). (`lib/userContext.ts`)
- **ffmpeg not in the Vercel Sandbox** — `dnf install ffmpeg --skip-broken` exited 0 without installing (not in Amazon Linux repos). Now downloads a static ffmpeg/ffprobe build, installs `xz` (needed to unpack `.tar.xz`), and verifies with `ffmpeg -version` (fails loudly otherwise). (`lib/recordings/extract.ts`)
- **Analyze timed out** — `callAI` defaults to a 15s timeout (fine for chat); Opus extracting Q&A from a full transcript needs minutes. Added `timeoutMs` (10 min Opus / 5 min Sonnet). (`lib/recordings/analyze.ts`, `regenerate.ts`)
- **Recordings list showed 0** — the list query embedded `users:created_by`, but `recordings.created_by → auth.users` isn't PostgREST-embeddable. Now looks owner names up from `public.users` separately. (`app/recordings/page.tsx`)
- **Supabase upload 413** for 175–251 MB files — project-level Storage upload limit (not the 20 GB bucket limit). Raised in the Supabase dashboard (ops, not code).

**Feature gating reworked**: recordings is now a normal **`ModuleFeatures` toggle** (sub-feature of Analytics) instead of the bespoke `org_features`/`user_features` quota system. **Analytics is the parent** — `googleReviews`, `reddit`, `substack`, `recordings` are forced off when `analyze` is off, enforced centrally in `effectiveFeatures` and reflected in the org toggle UI (children indented + disabled when Analytics is off). The generic `org_features`/`user_features` tables + `assertFeatureAllowed` remain as unused infra (sql/089). (`lib/types.ts`, `lib/resolveOrg.ts`, `lib/userContext.ts`, `components/analyze/OrgFeatureToggles.tsx`, recording page/API gates)

**Extraction quality — decouple recall from the agenda**: the old prompt used the agenda as both a recall anchor AND a fixed taxonomy ("use ONLY agenda topics"), so an empty/short agenda tanked recall. Now Opus extracts **every** audience Q&A comprehensively with a free-form topic label, and the Sonnet curator pass **clusters them into emergent topics** (agenda is an optional naming hint). Confirmed against the manual PM-1 baseline: the 7-vs-15 gap was mostly display (7 "ask" in the Q&A tab + 5 in the Appendix = 12) plus 4 genuinely-missed audience questions that the topic-anchoring had dropped. (`lib/recordings/prompts/qa.ts`, `lib/recordings/analyze.ts`)

**Accounting for recordings**: added `usage_logs.cost_cents` (sql/092, applied to prod) for non-token costs; the ASR/transcription vendor charge now logs to `usage_logs` (was invisible there); recording AI calls re-tagged `resource_type: 'recording'` (were hiding under "TextMine"/`dataset`); `/admin/usage` adds a **Recordings** label and folds `cost_cents` into cost totals. (`lib/usageLog.ts`, `lib/ai.ts`, `transcribe.ts`, `analyze.ts`, `regenerate.ts`, `app/api/admin/usage/route.ts`, `app/admin/usage/UsageClient.tsx`)

**UX**: `/recordings` now renders **cards** (matching dataset cards) instead of a table; added a **🎙️ Recordings** entry button in the Analyze header (the list was previously unreachable via UI); each card has a **delete** with a confirmation modal that cascades **storage files + derived dataset/rows + recording (→ files/transcripts/extractions)** via new `DELETE /api/recordings/[id]`; the full re-extract is now a clear **"↻ Re-extract all"** button (was a cryptic "⋯ More"). Status-page active-step loader switched to `LottieLoader`. (`app/recordings/RecordingsListClient.tsx`, `AnalyzeClient.tsx`, `ReportClient.tsx`, `StatusClient.tsx`)

**DD doc fix**: `docs/DATA_FLOW.md` storage drift corrected — uploaded media/PDFs are Supabase Storage; PPTX decks / HTML shares / nightly backups are AWS S3; encryption table no longer mislabels backups as Supabase-managed.

**Verification**: clean `rm -rf .next/types tsconfig.tsbuildinfo && npx tsc --noEmit` throughout. Pipeline validated live to the Analyze stage against NOWOCATS video; full end-to-end + re-extract being validated by the user.

**Production follow-ups (not blockers for local)**: bake a Vercel Sandbox snapshot with ffmpeg pre-installed (`FFMPEG_SANDBOX_SNAPSHOT_ID`) to skip the per-cold-boot download; raise the `runAnalyze` function `maxDuration` (default 300s may be tight for Opus).

**Gate 1 — analysis is now on-demand (2026-06-01)**: the pipeline no longer auto-runs the expensive Opus + Sonnet extraction. `processRecordingWorkflow` runs extract → transcribe and **pauses at a new `status='transcribed'`**; the user reviews the transcript, refines the agenda / panel roster, and adds an optional steer, then explicitly hits **"Generate Q&A pairs"** which starts the new `analyzeRecordingWorkflow` (analyzing → complete) via `POST /api/recordings/[id]/analyze`. WHY: the analyst wants to make adjustments before spending ~$1/meeting and before the report exists — extraction quality is steered by the agenda/roster, so letting them fix those pre-analysis is the highest-leverage moment. Gate 2 (the formatted report/PDF deliverable, § 4.5) is on-demand by design already (separate export route, never auto-fired). Status-page Retry now routes a post-transcription failure to `/analyze` (retry just the AI pass, no re-transcribe) instead of re-running the whole pipeline. (`sql/093`, `lib/recordings/types.ts`, `workflows/recordings.ts`, `app/api/recordings/[id]/analyze/route.ts`, `app/api/recordings/route.ts`, `app/analyze/new/recording/[id]/status/StatusClient.tsx`, `app/recordings/RecordingsListClient.tsx`, `docs/RECORDINGS.md`)

**Audio modal player wired (2026-06-01)**: the "▶ Play this segment" stub on Q&A/appendix cards is now a real shared `AudioModal`, and every transcript segment gained a "▶ Play from here" button. WHY: PM-1 review wanted to verify a pair against the actual audio in one click. New `GET /api/recordings/[id]/audio` mints a short-TTL (1h) signed URL for the stitched mp3 (org-gated, source files never exposed). The modal seeks to the pair's `start_sec` and autoplays, with a ≥48px play/pause, scrubber + time labels, ±15/±30s skip, playback speed (0.75–2×), Esc/×-close, and a synced transcript that highlights + auto-scrolls the segment under the playhead (click to seek). Removed the orphaned `StubButton`. (`app/api/recordings/[id]/audio/route.ts`, `app/analyze/[datasetId]/report/ReportClient.tsx`, `docs/RECORDINGS.md`)

## 2026-06-01 — W22 governance score-lift: CI green + CVE remediation + recordings tests + agent-page org gate

**Why**: The W22 governance report (PR #9) dropped to 71.0/100 and its CI went red. The red CI was *not* a code failure — `npm ci` rejected the lockfile because CI pins **Node 20** (npm 10, stricter *and* deprecated) while the committed lockfile resolves cleanly only on the dev environment's npm 11. The score drags were Dependencies (8 HIGH CVEs from the recordings packages) and Tests (recordings shipped with zero tests). Addressed all of it on a branch so CI proves green before reaching prod.

**What changed**:
- **CI: Node 20 → 24** (`.github/workflows/ci.yml`). Matches the dev environment where `npm ci` passes against the existing lockfile, and clears the Node-20-deprecation warning. Surgical — zero production-dependency churn (a clean lockfile regen was a 882-package, ~20k-line rewrite; rejected as too risky for a prod merge).
- **CVE overrides** (`package.json` `overrides`): pinned `undici` → 7.27.0 and `devalue` → 5.8.1 (the patched versions; the `@workflow/*` packages vendored vulnerable transitives). `npm audit` HIGH **8 → 1** (total 18 → 2); the lone remaining HIGH is `next` (needs a 14→16 major upgrade, scoped separately). Lockfile diff: 6 insertions / 24 deletions.
- **Recordings unit tests** (Tests dimension): `tests/unit/recordingsCoverage.test.ts` (pure `computeCoverage` — per-topic flagging, ≥5-min gap detection incl. leading/tail, confidence histogram) and `tests/unit/recordingsAnalyze.test.ts` (the PM-1-critical Opus/Sonnet parse + flag-merge: curator-flag precedence over low-confidence, emergent-topic override, markdown-fence tolerance, two-pass cost). +20 tests; suite 322 → 342.
- **Agent-page org gate** (`app/bots/[id]/{history,entities,questions}/page.tsx`): the service-role agent lookup now pairs `id` with `org_id` for non-admins (CLAUDE.md multi-tenancy invariant); admins still load any org's agent. The pre-existing redirect already closed the live access risk — this satisfies the invariant in the query itself. Regression test: `tests/unit/auth/botPageOrgGate.test.ts`.
- **`sql/091` tx-wrap** (`sql/091_recordings_storage_bucket.sql`): wrapped in `BEGIN; … COMMIT;` — it was the lone migration >70 missing the wrapper, which would have failed CI's `check:sql-tx` step once the npm-ci fix let CI progress. Not yet applied to prod, so safe.

**Verification**: clean `rm tsconfig.tsbuildinfo && tsc --noEmit` clean; `npm ci`, `npm run check:sql-tx`, and `npm test` (342 passed / 54 skipped) all green locally — i.e. every CI step passes before push.

**Scoped, not done — Next 14→16**: the remaining HIGH (`next`: Image-Optimizer remotePatterns DoS + RSC request-deserialization DoS) needs a two-major upgrade. Surface: `next ^14.2.35` (but `eslint-config-next` already `^15.5.18`), no `next/image` usage, middleware uses a matcher, `next.config.js` carries `experimental.{serverActions.bodySizeLimit,instrumentationHook,outputFileTracingIncludes}` (some now stable/relocated in 15) + the Sentry webpack plugin (16 defaults to Turbopack). Realistic as a dedicated 1–2 day spike (codemods → async `cookies()/headers()/params` → caching-default audit → Turbopack/webpack reconciliation → full regression). Deliberately kept off this branch.

## 2026-06-01 — Audit score push 1–3: recordings route tests, cross-org export-leak sweep, secrets verify

**Why**: Continuing the W22 governance score-lift (Tests + Security being the lowest dimensions). Picked the three highest-leverage remaining items.

**1) Recordings API route tests** (`tests/integration/recordings-routes.test.ts`, 22 tests): gate + validation coverage for all 8 recordings route files — auth (401), feature gate (403), org scoping (404 cross-tenant with id+org_id pairing asserted), and input validation (instructions length, scope enum, file dupes, status filter). Supabase boundary + getUserContext/getAuthUser + Workflow DevKit triggers mocked. Closes the "8 routes, 0 tests" gap.

**2) Service-role bare-`id` sweep → found a real cross-tenant leak CLASS in the export routes.** The W22 audit only flagged the bot *pages* (fixed last session). Sweeping `createServiceRoleClient().…eq('id', …)` lookups surfaced that the **dataset + town-hall export routes fetched a tenant resource by bare id with only an existence check** — any authed user could export another org's data by id. Fixed 5 routes to gate via the canonical `getCallerOrgContext` helper (`if (!isAdmin && row.org_id !== orgId) return 404`; admin-org may export any, Phase E):
- `app/api/datasets/[datasetId]/export/{signals-pptx,html,pptx}/route.ts`
- `app/api/townhall/sessions/[id]/export/{pptx,route}.ts` (CSV route captures org_id across both substrates)
- (`datasets/export/html/share` was already correctly gated — the reference pattern.)
- Regression test `tests/integration/export-org-gate.test.ts` (6 tests): non-admin in orgA → 404 for an orgB resource on every fixed route; same-org caller passes the gate.
- The other ~30 grep candidates were triaged as safe: admin-cross-org by design, public endpoints, session-client (RLS), id derived from an already-org-verified parent, or org-scoped mutations.

**3) Secrets quick win — already mitigated, verified.** The W22 LOW finding (`lib/meridian.ts` hardcoded JWT) already uses the env-override-with-public-fallback pattern (`process.env.MERIDIAN_TOKEN || PUBLIC_MERIDIAN_TOKEN`) and is documented as a public flymco.com bundle token. `.gitignore` already carries `*.pem`/`*.key`/`*.p12`. A scan of tracked source found **no real hardcoded secrets** (no `sk-ant`/`sk-`/AWS/private keys; the only JWT literal is the documented-public meridian token; `service_role` hits are SQL GRANTs). No code change warranted.

**Verification**: clean `rm tsconfig.tsbuildinfo && tsc --noEmit` clean; `npm test` 370 passed / 54 skipped (+28); `check:sql-tx` green.

## 2026-06-01 — Fix: stale signal-stats cache (Coalition Donor count mismatch)

**Why**: User reported the Coalition Donor Survey Collection showed irreconcilable counts on one screen — TextMine toolbar "67 records" vs Themes panel "80 responses/comments" for a single field ("Familiarity Follow-up"), which is impossible (a field can't have more answers than records in scope). Investigated against live prod (read-only): the collection's two member studies (Active 53 + Inactive 55 = 108 rows) had **exactly 67** non-empty `experience_followup` rows as of **2026-05-13** — the timestamp on the cached `signal_stats` blob — then **13 more responses arrived** (newest 2026-05-21) → **80** now. So 80 (live, correct) vs 67 (stale cache); the 108 top-right is correct.

**Root cause**: `lib/signalStats.ts` cached the toolbar stats in `dataset_state.analytics.signal_stats` keyed **only** on the theme-model hash. The hash flips on theme edits but is blind to rows added by a sync, so the strip froze at the 5/13 snapshot while the live Themes panel counted the new rows. The `invalidateSignalStats()` helper meant to cover this was **never called anywhere** (the docstring's "downstream sync routes call it" was false) — dead code.

**Fix**: pair the cache key with the **current row count**. `computeSignalStats` now resolves the underlying dataset IDs (extracted a shared `resolveDatasetIds` helper, reused by the compute path so both count the same rows) + a cheap `totalRowCount` head-count, stores `row_count` in the cache, and serves the cache only when hash AND row_count both match. A sync that changes the count forces a recompute on next read. Legacy caches (no `row_count`) never match → self-heal on next view — including the Coalition collection, which will recompute 67→80 with no manual cache clear. Edits that fill a previously-empty field without changing row count remain undetected (rare; re-mining forces recompute). Fixed the misleading docstring; `invalidateSignalStats` retained as an optional eager-drop but no longer load-bearing.

**Tests**: `tests/unit/signalStats.test.ts` (3) — cache hit when hash+count match (no recompute), recompute when row_count changes under a stable hash (the Coalition case, 67→80), recompute for a legacy cache missing `row_count`.

**Verification**: `rm tsconfig.tsbuildinfo && tsc --noEmit` clean; `npm test` 373 passed / 54 skipped (+3). Diagnosis confirmed by live read-only counts, not asserted. ANALYTICS.md § "Signal-stats toolbar" documents the keying + the intentional records-vs-responses denominator difference.

## 2026-06-01 — Audit push (DOMPurify, .env.example, test batch); Next 14→16 scoped

Driven by a fresh `/audit-codebase` run (7.5/10 on the skill's framework). Did the safe wins; scoped the Next upgrade separately.

**DOMPurify on the 3 `dangerouslySetInnerHTML` surfaces** (Security; closes the long-standing SECURITY.md TBD #14): wrapped the rendered HTML in `DOMPurify.sanitize` (existing `isomorphic-dompurify` dep) on `app/bots/[id]/conversations/ConversationsClient.tsx` (conversation message linkify), `components/ui/ChatBot.tsx` (chat bubble formatHtml), and `app/campaigns/[id]/CampaignDetailClient.tsx` (3 email-preview renders). All strip script/on*/javascript: while keeping the safe markup the helpers emit.

**`.env.example`** committed (Secrets 9→10 + onboarding/DD): enumerated all 56 `process.env.*` refs from the code and grouped them (core Supabase, AI providers, email/SMS, data sources, Meta social, AWS backups, recordings infra, secrets/signing, Sentry, URLs, internal flags) with placeholder values — no real credentials. Notes the GOAA/Meridian public-fallback pattern and the build-time-derived vars.

**Test batch** (Tests): `tests/unit/components/BrandTagInput.test.tsx` — the repo's **first component test** (render contract + onChange + `/api/brands` datalist population via mocked fetch). `tests/integration/tenant-routes-gate.test.ts` — gate coverage for campaign-send / social-comment-handle / dataset-route (401 + cross-org 404). Suite +10.

**Deliberately skipped `.claude/rules`** (the audit's AI-Patterns nudge): Claude Code auto-loads `CLAUDE.md`, not a `.claude/rules/` dir, in this repo — creating files there would be non-functional score-gaming. AI-Patterns is already healthy (rich CLAUDE.md + hooks + 4 commands + spec-drift/devlog/governance automation).

**Next 14→16 scoped (not executed):** 0 direct `cookies()`/`headers()` sites and 0 `next/image` (the scariest 15 migrations barely apply), but **235 route handlers + 36 pages** read `params`/`searchParams` (async in 15, codemod-assisted), 62 server-component `fetch()` sites need a caching-default audit, 8 `useSearchParams` need Suspense boundaries, and the config (instrumentationHook/serverActions relocation + Turbopack-default vs the Sentry webpack plugin) + a React 18→19 bump make it a stacked two-major. Estimate ~3–5 day spike + prod canary. Full write-up handed to the user.

**Verification**: `tsc --noEmit` clean; `npm test` 383 passed / 54 skipped.

## 2026-06-01 — StoryTime PPTX: theme-card counts, comments+signals, native entity analysis (catalog-first)

**Why**: User hit three PPTX-export problems on the Coalition Donor deck. (1) The theme-selection cards in the export builder showed `n=0 / 0%` for every theme. (2) A Custom-Builder instruction to "skip text analytics and run entity analysis on the Charities Donated To field" was silently ignored. (3) Wanted the "signals" count woven into every text-analytics slide alongside the comment count.

**1) Theme-card 0% (ExportModal)** — the cards read `count`/`percentage` straight from the saved `theme_model.themes`, which persist both as **0** (real counts are computed live in TextMine, never written back). Fixed by fetching live counts from the existing `/theme-counts` endpoint after load and merging them into the cards.

**2) Comments + signals on text slides (export/pptx route)** — every open-ended/theme slide header now shows `N comments · M signals` (comments = responses with text in the field; signals = sum of per-theme match counts, so a multi-theme response counts >1). Computed per field from `computeFieldThemes` and threaded into `buildOpenEndedSlide`/`buildThemeGridSlides`/`buildThemeSlides` via a `meta` arg + `withCounts()`. Definitions match the TextMine toolbar's "comments/signals" so the deck and app reconcile.

**3) Native entity analysis + skip-text (the real gap)** — the free-text Custom-Builder instruction only ever shaped AI narrative *wording* (`generateNarratives`); it never drove slide composition, and StoryTime had no entity capability at all (that lived in the separate `/api/entity-analysis-deck`). Added: an **Entity Analysis field picker** + a **"Skip theme/verbatim text-analytics slides"** toggle in ExportModal (`body.entityFields`, `body.skipTextAnalytics`); native entity slides in the export route; and `skipTextAnalytics` gates out the OE theme + verbatim sections (categorical/numeric stay). Extracted the entity core into `lib/entityAnalysis.ts` and refactored `/api/entity-analysis-deck` to share it; exported `renderEntityGrid/renderBarChart/renderQuotes` from `lib/pptx/slideRenderer` so StoryTime renders entity slides into its own pptx (same NUMBERED master).

**Cost — catalog-first (per user)**: entity slides read the **stored `entity_catalog`** via `getEntitiesWithCounts` (pre-extracted, canonicalised, categorised, live counts) → **zero extra AI**. Only when the catalog is empty does it run `discoverEntities` once, which **stores** the entities for next time (skipped when AI is off). The Coalition collection already has 35 catalog entities, so its deck costs $0 for entities.

**Verification**: `rm tsconfig.tsbuildinfo && tsc --noEmit` clean; `npm test` 388 passed / 54 skipped (+5: `tests/unit/entityAnalysis.test.ts`). Diagnosed against live read-only DB (theme_model persists count:0; q3_response="Charities Donated To" has 85 responses; entity_catalog has 35 rows for the collection scope). Entity renderers QC'd standalone — render into a fresh NUMBERED-master deck without throwing (they're the same renderers already shipped in entity-analysis-deck). ANALYTICS.md + TESTING.md updated.

## 2026-06-01 — Fix: signals-pptx export wrote to server ~/Downloads (prod crash)

CI on PR #11 surfaced a pre-existing bug: `app/api/datasets/[datasetId]/export/signals-pptx/route.ts` called `fs.writeFileSync(os.homedir()/Downloads/...)` server-side after rendering the deck — leftover dev convenience. It ENOENT-crashes on Vercel's serverless filesystem (no `~/Downloads`), and an API route shouldn't write to local disk anyway (it already returns the PPTX as an HTTP attachment). Removed the write; the download response is unchanged. The export-org-gate test's same-org case (which exercises the full route) now passes on CI.

## 2026-06-01 — Next 14 → 15 upgrade (Phase 1 of the 14→16 spike) — branch upgrade/next-15

Executed Phase 1 of the scoped Next upgrade. Branch `upgrade/next-15`, commit-only (not pushed), 3 checkpoint commits. **Bumping to Next 15 clears the last HIGH CVE — `npm audit` now 0 high / 2 moderate.**

**What changed**:
- `next` ^14.2.35 → ^15.5.18 (eslint-config-next already 15).
- **Async request APIs** (the bulk): `lib/supabase/server.ts` `createClient()` is now `async` (`await cookies()`); the ~262 server-side call sites became `await createClient()` (browser-client sites untouched). `tsc` was the worklist — making the wrapper return `Promise` flagged every un-awaited site, so none were missed. `ReturnType<typeof createClient>` refs → `Awaited<...>` (incl. the `createBrowserClient` alias in `lib/auth/orgAccess.ts`, which cascaded to ~30 callers via `getCallerOrgContext`).
- `headers()` async: `lib/requestContext.ts` `getRequestId()` → async; `app/demo/mco/page.tsx` → async.
- `NextRequest.ip` removed in 15: bot/clara/nora chat routes derive the rate-limit key from `x-forwarded-for`.
- **`@next/codemod next-async-request-api`** → 153 files: `params`/`searchParams` now `Promise<>` with `await props.params` in pages + route handlers. `entities/[slug]` local helper typed `Awaited<Params['params']>`. Test call sites wrapped `params` in `Promise.resolve(...)` (30 sites).
- **`next.config.js`**: removed `experimental.instrumentationHook` (stable in 15); moved `outputFileTracingIncludes` out of `experimental` to top-level (keeps the control-reports markdown bundling working).

**Verification**: `tsc --noEmit` clean; `npm test` 388 passed / 54 skipped; `next build` succeeds (only pre-existing ESLint `warn`s — the known 374 — no migration warnings, no invalid-config, no missing-Suspense). fetch-caching default flip (62 server fetches) did not surface in build; app is force-dynamic-heavy so low risk — flagged for the prod canary smoke.

**Not done (Phase 2, separate)**: Next 15 → 16 (Turbopack default vs the Sentry webpack plugin; React 18 → 19). Held for a separate branch + canary. This Phase-1 branch is commit-only pending review.

## 2026-06-01 — Next 15 canary caught a prod-breaker: jsdom ESM require fails on Node 20

Pushed `upgrade/next-15` to a Vercel **preview** (one-time, user-authorized) and smoke-tested. Login ✅, PPTX export ✅, auth redirects ✅, `/demo/mco` (the `await headers()` fix) ✅ — but **`/s/<real-survey>` returned 500** (a fake guid returned 200, so it was the actual-render path).

**Root cause (from Vercel runtime logs):** `ERR_REQUIRE_ESM` — `html-encoding-sniffer/lib/html-encoding-sniffer.js` does `require()` of the ESM `@exodus/bytes/encoding-lite.js`. The chain is `isomorphic-dompurify` (used by Survey/Agent/PulseIQ widgets for SSR sanitization) → `jsdom@29` → its `@exodus/bytes`-based `html-encoding-sniffer@6` / `data-urls@7` / `whatwg-url@16` cluster. These deps are **identical on main** — so it's not a regression from the bump; Next 15 externalizes jsdom to a runtime `require()` (Next 14 bundled it), and the Vercel function runs **Node 20**, where `require()` of ESM is unsupported. It does **not** reproduce locally because local Node is 24 (require-of-ESM is supported in Node 22+).

**Fix:** `engines.node` `">=20.0.0"` → `"22.x"` so Vercel runs the functions on Node 22+ (require-of-ESM supported, matching local). One line. **Caveat:** if the Vercel project has an explicit dashboard Node.js Version pin at 20, that must also be set to 22.x for the engines change to take effect. Fallback if Node can't move: npm `overrides` to force jsdom's WHATWG deps back to their CJS majors (riskier).

**Cannot verify locally** (local Node 24 already passes) — needs a re-push to the preview to confirm the survey/agent/PulseIQ widgets render on Node 22. Commit-only on the branch pending that re-canary.

## 2026-06-01 — Next 15 jsdom ESM blocker SOLVED (downgrade to CJS jsdom), verified locally

The `engines:"22.x"` bump did NOT fix the survey/agent/PulseIQ 500 on the preview (still `ERR_REQUIRE_ESM`) — Vercel either ignored engines or ran a 22.x without `require(ESM)` default (only default in Node 22.12+/24). Relying on the Vercel Node version was too fragile, so switched to a **Node-independent** fix.

**Repro without canary pushes:** `node --no-experimental-require-module` on local Node 24 disables `require(ESM)`, reproducing Vercel's Node-20 behavior exactly. `NODE_OPTIONS=--no-experimental-require-module npm run start` + curl `/s/vindman` → reproduced the 500 locally. This gave a fast fix-loop with zero deploys.

**Root cause:** `isomorphic-dompurify@3.12` → modern **jsdom@29 (ESM)** whose WHATWG deps (`html-encoding-sniffer@6`, `whatwg-url@16`, `data-urls@7`, `@exodus/bytes`) are ESM-only. Next 15 externalizes jsdom to a runtime `require()`, which throws on any Node without `require(ESM)`. (jsdom went ESM at v27; v26 is the last CJS.)

**Fix:** `isomorphic-dompurify` ^3.12 → **^2.26.0** (uses jsdom@^26) and the `jsdom` devDep ^29.1.1 → **^26.1.0** → single **jsdom@26 (CJS)**, `@exodus/bytes` gone. SSR sanitization still works (jsdom@26 supplies the server DOM).

**Verified locally under the Node-20 simulation:** `/s/vindman` → **200** (renders the real survey), 0 `ERR_REQUIRE_ESM`; `tsc` clean; `npm test` 388 passed (vitest jsdom env fine on @26); `next build` green. Node-independent, so it holds regardless of Vercel's Node version. (`engines:"22.x"` kept as hygiene — Node 20 is deprecated — but is no longer load-bearing.)

## 2026-06-01 — Next 15 → 16 upgrade (Phase 2 of the 14→16 spike) — branch upgrade/next-16

Executed Phase 2, the held Next 15 → 16 jump, on a fresh branch off `main` (which carries the Phase-1 Next 15.5.18 state). Commit-only, not pushed.

**Bumps**: `next` 15.5.18 → **16.2.7**; `react`/`react-dom` 18 → **19.2.7**; `@types/react`/`@types/react-dom` 18 → **19**. `isomorphic-dompurify`@2.26 + `jsdom`@26 (the Phase-1 CJS pin) carried forward untouched — the SSR-sanitization blocker stays solved.

**Turbopack-vs-webpack (the flagged blocker)**: Next 16 makes Turbopack the default for `next build`/`next dev`, which **fails the build** when a `webpack` key is present — and ours is, injected by both `withSentryConfig` (source-map upload + `treeshake.removeDebugLogging`) and `withWorkflow`. Conservative resolution: opted `build` and `dev` out with the documented `--webpack` flag, so Sentry + Workflow DevKit behave **identically to Next 15**. Turbopack adoption is deliberately deferred to its own evaluation — not bundled into a version jump.

**React 19 type breaks**: only 3 sites. React 19's `useRef<T>(null)` now returns `RefObject<T | null>` (was `RefObject<T>`), so two prop/param type decls that required a non-null ref no longer matched their callers — `LinkToolbar.targetRef` and `useSurveyEngine`'s `chatRef`/`inputRef`. Widened all three to `| null`. No runtime/behavioral change.

**Generated-file churn (committed, as in Phase 1)**: `next build` rewrote `tsconfig.json` (`jsx: preserve` → `react-jsx`; added `.next/dev/types/**/*.ts` for the new concurrent dev/build output dir) and `next-env.d.ts` (`/// <reference path>` → `import`).

**Clean by absence**: no `revalidateTag` (would need the new 2nd `cacheLife` arg), no `serverRuntimeConfig`/`publicRuntimeConfig` (removed), no parallel-route `@slots` (now need `default.js`), no `unstable_cache`/PPR/`dynamicIO`, no `next/legacy/image` or AMP, no `images` config block to reconcile against the new `qualities`/`minimumCacheTTL`/`imageSizes` defaults.

**Verification**: `rm tsconfig.tsbuildinfo && tsc --noEmit` clean; `next build --webpack` green (exit 0; only the pre-existing benign `@opentelemetry/instrumentation` "Critical dependency" warning via Sentry — present on Next 15 too, not a regression); `npm test` **388 passed / 54 skipped**. Build output now labels middleware as "Proxy (Middleware)" — Next 16 nomenclature; the file is still `middleware.ts`.

**Deferred (own follow-ups, not bundled into the version jump)**:
- `middleware.ts` → `proxy.ts` rename. Deprecated, **not removed** in 16 — still works. It's the CSRF-critical path and `proxy` is nodejs-only (no edge runtime), so it gets its own focused change + QA.
- ESLint toolchain: `next lint` is removed in 16, so the `"lint": "next lint"` script is stale. The real fix is eslint 8 → 9 + flat config + `eslint-config-next`@16 (which peer-requires eslint ≥9). Isolated from the runtime upgrade because it can surface a wall of lint findings; lint is not in CI (CI = typecheck + `npm test`) so nothing is gated meanwhile.

**Not verified**: prod-canary smoke (the React 19 hydration surfaces — survey/agent/PulseIQ widgets, streaming, loaders, images — need a real browser, per the Phase-1 jsdom lesson that local Node masks Vercel behavior). Branch is commit-only pending that canary + user review.

**Next 16 (2/n) — vercel.json buildCommand pin.** `vercel pull` showed the project's `buildCommand` is `null` → Vercel uses the Next.js framework default `next build` (no flag) and **ignores** the `--webpack` in our package.json script. Under Turbopack-default that fails on the Sentry/Workflow webpack key. Pinned `"buildCommand": "next build --webpack"` in vercel.json so cloud builds (preview + prod) match local. Dashboard nodeVersion is 24.x (engines says 22.x) — irrelevant now that the jsdom fix is Node-independent. Needed before the first Next-16 Vercel build can go green.

## 2026-06-01 — Next 16 (3/n): middleware→proxy rename + spec version sync (15→16), then PUSH

Folded the two cheap deferred follow-ups into the upgrade before landing it.

**#1 middleware → proxy** (Next 16 deprecated the `middleware` file convention): `git mv middleware.ts proxy.ts`, `export function middleware` → `export function proxy`. The CSRF + same-origin + request-id logic is byte-for-byte unchanged; only the wrapper name moved. `config.matcher` carries over. proxy runtime is nodejs (was edge by default) — fine, the code uses only NextRequest/NextResponse/crypto.randomUUID/Headers/URL, no edge-only APIs. Updated every reference: tooling (`scripts/specMap.ts` ×2, `scripts/check-devlog-drift-staged.ts` watch regex), code comments (`lib/requestContext.ts`, bots `[id]/chat`, recordings `[id]/analyze` + `[id]/process`), and live docs (CLAUDE.md, SECURITY.md, ENGINEERING.md). Build output now reads `ƒ Proxy (Middleware)` — confirmed wired on /api/*.

**#3 spec version sync**: SPEC.md + CLAUDE.md stack lines `Next.js 14 / React 18` → `Next.js 16 / React 19` (main never carried the Phase-1 15 sync — it lived only on the unmerged docs/next15-spec-sync branch, so 16 subsumes it), CLAUDE.md `Node ≥ 20` → `Node 22.x` (matches engines).

**Environment snag (local only):** this working copy is in Dropbox, which (a) created `" 2"` sync-conflict dupes of `node_modules/@types/react`, `@types/react-dom` and `.next/types/*` that broke `tsc` with phantom duplicate-identifier errors, and (b) *restored* the deleted `middleware.ts` as an untracked file after `git mv`, making the build see both files. Both are local-disk artifacts — the committed git tree has only `proxy.ts` and no dupes, so Vercel (builds from git) is unaffected. Cleared the dupes + ghost; rebuilt clean.

**Verification**: tsc clean; `next build --webpack` green with Proxy wired; `npm test` 388 passed / 54 skipped. Pushing to main (authorized) — first Next 16 production deploy.

## 2026-06-01 — Next 16 (4/n): deeper spec sync

Follow-up doc-only sync beyond the (3/n) version-line bumps. ENGINEERING.md: rewrote the lint bullet + Open-TBD item 10 (in SECURITY.md) for the Next 16 reality — `next lint` removed, `next build` no longer runs ESLint, so the eslint 8→9 flat-config migration is the prerequisite and future enforcement needs a CI lint step; new `### Build command — Turbopack opt-out` subsection documenting the `--webpack` + `vercel.json` buildCommand pin (project setting was null → cloud ignored the package.json flag); request-ID note updated (proxy now nodejs runtime, AsyncLocalStorage now viable but headers-based approach retained). SPEC.md + FEATURES.md: manifest "Next.js 14 file convention" → "Next.js App Router". SECURITY.md: two ESLint paragraphs updated for the `next build`-no-longer-lints change. Legacy docs (ana_spec, sentimetrx-spec-v4, dated security-review) left as point-in-time records.

## 2026-06-02 — Admin gating for recordings as a metered add-on

**Why**: We're rolling recordings out as a metered paid add-on that shouldn't be all-or-nothing per org — only certain users within an org should get it. That needs two levels of control (an org default plus per-user overrides) and a monthly quota, which the existing boolean `ModuleFeatures` toggles can't express. These three files give super-admins a single panel to flip recordings on for an org, set its quota, and then allow/block individual members.

**What changed**:
- `app/api/admin/orgs/[id]/features/route.ts` — super-admin GET/PUT for the org-level `org_features` gate (sql/089). GET returns the org setting plus every member's `user_features` override in one round-trip so the panel renders both levels at once; PUT upserts the org enable + `quota_per_month`. Writable features are whitelisted (`recording`). Distinct from the `ModuleFeatures` JSONB toggles on `/api/admin/orgs/[id]`.
- `app/api/admin/users/[id]/features/route.ts` — super-admin PUT for the per-user override: `enabled` true = allow, false = block, null = inherit (row deleted); optional per-user `quota_per_month`. Pure-inherit drops the row so resolution falls back to the org level.
- `components/admin/RecordingsAccessPanel.tsx` — the admin UI: org enable + quota, plus per-member Inherit/Allow/Block. Metered/gated by `org_features`/`user_features`, distinct from `OrgFeatureToggles`.

## 2026-06-02 — StoryTime deck-fix backlog #8–#11 (provenance honesty, branding, recap slide, collection recompute)

**Why**: Reviewing the regenerated Coalition Donor deck surfaced four issues. The overarching directive: the report-export deck is a **readout, not a sales pitch** — stop overselling, make every number traceable.

- **#8 Provenance honesty** (`export/pptx/route.ts` provenance block + `renderProvenance` in `slideRenderer.ts`): the "How this deck was made" slide printed theoretical capacity as if it were work done — "210 potential cross-tabulations", "126 significance tests run", "648 pairings", a "decisions made" headline, and an inflated 12–23 hr human-equivalent. Rewrote it to report only work performed: field counts now read the **defined schema** (`schema_config.fields`) instead of the selected export subset (so "2 open-ended · 27 fields captured", not "1 open / 21 fields"); dropped all capacity numbers; human-equivalent is a flat ~15 min/content slide (`slidesSoFar−1`, excl. title + closers) with the assumption stated on the slide; key-takeaways row hidden when 0. Renderer gained a generic `secondStat` and collapses `low===high` hours to "~N hours".
- **#9 Branding** (`route.ts`, `slideRenderer.ts`, `lib/pptx/shared.ts`, `ExportModal.tsx`): the deck still leaked "datanautix.com" / "Generated by Ana" on footers, the header wordmark (`logo()` in shared.ts — the biggest miss, on nearly every content slide), the title wordmark + "d" monogram, and the About-slide methodology ("Ana AI Text Analytics"). Switched all of them to Sentimetrx ("Senti·metrx" split wordmark, "S" monogram, `sentimetrx.ai`, "Generated by Sentimetrx"). Internal `DN` palette constant + code comments left as-is per naming policy.
- **#10 Report-inputs recap slide** (`buildRecapSlide` in `route.ts` + `includeRecap` toggle in `ExportModal.tsx`, default ON): an always-present appendix recapping the export request — mode, audience, fields, theme names, entity/impact fields, filters, comment options, appendices, and the **verbatim custom instructions** (otherwise discarded after `generateNarratives`, so previously unrecoverable). Lets a deck's AI storytelling be retraced. Suppressible for clean client decks.
- **#11 Collection recompute cascade** (`lib/collectionRecompute.ts` new; `sync/route.ts` + `compute/route.ts`): the root cause behind #1's `displayRows` band-aid *and* the earlier 67-vs-80 signal-stats drift. A collection's cached aggregates (`row_count`, `analytics.totalRows`, `signal_stats`) only recompute on explicit trigger, so member sync left every parent collection stale. Extracted the collection-recompute logic into a shared helper (`recomputeCollectionAnalytics` + `recomputeParentCollections`); member sync now cascades a recompute to parents (best-effort) and the manual `/compute` collection branch was refactored to call the same helper — one implementation, no parallel copy. `invalidateSignalStats` runs as part of the recompute.

**Verification**: clean `tsc --noEmit` (cache cleared); `npm test` 388 passed / 54 skipped; provenance + recap slides pixel-QC'd via LibreOffice → pdftoppm (both layout variants — 2-vs-3 output rows, instructions-vs-none — plus confirmed the Sentimetrx header wordmark). #11 verified read-only (typecheck + tests; not run against prod). Commit-only, not pushed.

## 2026-06-02 — RC taxonomy pilot: learned keyword dictionary (Path B)

**Why**: The hand-written Tier-1 keyword dictionary (~290 phrases) is too thin to compete with CX-tagging vendors whose libraries are thousands of phrases tuned over years (user flagged the keyword tier as "weak competitively"). Path B machine-generates the dictionary from the prospect's own 43K Google reviews, so it's pre-tuned to actual customer vocabulary — and the generation story is itself a pitch artifact ("we read your reviews to build this; your old vendor guessed at a desk").

**What changed**:
- `scripts/pilot-rc-keyword-mine.ts` (new) — reads the 43K CSV directly (the pilot DB dataset holds only a 50-row smoke sample — the full ingest never ran), seeded-samples N reviews, Haiku 4.5 extracts verbatim ≤6-word phrases against the closed 7-axis vocab. Prompt-cached system prompt. → `data/keyword-candidates.jsonl` (gitignored).
- `scripts/pilot-rc-keyword-build.ts` (new) — aggregates JSONL → frequency floor → polarity resolution → item assignment → emits `lib/taxonomyKeywordsLearned.ts` (`KeywordEntry[]`, per-phrase freq comments). Two quality guards added after the partial-sample spot-check exposed them: (1) a **product guard** dropping generic food-sentiment ("great food") misfiled on `product:steak` — that's regression-breaking, since the anchors forbid `product:steak` on food-only reviews — unless the phrase also names a concrete product/item; (2) a polarity-split floor (minority kept only at ≥30% share AND count ≥ 2) to wash out count-1 noise.
- `lib/taxonomyKeywordsLearned.ts` (generated) — 1,017 phrases from the first 5K run (seed 1, min-count 3), ~3.6× the hand-written set.
- `lib/taxonomyKeywordMatcher.ts` — scans `ACTIVE_DICTIONARY = hand-written ⊕ learned` (**merge, not replace**: keeps tuned severity defaults + anchor phrases; `collapseHits` dedups overlap). `classifyByKeyword` gained an optional dictionary-override param.
- `scripts/pilot-rc-keyword-lift.ts` (new) — measures keyword-tier chip lift hand-written-only vs merged on held-out reviews (seed ≠ mine).
- `docs/DATA_SOURCES.md` § 14 — new "Learned keyword dictionary (Path B)" subsection.

**Verification**: `pilot-rc-regression.ts` **7/7** still pass (product guard holds — food-only anchors emit no `product:steak`; "food poisoning from the steak" correctly keeps it). `pilot-rc-keyword-lift.ts` on 500 held-out reviews: **3.15×** keyword-tier assertions (1,193 → 3,759), coverage 82% → 99% — clears the spec's 2× bar. `tsc --noEmit` clean (cache cleared); `npm test` 388 passed / 54 skipped. Mining spend ~$9 (358-review partial spot-check + 5K run). Commit-only, not pushed. No prod/DB changes — the dictionary is a static artifact.

## 2026-06-02 — RC pilot: coverage comparison vs the vendor's labels

**Why**: To show the client, in their own data, how our classifier compares to the labels their current CX vendor produced (the CSV `Classification` column) — coverage, recall, and added coverage.

**What changed**: `scripts/pilot-rc-coverage.ts` (new) projects every legacy vendor label into our 7-axis model via `mapLegacyLabels` and compares against our Tier-1 keyword classifier across all 43,196 reviews (deterministic, no AI). Reports vendor vs our coverage rate, recall of the vendor's labels (exact axis:sub and axis-level), and reviews the vendor left usably-untagged that we tag.

**Result (first run, keyword tier only)**: vendor tags 90.2% of reviews with a usable label but 20.8% of all rows carry the vendor's `TEST` QA-leak; our keyword tier tags 98.6%; we reproduce **89.6%** of the vendor's labels at axis level (70.4% exact) while averaging 7.3 labels/review vs the vendor's 3.2; we add labels on 3,844 reviews (8.9%) the vendor left usably-untagged. The shipping hybrid (keyword+AI) tier raises recall further. Commit-only, not pushed.

## 2026-06-02 — RC pilot: example-mining + client results deck

**Why**: Client asked for a results deck and concrete example reviews bucketed by how our classifier compares to their vendor's labels.

**What changed**: `scripts/pilot-rc-examples.ts` (buckets reviews: match / vendor-caught-more / we-missed, keyword tier), `scripts/pilot-rc-examples-ai.ts` (keyword-vs-hybrid on curated misses — shows the AI tier recovers e.g. parking-lot → ambiance:safety[alert]), `scripts/pilot-rc-deck.ts` (standalone pptxgenjs builder, Sentimetrx-branded, 9 slides → ~/Downloads one-off). All numbers sourced from the regression/lift/coverage runs. Deck pixel-QC'd (LibreOffice → pdftoppm, all 9 slides; fixed a doubled footer + tight spacing). No repo artifact — deck lives in ~/Downloads. Commit-only, not pushed.

## 2026-06-02 — RC pilot: align taxonomy to the client's authoritative vendor scheme

**Why**: The client sent their CX vendor's full cross-brand "Classification Categories" — the authoritative label set our `taxonomyMapping.ts` had only reverse-engineered from the RC CSV sample. Running it through our mapper showed 44/85 of their canonical labels fell to `_unmapped` (prefix-format mismatches + the context axis was never wired into the mapper).

**What changed**:
- `taxonomyVocabulary.ts` — +7 attribute subs (quality, prep, menu variety, eighty-sixed, experience, sequence, ziosk), touchpoint `delivery`, +3 beverage (alcohol, assortment, flavor), context `special-occasion` — to fully cover concepts the vendor tracks.
- `taxonomyMapping.ts` — `Bev-`/`Steak-`/`IOR-`/`Dayparts-` prefix aliases; wired the **context axis** (dayparts, holidays, special-occasion, sporting-event, channels) which previously produced no legacy assertions at all; `normRole()` resolves `Busser Janitor`→busser and `Delivery` as touchpoints instead of collapsing to server; `Generous Pour`→campaign quarantine; split-hyphen variant keys (canonicalizer turns `to-go`→`to - go`).
- `scripts/pilot-rc-vendor-vocab-check.ts` (new) — runs the vendor's 85 canonical labels through the mapper. **0% unmapped** (was 52%).

**Result**: the coverage comparison is now complete + fairer. Vendor usable coverage 90.2%→95.3% (more of their labels recognized, avg labels/review 3.2→5.0); our axis-level recall 89.6%→90.4%; exact-sub recall 70.4%→58.5% (we now measure against their full granularity — every holiday/steak-cut/daypart — which the keyword tier rolls up and the AI tier resolves). Client deck regenerated with the honest numbers + a "your scheme maps 1:1 into our 7 axes" validation. Regression 7/7; tsc clean; npm test 388. Commit-only, not pushed.

## 2026-06-02 — Dataset report PPTX: survey overview slide, live counts, theme detail, ≥12pt fonts

**Why**: Reviewing a freshly generated Coalition Donor Survey deck surfaced six issues the client felt: (1) no survey overview/funnel page for survey sources, (2) exec summary showing a stale 62 vs the live 110, (3) same wrong number on the About slide, (4) "Familiarity Follow-up" printed three times on one open-ended slide, (5) theme cards capped at 3 keywords with no per-slide control, (6) body text at 8–10pt — unreadable on screen/print. Root cause of (2)/(3): the exec/about count + Sentimetrx branding fixes were committed but never deployed, so regenerating from the live (old) app reproduced the bugs.

**What changed** (`app/api/datasets/[datasetId]/export/pptx/route.ts`, `components/analyze/ExportModal.tsx`, `docs/ANALYTICS.md`):
- **Survey Overview slide** (new `buildSurveyOverviewSlide`) — first slide after the exec summary for survey-shaped datasets (study, or a collection of studies, or rows with `status`). Responses + With-comments KPIs over a completion funnel (Started → rating → Conversation → Survey Questions (N) → Psychographics (N) → Demographics → Completed) with retention % + drop-off, computed from the loaded flat rows exactly like `/api/share/analytics`. Replaced the response-payload `buildFunnelSlide` (single-study only; never fired for collections).
- **Familiarity-×3 fix** — section divider now uses a category eyebrow (Open-ended/Verbatim) instead of echoing the field label, with a generic subtitle fallback; the OE overview slide drops the prompt box + "Headline finding" when they'd just repeat the label. Field name now appears once.
- **Theme cards** — ExportModal gains a *Themes per slide* control (Auto/1/2/4/6 → `body.themesPerSlide`); `buildThemeGridSlides` honours it and each card now shows up to 6 wrapping keywords + description + sentiment + `n in N` + % occurrence (matches the in-app theme cloud).
- **≥12pt content floor** — bumped all body/content text (headings, bullets, KPI labels, table headers, bar labels, %/count values, quotes, descriptions, implications, recap rows) to ≥12pt; chrome (footers, page#, chips, badges, axis ticks, fine print) kept small per product decision. Compact categorical grid capped at 4/page so 12pt rows fit.

**Verified**: built a faithful render harness (extracts the edited builders verbatim + Coalition-shaped mock data → pptxgenjs → LibreOffice → pdftoppm) and visually QC'd every changed slide — exec summary now reads 110, About 110 · 78 complete (71%), survey overview funnel matches the dashboard, divider/OE show the field name once, theme cards carry full detail at ≥12pt. `tsc --noEmit` clean. Commit-only — NOT pushed (these fixes only take effect after a deploy).

## 2026-06-02 — Decks revert to Datanautix branding (company brand on deliverables)

**Why**: Owner flagged that decks should NOT say Sentimetrx — a prior session's "deck-fix #9" had switched deck branding datanautix→Sentimetrx, treating it as a leak. Clarified brand model: **Datanautix = company/consulting brand on the deliverables, Sentimetrx = the SaaS product/app.** So exported decks carry Datanautix; the app stays Sentimetrx.

**What changed** (`lib/pptx/shared.ts`, `lib/pptx/slideRenderer.ts`, `app/api/datasets/[datasetId]/export/pptx/route.ts`, `CLAUDE.md`, `docs/ANALYTICS.md`): wordmark "Senti·metrx" → "data·nautix" (data = Sarina teal, nautix = Ana orange, matching `datanautix-homepage` `--sarina`/`--ana`); "S" monogram → "D"; footers `sentimetrx.ai` → `datanautix.com`; "Generated by"/"Prepared with" + About methodology + pptx file metadata → Datanautix. Palette unchanged (it was already the Datanautix brand palette). CLAUDE.md product-naming gains a documented deck-branding exception so this isn't re-"fixed" again. Verified via render harness (wordmark + footer). tsc clean. Commit-only, not pushed. (Theme-cloud redesign / canonical theme numbers / ≤3% filter / entity fonts / style picker are the next stages in this effort.)

## 2026-06-02 — Theme slides: canonical numbers + theme-cloud redesign + ≤3% + entity fonts

**Why**: Owner review of the regenerated deck: (1) exec-summary theme % didn't match the Theme Analysis slides (deck recomputed themes per open-ended field while the app computes one set); (2/3/4) the theme grid was a staid card grid with 9pt keyword chips and ~80% white space on low-density pages — should look like the in-app Theme Clouds; (5) entity slides still had sub-12pt fonts; (6) themes ≤3% should be hidden.

**What changed** (`app/api/datasets/[datasetId]/export/pptx/route.ts`, `lib/pptx/slideRenderer.ts`, `docs/ANALYTICS.md`):
- **Canonical themes** (`computeCanonicalThemes`): themes counted ONCE across the theme model's fields (mirrors `/api/share/analytics` + the in-app Themes page), with per-keyword frequency (`kwFreqs`). Exec summary + Theme Analysis now use this one set → numbers agree everywhere. Per-question theme sections collapsed into one Theme Analysis; per-field verbatim overview slides retained.
- **≤3% filter** (`visibleThemes`): drop themes at/below 3% (fallback: top 5), matching the app.
- **Theme-cloud redesign** (`buildThemeGridSlides` rewritten): each theme = % badge + name + sentiment + a frequency-sized keyword cloud (words scale 12–30pt by occurrence, each tagged with its %), blocks fill the slide height (no white space). `themesPerSlide` (1/2/4/6) honored; word size/count scale to block height + autoFit so clouds never overflow into the next block.
- **Entity + bar-chart fonts** bumped to the ≥12pt content floor in `slideRenderer.ts` (entity name + "% of mentions", bar labels/%/count/headers, KPI labels). Per-theme detail keyword chips 7.5→12.

**Verified**: render harness (auto 4-per + 2-per theme-cloud, exec summary, survey overview, branding) — clouds frequency-sized, no overflow, Datanautix wordmark. tsc clean. Commit-only, not pushed. Next: style/personality picker (palette refactor).

## 2026-06-02 — Survey overview "With comments" parity

**Why**: Real-deck render showed "With comments" = 90 but the in-app dashboard shows 81. The dashboard counts comments in the theme/comment fields; the slide counted all open-ended fields.

**What changed** (`export/pptx/route.ts`): `buildSurveyOverviewSlide` now counts "With comments" over the theme fields (fallback all OE), matching `/api/share/analytics` commentCount (→ 81). Verified against real Coalition data via the read-only service-role harness. tsc clean. Commit-only.

## 2026-06-02 — Exec-summary system-field guard + theme-pill color fix; style picker scoped

**Why**: Real-deck render caught (1) the KEY FINDINGS fallback (shown when AI writes no bullets) leaking internal columns (Collection Label / Response Status / sentiment), and (2) the OE-overview "THEMES IDENTIFIED" pills rendering solid black (invalid 8-digit hex `tc+20`/`tc+60`).

**What changed** (`export/pptx/route.ts`, `docs/ANALYTICS.md`): snapshot fallback now excludes a SYSTEM_FIELDS set (status/sentiment/collection_label/language/score fields/`_`-prefixed); theme pills use a light neutral fill + theme-color border (valid hex). Also spec-documented the **planned standalone style/personality picker** (palette must go per-request, concurrency-safe — not a module global on Fluid Compute) — see project_deck_style_picker memory. Both fixes verified against real Coalition data (read-only harness): KEY FINDINGS shows only survey content, pills render light/teal. tsc clean. Commit-only, not pushed.

## 2026-06-02 — Apply taxonomy to more restaurant datasets (RC/CG compare + Chuy's casual overlay)

**Why**: Pitch prep this week to Ruth's Chris + Capital Grille (competitors) and a Chuy's demo. Proves the taxonomy generalizes across brands/verticals.

**What changed** (all pilot/demo tooling — inert in the app):
- `scripts/pilot-rc-cg-compare.ts` — classifies RC (26K) + Capital Grille (15K) on the shared 7 axes, two-level (axis L1, sub L2) roll-up + over/under-index deltas. Finding: CG over-indexes seafood/wine/decor/lunch (seafood sentiment 100% vs RC 75%); RC over-indexes service warmth. NOTE: these google_reviews datasets store text in `data.review_text`, not `description`.
- `scripts/pull-chuys-reviews.ts` — DataForSEO pull of 30d of Chuy's Google reviews across all 125 locations → 1,872 reviews ingested as a new dataset. Uses the `/reviews/google/` endpoint family (the `/business_data/` path 40401s on this account).
- `scripts/chuys-mine.ts` + `lib/taxonomyKeywordsChuys.ts` — Path B casual Tex-Mex overlay: shared 6 axes + a casual PRODUCT category set, dictionary mined from Chuy's reviews (204 phrases). Surfaced Chuy's-specific menu vocab (chuychanga, queso compuesto, creamy jalapeño dip, panchos).
- `scripts/chuys-classify.ts` — classifies Chuy's with core+overlay, prints the L1/L2 roll-up (margarita top drink, to-go/lunch heavy — casual patterns).
- `docs/TAXONOMY_PRODUCTIZATION_PLAN.md` — productization roadmap (proposal).

Keyword tier only (free). No app/prod behavior change. Commit-only, not pushed.

## 2026-06-02 — Share analytics: completion funnel only for survey-sourced datasets

**Why**: The shared analytics page (`/shared/[token]`) always rendered a Completion Funnel, but it only makes sense for surveys we conducted (needs response `status` + section metadata). For uploaded CSVs / Google-reviews / other ingests there is no funnel data, so it showed a misleading "Started 100% -> Completed 0%".

**What changed** (`app/api/share/analytics/route.ts`): gate `completion` to survey sources — `dataset.source==="study"` OR schema has custom/psychographic/demographic sections OR an experience_score/nps_score/status field OR rows carry `status`; also require >=3 funnel stages. Otherwise `completion: null`. The page already guards on `data.completion`, so the funnel hides automatically with no UI change. Same survey-source signal as the deck survey-overview slide. tsc clean. Commit-only.

## 2026-06-03 — Admin: make org invite buttons prominent (contrast fix)

**Why**: Platform admin couldn't find how to add users to a newly-created org — the invite controls existed on `/admin/clients/[id]` but the "+ New Invite" / "+ Bulk Invite" buttons used `text-slate-300` (near-white) on a light card, so they were effectively invisible. User management is invite-only today (no direct password-create path).

**What changed** (`app/admin/clients/[id]/AdminClientDetail.tsx`): "+ New Invite" → solid cyan CTA (dark text, matches app primary buttons); "+ Bulk Invite" → dark text on medium gray; both bump xs→sm and switch to a muted "Cancel" style when their form is open. Helper line darkened (gray-400→500). CSS-only, no behavior change. tsc clean. Commit-only, not pushed.

## 2026-06-03 — Agents: respondent stays Anonymous when agent doesn't ask for a name

**Why**: Conversations list was labelling respondents with their first chat message when it was short/capitalized (≤3 words) — even for agents configured NOT to ask for a name. A reply like "Great" or "Not really" became the person's "name". Rule: if the agent isn't programmed to ask, the respondent is Anonymous.

**What changed**:
- `app/api/bots/[id]/conversations/route.ts` — load `config`, compute `askNameOn = config.askName !== 'false'`; when off, skip the persona-name lookup AND the regex heuristics (`my name is` / short-capitalized-first-message / bot-greeting extract) → `user_name` empty → client shows "Anonymous". Applies to historical rows too.
- `lib/chatCore.ts` — gate the post-response AI name extractor (`captureName`) on `askNameOn`, so no name is mined/persisted (and no Haiku call spent) when the agent doesn't ask. Widget `user_name` path already only fires when askName is on.
- `docs/BOTS.md` — documented both gates.

Swept the class: single-session route returns only turns (no derivation); insights-deck `split` is word-count, not a name. tsc clean. Commit-only, not pushed.

## 2026-06-03 — Recordings: analysis enrichment + PowerPoint export

**Why**: Walking into a prospect's next vendor meeting, we want to record it, run the existing batch pipeline, and hand them a polished deck that both faithfully represents the meeting and "wows". The Q&A extraction was too thin for a deck (no exec summary, no per-topic synthesis, no sentiment, no action items) and there was no PPTX export (the report Export tab was a stub). "Real-time" was clarified to mean fast post-meeting turnaround, not live in-meeting analysis — so this stays entirely on the batch path.

**What changed**:
- **Data model** (`sql/094`, `lib/recordings/types.ts`): new nullable `recordings.analysis_summary` jsonb (meeting-level synthesis); `QaPairPayload.sentiment` added (optional, defaults 'neutral'). Migration applied to linked prod. `mirror.ts` now branches on `unit_type` (action_item rows mirror their own shape) + carries `sentiment`; `buildRecordingSchema` gained a Sentiment facet.
- **Analysis** (`lib/recordings/analyze.ts`, `prompts/qa.ts`): Opus extraction now classifies per-pair sentiment (no extra call). Added a third **synthesis** Sonnet pass over the published pairs → exec summary, headline, per-topic summaries, decisions, and action_item rows. Counts (`sentiment_breakdown`, `qa_count`) computed in code, not by the model. Skipped on topic-scoped re-extracts; graceful-degrades to null on failure. Persisted in `workflows/recordings.ts` + `reanalyze.ts` (scope='all'). Cost ~$1.20/meeting (+$0.25 synthesis).
- **Deck** (`lib/pptx/recordingDeck.ts` new): `buildRecordingDeck` — Datanautix-branded, modeled on the townhall export. Title → exec summary → sentiment → themes (2/slide) → action items & decisions → appendix (1 Q&A/slide). `POST /api/recordings/[id]/export/pptx` (new) — `getCallerOrgContext` + 404 cross-org gate, 409 until status=complete, `deck_download_log`. Report **Export tab** wired with a real "Export to PowerPoint" button (`ReportClient.tsx`); action_item rows excluded from the Q&A/Appendix tab split.
- **Verified**: read-only QC harness (`scripts/_recording_deck_qc.ts`) rendered the prospect's "NOWOCATS Meeting 2" deck against real data (in-memory analyze, nothing written to prod) — QC'd via LibreOffice/pdftoppm, 21 slides, brand + layout clean. Org-scope integration test (`export-org-gate.test.ts`, +4 cases) + synthesis unit tests (`analyze.test.ts`, now 17) green. Full `tsc` clean.

Commit-only, not pushed.

## 2026-06-03 — Mason: scoped capital-campaign agent for the Foundations Project

**Why**: We already run "Hope" (`/b/hope`) — a broad donor agent covering the Foundations Project *and* the full Coalition for the Homeless KB. The ask was a second, deliberately narrower agent focused only on the **Foundations Project capital raise** (what's being built, impact, naming opportunities, how to give), that still knows enough to hand people off to the Coalition site for shelter services / volunteering / getting help. Named **Mason** ("one who builds" — nods to the "Building. Pathways. Home." tagline; avoids colliding with the real Dr. Leon Kirkpatrick, the campaign's donate contact).

**What changed**:
- `scripts/_mason_create_agent.ts` (new, idempotent seed — mirrors the Hope script pattern): creates/updates the `mason` agent in the Larry Kahn org (platform AI mode), with a 14-chunk hand-encoded KB drawn from a fresh 2026-06-03 crawl of foundationsproject.org (homepage + Campaign Brochure PDF + the June 1 Naming Rights Menu PDF + the news articles — every figure verified against source, no scraped-page JSON dependency). Embeds with text-embedding-3-small.
- **3 intents**: *Donate* (→ DonorPerfect portal for any-size gifts; Dr. Leon Kirkpatrick for major/naming), *More Information Requested* (→ brochure/menu PDFs + collect name/email/phone for Brad or Leon to follow up), *Coalition Services & Help* (→ centralfloridahomeless.org + the Center for Women & Families at 18 N. Terry Ave for anyone needing shelter/help/volunteering — i.e. out-of-scope hand-off).
- **7 focuses** for analytics; branding matched to foundationsproject.org — brand navy `#1b3a5e` header + warm gold `#f7b200` avatar (navy letter) on near-white, theme brick-red `#9e2a2f` as the legible CTA accent (gold fails contrast as hover text). Colors pulled from the live site's inline CSS + the custom `foundations` theme stylesheet, not eyeballed. `askName` stored as the string `'true'` (per the user's call — the name-ask "feels personal"): Mason opens "Hi, I'm Mason! What's your name?", then greets by name before the topical opener. NB: BotClient resolves `config.askName !== 'false'`, so the value must be a string, not a boolean. Visually QC'd via the preview tool (branding + both opener states).
- No platform-code or feature changes — uses existing agent/RAG/intent machinery, so no spec (BOTS.md) delta. (`SKIP_SPEC_CHECK` — operational customer-data script only.)

**Verified locally** (`npm run dev` vs linked prod DB): RAG retrieves the right chunks at 100% top confidence; all 3 intents fire correctly; overview/donate/more-info/crisis-handoff replies are accurate, dignity-correct, and surface the real contacts + links. (The AI-generation step needs `ANTHROPIC_API_KEY` in the dev process — the live Hope agent fails identically without it, confirming it's a local-env gap, not a Mason issue.) Agent is `active` in prod → reachable at `/b/mason`. Commit-only, not pushed.

## 2026-06-03 — Agents: dynamic follow-up pills (opt-in `dynamicChips`)

**Why**: When an agent ends a reply with a choice-style question ("Want to hear about the impact, the buildings, or how to get involved?"), the visitor had to type it out. Surfacing those options as clickable pills makes guided Q&A feel responsive. Requested for the Mason agent; built as a reusable, opt-in widget capability.

**What changed** (platform code — shared widget):
- `components/ui/ChatBot.tsx`: new `extractChips()` parses a `[[chips: A | B | C]]` trailer off each agent reply, strips it from the visible text (never leaks), stores ≤4 options on the message (`Message._chips`), and renders them as pills under the **newest** assistant turn — reusing the opener-suggestion styling + `accentColor`; click → `sendMessage(option)`. Hydration strips the trailer from persisted turns too. New `ChatBotConfig.dynamicChips?: boolean`. Purely additive — no trailer / flag off → current behavior unchanged.
- `app/b/[slug]/BotClient.tsx`: resolves `dynamicChips` from the agent config (accepts boolean `true` or string `'true'`).
- `scripts/_mason_create_agent.ts`: Mason's prompt now instructs the `[[chips:…]]` trailer for choice questions (visitor-voice, 2–4 opts, not for open questions); `config.dynamicChips: true`. Only Mason is enabled.
- `docs/BOTS.md`: documented the feature under the opener section.

**Verified** (`npm run dev` vs linked DB): model emits the trailer reliably; parser strips it (no marker leak); pills render under the reply and match the offered options (screenshot QC via preview tool); click path is the proven `sendMessage` handler. tsc clean. Datanautix branding untouched. Commit-only, not pushed.

## 2026-06-03 — Recordings deck: polish round (tone, sizing, Q&A exchanges)

**Why**: Owner review of the generated NOWOCATS deck. Three fixes before it's prospect-ready. (Code for the recordings analysis-enrichment + PPTX export feature lands in this same commit; the original WHY entry was captured by a parallel commit while this work was still local.)

**What changed** (`lib/pptx/recordingDeck.ts`, `lib/recordings/{analyze,prompts/qa,types}.ts`):
- **No opining**: synthesis prompt rewritten to a strictly neutral minutes-taker voice — the headline is now a factual subject/scope line (was an editorial "Funding Threats Cloud Broader Plans"), exec/topic summaries are descriptive only. The deck may be shared with the client/county.
- **Representative exchanges**: theme cards now show a real Q&A pair with asker/panelist identified (resolved from the actual extraction pairs via model-chosen indexes), not two lookalike quotes.
- **Legibility**: 12pt floor on all body text; boundary-aware truncation (`truncBoundary`) so quotes/summaries run longer and end on a sentence/word boundary instead of mid-word; card layouts retuned so nothing overflows.

Verified via the read-only QC harness against the real recording (in-memory analyze, no prod writes), QC'd in LibreOffice/pdftoppm. tsc + npm test green. Commit-only, not pushed.

## 2026-06-03 — New deck: "Project Insight" PE teaser (/admin/decks)

**Why**: Owner workshopped an acquisition-roll-up thesis with ChatGPT (consolidate fragmented survey/feedback software vendors) and wanted it as a real, regeneratable deck. Built as a 10-slide first-conversation teaser. Note: it overlaps the existing Datanautix Roll-up decks (`/api/rollup-deck`) — flagged to owner; may converge later.

**What changed** (new deck route + builder, registry wiring):
- `lib/pptx/projectInsightDeck.ts`: `buildProjectInsightDeck(pptx)` — cover + 9 content slides. Datanautix-branded (navy header, sarinaBlue accent, datanautix wordmark, `datanautix.com · Confidential` footer). Style mirrors `reviewIntelligenceDeck.ts` / `rollup-deck`.
- **Framing = Option B** (owner's call): survey software is the *acquisition vehicle*, the AI insight layer is the product. Core slide reframes "Survey → Report" → "Survey → Analyze → Recommend → Act."
- **Numbers stripped to qualitative** (owner's call): no fabricated TAM, vendor counts, deal multiples, or EBITDA-uplift figures (the ChatGPT draft had all of these). The economics slide is the re-rating *logic*, not a `10×$5M=$50M, 3–5× in / 8–12× out` spreadsheet. Buy-box retention/margin thresholds held for the criteria memo; per-slide footnotes say specific figures get cited in diligence. Pipeline/exit names labeled illustrative.
- `app/api/project-insight-deck/route.ts`: thin `requireAdmin`-gated GET; `logDeckDownload('project-insight-deck')`; returns `Project-Insight-Teaser.pptx`.
- `app/admin/decks/DecksClient.tsx` + `page.tsx`: registered the deck card (badge `TEASER`) + `deckLastModified` lookup.
- `scripts/_project_insight_qc.ts`: read-only render harness (no prod I/O).

**Verified**: rendered via the QC harness, converted to PNG (LibreOffice + pdftoppm), visually inspected all 10 slides — caught + fixed a slide-10 overlap (5th strategic-buyer card under the objective box). `rm tsconfig.tsbuildinfo && npx tsc --noEmit` clean. Datanautix branding correct. Commit-only, not pushed.

## 2026-06-03 — Recordings → general meeting tool (presentation + Q&A) — backend + deck

**Why**: Walking into a prospect's community meeting (~1wk out) we want to record the WHOLE meeting, summarize the presentation portion (seeded by the presenter's actual slides), then the Q&A — and have it be a generically useful, tunable meeting tool, not a one-off. "Real-time" was clarified as fast post-meeting turnaround through the batch pipeline.

**De-risk gates (both passed before building)**: (1) extended `lib/ai.ts` with image content blocks → Claude vision reads a slide accurately (~$0.01/slide Sonnet); (2) `poppler-utils`/`pdftoppm` installs + renders PDF→PNG in a Vercel Sandbox. So the full vision + slide-grounding scope is viable — no fallback needed.

**What changed** (all backend + deck; UI wizard/gate forms still to come):
- **Data model** (`sql/097`, applied to prod): `recordings.meeting_profile/phase_map/presentation_outline/proceedings_summary` (jsonb) + `recording_files.file_role` ('media'|'slides'). Nullable adds → no new RLS; `meeting_profile IS NULL` = legacy Q&A behavior.
- **Profiles** (`lib/recordings/profiles.ts`): presets `town_hall_qa` (current) + `community_meeting` (presentation→Q&A); `resolveProfile` coerces null→qa as the single chokepoint.
- **Phases** (`lib/recordings/phases.ts`): Sonnet detection seeded by profile + slide titles; `clampPhases`/`slicePhaseSegments` pure helpers; never throws, whole-transcript fallback.
- **Vision** (`lib/vision/renderDoc.ts` + `readDocument.ts`): shared Sandbox PDF→PNG render + generic vision page reader (reusable by bot-KB later). Slides→`presentation_outline` (`lib/recordings/slides.ts`), neutral presentation summary→`proceedings_summary` (`lib/recordings/presentation.ts`, reuses the exact no-opining directive).
- **Pipeline** (`workflows/recordings.ts`): `runSlidesAndPhases` after transcription (before the gate); `runAnalyze` scopes Q&A to the qa phase + runs the presentation summary; persists the new columns. `extract.ts` skips `file_role='slides'`. Routes: create accepts file_role + meeting_profile (≤1 PDF slide, ≥1 media); analyze persists the user-edited phase_map; GET + export return the new fields.
- **Deck** (`lib/pptx/recordingDeck.ts`): new Meeting Overview (overview + agenda list) + per-item "What Was Presented" cards (presenter + neutral summary + key-figures strip) ahead of the Q&A sections; title adapts to "Meeting Report"; all sections null-guarded so a pure Q&A recording is unchanged. QC'd via render harness.

Tests: meetingTool unit (13) + recordings-route file_role validation. tsc clean. NOTE: a parallel session is building conversation-reviews/project-insight-deck in the same tree — migration collided at 096, so this one is **097**; only recordings-tool files staged here. Commit-only, not pushed.

## 2026-06-03 — Mason: guardrail hardening + adversarial test

**Why**: Pre-deployment safety review for the donor-facing Foundations Project agent on a homelessness-charity site (trolls, foul language, off-topic, jailbreaks, and — critically — real people in crisis).

**What changed** (`scripts/_mason_create_agent.ts`, config-only → live on prod immediately via the DB upsert, no deploy):
- **Crisis/vulnerable-user block** added to the system prompt (highest priority): detect distress/eviction/self-harm → respond with care, route to 911 / 988 (Suicide & Crisis Lifeline) / Coalition intake at 18 N. Terry Ave; never act as counselor, never promise a bed, never bury under campaign details.
- **9 structured `guardrails`** (chatCore injects as numbered must-follow rules every turn): scope-only; no medical/legal/financial/mental-health advice; no invented facts/figures/partners; no PII solicitation beyond opt-in contact capture; never reveal resident/staff info; nonpartisan + no disparaging other orgs; never claim a completed action; ignore role-change/prompt-leak attempts; dignified language.
- **8 `sensitive_topics`** (coarse word-boundary deflection backstop) + `negative_content_mode: deflect`, `deflection_enabled: true` set explicitly.

**Adversarial test (live, vs linked DB)** — 11 probes:
- ✅ Off-topic/troll, jailbreak/prompt-leak → polite refusal, stayed in scope.
- ✅ Medical & legal advice → declined + routed to professional/legal aid (+ 988 where apt).
- ✅ Politics → neutral decline. PII request → refused on resident dignity.
- ✅ Crisis (shelter + self-harm) → warm, correct 911/988/Coalition routing, no campaign burial.
- ✅ Explicit profanity → deterministic `checkMessage` block (strike path).
- ⚠️ **Finding**: threats with indirect phrasing ("kill all of you", "hurt the staff") slip the deterministic threat regex in `lib/contentGuard.ts` (it matches `kill (you|them|...)`, not `kill all of you`). The **model's guardrails caught them** with safe crisis responses, so behavior was correct — but the deterministic layer is phrasing-narrow. Optional follow-up: broaden the `threat` patterns (platform code, needs deploy).

**Residual (not blocking, would need code+deploy)**: bot/automation defense is still per-IP rate limit (30/min) + in-memory strike map (resets across Fluid-Compute instances); origin allowlist / Vercel BotID would harden further.

Commit-only, not pushed.

## 2026-06-03 — Meeting tool D5: wizard preset + slide upload + gate phase-split (UI)

**Why**: Make the meeting tool user-reachable — the backend + deck landed (commit 2a1a3000) but there was no way to create a community-meeting recording or confirm the presentation→Q&A split from the UI.

**What changed**:
- `app/analyze/new/recording/RecordingWizardClient.tsx`: Setup pane gains a **Meeting type** selector (Town hall Q&A | Community meeting). Community meeting reveals a **Presentation slides (PDF)** uploader — rides the existing TUS flow tagged `file_role='slides'`, rendered separately from the audio/video list. POST sends `meeting_profile` (has_slides = deck attached); town_hall_qa sends null = legacy. Slides optional.
- `app/analyze/new/recording/[id]/status/StatusClient.tsx`: the transcribed review gate shows a **"Presentation ends at [mm:ss]"** control (seeded by the detected `phase_map` boundary) when the profile has a presentation phase. Generate sends an edited two-phase `phase_map` (presentation 0→split, Q&A split→end) so analysis scopes correctly.

tsc clean; recordings unit+route tests green (64). UI is forms-only (no automated render test) — eyeball via `npm run dev`. Commit-only, not pushed; staged my files only (parallel session still active in-tree).

## 2026-06-03 — Agent Study: shareable read-only report link

**Why**: The Agent Study report (`/bots/[id]/report`) had Export PPTX and Transcripts, but no way to hand a stakeholder the *rich* HTML report (with its drill-downs) without giving them a login. Decision: keep the rich HTML and share it as a **point-in-time bake** through the existing `/api/share` mechanism — same pattern as the conversation share — rather than building a live public report endpoint.

**What changed**:
- `lib/agentStudyHtml.ts` (new): pure `renderAgentStudyHtml(study: AgentStudy): string`. Self-contained, inline-styled static mirror of `ReportClient.tsx`, section for section. Every user/agent-derived string is escaped; drill-downs use native `<details>`/`<summary>` so they work with JS disabled (the shared viewer's iframe is script-sandboxed). No server deps — type-only import of `AgentStudy`.
- `app/api/share/route.ts`: added `agent_study` to `ShareType` + both allowlists, resolved its target org via `agents.org_id`, and a POST branch that stores the baked HTML in `shared_links.metadata.html` and returns `/shared/agent-study/{token}` (30-day default expiry). Mirrors the `conversation` branch, no labeled variant.
- `app/bots/[id]/report/ReportClient.tsx`: **Share** button next to Export PPTX — bakes the current study, POSTs it, copies the returned URL, shows a "✓ Link copied" state (mirrors the conversations-page share UX).
- `app/shared/agent-study/[token]/{page.tsx,SharedReportView.tsx}` (new): public viewer mirroring `/shared/conversation/[token]` — service-role token lookup, type + expiry guards, fire-and-forget access stamp, HTML rendered in a sandboxed iframe (`allow-popups allow-popups-to-escape-sandbox`).
- `sql/098_shared_links_agent_study.sql` (new): widens the `shared_links_type_check` CHECK to include `agent_study` (additive; no rows affected). **Not yet applied to prod** — the share insert will be rejected by the live constraint until it (and the still-pending sql/095, sql/096) are applied.

**Verification**: `rm tsconfig.tsbuildinfo && npx tsc --noEmit` clean. Rendered a full-coverage `AgentStudy` fixture (all sections + non-English samples + `<`/`&`/`"` in entity names) through `renderAgentStudyHtml` and screenshotted via Playwright/chromium at desktop (collapsed + all-`<details>`-expanded) and mobile (390px) — faithful to the live report, responsive, no overflow, escaping confirmed (raw `<bus>` does not leak; `&lt;bus&gt;` present). Commit-only, not pushed; staged my files only by explicit path (parallel recordings session active in-tree).

## 2026-06-03 — Mason agent: corrected brand navy to the real FP theme color

**Why**: Owner asked to match Mason's widget chrome to foundationsproject.org. The config navy `#1b3a5e` turned out to be a Gutenberg hero-block color from the homepage, not the brand navy. Verified the real palette against the live theme stylesheet (`themes/foundations/assets/css/style.css`): primary navy **`#103c5d`** (37× — the dominant brand color), darker `#0a3557`, gold `#f7b200` (2×), brick-red `#9e2a2f` (3×). Gold + red in the config were already correct; only the navy was off.

**What changed** (`scripts/_mason_create_agent.ts` CONFIG): `headerGradient` → `#103c5d→#0a3557`, `avatarTextColor`/`userBubbleBg` → `#103c5d`. Re-seeded the live `mason` agent (idempotent upsert, 14 chunks re-embedded). Verified the stored config via read-only query. Live at `/b/mason` (DB-driven, no deploy). Commit-only, not pushed.

## 2026-06-03 — Meeting tool: live e2e verification + bucket image/png fix

**Why**: Verified the new meeting-tool path end-to-end on real infra (read-only, no DB writes): generated a test presentation PDF → Vercel Sandbox poppler render → Claude vision slide read → phase detection over the real NOWOCATS transcript → slide-grounded presentation summary → deck. All stages produced valid output; the deck's "What Was Presented" carried vision-read figures (~90% design, within 2 years) through to the slide.

**What changed** (`sql/099`): the e2e surfaced a real bug — the `recordings` bucket MIME allowlist (sql/091) didn't include `image/png`, so the rendered slide pages 415'd on upload. Added `image/png` + `image/jpeg`. Applied to prod. Without this, slide ingestion would have failed silently in production (graceful-degrade → null outline). Commit-only, not pushed.

## 2026-06-03 — Agent platform hardening + dynamicChips productization

Four items off the post-Mason to-do, all verified locally (`npm run dev` vs linked DB):

1. **Self-harm crisis routing + broadened threat detection** (`lib/contentGuard.ts`): new `self_harm` category, detected before threats, returns a compassionate 988/911 crisis message (no hostile "be respectful" block, no strike) — fixes a latent bug where "I want to kill myself" got the rephrase warning. Threat regex broadened to catch indirect phrasings ("kill all of you," "hurt the staff," "going to shoot everyone") while idioms ("kill time," "I'd kill for a coffee," "this wait is killing me") still pass. Verified: 3 self-harm phrasings → crisis msg; 3 indirect threats → strike→final-warning→shutdown; 2 idioms → pass.
2. **Per-agent embed allowlist** (`app/api/bots/[id]/chat/route.ts` + Mason `config.allowedOrigins`): opt-in; when set, browser requests with a non-allowed `Origin` get 403 (self + listed domains + subdomains allowed; no-Origin passes to the rate limiter). Empty = wildcard (every other agent unchanged). Verified: foundationsproject.org + subdomain + sentimetrx self → 200; evil-clone.com → 403; no-Origin → 200. NB: enforcement code needs deploy; Mason's allowlist data is already live but inert until then.
3. **dynamicChips is now a real setup toggle**: "Show follow-up pills" checkbox in the agent editor (`EditAgentClient.tsx` → `config.dynamicChips`), and the `[[chips:…]]` trailer instruction moved from Mason's hand-written prompt into `lib/chatCore.ts` (injected only when the flag is on). Now flipping the toggle works for ANY agent with no prompt editing. Side benefit: removing the instruction from Mason's live prompt **stops the raw `[[chips:]]` leak on prod immediately** (prod chatCore doesn't inject yet → clean text now → pills resume after deploy).
4. **Mason KB naming-menu URL**: already on the June-1 `260601-…` file (was fixed when Mason was built from the fresh crawl); no change needed.

Docs: BOTS.md (dynamicChips section rewritten for the toggle/injection model, new embed-allowlist section, self-harm/threat note in the safety-filter step). tsc clean. Commit-only, not pushed.

## 2026-06-03 — Google review download: dedupe locations by place_id before insert

**Why**: A Cheddar's Scratch Kitchen download (176/180 locations) failed with `duplicate key value violates unique constraint "idx_rsl_source_place"`. Root cause: location discovery can return the same physical place twice (legacy + current Google listing sharing a `place_id`); the create route inserts all selected locations into a freshly-created `review_source` in one batch, and the `UNIQUE(review_source_id, place_id)` index (sql/phase7) rejects the whole batch on the first collision — so nothing downloads.

**What changed** (`app/api/review-sources/route.ts`, step 4): replaced the `locations.map(...)` with a `reduce` that keeps the first occurrence of each `place_id` and drops rows with empty/duplicate `place_id`. Behavior otherwise unchanged. Verified the dedupe logic in isolation against a Cheddar's-style sample (two listings sharing one place_id + a missing-place_id row → collapses to distinct rows, no dupes/empties). tsc clean. Note: upstream discovery still surfaces the dupes in the picker count; deduping there is a follow-up. Commit-only, not pushed.

## 2026-06-03 — Taxonomy: self-serve "Classify this dataset" button (was script-only)

**Why**: Applying the 7-axis taxonomy to a Google-review dataset was a developer-only command-line step (`scripts/taxonomy-classify.ts`); the in-app **Taxonomy** tab only *displayed* results and showed a raw shell command in its empty state. Owner (non-technical) asked to self-serve it — "seems silly not to allow that for users." DATA_SOURCES §14 already listed a "per-dataset classify button" as the productionization step.

**What changed**:
- `lib/taxonomyClassify.ts`: `classifyDatasetKeyword` now takes an `offset` and returns `{ nextOffset, reachedEnd }` so classification runs in resumable chunks (script behavior unchanged — offset defaults to 0; existing return fields intact). A Cheddar's-scale ~640K-review dataset would otherwise blow the function timeout in one pass.
- `app/api/datasets/[datasetId]/taxonomy/route.ts`: new `POST` — org-gated identically to `GET` (refactored the shared gate into `gateDataset`), classifies one 10K-row chunk from a `{ cursor }` body, returns `{ classifiedThisCall, scanned, nextCursor, done, totalRows }`. `maxDuration` 60→120. Keyword-tier, no AI cost. Always uses the `core` overlay (brand-tuned rc/chuys stay script-only).
- `components/analyze/TaxonomyModule.tsx`: empty state now has a **"Classify this dataset"** button (loops POST chunks with a live progress bar, then refreshes the roll-up); populated view gets a **"Re-classify"** control for picking up daily-synced reviews. Writes are idempotent on `(dataset_id, row_id)` so an interrupted run resumes.

**Verification**: `rm tsconfig.tsbuildinfo && npx tsc --noEmit` clean. Confirmed against `lib/reviewSync.ts::reviewToRow` that Google review rows store text in `review_text` (the classifier's default `textField`) — the key silent-failure mode (wrong field → all rows skipped) is ruled out. NOT yet click-tested end-to-end (the tab is auth-gated on prod data; the button is only usable by the owner after deploy). Commit-only, not pushed.

## 2026-06-03 — Taxonomy: user-selectable text field (not hardcoded review_text)

**Why**: The self-serve classifier (shipped earlier today) hardcoded `textField: 'review_text'`. Owner flagged that's review-only — a guest-satisfaction survey stores the written feedback under a different column (`comment`, `feedback`, etc.), so the user should pick which field to classify.

**What changed**:
- `app/api/datasets/[datasetId]/taxonomy/route.ts`: `GET` now also returns `{ textFields, defaultField }` via a new `detectTextFields` helper — samples ~25 rows of `dataset_rows_flat`, keeps columns whose sampled values are mostly multi-word strings ≥12 chars (so place_id / dates / ratings / ids / single-word fields drop out), labels them from `dataset_state.schema_config` when present, and recommends `review_text` as default. `POST` accepts `textField` from the body and threads it to `classifyDatasetKeyword` (it's a JSONB key lookup — an unknown field yields no matches, never an error, so no injection surface).
- `components/analyze/TaxonomyModule.tsx`: a **"Field to classify"** dropdown (empty state + a compact one beside Re-classify); selection rides each POST as `textField`. Progress copy de-review-ified ("rows", not "reviews").

**Scope note**: the Taxonomy tab is still gated to `source==='google_reviews'` datasets, and the keyword dictionary is restaurant-vertical — so this field picker generalizes *within* that gate today and unblocks survey data once the tab is opened to more dataset types (a separate, flagged decision). Did **not** silently ungate.

**Verification**: `rm tsconfig.tsbuildinfo && npx tsc --noEmit` clean. Ran `detectTextFields` logic in isolation against the real `reviewToRow` shape → default `review_text`, junk fields (place_id, review_date, rating, ids) correctly excluded (a few multi-word location columns remain as harmless extra options). Commit-only, not pushed.

## 2026-06-03 — Taxonomy: comment drill-down on the tab (demo-minimal)

**Why**: Owner has a demo in ~8h and needs to click into the taxonomy and retrieve the comments behind a tag (like the Themes/Entities drill-down). The Taxonomy tab was aggregate-only. Built a deliberately-minimal, throwaway-acceptable first cut on the existing standalone tab (the agreed longer-term home is a TextMine lens reusing `CommentsPanel` — not done under demo time pressure).

**What changed**:
- New `GET /api/datasets/[datasetId]/taxonomy/rows` — `?axis=&sub=` or `?alert=`, org-gated (pairs the dataset's org_id). `.contains()` on the GIN-indexed `axis_*` array (axis name → column via a fixed allowlist, so the param can't name an arbitrary column) → joins `dataset_rows_flat` for the row text → returns `{ label, count, comments[] }` with each comment's matched-evidence quotes. `pickText` prefers review_text/comment/feedback/response/text then longest string.
- `components/analyze/TaxonomyModule.tsx`: sub-topic rows + alert chips are now clickable (hover + `›` affordance) → open a right-side drawer listing the comments, rating ★ + date, with the matched evidence phrases highlighted (`<mark>`).

**Verification**: tsc clean (React 19: used `ReactElement`, not the removed global `JSX` namespace). Data path verified against real Cheddar's data — see session notes. Commit-only, not pushed.

## 2026-06-03 — PulseIQ public link /th → /pi (reserve /th for Town Hall)

**Why**: The short `/th` ("town hall") public prefix should belong to the new recordings-based **Town Hall** product, not PulseIQ. Moved PulseIQ's participant + live screen from `/th/[sessionId]` to `/pi/[sessionId]` (route dir `app/th/` → `app/pi/`). Public URL only — internal `townhall_*` tables, the `/townhall` facilitator console, `/api/townhall/*`, and `features.townhall` are all unchanged (project convention: internal name ≠ UI label). Safe with no back-compat redirect since there are no live PulseIQ sessions; `/th` is left free (no route) for Town Hall to claim when it ships a public surface.

**What changed**: renamed `app/th/[sessionId]/{page,TownHallChat,live/page}` → `app/pi/...`; swapped `/th/` → `/pi/` in the 6 participant-link generation/display sites (`TownHallListClient`, `SessionDetailClient` incl. the live link, `NewSessionClient`, the moved `live/page`) + incidental refs (architecture-deck label, chatCore/townhall-live comments, loadtest). Specs (TOWNHALL.md, SECURITY.md, DATA_FLOW.md) updated. tsc clean. Commit-only, not pushed.

## 2026-06-04 — Recordings promoted to top-level "Town Hall" product

**Why**: Recordings isn't a passive data source like Google Reviews/Reddit — it's a workspace (audio + slides + agenda + roster) with a workflow and deliverables. Burying it under Analyze ("New dataset → Recordings tile") framed it wrong. Promoted to a first-class product, user-facing label **Town Hall** (internal slug/tables/feature-key stay `recordings`, per bots=Agents). Distinct from PulseIQ (the live/digital product) — the `/th` swap earlier reserved that prefix.

**What changed**:
- **Feature decouple**: removed `recordings` from `ANALYZE_CHILDREN` (`lib/resolveOrg.ts` + `OrgFeatureToggles`); it's a standalone top-level feature gating on `features.recordings` alone. `MODULE_LABELS.recordings = 'Town Hall'`.
- **Nav**: added a top-level Town Hall item (🏛️) in `TopNav` (peer of PulseIQ); `currentPage`/features plumbed.
- **Routes consolidated under `/recordings/*`** (git-tracked renames): landing `/recordings`, wizard `/recordings/new` (was `/analyze/new/recording`), status `/recordings/[id]/status`, **report `/recordings/[id]/report` re-keyed datasetId→recording_id** (resolves the recording directly, org-paired 404). Thin back-compat redirect left at `/analyze/[datasetId]/report`. Status/wizard/list links + DownloadMonitor updated.
- **Landing**: `/recordings` rewritten as the Town Hall home — list + "New Town Hall" CTA + a materials-guidance panel (recording / slides PDF / agenda / roster).
- **Removed Analyze entry points**: the `/analyze` header Recordings button + the `/analyze/new` source tile (+ cleaned the dead `recordingsEnabled` prop). The dataset mirror stays as the analytics view, reachable via an "Open in Analytics" cross-link on the report (shown only when analyze is on + a dataset exists).
- **Labels**: ~10 user-facing "Recording(s)" → "Town Hall" (list, wizard, breadcrumbs, admin usage + download monitor).
- **Specs**: RECORDINGS.md, ANALYTICS.md, FEATURES.md, SPEC.md, CLAUDE.md updated (PulseIQ vs Town Hall disambiguated; PulseIQ public link corrected to /pi).

tsc clean; full suite green; verified routes on the dev server. No SQL/data changes. Commit-only, not pushed.

## 2026-06-04 — Nav icons: distinct icons for PulseIQ vs Town Hall + fix small Campaigns envelope

**Why**: Owner feedback. Campaigns used a plain `✉` text dingbat that renders thin/small next to the full-color emoji. And now that PulseIQ + Town Hall are distinct products they need distinct icons — the people-gathering icon fits the in-person Town Hall better.

**What changed** (`components/nav/TopNav.tsx`): Campaigns `✉`→`📨` (full-size envelope); Town Hall `🏛️`→`👥` (gathering of people); PulseIQ `👥`→ an inline **EKG/pulse-line SVG** (`EkgIcon`, `currentColor` so it matches the nav text color — there's no heartbeat-waveform emoji). `navItems.icon` widened to `React.ReactNode` to allow the SVG. Drives both the desktop bar + mobile drawer. Commit-only, not pushed.

## 2026-06-04 — Town Hall list cards match the Analyze/Surveys card family

**Why**: Owner — the Town Hall (recordings) cards didn't follow the visual conventions of the Analyze/Surveys lists. Restyled to the shared family idiom.

**What changed** (`app/recordings/RecordingsListClient.tsx`): card shell now mirrors the Dashboard StudyCard — `flex flex-col overflow-hidden` with a **colored top accent strip** (status color, like the family's card header), emoji + bold `text-sm` title, a pill status badge + date row, and a divided footer (`mt-auto pt-3 border-t`) showing owner/org + cost. Uniform `min-h`. Replaces the old flat `p-5` card with a definition-list meta block. QC'd via a side-by-side render vs a Dashboard card — consistent family.

## 2026-06-04 — Town Hall deck reconciles to the report page (18→19 Q&A mismatch fix)

**Why**: Owner exported a recording PPTX that showed 18 Q&A pairs while the report page showed 19 — "this type of mismatch makes me look foolish." Root cause: the report page shows + counts `flagged_for_review` pairs (just marks them ⚠), but the synthesis pass *and* the deck appendix silently dropped flagged pairs → two denominators (18 vs 19).

**What changed**:
- `lib/recordings/analyze.ts` — synthesis now runs over **all** `qa_pair` rows (was non-flagged only), so `sentiment_breakdown` + per-topic `qa_count` reconcile to the same set the page shows. Skips synthesis only when there are zero pairs.
- `lib/pptx/recordingDeck.ts` — appendix renders all pairs; and every printed count (KPI Questions, sentiment breakdown, per-topic question badges) is now re-derived from the pairs the deck actually renders, never trusted from a possibly-stale stored `analysis_summary`. One denominator across the whole deck (deck-credibility rule).
- Tests updated: flagged-pair recordings now DO run synthesis; synthesis skips only on zero pairs.

## 2026-06-04 — Town Hall landing/card polish

**Why**: Owner — the top materials panel on /recordings was "oddly placed and ugly"; the card showed an internal $$ AI-processing cost that doesn't belong on a user-facing card.

**What changed**: removed the orange materials-guidance panel from the `/recordings` landing (`app/recordings/page.tsx`); removed the per-card cost (`fmtCost`) from `RecordingsListClient.tsx` — cost is an accounting metric that lives in /admin/usage. Footer now shows owner (+ org name for the admin org), matching the Analyze/Surveys card family.

## 2026-06-04 — Town Hall deck: Appendix section divider

**Why**: Owner — the deck jumped straight from the analysis slides into the per-question appendix; wanted a clear page separator between the two sections.

**What changed** (`lib/pptx/recordingDeck.ts`): inserted a navy section-divider slide (matching the title slide — gold top strip, "APPENDIX" eyebrow, "Question & Answer Detail", "N questions" subtitle, datanautix wordmark) before the appendix loop. Renders only when ≥1 Q&A pair exists. QC'd via a render of all 11 slides — divider sits correctly between Action Items and Q&A 1.

## 2026-06-04 — Town Hall: public-shareable Q&A polish pass (Phase 1 + deck/page surfaces)

**Why**: Owner — the original vendor sample and our earlier sample out-file summarized/polished the Q&A for public sharing; the new pipeline only had verbatim quotes + topic-level summaries, missing the per-question "Question → cleaned Response" public document. Build it, save it, make it available across export formats.

**What changed**:
- **Polish pass (pass 4)** — `polishQaPairs` in `lib/recordings/analyze.ts` + `buildQaPolishPrompt` in `prompts/qa.ts`. One Sonnet call over all pairs; faithful cleanup (remove filler/false-starts, fix grammar, keep every figure/name/date/commitment, strictly neutral, no added facts). Writes `polished_question`/`polished_answer` ADDITIVELY onto the payload (jsonb — no migration); verbatim stays the record of truth. Non-fatal → verbatim fallback. Optional `glossary` param = hook for future entity-spelling normalization (LLM phonetic match > edit-distance).
- **Saved automatically** — persists via `mirror.ts` (full payload insert). Swept the single-pair `regenerate.ts` path so a regenerated pair also gets re-polished (else it'd lose polish).
- **Deck surface** — `recordingDeck.ts` appendix renders polished when present (fallback verbatim); `input.polished` (default true) can force verbatim.
- **Report page surface** — Q&A cards show polished by default with a "Polished for sharing" badge + per-card "Show verbatim" toggle, so the page matches what the deck exports (avoids a new page-vs-deck mismatch).
- Cost +$0.25/meeting (~$1.45 total). Tests: polish populate + verbatim fallback; updated pass-count/cost assertions (now 4 passes). QC'd deck render (polished pair clean, no-polish pair falls back).

**Deferred (queued)**: PDF report + public share link `/r/[token]` reading the same saved polished field; entity-spelling-normalization glossary sources.

## 2026-06-03 — Taxonomy dict v2: hair + foreign-object cadre in food-safety

**Why**: Demo prep. Owner tested "I proceed to pull a VERY LONG piece of hair from the bread!" — the keyword classifier produced NO tags (the `food safety` bucket only had `foreign object`, not `hair`). Checked the competitor's rules engine in the RC vendor CSV: it flags **72 of 234** hair-mentioning reviews as `Alert - Food Safety` but ≥16 are clear FPs on a *person's* hair ("blonde hair" ×6, "dark hair" ×3, "no hair"/bald, "golden hair"). So the vendor over-flags (noise), we under-flagged (miss) — the fix is the precise middle.

**What changed** (`lib/taxonomyKeywords.ts`, `food safety` sub): added hair phrases (`piece of hair`, `strand of hair`, `found a hair`, `a hair in`, `hair in my/our/it`, `hair in the food`, `hair baked`) + a foreign-object cadre (glass/shard/broken glass → crisis; metal/shaving/staple/nail/band-aid → crisis; plastic/rubber band/twist tie/fingernail/rock/pebble/wood chip/splinter/paper/wrapper → alert). **Multi-word in-food phrasings only** so bare "hair"/"blonde hair"/"hairnet" don't false-fire. Bumped `TAXONOMY_VERSION` v1→v2 (`lib/taxonomyClassify.ts`; stored-only provenance, no filtering side-effects).

**Verification**: tsc clean. Probe: 7/7 real complaints flag (hair=alert; glass/staple/band-aid=crisis), 5/5 competitor FPs ("no hair","dark hair","golden hair","blonde hair","hairnet") stay clean. Re-classified Cheddar's (`86737f9b…`, 19,708 rows) on prod → food-safety alerts 45 → 79, real hair-in-food complaints now surface in the drill-down with evidence. Commit-only, not pushed.

## 2026-06-04 — Town Hall: entity glossary field in setup → polish pass

**Why**: Owner wants to drop in a list of correct entity spellings when setting up a meeting, so the report normalizes ASR mis-hearings of proper names. First concrete piece of the entity-spelling-normalization feature.

**What changed** (end-to-end manual entry):
- New Town Hall wizard (`RecordingWizardClient.tsx`): "Names & terms (optional)" textarea (one per line) after Agenda topics → `setup_inputs.glossary: string[]`.
- `QaSetupInputs.glossary?: string[]` (jsonb, persists as-is via the create route, no migration).
- `cleanGlossary` helper (trim/dedupe-ci/empty→undefined) in `analyze.ts`; threaded into the polish pass (`polishQaPairs`) from both `analyzeRecording` and the single-pair `regenerate`.
- The polish prompt already injects the glossary block (canonical spellings, phonetic-aware). Tests for `cleanGlossary`.

**Deferred**: auto-fill the glossary from uploaded slides/agenda (vision) or the dataset entity catalog; make it editable at the "Review & generate" gate.

## 2026-06-03 — Taxonomy drill-down: drawer → modal + Export CSV + per-comment Copy

**Why**: Demo polish. Owner wanted the comment drill-down as a centered modal (not a side drawer) with breadcrumb context, a scrollable list, a whole-modal export, and a copy button per comment.

**What changed** (`components/analyze/TaxonomyModule.tsx`, UI-only): replaced the right-side drawer with a centered modal — breadcrumb header (`Taxonomy › axis › sub` or `Taxonomy › Severity alert › tag`) + count + scrollable comment body. Added **Export CSV** (client-side Blob download: rating/date/comment/matched_evidence of the shown comments) and a per-comment **Copy** button (clipboard + ✓ feedback). `drill` state now carries `crumbs[]` instead of a flat label. tsc clean; page compiles (dev 307). Commit-only, not pushed.

## 2026-06-04 — Town Hall: auto entity-spelling extraction (Phase 1 backend)

**Why**: Owner — better than manual glossary entry: auto-extract the proper nouns the meeting mentioned, cluster the ASR's phonetic mis-hearings, let the user correct, then use the correct spellings. ASR errors are phonetic, so an LLM clusters variants where edit-distance fuzzy matching can't.

**What changed (backend foundation)**:
- `sql/100_recordings_entity_map.sql` — additive nullable `recordings.entity_map` jsonb (RLS already covers the table). **NOT YET APPLIED to prod** (needs owner authorization).
- `lib/recordings/entities.ts` — `extractEntities` (Sonnet ≈ $0.10) clusters variants→canonical; `glossaryFromEntities` (canonicals ∪ manual); `normalizeSegments`/`normalizeText`/`buildReplacements` = deterministic variant→canonical for the "Corrected" transcript view (raw ASR never mutated — the two-transcripts model). `buildEntityExtractionPrompt` in `prompts/qa.ts`.
- Workflow: `runEntityExtraction` step runs after transcription, before the gate (best-effort), stores `entity_map`.
- Polish glossary now derives from `entity_map` ∪ manual `setup_inputs.glossary` (replaced the standalone `cleanGlossary` with `glossaryFromEntities`); threaded through analyze/reanalyze/regenerate.
- Types (`EntityMap`/`EntityMapEntry`/`EntityType`), tests (`entities.test.ts`: parse/glossary/normalize; 52 recordings tests pass).

**Next**: Phase 2 review/correct UI at the gate (`StatusClient` + a PATCH route); Phase 3 Raw/Corrected transcript toggle (`ReportClient`).

## 2026-06-04 — Town Hall: entity-spelling review UI + Corrected transcript (Phases 2–3)

**Why**: complete the auto-extract → user-correct → apply loop from the Phase-1 backend.

**Phase 2 — review at the gate**: the "Review & generate" panel (`StatusClient` `GeneratePanel`) gained a "Names & spellings" block — lists the auto-extracted entities with the canonical spelling editable, the ASR variants shown as "heard as: …", drop/add controls. On Generate the reviewed map POSTs to `/api/recordings/[id]/analyze`, which sanitizes (`sanitizeEntityMap`) + persists it (stamped `reviewed_at`) before analysis, so the polish glossary uses the confirmed spellings. GET `/api/recordings/[id]` now returns `entity_map`.

**Phase 3 — Corrected transcript view**: extracted the pure normalize helpers into client-safe `lib/recordings/normalize.ts` (entities.ts re-exports them). The report Transcript tab gained a **Corrected / Raw toggle** (defaults to Corrected when a reviewed map exists): Corrected applies the deterministic variant→canonical fix client-side; Raw is the untouched record of truth. The raw transcript is never mutated — two transcripts, one record.

430 tests pass, tsc clean. Migration `sql/100` still NOT applied to prod (needed before the column-selecting paths work).

## 2026-06-03 — TextMine Comments: inline search (reuses SearchPanel)

**Why**: Owner expected search in the Comments view. Search already existed but was relocated to the dataset-header modal (commit 4076d646), leaving a dead `SearchPanel` import + unused `showSearch` in `TextMineModule.tsx`. Owner asked to add comment-level search reusing the exact same search code.

**What changed** (`components/analyze/TextMineModule.tsx`, UI-only): rendered the already-imported `<SearchPanel datasetId openEndedField>` at the top of the Comments sub-tab (the import was previously dead). Same component + same `GET /api/datasets/[datasetId]/search` endpoint (FTS + optional AI synonym/re-rank) the header modal uses — zero new search logic. `openEndedField` = the active open-ended field so results display the right text.

**Verification**: tsc clean; TextMine page compiles (dev 307). NB: the header's separate `showSearch`/SearchPanel modal is unaffected; this is an additional inline surface. Commit-only, not pushed.

## 2026-06-03 — TextMine Comments search: make it collapsible

**Why**: Owner asked for the inline Comments-tab search to be closeable/collapsible (don't permanently occupy the top of the comments view).

**What changed** (`components/analyze/TextMineModule.tsx`, UI-only): new `showCommentSearch` state (default collapsed). Collapsed → a compact "🔍 Search comments" toggle; expanded → the `SearchPanel` with a "Close search ✕" control. No change to search behavior/endpoint. tsc clean; page compiles.

## 2026-06-03 — Taxonomy: topic/sub-topic filter + inline comments (modal → inline)

**Why**: Owner wanted (1) filtering the taxonomy view by topic + sub-topic, and (2) comments shown inline like TextMine's Comments tab. Asked whether TextMine's `CommentsPanel` could be reused — it can't cleanly (944 lines, coupled to the theme model + in-memory `parsedData` + `commentMatchesTheme`/`highlightKeywords`; taxonomy filters server-side by tag, a different model).

**What changed** (`components/analyze/TaxonomyModule.tsx`, UI-only): added **Topic** (axis) + **Sub-topic** (sub) filter dropdowns (sub options derive from `data.subs` for the chosen axis). Converted the drill-down **modal into an inline panel** (same breadcrumb header + scrollable list + Export CSV + per-comment Copy), driven by the filter or by clicking a sub-topic/alert (clicks now sync the dropdowns). Reuses the existing `/taxonomy/rows` endpoint + comment-card rendering — no new search/fetch logic, and explicitly NOT the theme-coupled `CommentsPanel`.

**Verification**: tsc clean; taxonomy page compiles (dev 307). Data path unchanged (already verified vs Cheddar's: axis_attribute·speed→388, pests alert→40). Commit-only, not pushed.

## 2026-06-03 — Taxonomy filter: dropdowns → pills (progressive topic→sub-topic)

**Why**: Owner asked for pill-based topic/sub-topic filtering — show topic pills first; once a topic is picked, reveal that topic's sub-topic pills.

**What changed** (`components/analyze/TaxonomyModule.tsx`, UI-only): replaced the two `<select>` dropdowns with pill rows. Topic pills (axes, with %) always show; selecting one reveals its sub-topic pills (with counts); selecting a sub-topic loads the inline comments (same drill mechanism). Toggling a pill off / "Clear ✕" resets. Rollup sub-topic & alert clicks still sync the active pills. New module-level `pillStyle()` helper. tsc clean; page compiles.

## 2026-06-04 — Town Hall: public share link (open-items #1)

**Why**: deliver the polished Q&A report as a shareable web page ("send link to principals") — reusing the polished data already built. The DB foundation (share_token/share_enabled/share_expires_at) shipped back in sql/090; this wires the surface.

**What changed**:
- `app/th/[token]/page.tsx` — public, no-auth, token-gated read-only report (server component). Fails closed: 404 unless share_enabled + status=complete + not expired. Renders only shareable fields (meeting meta + exec summary + polished Q&A by topic, polished→verbatim fallback); never raw transcript/flags/confidence/cost/org. Datanautix footer. `/th` is the reserved Town Hall public prefix (PulseIQ is /pi).
- `app/api/recordings/[id]/share/route.ts` — owner-gated enable/disable (403 for non-owner org members, 404 cross-org, 409 until complete). 24-char URL-safe token minted once + reused. Returns `{ enabled, token, path }`.
- Report Export & Share tab — owner-only "Enable public link" toggle + copy-link (removed the public-link "coming soon" line).
- Security tests in `tests/integration/export-org-gate.test.ts`: cross-org 404, non-owner 403, not-complete 409, owner happy-path → token + /th path.

434 tests pass, tsc clean. Open-items #2 (PDF, reuses this template) + #3 (card favorite/kebab/transfer) next.

## 2026-06-03 — Taxonomy: fold severity alerts into the filter card as pills

**Why**: The standalone "Severity alerts" section (food safety / pests chips) ate vertical space. Owner asked to move them into the top filter card as two pills.

**What changed** (`components/analyze/TaxonomyModule.tsx`, UI-only): removed the separate severity-alerts block; the alerts now render as red **Severity** pills at the bottom of the filter card (active state + count, clicking loads the flagged comments inline — same drill mechanism). Saves a full section of vertical real estate.

## 2026-06-04 — Town Hall session wrap (handoff marker)

Nine Town Hall commits this session (interleaved on `main` with a parallel session's 6 Taxonomy/TextMine commits — 15 ahead of origin total, NOT pushed; owner pushes, one push ships both sets). Arc: list cards → 18→19 deck reconciliation → landing/card polish → Appendix divider → public-shareable **polish pass** (deck + report, polished/verbatim) → manual entity glossary field → **entity-spelling normalization** (auto-extract variants→canonical at the gate, sql/100 applied, polish glossary + Corrected/Raw transcript toggle) → **public share link** `/th/[token]` (owner-gated, fails-closed, security-tested). Suite 434 pass, tsc clean. `sql/100` applied to prod. Next: PDF report (reuses /th template), card overhaul (favorite/kebab/org-transfer), brand-entity convergence. Full state: memory `townhall-product`.

## 2026-06-03 — Taxonomy pills: shrink to fit on one line

Cosmetic: reduced topic/sub-topic/severity pill size (fontSize 13→11, padding 6×14→2×9, weight 700→600, nowrap) so the topic and sub-topic groups pack onto a single line on a full-width screen. No behavior change.

## 2026-06-03 — Taxonomy: center KPI numbers + align comment cards to TextMine style

Cosmetic: KPI boxes now center the number + label (`textAlign:center`). Taxonomy comment cards restyled to mirror TextMine's `CommentCard` look — comment text on top, meta as bottom rounded chips (rating colored amber, date as YYYY-MM-DD), and the evidence highlight switched to the TextMine underline-mark style (light amber bg + bottom border). Still a lightweight render, not the theme-coupled `CommentsPanel` component.

## 2026-06-03 — Taxonomy comments: show all hit tags + show-more + closer TextMine match

**Why**: Owner wanted the taxonomy comment boxes to match TextMine's as much as possible, and to show what OTHER topic/sub-topic pairs each comment hit.

**What changed**: `GET …/taxonomy/rows` now returns `tags: {axis,sub}[]` per comment (all distinct assertions on the row, via new `collectTags`). `TaxonomyModule.tsx` cards now render those as small chips (the filtered one highlighted teal, others gray) + a **Show more / Show less** toggle for comments over 300 chars (`expanded` Set, reset when the drill changes). Verified the tags populate richly (a "speed" comment also shows server/flavor/apps). tsc clean; page compiles.

## 2026-06-03 — TextMine metric strip: show the dataset date range

**Why**: Owner realized the dataset's date range wasn't surfaced anywhere. Added it to the "records · signals · theme-fit · themes" strip.

**What changed**: `signal-stats` route now returns `{ dateMin, dateMax }` from `datasets.description.start_date/end_date` — read via the RLS-enforced user client (NOT a bare service-role id lookup), instant (no row scan; a live min/max over `data->>review_date` measured ~2.4s on 19.7K rows and would balloon at full sync, so rejected). `DatasetMetricStrip.tsx` shows "📅 Jan 1, 2026 – Jun 3, 2026" when present. Shown only when the strip renders (which is theme-gated). tsc clean for my files; note: a parallel session's `scripts/_townhall_pdf_qc.ts` currently has an unrelated tsc error (their WIP).

## 2026-06-03 — Taxonomy comments: rating left-bar + grid column selector (match TextMine)

**Why**: Owner wanted a closer match to TextMine's comment cards — a column-count (grid) selector and a per-card side-bar reflecting the underlying rating.

**What changed** (`components/analyze/TaxonomyModule.tsx`): added `rampColor`/`ratingColor` (the same red→green ramp as TextMine's CommentsPanel), so each card gets a **4px left bar** coloured by its 1–5 rating + a faint rgba tint. Added a **1–4 column grid picker** in the panel header (`gridCols` state) and rendered the comments in a CSS grid (`repeat(N,1fr)`, equal-height cells via flex-column cards with meta pinned `marginTop:auto`). tsc clean; page compiles.

## 2026-06-03 — Taxonomy tab renamed "Categories" (user-facing only)

**Why**: "Taxonomy" is jargon and sits oddly next to Themes/Entities; the competitor calls it "categories", which helps in a head-to-head pitch. Owner picked "Categories" for now (personally prefers "Aspects"/"Dimensions" — parked).

**What changed** (user-facing strings only; all internal `taxonomy` code/routes/keys unchanged): `DatasetHeader` tab label `Taxonomy`→`Categories`; `TaxonomyModule` copy (loader, error, "No categories yet", empty-state, footer, filter labels Topic/Sub-topic → Category/Sub-category, breadcrumb root `Categories`, CSV filename fallback `categories.csv`). tsc clean; page compiles.

## 2026-06-03 — Renamed user-facing label "Categories" → "Dimensions"

Owner's preference. "Dimensions" reads as analytical structure you can pivot/trend on and aligns with the future chart-integration plan (the axes become the dimensions you break charts down by). Swapped all user-facing strings in `DatasetHeader` + `TaxonomyModule` (tab label, Dimension/Sub-dimension pill labels, breadcrumb root, copy, CSV filename). Internal `taxonomy` code/routes/keys unchanged. tsc clean.

## 2026-06-03 — Dimensions comments: hover a chip to highlight its span

**Why**: Owner wanted to see exactly which words of a comment tie to a given dimension. Hovering a dimension/sub-dimension chip now lights up that dimension's evidence span in the comment text.

**What changed**: `GET …/taxonomy/rows` `collectTags` now returns evidence **per** (axis,sub) tag (was tag-only). `TaxonomyModule.tsx`: new `hoverTag` state; the comment text highlight defaults to the filtered tag's evidence but switches to the hovered chip's evidence on mouse-over (the chip turns amber to match the `<mark>`). Verified per-tag evidence populates (e.g., a comment's `attribute·flavor` → "...has always been delicious...", `product·seafood` → "Salmon was not very good"). tsc clean; page compiles.

## 2026-06-03 — Dimensions: avg star rating per dimension / sub-dimension

**Why**: From the client session — they wanted avg rating shown alongside the existing sentiment, so a low-scored dimension pops. Did Dimensions first because it's collision-free (my code, not TextMine).

**What changed**: `lib/taxonomyRollup.ts` — the paged read now also pulls `data->>rating` from `dataset_rows_flat` by `row_id`; `aggregateTaxonomy` averages it into `avgRating` per axis + per sub + `overallAvgRating` (red→green ramp). `TaxonomyModule.tsx` — new `StarBadge`; shows ★ on the avg-rating KPI, each axis bar, and each sub-topic row. Verified on Cheddar's: overall ★3.9, and the spread is meaningful — `touchpoint·manager` ★2.4 (named when things go wrong) vs `attribute·flavor` ★4.1. tsc clean; 346 unit tests pass.

## 2026-06-04 — Themes + Theme Clouds: show avg rating per theme (client request 1a)

**Why**: Client wanted avg rating shown per theme so you can tell at a glance whether a theme is loved or hated — not just its sentiment. The data was already computed (`recountThemes(..., ratingField)` populates `theme.avgRating`/`ratingDelta`); the Themes card only showed it *instead of* sentiment behind the colorMode toggle, and Theme Clouds didn't show it at all.

**What changed** (UI-only): `TextMineModule.tsx` theme card now shows **both** the ★ avg-rating badge AND the sentiment badge (was either/or). `WordCloud.tsx` per-theme header gets a ★ avg-rating badge colored green/red vs the dataset overall (via `ratingDelta`). tsc clean; page compiles.

**Re: the "parallel session in TextMine" caution I'd been repeating** — verified it was wrong: nothing uncommitted in TextMine, latest commits to those files are all mine (today), the next are weeks old (05-18/05-14). The active parallel session is in Town Hall/recordings, NOT TextMine. Proceeded cleanly, staged only my files.

## 2026-06-04 — Entities: avg star rating per entity (client request 1b)

**Why**: Next item in the client's TextMine ratings sequence (1a themes ✅, 1c dimensions ✅). They wanted to see at a glance whether an entity — a dish, a competitor, a person — is loved or hated, not just how often it's mentioned. EntitiesCard showed mention counts only.

**What changed**: `TextMineModule.tsx` adds an `entityRatings` memo that derives avg rating per entity client-side (no server source exists): it matches each catalog entity's terms (`expandEntityTerms`, canonical + aliases + plurals) against the active text fields of the loaded/filtered rows and averages `row[ratingField]`, returning `{ byEntity: {slug→{avg,n}}, overall }`. Same matcher family as EntityCloud's sentiment scan but **row-level** (a star rating is a row attribute, not a clause attribute). `EntitiesCard.tsx` renders a ★ avg-rating badge on each pill (green/red vs the dataset overall, matching the WordCloud theme-badge style), gated to ≥3 rated mentions (`MIN_RATED`) so a lone 5★ row isn't a signal; tooltip surfaces `n` + delta. Mention counts stay scope-wide (SQL); ratings are filter-aware — the same honest split EntityCloud documents for sentiment. tsc clean; 446 unit tests pass.

**Next in the sequence**: (2) theme cloud → entities within a theme ("when they talk about steak, what items are they asking about?") — med-high, a new theme×entity cross-ref panel.

## 2026-06-04 — Theme Clouds: "Items mentioned" per theme (client request 2)

**Why**: The client's ops ask — "when they talk about steak, what items are they asking about?" Theme Clouds showed the *words* within a theme but not the named *entities* (specific dishes/people/brands) reviewers bring up inside that theme. This closes the TextMine ratings/cross-ref sequence (1a themes ✅, 1c dimensions ✅, 1b entities ✅, 2 theme×entity ✅).

**What changed**: `WordCloud.tsx` gains an `entities` prop and a `themeEntities` memo — a theme×entity cross-tab computed in one pass over the filtered rows: match catalog entities with a single combined `expandEntityTerms` regex, match themes against per-theme keyword regexes precompiled once via `buildKwRegex` (not `commentMatchesTheme` per row — it rebuilds regexes each call), and tally `count[themeIdx][slug]` only for themes a row actually matches. Each grouped theme cloud renders a compact **"Items"** chip row under its keywords (top 8, count ≥ 2, category-dot colored to match `EntitiesCard`), shown only when the theme has entity mentions. `TextMineModule` passes `entities={entityCatalogRows}`. Static readout for v1 (no new drill path). Mention counts are filter-aware like the rest of the cloud. tsc clean; 446 unit tests pass; cross-tab logic verified in isolation (Steak→Ribeye:2/Filet:1, Service→John:1, John correctly absent from Steak).

## 2026-06-04 — Dimensions in Charts via server aggregation (TextMine Phase B)

**Why**: Expose the taxonomy "Dimensions" (7 restaurant axes) to the Charts module so users get dimension × rating / × field crosstabs in the familiar chart UI — not just the standalone Dimensions tab. The plan was to mirror the `__themes__` synthetic-field pattern.

**Key finding that set the architecture**: `__themes__` re-derives themes from row text client-side (~15 keywords). Benchmarking the taxonomy classifier (`classifyByKeyword`, 250+ entries) showed **~615µs/row → ~12s per 20K rows, 30s+ for 50K** — far too slow for client enrichment. So dimensions use the **stored** `dataset_row_taxonomy` tags via **server aggregation** instead (the queue's "Phase C", pulled forward as the right answer; it also scales past the 50K client cap and uses exactly the classified rows).

**What changed**:
- `sql/105_taxonomy_aggregates.sql` — 3 RPCs (`taxonomy_sub_counts`, `taxonomy_group_stats`, `taxonomy_crosstab`), SECURITY DEFINER + `SET search_path`, axis whitelist-validated. They UNNEST the multi-value `axis_<a>` text[] arrays and join `dataset_rows_flat` for the value/column field. A row tagged `product=[steak,seafood]` counts in both subs — matching the Dimensions tab. **Validated read-only vs prod** before writing (Cheddar's: product steak n=1049 ★3.21 / seafood ★3.74; touchpoint manager ★2.42 — reconciles with the Dimensions tab).
- `/api/datasets/[id]/aggregate` — `tax_counts` / `tax_group_stats` / `tax_crosstab` ops returning the same `{counts}`/`{groups}`/`{grid}` shapes as their scalar counterparts, so chart components consume them unchanged.
- `lib/dimensionFields.ts` — shared helper (axis list/labels, `dimFieldName`/`axisOfDimField`/`isDimField`, `dimVirtualFields`).
- `ChartsModule.tsx` — register 7 `__dim_<axis>__` categorical fields (gated `google_reviews`); fetch per-sub counts from the taxonomy rollup → field summaries for the count/% bar + picker; route dim fields to tax specs in `BarAggInner` (avg rating per dimension), `BarStackedInner`/`CrosstabInner` (dimension × scalar field, either orientation); freq-then-alpha ordering like themes; hide dim fields from the pickers of unwired chart types (`pickerFields`).

**Coverage / deferred**: Bar + Crosstab only. Stats (Phase B.2) deferred — its panels run per-row significance tests (t-test/ANOVA/Mann-Whitney/correlation/regression) that don't map to summary aggregation, and client enrichment is off the table for perf. Other chart types (KPI/score-driver/gantt/time-series) not yet wired; dim fields are hidden from their pickers.

**Verify**: tsc clean; 446 unit tests pass; SQL bodies validated read-only vs prod. **`sql/105` must be applied to prod before the avg-rating/crosstab paths work** (dev hits the linked prod DB; the count bars work off the rollup without it). Live render-QC pending the apply.

## 2026-06-04 — Dimensions in (almost) all chart types

**Why**: Follow-up to the Phase B Bar+Crosstab work — wire the taxonomy Dimensions into the rest of the Charts module so any chart can break down by a dimension axis.

**Coverage**: 10 of 13 chart types now accept `__dim_<axis>__` fields, all server-aggregated:
- **Free** (count from the rollup-fed summary): Treemap, Bubbles, Waterfall, Funnel.
- **`tax_group_stats`**: Bullet/KPI + Gantt (avg / min-max per sub); Distribution (precomputed box plot — `sql/106` adds q1/q3 quartiles so the box renders without shipping raw values).
- **`tax_date_series`** (`sql/106`, new RPC): Time Series "break down by" → dimension × time (count or avg per sub per bucket).
- Already done: Bar (count/%/avg), Crosstab/stacked Bar.

**Excluded** (hidden from those charts' dim pickers): Scatter (colours each point — needs per-row tags), Data Table (lists rows), Score Driver (theme-keyword regression engine; the avg Bar already answers "which dimension drives rating"). Stats stays deferred (B.2).

**What changed**: `sql/106` — `taxonomy_group_stats` gains q1_val/q3_val (drop+recreate for the new OUT cols); new `taxonomy_date_series(dataset,axis,date,metric,bucket)`. `/aggregate` — `tax_date_series` op + q1/q3 passthrough. `ChartsModule` — expand `DIM_WIRED_CHARTS`; `BulletSplitInner`/`GanttInner`/`DistSplitInner` get `tax_group_stats` paths; `TimeSeriesInner` gets a `tax_date_series` path (new `catAgg` precomputed map + shared `tsBreakdownY` helper feeding both the combined and split-mode trace builders).

**Verify**: tsc clean (my files); 446 tests pass; `sql/106` applied to prod + validated in a rolled-back tx; data path confirmed live — box quartiles (steak q1=2/med=3/q3=5) and manager×time (★2.58→2.48→2.29, declining). Browser pixel-render still pending (auth-gated).

## 2026-06-04 — Dimensions in the Statistics module (Phase B.2)

**Why**: Close out the deferred Stats piece — let the Group Tests panel compare a numeric outcome across a taxonomy Dimension.

**What changed**: Group Tests is the only Stats panel that consumes categorical fields, so dims are spliced only into its list (`groupTestCatFields`), never the row-based panels (Descriptives/Correlations/Regression/Insights/Outliers stay dim-free). When a dimension is the group/variable, the panel fetches `tax_group_stats` (t-test/ANOVA) or `tax_crosstab` (chi-square) from `/aggregate` instead of computing from client rows. New `lib/statsUtils` helpers: `welchTTestFromStats`, `anovaFromStats`, `chiSquareFromTable` — return the exact same shapes as the raw-data functions (verified to match to 6–8 decimals), so the renderer is unchanged. Group box plots render from the q1/q3 quartiles. Mann-Whitney shows an "unsupported for Dimensions" note (needs raw ranks).

**Bug fix (pre-existing, surfaced by this work)**: `incompleteGamma` used a series expansion that overflows for `x ≥ a+1` (the term grows to ~x mid-sum), so `chiSqP`/`fDistP` returned garbage for large χ²/F — e.g. ANOVA rating~touchpoint (F=64, dfW=5263) reported p=0.23 instead of ~0. This silently affected the existing chi-square test and ANOVA on any large sample. Fixed with the standard split: series for `x < a+1`, continued fraction (upper-gamma Lentz) above. Verified against χ² critical values (3.841/1→0.0500, 11.070/5→0.0500, 7.879/1→0.0050) and the large case (chiSqP(384,6)≈0).

**Verify**: tsc clean (my files); 449 tests pass; from-stats helpers verified vs raw-data fns; full dim path confirmed live (t-test server-vs-manager t=16.89 p≈0 d=0.69; ANOVA F=64 p≈0 η²=0.068). Browser pixel-render pending (auth-gated). **No new migration** — reuses sql/105–106.

## 2026-06-04 — Avg rating on the TextMine metric strip

**Why**: The strip shows records/signals/theme-fit/themes/date-range; adding the dataset's overall average rating frames how to read the per-theme and per-dimension rating badges (is steak ★3.2 good or bad? — depends on the ★4.1 baseline).

**What changed**: `signal-stats` route now also returns `avgRating`/`ratingMax`/`ratingLabel` — detects the rating field from `schema_config` (numeric with `sqt` rating/nps/likert or `scoreField`, the same rule TextMine uses) via the RLS user client, then averages it with the existing `numeric_field_stats` RPC (service-role, gated by the prior org-safe schema read). `DatasetMetricStrip` renders "★ R avg rating" (★ coloured green/amber/red by R relative to the scale max) with a tooltip explaining it's the baseline the theme/dimension ratings compare against. Optional — omitted for datasets with no rating field (open-text surveys) or empty collections.

**Verify**: tsc clean; 449 tests pass; value confirmed live (Cheddar's ★4.14 over n=19,708, max=5 — sits above the steak ★3.2 / manager ★2.4 dimension ratings). No migration (reuses numeric_field_stats).

## 2026-06-04 — "Items mentioned" on theme cards (entities in the card)

**Why**: The Theme Clouds already show the named entities within each theme ("Items"); the request was to surface the same on the Theme **Cards** so you can see, e.g., which dishes drive "Food Quality & Taste".

**What changed**: Extracted the theme×entity cross-tab out of `WordCloud` into a shared `lib/themeEntities.computeThemeEntities` (keyed by theme id/name so both views look it up regardless of ordering). `WordCloud` now calls the shared helper (dropped its inline memo + the now-unused `buildKwRegex`/`expandEntityTerms` imports). `TextMineModule` computes `themeCardEntities` over the filtered rows + entity catalog and renders an **"Items mentioned"** chip row on each theme card (between Co-occurs and the footer; top 6, count ≥ 2, category-dot colored, with a "+N more"). Only appears when the entity catalog has hits for that theme.

**Verify**: tsc clean; 454 tests pass; shared helper verified in isolation (Steak→Ribeye:2/Filet:1, Service→John:1, John absent from Steak). Same proven cross-tab the Clouds already ship. Browser pixel-render pending (auth-gated).

## 2026-06-04 — Fix: strip avg rating now matches the Dimensions box

**Why**: Owner spotted the top-bar avg rating (★4.1) disagreeing with the Dimensions box (★3.9). Root cause: the strip averaged EVERY rated row (Cheddar's: 19,708 rows → ★4.14), but Dimensions / per-theme / per-dimension ratings only cover the *analyzed* reviews — those with text (12,351 rows → ★3.90). The 7,357 text-less rows are mostly silent 5-stars (★4.54) that pulled the strip's number up, making every theme look below baseline when it was at baseline.

**Fix**: `sql/107` adds `numeric_field_stats_present(dataset, field, present_field)` — averages a numeric field only over rows where a second field is non-empty. The `signal-stats` route now reads the theme-source field from `theme_model` and averages the rating over rows where that text field is present (falling back to plain `numeric_field_stats` when there's no theme model), so the strip's avg rating uses the exact same population as `records`. Tooltip updated to say "across the N analyzed reviews (those with text)".

**Verify**: tsc clean; `sql/107` applied to prod + validated in a rolled-back tx; route path confirmed live — ★3.90 over n=12,351, matching the Dimensions tab + theme cards.

## 2026-06-05 — Dimension (axis) pill now drills into its comments

**Why**: On the Dimensions tab, clicking a top-level dimension pill (Product, Touchpoint…) only expanded its sub-pills — flat. Owner wanted it to drill into every comment tagged anywhere on that dimension.

**What changed**: `GET /api/datasets/[id]/taxonomy/rows` now accepts an **axis-only** query (`?axis=product` with no `sub`) → filters `dataset_row_taxonomy` with `.neq(axis_col,'{}')` (rows with any tag on that axis) and `collectEvidence` matches any assertion on the axis. `TaxonomyModule`'s axis pill onClick now sets the drill (`axis=<axis>`, crumb `Dimensions › <Label>`) in addition to revealing the sub-pills — so clicking Product opens the Product comments panel and you can then click a sub to narrow. Sub/alert drills unchanged.

**Verify**: tsc clean; 456 tests pass; axis-only filter confirmed live (Product → 3,238 distinct tagged reviews). No migration. Browser pixel-render pending (auth-gated).

## 2026-06-05 — Dimensions: deselecting a sub reverts to the axis drill

**Why**: After drilling axis → sub, deselecting the sub closed the comments panel entirely instead of falling back to the axis-level drill. Minor follow-up to the axis-pill drill.

**What changed**: `TaxonomyModule` sub-pill onClick now, on deselect, sets the axis-level drill (`axis=<axis>`) instead of `null`. Wrapped the sub-section in an IIFE to compute `axisLabel` once (from `data.axes`) so both the sub crumbs and the revert use the dimension's display label consistently (`Dimensions › Product › steak` / `Dimensions › Product`). UI-only.

**Verify**: tsc clean; 456 tests pass.

## 2026-06-05 — Dimensions: clarify the "severity alerts" KPI (118 vs 79+40)

**Why**: Owner: "118 severity alerts but 79 food safety + 40 pests = 119 — why are the numbers off?" Not a bug: the KPI (`alertRows`) counts distinct *reviews* with ≥1 alert (118), while the pills count alerts *per type* (79+40=119). Exactly 1 review is flagged for both food safety AND pests, so it's counted once in the KPI but in both pills (verified live). The "severity alerts" label made it read like a total that should sum.

**What changed** (UI copy only): relabeled the KPI **"severity alerts" → "flagged reviews"** (value unchanged = distinct alertRows), added a help tooltip explaining a review can carry multiple alert types so the per-type counts can exceed it, and extended the Severity section header to say counts are per type. `kpi()` helper gained an optional `tip` (title) param.

**Verify**: tsc clean; 456 tests pass; prod confirms 118 distinct flagged reviews, food safety 79 / pests 40, 1 review with both.

## 2026-06-05 — CI fix: wrap migrations in BEGIN/COMMIT (tx-wrap guard)

**Why**: After pushing the Dimensions arc, CI failed at the `check:sql-tx` guard — migrations numbered >70 must be transaction-wrapped. Offenders: my `sql/105/106/107` (taxonomy aggregates) **and the pre-existing `sql/100`** (Town Hall entity_map, from the parallel session — main was already red on this before my push). All four are tx-safe (CREATE/DROP FUNCTION, one ADD COLUMN; no CONCURRENTLY).

**What changed**: wrapped all four in `BEGIN; … COMMIT;`. No behavioral change — the RPCs are already live in prod (applied directly); this only satisfies the CI lint so partial failures would roll back. Guard now green locally.

## 2026-06-05 — Auto-classify-on-sync safety net (Dimensions stays current)

**Why**: Dimensions only reflected the last manual Re-classify — reviews pulled by the 6-hourly `review-sync` cron (and manual syncs) landed in `dataset_rows_flat` unclassified, so the tab silently drifted behind live data (e.g. Cheddar's: 11 text-bearing rows already pending). Owner asked for a safety net.

**What changed**:
- `sql/108` — `dataset_rows_pending_taxonomy(dataset, text_field, limit)` RPC: anti-join returning flat rows with NO taxonomy row AND non-empty text. The text filter is essential — text-less star-only reviews are skipped by the classifier and never get a row, so including them would make the LIMIT window loop on them forever; excluding them also keeps "reviews classified" = text-bearing rows.
- `lib/taxonomyClassify.classifyPendingRows()` — classifies only pending rows via that RPC, keyword tier, idempotent upsert, capped at `maxRows`.
- `lib/reviewSync.syncReviewSource` — after the post-sync schema/analytics recompute, **if the dataset is already classified** (≥1 taxonomy row → user opted in), classify the freshly-synced pending rows. Gated, capped (10K/sync), non-fatal (a hiccup can't fail the sync). Hooks the shared sync fn so it covers BOTH the manual sync route and the `review-sync` cron.

**Coverage / limits**: only datasets the user already classified (never auto-starts). Assumes `review_text` (the button default; a non-default-field classify would need a manual Re-classify). Huge initial gaps converge over a few syncs (capped per run; idempotent so timeouts are safe).

**Verify**: tsc clean; 461 tests pass (3 new `classifyPendingRows` unit tests — drain, cap/hasMore, no-work, real assertions fire); `sql/108` validated read-only vs prod (returns the 11 pending Cheddar's rows). Did NOT run the live backfill (no prod-mutating verification). **sql/108 must be applied to prod before the deployed hook works.**

## 2026-06-05 — Manage Entities: group by type, bulk None/All, staged Save

**Why**: Owner feedback on the Manage Entities panel (Schema tab): every hide/show click PATCHed + refetched, scrolling the panel back to the top — couldn't toggle several then save; and the "Done managing" button should be a Save.

**What changed** (`ExtractEntitiesPanel.tsx`, UI-only):
- **Grouped by category (type)** with a per-type header showing `shown/total` + **Show all / Hide all** buttons — so you can ignore a whole type (e.g. people) in one click.
- Hide/show is now **staged locally** (`pendingHidden` slug→desired, only when it differs from server; `effHidden` overlays it at render so an add/edit/discover refetch doesn't drop unsaved toggles). No per-click PATCH, no scroll jump.
- **"Done managing" → "Save (N)"** button that flushes staged changes (PATCH per row, chunked 10-at-a-time), then refetches + ✓ flash. Separate **Close** exits manage mode (confirms if unsaved). Toggled rows get an accent outline so pending edits are visible.

**Verify**: tsc clean; 461 tests pass (UI-only, no test surface). Browser pixel-render pending (auth-gated).

## 2026-06-05 — Dimensions on any dataset (per-org taxonomy flag) + co-occurs hover

**Why**: Owner wanted a way to apply Dimensions to datasets beyond Google Reviews (e.g. an uploaded CSV of restaurant feedback). The Dimensions tab + Charts/Stats dim fields were gated to `datasetSource==='google_reviews'`; the taxonomy dictionary is restaurant-specific, so the right control is a per-org capability, not the data source.

**What changed**:
- New **`taxonomy` capability** in `ModuleFeatures` (label "Dimensions"; `MODULE_LABELS` + `OrgFeatureToggles` description; registered in `resolveOrg` `ALL_MODULE_KEYS` + `ANALYZE_CHILDREN` so it's forced off when Analytics is off + auto-on for admin orgs). Auto-appears as a toggle in team settings.
- Threaded `taxonomyEnabled` from the analyze textmine/charts/stats pages → `TextMineModule` (Dimensions sub-tab gate), `ChartsModule`/`StatsModule` (`hasDimensions`). All three now gate on `datasetSource==='google_reviews' || taxonomyEnabled`. The classify route was already org-gated (not source-gated), so classification works on any dataset; the field picker handles non-`review_text` text fields.
- **Co-occurs hover fix**: theme-card "Co-occurs with themes" pill tooltip now matches the "Items mentioned" pattern (`<Theme> — co-occurs in N "<theme>" comments (X% of this theme)`) and dropped the inconsistent `cursor:'help'`.

**Enable it**: turn on "Dimensions" for a restaurant org in team settings → that org's analyze datasets all get the Dimensions tab + Classify button + dim fields in Charts/Stats.

**Verify**: tsc clean; 461 tests pass. Browser pixel-render pending (auth-gated). No migration.

## 2026-06-05 — Dimensions gating: restaurant-org auto-enable + per-dataset flag

**Why**: Owner has restaurant clients who upload data (not just Google Reviews) and needs (a) restaurant orgs to get Dimensions automatically, and (b) an admin/upload-time per-dataset apply.

**What changed**:
- **Auto-enable for restaurant orgs**: `orgTaxonomyEnabled(orgFeatures)` (`lib/resolveOrg`) = explicit `ModuleFeatures.taxonomy` flag OR `primaryIndustries` includes a restaurant type (`RESTAURANT_INDUSTRIES` = casual/fine/fast). The explicit toggle stays as an override for non-restaurant orgs.
- **Per-dataset flag**: `datasets.taxonomy_enabled` (sql/109). Set by an "Apply Dimensions" checkbox in the CSV upload flow (UploadClient → POST /api/datasets) and a toggle on the Schema tab (SettingsClient → PATCH /api/datasets/[id], allowlisted). Added to the `Dataset` type.
- **Gate**: the textmine/charts/stats pages compute `taxonomyEnabled = datasetSource==='google_reviews' || orgTaxonomyEnabled(org) || dataset.taxonomy_enabled` and thread it to TextMine (Dimensions sub-tab) + Charts/Stats (`hasDimensions`).

**Verify**: tsc clean; 461 tests; sql/109 applied to prod + verified (column exists). Browser pixel-render pending (auth-gated). Restaurant-industry orgs + flagged datasets now see the Dimensions tab + dim charts/stats; classify from the Dimensions tab as before.

## 2026-06-05 — classifyDatasetKeyword multi-field + applied Dimensions to Carabbas GSS

**Why**: Owner asked to apply Dimensions to the "Carabbas GSS" dataset (a guest-satisfaction survey, source=upload, 19,133 rows, Datanautix org). GSS exports have TWO open-ended verbatims ("What did you like MOST" / "LEAST"); the classifier read a single field.

**What changed**: `classifyDatasetKeyword` gained an optional `textFields[]` (concatenated with ` . ` so a phrase can't span a field boundary; takes precedence over `textField`). Backward-compatible.

**Operation (one-off, owner-authorized)**: set `datasets.taxonomy_enabled=true` for Carabbas GSS + ran the keyword classifier over both verbatims → 19,133 classified, 9,505 with a signal, 41 severity alerts. Top attribute subs: flavor 2,670 / friendly 1,540 / attentive 596 / professional 375 / speed 360 — sensible restaurant dimensions. (Datanautix is an admin org so it auto-qualifies for the Dimensions tab once the gating code deploys; the per-dataset flag is set too.)

**Verify**: tsc clean; classification verified read-only vs prod (counts + sub breakdown). The run mutates prod, but it's the explicitly-requested operation (idempotent upsert), not verification.

## 2026-06-05 — Metric strip avg rating: support remapped (valueAliases) fields

**Why**: Owner remapped a survey satisfaction field to a numeric score and tagged it as a rating, but the top info bar (metric strip) stayed blank. Root cause: the field's values are text labels ("Highly Satisfied"…) mapped to numbers via the field's `valueAliases` ({"Highly Satisfied":"5",…}); the client surfaces apply the aliases, but the strip ran SQL `avg((data->>field)::numeric)` on the RAW label → cast nothing → no avg.

**What changed**: `sql/110` `field_aliased_avg(dataset, field, present_field, aliases)` — maps each stored label to its alias number, then averages (optional present_field to keep the analyzed-population consistency). The `signal-stats` route now detects a remapped rating field (numeric field whose `valueAliases` has numeric values) and routes to it instead of `numeric_field_stats`.

**Verify**: tsc clean; sql/110 applied + verified live — Carabbas GSS "Rating" field → ★4.14 over 15,384 analyzed rows. (Noted to owner: their map has "Somewhat Satisfied"→1, looks like a typo for 4.)

## 2026-06-05 — Session state (Dimensions/Analyze track)

**~11 analyze commits ahead of origin, NOT pushed** (owner chose "not yet"). `sql/105–110` ALL applied to prod, but the calling code is local → the Dimensions-on-any-dataset gating, the Charts/Stats dim fields, the strip rating fixes, and the entity-panel rework are **inert/invisible in the live app until a deploy**. Carabbas GSS is classified + flagged in prod and works in local `npm run dev` only. Spec docs (ANALYTICS/TAXONOMY/SECURITY/DATA_SOURCES/SURVEYS/TESTING) + this devlog are current per-commit.

**Open items** (also in the task list / queue memory):
1. **Deploy** — push the ~11 commits when ready (each prod build ~$8–10).
2. **Per-theme Dimensions row on theme cards** — owner asked; needs a server theme×dimension RPC + render (the one deferred mid-session).
3. **Dimensions rollup hardcodes `data->>rating`** — per-dimension ★ won't pick up survey/aliased rating fields (e.g. Carabbas); make it detect the field dynamically + apply `valueAliases`.
4. **Carabbas mapping typo** — "Somewhat Satisfied" → 1 (likely 4); owner to fix in the Schema editor.
5. Entity filtering on Comments + pill→Comments nav (owner-queued); dims into Score Driver delta; user-facing↔internal name-map doc.

## 2026-06-05 — Agent Study open-question count = the curated queue (matches the agent card)

**Why**: The per-agent Report's "Open Questions" count could disagree with the **agent card** on the bots list. The card reads `logged_questions.status='open'` (one grouped count, no cap). The Study, since 2026-06-03, ran a per-render **AI validation pass** that re-judged each open row and dropped false positives, then labeled the survivors "(N validated)" — so its count was a *different* number than the card's, and the two surfaces visibly contradicted. Owner wants one number.

**What changed** (`lib/agentStudy.ts` + 3 consumers):
- `getAgentStudy` now computes **`openQuestions.total`** from the same `logged_questions.status='open'` count the card uses (`count: 'exact', head: true`, no time/row cap) and drives every headline off it: the Overview KPI, the Open Questions card header, the deck KPI, and `answerRatePct` (`answeredPairs = totalPairs − total`). The displayed `open[]` list stays the **40 most recent** for drill-down, with a "showing N most recent of {total}" note when truncated.
- **Dropped from the AgentStudy object**: `openQuestions.autoFiltered`, `filteredExamples`, and `open[].restated`. The report shows the **raw user message**, not an AI restatement. Copy de-"validated"-ed across the in-app report (`ReportClient.tsx`), the baked HTML export (`agentStudyHtml.ts`), and the leave-behind deck (`pptx/agentStudyDeck.ts`). False-positive cleanup is no longer per-render — it's the team's deliberate action on the Questions page (Answered/Referred/N-A) or the `agent-question-revalidate` script, both unchanged.
- `STUDY_SCHEMA_VERSION` → **v4** so stale cached studies recompute. `validateOpenQuestions`/`revalidateOpenQuestions` (the on-demand queue-cleanup action) are untouched.

**Verify**: tsc clean; 461 tests pass (no test surface — render/copy only). Browser pixel-render of the report pending (auth-gated). No migration. Spec: `docs/BOTS.md` updated (superseded the 2026-06-03 validation bullet + added the v4 bullet).

## 2026-06-05 — Remove AI queue-cleaning entirely (owner: humans curate, no AI)

**Why**: Follow-on to the count-reconciliation fix. Owner's standing rule for the open-questions queue: *no AI cleaning — let the team mark questions Answered/Referred/N-A as they see fit*. The per-render AI validation was already gone; what remained was the on-demand AI cleanup path (`revalidateOpenQuestions` + the `scripts/agent-question-revalidate.ts` CLI, dry-run by default) that re-judged open rows with Claude and wrote false positives to `status='n_a'`. CLI-only, never wired to UI — but still AI-cleans the queue, contradicting the rule.

**What changed**: Deleted `scripts/agent-question-revalidate.ts`; removed `revalidateOpenQuestions` + the now-orphaned `validateOpenQuestions` helper and `QVerdict` type from `lib/agentStudy.ts`. The `findPriorAgentLine`/`findFollowingAgentLine` context helpers stay (the report still shows AGENT-before / USER / AGENT-after). The Questions page (mark Answered/Referred/N-A) is now the **sole** arbiter of what's open — no automated AI judgment anywhere in the path.

**Verify**: tsc clean (full tree, exit 0); no test/import references to the removed symbols (grepped app/lib/components/tests/scripts/package.json). Spec: `docs/BOTS.md` both open-question bullets updated to record the removal.

## 2026-06-05 — Town Hall: "Send to principals" email (report link and/or PDF)

**Why**: The v1 Town Hall promise is "send the report to principals at the end of the meeting." The Export & Share tab had a stub bullet ("Send to principals — Resend email with the share link") but no actual send. This is the most pilot-critical of the remaining Town Hall open items (June 16 NOWOCATS pilot).

**What changed**:
- **New route** `POST /api/recordings/[id]/report/send` (`docs/RECORDINGS.md §4.7a`). Owner/admin-org only (same gate as `/share`), service-role read pairs `id`+`org_id` (404 cross-org), 409 until complete. Body `{ recipients, note?, includeLink?, includePdf?, includeTranscript? }`: recipients accept an array or a comma/newline/semicolon string → parsed, lowercased, email-validated, de-duped, capped at 25 (bad ones returned as `rejected`); **the sender chooses** link and/or PDF (≥1 required); `includeLink` requires the public link enabled+unexpired and embeds `${BASE_URL}/th/<token>`; `includePdf` renders once and attaches base64 to every recipient. Returns `{ ok, sent, failed, rejected, results[] }`.
- **Shared PDF renderer**: extracted the data-fetch + HTML bake + Chrome render out of `report/pdf/route.ts` into `lib/recordings/reportPdf.ts → renderRecordingReportPdf(service, rec, {includeTranscript})`; both the download route and the send route use it (DRY — render lives once). The pdf route keeps auth + the cross-org gate.
- **Datanautix-branded email** (`lib/recordings/reportEmail.ts → buildReportEmail`): it's a client report deliverable, so the "datanautix" wordmark (data teal + nautix orange) + datanautix.com footer, NOT Sentimetrx. Adaptive body (link button / "PDF attached" line / both) + optional escaped sender note. From `Datanautix <reports@sentimetrx.ai>` (verified domain), reply-to = the sending user. Resend provider gained an `attachments` field (Resend-only).
- **UI**: replaced the stub bullet with a "Send to principals" owner-only card on the Export & Share tab — recipients textarea (16px), optional note, include-link toggle (disabled until the public link is on), attach-PDF toggle (+ transcript sub-toggle), Send button + per-send result + skipped-invalid feedback.
- **Spec drift fix**: `RECORDINGS.md` had a stale duplicate §4.7 describing an old design (share route emailing principals, Sentimetrx branding, `/r/<token>` URLs, password hashing) that never matched the built split — replaced with the accurate §4.7a; §4.5 updated to note the shared renderer.

**Verify**: tsc clean; 461 tests pass. **Email QC done** — rendered all three variants (link-only / pdf-only / both+note) to PNG via a throwaway harness (now deleted) + local Chrome and eyeballed: datanautix wordmark correct, layout clean, adaptive CTA correct, and caught + fixed a date off-by-one (date-only `meeting_date` parsed as UTC → rendered a day early in PDT; now parsed from local Y/M/D components). No migration. NOT sent to any real address (would email live recipients) — the route path is exercised only by the QC render of the template; first real send is the manual prod test. ALL LOCAL.

## 2026-06-05 — Town Hall cards: content meta row (files · Q&A · duration)

**Why**: Owner wanted richer info on the Town Hall list cards — how many files are attached, how many Q&A pairs the meeting yielded, etc. — so the list conveys substance at a glance, not just name/status/date.

**What changed**:
- **`app/recordings/page.tsx`** — hoisted the recording-ids array and added two batched aggregate queries over the loaded ids (no N+1): one on `recording_extractions` filtered to `unit_type='qa_pair'` (the same filter the report header + `GET /api/recordings/[id]` use, so the card and report agree), counted per recording in memory; one on `recording_files` selecting `recording_id, file_role`, counted per recording split into media vs slides. New `Row` fields `qa_pair_count`, `media_file_count`, `slide_file_count` (+ `source_duration_sec`, already fetched).
- **`app/recordings/RecordingsListClient.tsx`** — extended `RecordingCard`, added `fmtDur` (sec → "1h 12m"/"45m") + `cardMeta` (builds the parts list, dropping any zero/unknown part), and rendered a middot-separated meta row between the status/date row and the owner footer. An in-progress card with no pairs/duration just shows its file count (or nothing).

**Verify**: tsc clean; 461 tests pass. **Data path verified read-only vs prod** (supabase db query): NOWOCATS Meeting 2 → 5 media · 0 slides · 17 qa_pairs · 2760s (46m) — the qa_pair count matches the documented Meeting 2 number exactly, confirming the filter agrees with the report. Browser pixel-render pending (auth-gated). No migration. Spec RECORDINGS.md §5.5 (List UX bullet) updated. ALL LOCAL.

## 2026-06-05 — Town Hall cards: "needs review" pending-work pill + deep-linkable report tabs

**Why**: Owner wanted the cards to flag pending reviewer work so it's visible without opening each recording, in a darker color, ideally a clickable pill that jumps straight to where you resolve it. Note: the Town Hall data model has **no "unanswered question" concept** — every extracted Q&A pair has both a question and an answer (required). The real "needs human intervention" signal that exists today is `recording_extractions.flagged_for_review` (low_confidence / curator_questioned / cross_vendor_disagreement / panel_to_panel_suspect). Owner agreed: show flagged now, separated; a true "unanswered" pill is a follow-up needing an analyzer detector.

**What changed**:
- **`app/recordings/page.tsx`** — the existing qa_pair aggregate query now also counts `flagged_for_review` pairs in the same pass (one query, two counts). New `Row.flagged_count`.
- **`app/recordings/RecordingsListClient.tsx`** — on `status==='complete' && flagged_count>0`, a **darker-amber full-width action bar** ("⚠ N pairs need review →") renders at the card bottom. It's its **own `<Link>`** to `…/report?tab=coverage` — a sibling of, never nested inside, the card's body link (nested `<a>` is invalid). Built to hold a second "unanswered" pill later; both will funnel to the same review tab.
- **`app/recordings/[id]/report/ReportClient.tsx`** — report tabs are now **deep-linkable**: initial tab reads `?tab=` (`useSearchParams`, validated against the Tab union, defaults to `coverage`). The page is auth-dynamic so no static CSR-bailout concern.

**Open follow-up**: **truly-unanswered-question detection** — add a `flag_reason='no_response'` (or payload flag) the analyzer sets when an audience question got no substantive panel answer, then a second card pill counting it. Bigger build (analyzer prompt/pass + backfill via re-extract); scoped, NOT built.

**Verify**: my files tsc-clean (the 3 tsc errors in the tree are the parallel TextMine session's uncommitted `EntityCompareTab.tsx` — `SchemaField.max`/`.sqt` — NOT mine; excluded from this commit). **Data verified read-only vs prod**: NOWOCATS Meeting 2 → 17 qa / 3 flagged → card shows "⚠ 3 pairs need review". 461 tests pass. Browser pixel-render pending (auth-gated). No migration. Spec RECORDINGS.md §5.5 updated. ALL LOCAL.

## 2026-06-06 — Dimensions view redesign spec (pills + cards) — DESIGN ONLY, not built

**Why**: Owner wanted to rethink how the **Dimensions** sub-tab (`TaxonomyModule.tsx`) displays the 7-axis taxonomy. Today it shows the same data twice (axis pills + a "By axis" bar column; sub-pills + a "Top sub-topics" list column), which is dense and redundant. Goal: one coherent surface that reuses patterns already in the product — **Entities-style pills** for the 7 top-level axes, **theme-card-family cards** for the level-2 sub-buckets — with a clean pill→card hierarchy.

**Design decisions reached** (full spec: `TAXONOMY.md §4a`):
- **Axis pills** = Entities-pill treatment: identity-color dot + label + **rate%** + red→green **★ badge**. Pills filter the card grid. Chose **rate%** over raw count (better at the broad axis grain).
- **No rating/sentiment fill-coloring on pills** — an axis rating is an average-of-averages (soft); a ★ *badge* is the right lightweight weight, but coloring the *fill* would collide with Severity red, fight the selected-state, and double-encode the per-sub cards. Same principle = **axes never become full cards** (would overclaim depth the average lacks); UI weight must match signal strength.
- **Sub cards** = theme-card family, slightly leaner: dot + ★rating + pos/neg sentiment bar + **rate% lead / count muted**, click → existing drill panel. Carry only the four things a sub genuinely knows; skip theme-card sections with no taxonomy data (description/keywords/co-occurs/items/CI/box) — additive later.
- **Grid**: no axis selected → top subs across all axes (default landing); axis selected → filtered. Sort rate% desc. Preserve the axis-level "all comments on this axis" drill as a grid-header affordance.
- **Retire** the "By axis" bars, "Top sub-topics" list, and sub-dimension pill row.
- **Refactor**: centralize the 7 axis colors into `AXIS_COLOR` in `lib/dimensionFields.ts` (shared by the view + the existing theme-card Dimensions chips so they never drift) — relocates a constant only, **no theme-card layout change**.
- **Severity** pills stay **red**, own row, unchanged.
- **Cost when built**: zero new backend — all from the existing `taxonomy` rollup (`SubStat`); no new endpoint/RPC, no per-card fetch, no migration. Contained to `TaxonomyModule.tsx` + `dimensionFields.ts`.

**Next session entry point**: implement `TAXONOMY.md §4a` in `TaxonomyModule.tsx` (+ `AXIS_COLOR` in `dimensionFields.ts`). Open detail left to build-time: exact card density vs. a theme card; whether to sub-group Context's 25 subs.

**Verify**: docs-only commit — no code, no tsc/test impact, no migration, NOT pushed.

## 2026-06-06 — Dimensions view redesign BUILT (pills + cards)

**Why**: Implemented the design speced earlier today in `TAXONOMY.md §4a`. The Dimensions sub-tab (`TaxonomyModule.tsx`) previously showed the same data twice — axis pills + a "By axis" bar column, and sub-pills + a "Top sub-topics" list. Replaced that redundancy with one surface: Entities-style axis pills on top, theme-card-family sub-bucket cards below.

**What changed**:
- **`lib/dimensionFields.ts`** — added `AXIS_COLOR` (the 7 axis identity colors) as the single source of truth.
- **`components/analyze/TaxonomyModule.tsx`** — axis pills now render Entities-style (identity dot + **rate%** + ★ rating badge) and only *filter* the grid (no auto-drill). New level-2 card grid (`repeat(auto-fill, minmax(240px,1fr))`): each card = axis dot + title (`dimSubLabel`) + ★ rating + pos/neg sentiment bar + rate% lead / count muted, click → existing `setDrill(...)`. No axis selected = top 24 sub-buckets across all axes (sorted rate desc, count tiebreak); axis selected = that axis's subs + a "Read all comments on this dimension" header link for the axis-level drill. Clicking a card also focuses its axis so the drill panel's per-tag highlight + breadcrumb stay in sync. Retired the sub-pill row, the "By axis" bars, and the "Top sub-topics" list; removed now-unused `pillStyle`/`Pill`/`maxAxis`/`CSSProperties`. Severity stays a red pill row, KPIs + drill panel unchanged. **All from the existing `taxonomy` rollup (`SubStat`) — no new backend, endpoint, or fetch.**
- **`TextMineModule.tsx` (×2) + `textmine/WordCloud.tsx`** — replaced the inline per-axis color literals in the theme-card / Theme-cloud Dimensions chip rows with the shared `AXIS_COLOR` import, so colors can't drift. **No theme-card layout change.**

**Verify**: my 4 changed files **typecheck clean** (`npx tsc --noEmit` after a clean cache); the only 2 tsc errors are in the untouched `CampaignDetailClient.tsx` and trace to a *local xlsx stub* I had to create — the env's network policy 403s `cdn.sheetjs.com` (the CDN-pinned `xlsx` dep), so a full `npm install` can't complete; I installed everything else and stubbed `xlsx` as `any` for the typecheck, which is what makes `sheet_to_json<T>()` complain. Not present with the real package. **461 tests pass** (`npm test`). No migration. Spec `TAXONOMY.md §4 + §4a` and `ANALYTICS.md` updated. ALL LOCAL, not pushed.

## 2026-06-06 — Dimensions: Severity promoted to a top-level pill + alert cards

**Why**: Owner wanted severity handled like the other dimensions — a single top-level **⚠ Severity** pill that, when selected, opens its sub-alerts (rather than a separate always-visible red pill row). Mirrors the axis→sub-card flow exactly.

**What changed** (`components/analyze/TaxonomyModule.tsx`):
- Replaced the separate severity-pill row with an **8th pill in the axis-pill row** (kept red — status, not navigation), showing the total flagged-review count. Driven by a `SEVERITY='__severity__'` sentinel `filterAxis`.
- Selecting it renders the alert sub-types as **red cards** in the same grid (⚠ tag + the matching `attribute` sub's ★ rating + flagged count, click → `?alert=` drill), with a header showing the flagged-review total + the per-type caveat.
- Footnote updated ("Pick a dimension chip — including ⚠ Severity — to open its cards").

**Verify**: changed file typecheck-clean (the only 2 tsc errors remain the untouched `CampaignDetailClient.tsx` xlsx-stub artifacts — env can't install the CDN-pinned `xlsx`); 461 tests pass. No backend/migration — still all from the existing `taxonomy` rollup. Specs `TAXONOMY.md §4/§4a` + `ANALYTICS.md` updated. ALL LOCAL, not pushed.

## 2026-06-06 — Dimensions view: design polish pass (header, %, comment highlight)

**Why**: Owner review of the built Dimensions view flagged several fit-and-finish issues against the Themes view's look.

**What changed** (`components/analyze/TaxonomyModule.tsx`):
- **Header meshes with Themes now**: replaced the chunky centered KPI cards with a Themes-scale header — an `<h2>` "Dimensions" + a one-line stat summary (reviews classified · % with a signal · ★ avg · N flagged), field picker + Re-classify aligned right. The redundant "flagged reviews" KPI is gone (it lives on the ⚠ Severity pill). Removed the now-unused `kpi` helper; field-picker compact height fixed (`'100%'` → `34`).
- **Grid section header slimmed** from a 15px `<h3>` to a slim toolbar line (13px focus label / 11px uppercase "Sub-dimensions"), matching the Themes toolbar scale.
- **Sub-card % is now "% of the dimension"** (`round(100·sub.count/axis.count)`) instead of % of all reviews, labeled "X% of <dimension>"; **all percentages rounded** (axis pill, sub card, sentiment) — no decimals.
- **Comment-card highlighting**: the chip for the picked dimension/sub pair is highlighted; an axis-only "read all" drill highlights every sub of that dimension; a severity drill highlights the `attribute:<alert>` chip; other tags rendered muted. Chips now show display labels (`DIM_AXIS_LABEL` · `dimSubLabel`) instead of raw keys.
- Severity-as-a-dimension-pill (built in the prior commit) confirmed in place — selecting it expands its alert sub-cards.

**Verify**: changed file typecheck-clean (only the 2 untouched `CampaignDetailClient.tsx` xlsx-stub artifacts remain — env can't install the CDN-pinned `xlsx`); 461 tests pass. No backend change. Specs `TAXONOMY.md §4/§4a` + `ANALYTICS.md` updated. ALL LOCAL, not pushed.

## 2026-06-06 — Policy: AI-agent sessions work directly on `main`

**Why**: Owner wants Claude Code sessions to commit straight to `main` (no feature-branch juggling) so local testing is friction-free. Recorded as a permanent **Branch policy** in `CLAUDE.md` (project + a parent-level `/home/user/CLAUDE.md`), and reconciled `docs/ENGINEERING.md §2` so the formal Branch & review policy isn't contradicted — documented as an owner-directed exception where the **owner-authorized push is the review gate** (diff-read before push = the solo-founder self-review). Pushing still requires explicit authorization; no `--force`/`--no-verify`.

## 2026-06-06 — Fix: favorite star showed "off" on faved dataset cards

**Why**: Owner noticed faved datasets in Analyze rendered an empty star even though the card behaved as a favorite (sorted to top). Root cause: `FavoriteStar` seeded its state with `useState(initialFavorited)`, which only reads the prop on first render — but `AnalyzeClient` hydrates favorites asynchronously (`/api/favorites` fetched after first paint), so the prop flipped false→true after mount and the star never updated. The sort used the reactive `favoriteIds` set, hence state-correct but display-stale.

**What changed** (`components/ui/FavoriteStar.tsx`): added `useEffect(() => setFavorited(initialFavorited), [initialFavorited])` to re-sync when the parent hydrates/changes the prop. Shared component (bots/surveys/datasets/campaigns/townhall/recordings) — all benefit; parents that hydrate synchronously just re-set the same value (no-op).

**Verify**: typecheck-clean (only the unrelated CampaignDetailClient xlsx-stub artifacts remain); 461 tests pass. No backend change. ALL LOCAL on main, not pushed.
