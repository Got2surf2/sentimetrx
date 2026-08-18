# Testing strategy

This is a deliberately small, high-leverage test suite. Its job is to prove the
non-negotiable pieces work — the parts that PE / technical-diligence reviewers
care about — without the upkeep cost of comprehensive coverage.

## How to run

```bash
npm run typecheck         # tsc --noEmit (strict)
npm test                  # unit + integration via Vitest
npm run test:watch        # local TDD loop
npm run test:coverage     # v8 coverage report
npm run test:e2e          # Playwright (requires running app + admin creds)
npm run test:rls          # env-gated: cross-org RLS isolation (real Supabase)
npm run test:egress       # env-gated: cross-org data egress per table (real Supabase)
npm run test:auth-flows   # env-gated: real Supabase auth round-trips
npm run test:campaign-egress # env-gated: campaign-by-id route handlers
npm run test:dataset-egress  # env-gated: dataset sync + auto-setup + regulations download + org/logo route handlers
npm run loadtest:k6          # k6 — concurrent Town Hall API load (manual)
npm run loadtest:browsers    # Playwright — concurrent Town Hall browser load (manual)
npm run check:sql-tx         # fails when a new sql/NNN_*.sql lacks BEGIN/COMMIT
npm run check:spec-staged    # pre-commit hook target — blocks commits whose staged code maps to an unstaged spec doc
```

**Lint ratchet**: `npm run lint:ci` is `eslint . --max-warnings 176` (2026-08-18, down from 195 — `useSurveyEngine`'s 19 `exhaustive-deps` warnings cleared; before that 251 → 229 on 2026-08-16, when the ceiling had drifted 9 above the measured count, which is the slack the ratchet exists to prevent). The number may only ever go DOWN. ⚠️ `eslint .` **cannot be run locally** (OOMs at 12GB); lint scoped directories instead — `components lib` + `app` + `tests scripts workflows proxy.ts` sum to the CI total exactly. The remaining warnings are **96% `react-hooks/*`** and are behaviour-sensitive: burn them down per-file with browser verification, never as a bulk sweep. ⚠️ **A low `react-hooks/*` count on a file is not evidence of health**: the v7 rules are compiler-based and bail out of an entire component on a construct they can't model — reporting nothing from `refs`/`purity`/`immutability` for it. `useSurveyEngine` went from 19 warnings to 51 on a reorder that edited zero lines (see ENGINEERING.md, 2026-08-18). Confirm the compiler actually analysed a file before reading its count as clean.

**k6 load tests** (`tests/loadtest/*.k6.js`) export a **named** default function (`chatTurnScenario`, `rowsFetchScenario`, `surveySubmitScenario`, `townHallScenario`). k6 requires a default export as its VU entry point but does not require it to be anonymous; naming it satisfies `import/no-anonymous-default-export` and gives readable stack traces.

CI runs `typecheck`, `check:sql-tx`, and `test:coverage` on every push and PR. The test step runs with v8 coverage so each CI run publishes the coverage table and enforces a **ratcheting floor** (`coverage.thresholds` in `vitest.config.ts`): a regression below the floor fails CI. The floor is set just below the current baseline — **raised 2026-08-16 from 20/15/20/20 to 30/23/33/30** (statements/branches/functions/lines) over `lib/**` + `app/api/**`, because the old floor had drifted ~10pp *under* the real numbers and would have passed a 30% regression without complaint; a floor that far below actual is decoration, not a gate. Measured at the raise: statements 30.7 · branches 24.07 · functions 33.79 · lines 31.26. It is bumped up as new tests land — per the governance Tests-score progression plan. The thresholds are deliberately a no-regression gate, not a coverage *target*; the target is critical-path coverage, not a headline %.

**Isolation suites now gate CI (2026-07-02).** The five env-gated suites above (`test:rls`, `test:egress`, `test:auth-flows`, `test:campaign-egress`, `test:dataset-egress`) were previously *never* run in CI — the `test:coverage` step doesn't set their env flags, so the single most important test class for a multi-tenant product only ran when someone ran it by hand. A separate `isolation` job in `ci.yml` now runs all five against real Supabase creds (`SUPABASE_TEST_*` repo secrets). Because these suites `describe.skip` on missing/placeholder creds and vitest still exits 0, the job has a **fail-loud preflight** that hard-fails if the secrets aren't set — a green `isolation` check therefore means isolation was actually tested, not skipped. Pre-launch the secrets hold the prod project's values (the suites namespace `_rlstest_*`/`_egresstest_*` data and clean up after themselves); repoint them at a dedicated test project once real customers exist.

The repo also installs a local pre-commit hook (`.githooks/pre-commit`, wired up via `core.hooksPath` in the `postinstall` step) that runs `check:spec-staged` against the staging area. It blocks commits where a staged code file maps to a spec doc (per `scripts/specMap.ts`) that isn't also staged. Bypass with `SKIP_SPEC_CHECK=1 git commit ...` when the change is genuinely doc-irrelevant.

## Layout

```
tests/
├── setup.ts              # global setup (env stubs, next/headers shim)
├── unit/                 # pure functions + mocked-boundary tests
│   ├── auth/             # requireAdmin, logDeckDownload, botPageOrgGate (agent admin-page org gate)
│   ├── components/       # jsdom render/interaction tests — BrandTagInput (render + onChange + datalist fetch), DatanautixAttribution (brand contract + variants), ModulePlaceholder (counts + settings link), HelpHint (popover open/close/Escape), FavoriteStar (aria state + optimistic POST + re-sync), LottieLoader (message + size; lottie-web stubbed), SentryDigest (Resolve/Archive → POST {id,status} + optimistic row removal + error banner; the client half of the /admin/sentry write path the real Sentry API can't verify locally)
│   ├── sentryUpdate.test.ts  # updateIssueStatus (lib/sentry.ts) — PUT request shape (URL/method/bearer/body) + Archive→ignored mapping + non-2xx/network-error/unconfigured branches; mocked fetch (creds are prod-only)
│   ├── recordings/       # coverage (per-topic counting + zero-flag, gap detection, histogram, agenda↔topic casing reconciliation §3.6); analyze (Opus+Sonnet+synthesis parse, flag-merge, sentiment, deterministic counts, overallSentiment, graceful-degrade; callAI mocked); meetingTool (resolveProfile NULL→qa coercion, clampPhases snap/clip, slicePhaseSegments, fallback); brandGlossary (mergeBrandEntities — brand-catalog seeding §3.5c); transcriptRoles (segment→question/answer monotonic split + span tightening de-overlap §3.6 + action-item transcript trace by content-word window); timeline (packLanes overlap staggering + buildTimelineModel geometry); configVersion (isAnalysisConfigDrifted — shaping-vs-metadata drift detection §5.4/§5.7); panel (isPanelMember roster match — middle-initial tolerance, case/punctuation-insensitive, conservative no-partial-match, empty-roster safe)
│   ├── anaContext.test.ts    # Ask Ana row→context formatter — town-hall Q&A + agent-turn shape detection, mixed-collection (project preview) labeling, noise-field drop, truncation
│   ├── anaFilteredSample.test.ts # loadAnaSample filter-aware sampling (sql/167) — early-stop "~" estimate above the 50K cap, count-to-end EXACT denominator at/under it, canonical applyFilters on the small path (cat exclude-mode + daterange, both silently mishandled pre-167), PGRST202 legacy fallback, no-filters passthrough. SQL↔JS matcher parity (6 filter shapes, exact counts incl. sci-notation numerics) + 1M-row scale live-verified by untracked scripts/_verify_ana_filters.mts vs TEST
│   ├── botEntityExtraction.test.ts
│   ├── botProbeGuards.test.ts
│   ├── agentCapability.test.ts  # AGENT_TIERS Phase 1 — resolveCapability knob table: standard == today's hardcoded values (no model override), super raises every knob + defaults model to Opus 4.8, honors/validates capability_config.model, normalizeCapability CHECK-safe coercion, sanitizeCapabilityConfig drops junk. Live-TEST twin check in untracked scripts/_verify_super_agent.mts
│   ├── superTurnBackstop.test.ts  # AGENT_TIERS Phase 1 — assertSuperTurnAllowed abuse backstop: unlimited by default (no org_features row / null quota), allows under ceiling, blocks at ceiling on chat_super count, fails OPEN on count error
│   ├── aiProviderGuard.test.ts  # BYOK provider-independence (2026-07-15) — a claude-* modelOverride is dropped when resolution lands on OpenAI (explicit providerConfig AND the byo+openai org redirect → MODEL_MAP tier default, customer key in the header) but kept on Anthropic; chatCore's per-org gate refuses the turn with ZERO vendor calls when the org's AI mode is 'off'
│   ├── liveContextRegistry.test.ts  # AGENT_TIERS Phase 2e/2f — the live-context adapter registry (lib/liveContext/registry.resolveLiveContextBlocks): wildfire activated by legacy config.liveContext (any tier, exact call shape), MCO activated by AskAna bot id (not other bots), super capability_config.liveContext knob activates an adapter with no legacy gate, knob IGNORED for standard (super-only), dedup across legacy+knob, MCO-before-wildfire order, adapter throw → per-source error not a failed turn. Live wildfire turn through the registry verified by untracked scripts/_verify_live_context.mts
│   ├── liveContextTypes.test.ts  # AGENT_TIERS Phase 2f — client-safe knob validation (lib/liveContext/types.sanitizeLiveContextRefs): drops unknown sources, dedups by source, keeps params only when a plain object, [] on non-array; sanitizeCapabilityConfig round-trip preserves a validated liveContext + model and omits when nothing valid survives
│   ├── brandMatch.test.ts
│   ├── knowledgeChunkReembed.test.ts  # D2 (AGENT_TIERS §2) — PATCH /knowledge/[chunkId] re-embeds the merged new title+content on edit (tsv trigger keeps FTS current but embedding is not trigger-maintained → stale vectors); embedding failure clears the vector (NULL) rather than leaving it stale, text edit still applies
│   ├── crawlQueue.test.ts  # AGENT_TIERS Phase 2d — resumable super-crawl cursor math (lib/botKnowledge/crawlQueue): takeBatch respects visited + page budget + dedups queue, mergeDiscovered appends only-new capped at 2× remaining budget, crawlIsDone on empty-queue / cap-reached. Live 100+-page bar met on gnu.org via untracked scripts/_verify_super_crawl.mts (140 pages / 9 persisted resumable steps / 1550 chunks / boilerplate stripped)
│   ├── knowledgeReplaceProtect.test.ts  # AGENT_TIERS Phase 2d — a D3 editor save (replace:true) prunes stale AUTHORED chunks but NEVER prunes background bulk-source chunks (metadata.source_type='deep-crawl'|'re-crawl' super-crawl/re-crawl-cron), else the next Save wipes a 300-page crawl; append mode never prunes
│   ├── agentRecrawl.test.ts  # AGENT_TIERS Phase 2e — per-page hash-diff re-crawl (lib/botKnowledge/recrawl): contentHash determinism, UNCHANGED page skipped (no delete/ingest, only touches last_crawled_at), CHANGED page replaced (delete-by-metadata->>source then shared ingest + hash upsert), NEW page ingested, unreachable page fail-soft (no hash), ingest-throw leaves old hash for retry, deadline stops new pages. Live bar via untracked scripts/_verify_recrawl.mts (real gnu.org page → sql/177 round-trip + skip/replace decision)
│   ├── agentRecrawlCron.test.ts  # AGENT_TIERS Phase 2e — the weekly re-crawl cron (/api/cron/agent-recrawl): fail-closed checkCronAuth (401 unauthed), sweeps ONLY super agents that have training_urls (standard + super-without-urls excluded), clean no-op when no eligible agents; recrawlAgentPages mocked (selection/orchestration only)
│   ├── documentText.test.ts  # AGENT_TIERS Phase 2c — text-first document extraction (lib/botKnowledge/documentText): docKind mime/extension classify, assemblePdfPages page titling + scanned-PDF sparse detection, htmlToMarkdownish headings/lists/entities, real DOCX round-trip through mammoth, real text-PDF through unpdf, text/markdown wrap, unsupported-type reject
│   ├── knowledgeDedupBudget.test.ts  # AGENT_TIERS Phase 2b — POST /knowledge near-dup guard (append path drops cosine≥0.95 vs existing via match_agent_knowledge_embedding; replace mode BYPASSES so edits aren't dropped) + per-agent chunk budget cap (super 5000, budget_skipped count)
│   ├── knowledgeReplaceUpsert.test.ts  # D3 (AGENT_TIERS §2) — POST /knowledge replace=true is a content diff-upsert: inserts only changed chunks (unchanged ones not re-embedded), prunes only removed chunks (even when nothing new), append (no replace) never prunes, and a failed insert leaves the old KB intact (no zero-knowledge window)
│   ├── deepCrawlLinks.test.ts  # D4 (AGENT_TIERS §2) — crawl-quality helpers: htmlToText preserves in-body links as [label](url) / drops mailto·tel·anchors (a); stripBoilerplate removes >⅓-of-pages chrome, no-op under 3 pages (c); parseSitemapUrls same-host locs vs sitemapindex children (b); agentLinks buildLinksDirectory/attachLinksDirectory (idempotent replace) + withLinkIntegrityGuardrail (added once) (d). Fresh-crawl e2e in untracked scripts/_verify_deep_crawl_links.mts
│   ├── helpAgent.test.ts  # Help agent (Sherpa, 🧭) — scrubHelpReply strips fabricated links/emails (Spacy failure class) while preserving official sentimetrx.ai/datanautix.com links, softens invented emails to "your account team", KEEPS valid in-app nav links (/analyze, deep /bots/new) but STRIPS invented in-app paths (/billing-center) to their label; formatHelpPageContext emits current section/route + only enabled features. Live grounding bar in untracked scripts/_verify_help_agent.mts (real handleChatTurn vs TEST: grounded how-to, data-Q → Ask Ana redirect, fabrication bait declined)
│   ├── hierarchy.test.ts     # client-defined org hierarchy (lib/hierarchy) — path-keyed nodes (same-named districts under different regions must NOT merge), no row ever dropped ((unassigned) buckets so leaf counts sum to the total), level ordering, breadcrumb/rowsUnder/nodesAtDepth, crumbsForPath == breadcrumb (the tree-free trail the outlet page draws must not diverge from the real one), pluralLevel
│   ├── classifyPendingRows.test.ts  # auto-classify-on-sync safety net — pending-row loop drain, maxRows cap/hasMore, real keyword assertions, COLLECTION fan-out (drains each member, embeds into MEMBER rows, one rollup on the collection)
│   ├── commentaryReport.test.ts # shared Commentary renderer (Town Hall + Agent Study) — topic clustering/ordering, sentiment dot, escaping, empty-state
│   ├── deflectionRouter.test.ts
│   ├── engagementSignals.test.ts
│   ├── entityAnalysis.test.ts    # PPTX entity slides — splitMentions, catalogToAggregate (catalog-first reuse), entitySlideSpecs slide shape
│   ├── entityMentionDetector.test.ts
│   ├── guardrails.test.ts
│   ├── nameExtractor.test.ts  # post-hoc AI name extractor — gating + JSON parsing + defense-in-depth regex
│   ├── outletPredictor.test.ts # "recover 1–3★ guests" predictor — 1–3★ rate/spread, brand over-rep driver vs loud-but-neutral vs excluded outcome theme, peer-quartile weaknesses/strengths, themeFocus, top-3–5 learn-from list (distinct, best-first), quote attach + projectRecovery what-if (least-improved-theme gate) + buildRecommendedActions greedy playbook + outcomeCorrelations (loyalty→driver) + conventional ratingRank + recommended-actions rec/union (interactive playbook de-dup)
│   ├── agentStudyAttribution.test.ts # "Where They Came From" grouping — (source,medium,campaign) tuple buckets, untagged kept as its own row so columns reconcile, whitespace/blank normalization, busiest-first sort, rate null at zero opens and capped at 100% when conversations exceed opens
│   ├── attribution.test.ts   # embed-URL provenance sanitizer — trim/80-char cap/reject-empty, bare names with utm_* fallback (bare wins), absent keys omitted rather than emitted as undefined, non-string junk posted straight at the public API rejected
│   ├── personaExtractor.test.ts
│   ├── phase3DualWrite.test.ts
│   ├── projectCompare.test.ts # competitive + brand-360 comparison engine — primary focus resolution/reorder, matrix cells (count/dominant-sentiment/avg-rating), row sort by volume, brand_360 no-primary
│   ├── projectReport.test.ts # project (brand) report aggregation — by-topic pooling case-insensitive, reconciling totals, deterministic 1:1 theme fallback, entity merge across sources, sentiment sum, source-attributed commentary
│   ├── probeFocusClassifier.test.ts # user-turn topic classifier — gating + comma/bracket parsing + dedup + catalog validation
│   ├── promotion.test.ts     # promotion manifests (lib/promotion) — parseManifest version gates, -copy[N] slug ladder, imports land dormant (draft/paused), allow-list stripping, fresh survey guid + null client_id, PulseIQ dedicated-agent rollback on failed session insert
│   ├── ragConfidence.test.ts  # D1 (AGENT_TIERS §2) — chatCore.normalizeChunkConfidence derives confidence=LEAST(rank/8.5,1) onto keyword-fallback chunks that lack it, so a semantic-RPC error no longer suppresses the whole KB; cap-at-1/floor-at-0, semantic chunks untouched, null/empty no-op
│   ├── multiQueryRetrieval.test.ts  # AGENT_TIERS Phase 2 — mergeRankedChunks: super-agent multi-query union (dedup by id keeping higher confidence, re-rank by confidence, top-K), keeps id-less keyword-fallback chunks, tolerates null sets
│   ├── rateLimit.test.ts
│   ├── sentiment-slang.test.ts
│   ├── serviceAlerts.test.ts  # credit-limit alert emails (lib/serviceAlerts) — pickAlertWorthy per-status re-alert windows (low ≈3d "close to the limit", critical/error ≈daily), maybeAlertCreditError claim-then-send (atomic last_alerted_at claim: concurrent 402 burst → one email; loser skips), no-recipients no-op (no DB write)
│   ├── sentryScrub.test.ts    # Sentry beforeSend PII scrub + Office content-script noise drop
│   ├── townhallAnalytics.test.ts # PulseIQ detail analytics (lib/townhallAnalytics, shared legacy route + phase-3 adapter) — seed vs organic theme counting, keyword supplement, sentiment_score-preferred trend w/ lexicon backfill, bucket pinning/auto, dismissed-theme exclusion, empty-session shell
│   ├── snapshotV2.test.ts    # snapshot v2 (lib/orgSnapshotV2 + streaming orgRestore) — uncapped NDJSON dump→open round trip via local store, U+2028-in-text regression, manifest commit marker + listing grouping (manifest-less days hidden), replace-per-parent delete-once semantics, replace-mode zombie deletion, composite-PK reporting; resumable dump (2026-07-13): expired-deadline chain driven exactly like the cron (checkpoint reloaded from the store per hop) converges to a snapshot row-identical to single-shot incl. multi-part reassembly order + parent contiguity, multi-part restore still deletes each parent once, no-deadline = single-shot (no checkpoint/parts), alien-org checkpoints ignored
│   ├── orgSnapshotCron.test.ts # nightly org-snapshot cron orchestration (dump mocked) — id-order slicing, 240s budget bail + waitUntil self-continuation w/ CRON_SECRET, ≥1 unit of work per hop, hop>20 refusal, per-slice fail-loud (500+logError) without stranding later orgs, fetch_errors→500, dead continuation kick reported; intra-org resume (2026-07-13): deadline passed into the dump, mid-org bail → partial (not error) + resume=<org>&d=<day> kick, resume hop loads the ORIGINAL day's checkpoint then moves on, zero-progress resume gives the org up loudly (stalled), hop-cap partial converts to error
│   ├── orgRestore.test.ts    # restore fidelity (2026-07-04 DR-drill regressions) vs a PostgREST-faithful fake (atomic-batch FK/unique enforcement) — TABLE_SPECS dependency order, datasets↔collections circular-FK retry rounds, referential-debt bisection (skipped_fk without poisoning the batch), brand_slug unique collision → skipped_conflict, self-verification catches post-write vanishing rows (`missing`), under-delivered streams + failed pre-deletes are errors, deferred brand columns beat the set_brand_collection_id trigger's phantom-minting (two-trigger simulation incl. membership-twin dedup)
│   ├── signalStats.test.ts    # signal-stats cache freshness — recompute when row_count changes under a stable theme-model hash (stale-toolbar bug); persist path goes through the atomic merge RPC (sql/145); sampled path above the 50K cap (sql/162: scale + sampled flag, exact fallback when the RPC is unavailable, exact at/under cap); per-field cache slots (analytics.signal_stats_by_field hit/miss/prune, active-key delegation)
│   ├── themeCountsCache.test.ts # /theme-counts server cache (2026-08-14) — the key must MISS whenever the numbers could have moved (keyword added, theme removed, fields changed, any extras flag toggled, row_count moved, older payload version, malformed entry) and HIT on the cosmetic churn that would otherwise force a 33.4s recompute (theme/keyword reorder, keyword case). Absent/empty analytics misses cleanly; one request shape never serves another. The jsonb round-trip + analytics merge are additionally proven against the real TEST database by the untracked scripts/_verify_theme_counts_cache.ts (11 checks) — jsonb doesn't preserve key order, which a mock won't show
│   ├── themeUtils.test.ts     # theme utils incl. the per-field theme-set machinery — themeFieldKey/themeModelKey conventions, legacy-blob wrap, mergeThemeModelWrite clobber-safety, themeSetsForExport ordering, themeSetForField (the Charts/Stats/Ana per-question resolver: map entry vs fresher top level, never-mined → null fallback, combined-key passthrough); kwPatternFragment/buildKwRegex matching semantics (in-order multi-word with ≤4 intervening words, ≥5 rejected, POSIX-safety for the SQL RPCs, regex-special escaping); **recountThemes' substantive base (2026-08-18)** — a hit inside a non-substantive comment is not counted, the percentage is a share of the substantive base, the gate is per FIELD so two short answers can't add up to a passing word count, ANY substantive field qualifies the row, and the overall rating baseline still averages ALL rated rows
│   ├── themeMining.test.ts    # mine-time corpus validation (lib/themeMining) — scanThemes counts/unmatched/kwCounts, pruneDeadKeywords minKeep floor, deficientThemes 60%-of-estimate gate (<3% estimates ignored), mergeKeywordAdditions dedup+cap, applyMeasuredCoverage restatement, buildRefinePrompt content
│   ├── chartsMissingAnalytics.test.tsx # jsdom render regression (prod 2026-07-12): ChartsModule/StatsModule must render their degraded states — not throw — when the analytics blob lacks fieldSummaries/totalRows (script-seeded or compute-failed datasets; unguarded fieldSummaries derefs crashed Charts on the 785K scale test)
│   ├── trimRoute.test.ts      # dataset trim route vs a PostgREST-faithful fake (incl. its 1000-row select cap) — deletes ALL matching rows across rounds (the old single select silently trimmed ≤1000), hasMore continuation contract, analytics recompute goes through mergeDatasetAnalytics (never a blob replace that wipes signal_stats/taxonomy), comma-in-field-name 400, zero-match no-op
│   ├── bulkRowSample.test.ts  # shared sql/160 rows pager + collection share allocation (lib/bulkRowSample) — full-page continuation vs short-page termination, cursor advance, throw-on-error; proportional floored shares never exceed the cap, non-empty members keep ≥1 row, zero/empty handling. Live: untracked scripts/_verify_collection_sample.ts vs TEST (184K two-member collection → 49,999 unique)
│   ├── sampledSignalCounts.test.ts # sql/162+163 keyset pagers (lib/sampledSignalCounts) — page accumulation + cursor advance, short-page termination, throw-on-error (callers fall back to exact), scaleSampledCount rounding/full-coverage/zero-scan guards; numeric pager sum/n/min/max accumulation + alias-map passthrough + rating-less sample. Live accuracy verified vs exact counts (TEST 128K via REST) and vs field_aliased_avg on real 56K data (sampled 4.5830 vs exact 4.5823); untracked scripts/_verify_signalstats_e2e.ts
│   ├── sampledAggregate.test.ts # sql/169 /aggregate sampled twins (lib/sampledAggregate) — per-op keyset-page accumulation (crosstab cells, field-value counts, date buckets, group values, numeric values), count scaling vs UNSCALED means/medians/stddev, even-n median interpolation + sample-stddev n<2 null, ranked-grid/limit, p_row_ids passthrough, throw-on-error fallback. Live accuracy vs exact within ±2% on 56K/128K + no-57014 on 1M PERF TEST (untracked scripts/_verify_aggregate_sampled.mts)
│   ├── nonEmptyCountFilter.test.ts # sql/170 count_nonempty_rows filter-awareness (lib/nonEmptyCount) — p_row_ids appended only for a non-empty filter set (null/[] = whole dataset), RPC count returned, PGRST202 legacy fallback applies the filter via .in('id',...). Live filtered parity (numerator+denominator) vs JS count in scripts/_verify_aggregate_sampled context
│   ├── secretbox.test.ts      # at-rest encryption for per-org BYOK AI keys (lib/secretbox) — round-trip, legacy-plaintext passthrough, no-key degradation, GCM tamper detection
│   ├── orgDelete.test.ts      # tenant-erasure sweep (lib/orgDelete) — clears every org_id table, retry-to-fixpoint tolerates FK ordering, fail-closed when a table can't be cleared
│   ├── log.test.ts            # structured logger (lib/log) — Sentry capture tagged with where/request_id/org_id, never-throws, logWarn skips capture; where-prefix on empty-message plain-object errors (title says WHAT failed, not {"message":""}) + real-Error message left untouched + fields ride into Sentry extra
│   ├── sourceSummary.test.ts  # shared "what was presented" renderer (Town Hall Meeting Notes + Agent KB summary) — heading/overview/items, optional figures/refs/attribution, escaping, empty-state
│   ├── recordingSegmentEdits.test.ts # Town Hall transcript structural edits (lib/recordings/segmentEdits) — nudgeSegmentStart (carries the shared boundary, clamps so neither turn collapses, no-op on first/out-of-range), splitSegmentAt (text splits at caret, boundary time interpolated, second half left speaker-less, source_offset shifted, no-op at text ends), mergeSegmentUp (joins into the prior segment span+text, inherits speaker only when prior unassigned, no-op on first/out-of-range)
│   ├── recordingParticipation.test.ts # Town Hall Participation tab math (lib/recordings/participation) — mono vs stereo speaker keying, 2s turn merging (turns carry concatenated text), same-name dedupe (two raw labels resolving to one display name merge into one speaker row — incl. the real prod shape where one cluster's raw label was set directly to the name), floor changes/crosstalk/quiet time, panel-vs-community split gated on roster match (null without), no-diarization degradation
│   ├── researchProbes.test.ts # Research Probes pure helpers (lib/researchProbes, BOTS.md §14) — probe-library validation, deterministic hash assignment + sampling-rate bounds, field windows, eligibility gates (min turns / sentiment / topics / channels), verbatim delivery matching, decline vs answer split, yes/no coding. Live e2e rides untracked scripts/_verify_probes.ts vs the TEST project
│   ├── taxonomyRollup.test.ts # restaurant taxonomy roll-up — aggregateTaxonomy axis/sub rates + sentiment + alerts; resolveDictionary core⊕overlay layering; emotion block (neg/pos splits, disap×churn co-occurrence, zero-suppression); universal-tier zero-axis suppression (emotion-only rows yield ONLY the emotion axis; rating-less negRate degrades to null)
│   ├── emotionFlags.test.ts   # emotion-language flags (lib/emotionFlags) — disappointment/blame/churn-intent detection, negation guard ("won't be disappointed"), "should have" subject attribution (third-party→blame, passive/impersonal→disappointment, first-person dropped = regret dark), suppressChurn, evidence spans, embed grouping under a.emotion
│   ├── insightAlerts.test.ts  # lens-agnostic "Heads-Up" alert engine (themes + dimensions + quant) — pain/bright/safety static + deteriorating/heating/improving trend + quant avg-drift/low-tail; adaptive min-mention floor, safety-always, cross-lens merge+dedupe+cap, dimensionsToSignals/themesToSignals adapters
│   ├── metricStripUnstamped.test.tsx # jsdom — the strip must not assert a substantive count it never measured. An unstamped `substantive` flag counts as 0; the strip falls back to the answered count, **suppresses the "% of N answered" share** (claiming 100% off the fallback would imply a measurement), and uses the all-based theme fit instead of "Diffuse 0%". Fourth case pins that stamped datasets still prefer the substantive numbers
│   ├── collocations.test.ts   # Context view collocation math (lib/collocations, ANALYTICS.md "Context view") — `contextTokens` normalization (contractions resolved against the stop list — "we're"/"it's"/"that's" were topping spoken-corpus clouds; possessives folded so "sarah's" counts toward "sarah"; **evaluative adjectives good/great/delicious KEPT — they're the answer here, unlike in WordCloud**), sentence scoping (a word one sentence away is NOT context), per-COMMENT counting (a repeated word counts once), word-boundary targets ("seafood" ≠ "food"), target never its own context, multi-target theme pooling, multi-field search, G² ranking a distinctive partner above an everywhere-word of equal count, and the distinctiveness floor (a 2-comment exclusive can't top the list) with its empty-list fallback. **The load-bearing case is `filterCooccurringRows` returning exactly the chip's count** — if those diverge the cloud is lying about its drill-down
│   ├── contextCloud.test.tsx  # jsdom — ContextCloud renders: loader first then cloud (compute is deferred past mount), target absent from its own cloud, count badge = comment count, Frequency/Distinctive toggle reranks, click hands the word back, honest empty state
│   ├── opinionPopoverContext.test.tsx # jsdom — the word-modal Context path end-to-end: tab present, chip count → drill-down count match, aspect amber vs context blue highlight, clearing the chip restores the full list
│   ├── themePopoverContext.test.tsx # jsdom — the theme-modal Context path: every theme keyword pooled; **drilling a context word narrows the samples but leaves the theme's headline mentions + % untouched** (else the header silently starts meaning "of the co-occurrence subset")
│   ├── trendWindows.test.ts   # dynamic time-framing for trend charts + recent-vs-prior windows — adaptive bucket unit (week/month/quarter), auto third-vs-third split, YoY (same period last year), explicit trailing window, too-short-span fallback, bucketKey
│   ├── numericValue.test.ts   # toNumericOrNull SQL/classifier parity (lib/numericValue) — accepts tolerant forms (" 5", ".5", "1e3", "5."), rejects decoration ("1,000", "4.5abc", "4/5", Infinity) that parseFloat mis-parsed; the "No groups found." root-cause guard
│   ├── timeBucket.test.ts     # bucketKey timezone-safe boundary dates — 2024-01-01 buckets to 2024-Q1/2024 (not prev-day) in America/New_York, matching the SQL ::date path; datetime strings preserved
│   ├── filteredSummaries.test.ts # recomputeFilteredSummaries (ChartsModule) — filter-aware recount of summary-driven charts: categorical/numeric recount from filtered rows, COUNT surfaces scaled (means/extents unscaled), whole-dataset histogram bin edges reused, virtual __ fields skipped
│   ├── strictScaleMapping.test.ts # lib/scaleUtils strictScaleMapping — system-wide Likert auto-quant gate: maps full satisfaction/quality/agreement scales 1→k, REJECTS nominal fields (Visit Type, cities, names) and mostly-nominal fields with a single coincidental scale hit
│   ├── regressionDesign.test.ts # lib/regressionDesign — design matrix for categorical/theme regression: one-hot (modal reference) vs ordinal encoding, theme 0/1 keyword-match column, complete-case row dropping, outcome binarization (numeric threshold / category level / theme mention), buildRegVars field pool
│   ├── logisticRegression.test.ts # lib/statsUtils logistic regression + collinearity — intercept recovers logit(mean y), positive-effect recovery + convergence + OR=exp(β), perfect-separation flag, no-effect OR≈1; vif = 1/(1−r²); pruneCollinear drops the collinear twin, keeps independents
│   ├── chartsEffectStability.test.tsx # ChartsModule effect-web re-render-loop guard — mounts with LOADED rows + an ACTIVE FILTER (exercises useChartRows sync, theme-counts fetch, recomputeFilteredSummaries, regression-effect deps) and asserts it settles with no "Maximum update depth" loop (the react-hooks warning-sweep safety net)
│   ├── ratingTrend.test.ts    # competitive rating-over-time — buildRatingTrend: ≥2-series guard, per-series points + recent-vs-prior delta (slide vs climb), quarter bucketing for multi-year spans, y-axis star clamp, min-reviews delta guard
│   ├── quantSignals.test.ts   # Heads-Up quant lens — buildQuantSignals: recent-vs-prior field averages from dated rows → deteriorating-rating alert (★4.6→★4.1), low-score-tail surge, no-trend-without-dates, min-sample floor
│   ├── themeSignals.test.ts   # Heads-Up theme lens — buildThemeSignals: rating-derived per-theme pos/neg + avg ★ (full-period snapshot), posPct null without a rating field, recent-vs-prior windowed keyword re-matching → deteriorating theme alert, skip no-match themes
│   ├── reportCatalog.test.ts  # unified Reports picker source-of-truth — availableReports(ctx) gating (dataset deck + Operational Review for restaurants, collection community/competitive/brand-360 by purpose+member-count, ad-hoc gated until its endpoint ships, AI-off drops AI reports) + per-type formats/scopes + launch URL/method builders (ad-hoc always launches the datasets ad-hoc-report endpoint, incl. for collections)
│   ├── uiHints.test.ts        # ui_hints extractor (canvas demo intent layer) — parse/validate, context plumbing, revert_canvas signal, prompt-text invariants
│   ├── wildfireLiveContext.test.ts # wildfire agent live injection (lib/wildfireLiveContext, BOTS.md §6 config.liveContext) — location extraction (ZIP vs City,ST vs "near X"; acreage/go-bag/"near me" false-positive guards), haversine + compass, ring geometry (point-in-polygon + distance-to-edge), mocked-fetch block build (nearest-first ordering, ZIP carry-forward, RX labeling, IRWIN perimeter join + edge distance + inside-perimeter URGENT banner, worst-pollutant AirNow pick, USDM drought class as context-not-verdict, NWS alerts, empty-radius honesty, geocode/WFIGS fail-soft)
│   ├── surveyEngineFlow.test.tsx # jsdom END-TO-END harness for the survey engine (components/survey/useSurveyEngine) — drives a real respondent flow through the same buttons/textareas and asserts the /api/respond payload, which embeds the whole conversation transcript (two transcripts snapshotted). Covers the NPS → rating → q3 → q4 → psychographics → demographics → contact walk; the AI clarifier (asked / SKIP respected / answer appended) and the keyword fallback; AI deflection short-circuiting the clarifier; both #verbose commands; the kiosk vs non-kiosk device lock; all seven custom question types; `_end` skip logic; required-open blocking an empty send; hidden fields / urlParams / ?rid= click self-report; and the **customAnswers accumulator** — a hidden field and a conversation-position answer must both survive a later `stepCustomQuestions` run (regression: it assigned the map wholesale, dropping them from the final payload only). Math.random pinned to 0 (the engine shuffles psychographic + custom questions with it) and timers faked; jsdom on Node 22 has no Web Storage so localStorage/sessionStorage are stubbed
│   └── usageLog.test.ts
├── integration/          # route handlers with mocked Supabase
│   ├── admin-usage-detail.test.ts     # GET /api/admin/usage/[type]/[id] — admin gate + aggregation roll-up + from/to range
│   ├── decks.test.ts                  # 4 admin-only deck routes × {anon, admin}
│   ├── respond.test.ts                # public survey-response endpoint
│   ├── high-traffic-routes.test.ts    # clara/nora/bot/townhall chat + study/[guid]
│   ├── rls-isolation.test.ts          # env-gated, real Supabase — RLS coverage
│   ├── cross-org-egress.test.ts       # env-gated, real Supabase — per-table egress
│   ├── auth-flows.test.ts             # env-gated, real Supabase — auth round-trips
│   ├── campaign-routes-egress.test.ts # env-gated — service-role campaign-by-id routes
│   ├── dataset-routes-egress.test.ts  # env-gated — service-role dataset/regulations/org routes
│   ├── collection-members-routes-gate.test.ts # POST /api/collections/[id]/members (add datasets to a collection) — 401 no-org, 400 empty, 404 cross-org / missing
│   ├── recordings-routes.test.ts      # recordings API routes (incl. documents §4.1e) — auth/feature/org gates + validation (mocked)
│   ├── export-org-gate.test.ts        # cross-org 404 gate on the service-role export routes incl. recordings pptx (404/409/200+content-type; mocked)
│   ├── export-perfield-themes.test.ts # per-field theme sets in export/pptx + export/html — one Theme Analysis block per stored set counted on its own field, selectedThemesByField per-set filter (colliding t1..tN ids), HTML per-field slides, combined-set 'a + b' artifacts excluded (mocked; renderDeck captured)
│   ├── recording-transfer-gate.test.ts # PATCH recording transfer — platform-admin-only 403 gate + RPC/audit orchestration + rename isolation (mocked)
│   ├── recording-edit-pair-gate.test.ts # PATCH extraction hand-edit (§3.5d) — edited_* write, null-reverts-to-AI, cross-org 404, non-qa_pair 400 (mocked)
│   ├── tenant-routes-gate.test.ts     # campaign-send / social-handle / dataset route — 401 + cross-org 404 (mocked)
│   ├── bot-routes-gate.test.ts        # agent API routes (bots/[id] + entities/questions/conversations/knowledge) — 401 no-auth/no-org, cross-org 404/403, admin bypass; both getCallerOrgContext + getAuthUser auth shapes (mocked); PATCH nonexistent-id 404 for non-admins (the org-paired snapshot read, W29 audit fix)
│   ├── social-comment-routes-gate.test.ts # social comment actions (delete/hide/reply/ai-reply/dm/bulk) — Phase 1 mutating-route gates; 401 + 404; mock records .eq() calls to ASSERT the lookup is paired with .eq('org_id', callerOrg) (catches a dropped org filter, not just a null result)
│   ├── townhall-mutation-gate.test.ts  # regression for two cross-org write holes fixed 2026-06-08 — POST townhall/themes/[id] (topic moderation) + townhall/sessions/[id]/duplicate; cross-org non-admin → 404, owning-org + admin bypass allowed (tranche 2, 2026-07-03: mocks target pulseiq_sessions/pulseiq_topics — legacy fallbacks retired). ALSO: round-based pacing POST townhall/sessions/[id]/round (401/400-invalid-round/404-cross-org/200/admin-bypass) + participant-facing townhall/resume/[sessionId] guards (400 missing participant_id, 404 unknown session, holds when not active)
│   ├── data-source-routes-gate.test.ts # Phase 1 — data-source mutations (review-sources DELETE/PATCH/sync, reddit-sources sync + download-thread, social/connections DELETE); 401/403/404 + org-paired lookup (.eq('org_id') recorded). All verified correctly gated
│   ├── core-entity-routes-gate.test.ts # Phase 1 — core-entity mutations (studies/[id] per-user created_by gate, collections/[id] GET/DELETE admin-aware (explicit cross-org 404, not org-locked), campaigns/[id]/clone + /respondents org gate, settings/team same-org+owner, townhall/sessions POST, townhall/themes/custom POST); includes the REGRESSION for the townhall/themes/custom cross-org write hole fixed 2026-06-08. Records .eq()/.insert() to assert org pairing + that creates land in the caller org
│   ├── external-source-routes-gate.test.ts # Phase 1 — external-ingest source routes (substack-sources create/download-comments/fetch-posts, regulations-sources create/download-comments/search) + social alert-rule routes (social/alerts GET/POST/PATCH/DELETE, social/dm-templates GET/POST); 401/403/404 + org-paired lookup/insert (.eq('org_id')/insert org_id recorded), PATCH field-whitelist blocks org_id escape. All verified correctly gated
│   ├── dataset-mutation-routes-gate.test.ts # Phase 1 — high-blast-radius dataset lifecycle mutations (datasets/[datasetId] GET/PATCH/DELETE [per-creator], state GET/PUT/PATCH, trim POST, sync POST [?full wipes+re-imports], refresh-schema POST); 401/403/404 cross-org before any service-role write, .eq('org_id') recorded, state PATCH field-whitelist asserted. DELETE: admins may delete cross-org (collections live in the client org), collections skip the creator-only gate, non-admin cross-org → 404
│   ├── entity-enrichment-routes-gate.test.ts # Phase 1 — dataset entity-catalog + enrichment routes (entities GET/POST, entities/[slug] PATCH/DELETE, entities/reset-discovered POST, discover-entities POST, auto-setup POST, compute POST) + the auth-only AI helpers (merge-themes, expand-keywords); 401/404 cross-org with .eq('org_id') recorded on the POST/[slug] lookups. All verified correctly gated
│   ├── dataset-query-routes-gate.test.ts # Phase 1 — dataset "query POST" routes that read tenant rows from a body (aggregate, rows GET/POST/DELETE, comments, taxonomy GET/POST, export/html/share) + REGRESSION for three cross-org READ leaks fixed 2026-06-08 (theme-counts POST [leaked theme counts + topical words over another org's rows], signal-stats-batch POST [arbitrary ids], theme-impact POST [latent]); cross-org non-admin → 404, signal-stats ids filtered to caller-owned
│   ├── bot-action-routes-gate.test.ts # Phase 1 — agent action + study routes not in bot-routes-gate (bots POST/import create, bots/[id]/analyze, entities/extract, entities/[entityId] PATCH/DELETE, questions/[questionId] PATCH, conversations/[sessionId]/review POST, study/pdf+pptx POST, ask-ana POST); 401/404 cross-org on the agent org gate, ask-ana 403 on the body datasetId. All verified correctly gated
│   ├── recordings-townhall-routes-gate.test.ts # Phase 1 — Town Hall (recordings) + PulseIQ routes not in recordings-routes.test.ts (analyze gate mocks the adapter's pulseiq_sessions resolve since tranche 2) (recordings/[id]/{files, live-summary/token/transcript, report/pdf+send, signoff, versions}, recordings/extract-setup, townhall/sessions/[id] GET/PATCH/DELETE + /analyze); 401/403-no-feature/404 cross-org (paired id+org_id or JS org check). All verified correctly gated
│   ├── sources-misc-routes-gate.test.ts # Phase 1 — remaining sources + misc tenant routes (review-sources create + [sourceId]/locations + user-locations, reddit-sources, social/auto-config + export-dataset, collections/datasets create, studies/[id]/analyze + responses, settings/team/disable, org/logo, invite + [id] + resend, favorites, share); 401 + cross-org 404 + role/owner 403 (org-paired id/org_id validated against caller). All verified correctly gated
│   ├── admin-routes-gate.test.ts # Phase 1 — platform-admin gate on EVERY internal admin/* route (23 route+verb combos across agent-tester, bulk-invite, clients[/id], invite-preview, org-snapshots[/restore], orgs/[id][/ai-key,/features], reo-gold-set, users/[id][/features]); asserts a non-admin caller (authed or not) never gets 2xx — requireAdmin → 404, inline is_admin_org/owner → 401/403
│   └── public-routes-noleak.test.ts # Phase 1 — the intentionally-public surface (webhooks, participant widgets, embeds, demo kiosk). Asserts the per-route safety mechanism, NOT an org gate: resend/social webhooks reject forged/unsigned requests (Svix/Meta HMAC), townhall/responses validates the participant against the session (404, no blind cross-session write), translate-responses translates only caller-supplied body text (size cap / english short-circuit). Full public-surface catalogue in docs/SECURITY.md § 3
├── e2e/
│   ├── smoke.spec.ts         # Playwright CI smoke — self-contained (throwaway login + seeded dataset), runs on every push vs a production build; shell/list/tab-dance/schema/filters
│   ├── helpers/e2eSeed.ts    # env gate (prod-ref refusal), org/user find-or-create, dataset seed/cleanup, storageState cookie mint
│   ├── global-setup.ts       # seeds + writes storageState; writes skip marker without TEST creds
│   ├── global-teardown.ts    # deletes the seeded dataset
│   └── deck-download.spec.ts # Playwright, env-gated (legacy: needs E2E_ADMIN_* creds)
└── loadtest/
    ├── townhall.k6.js        # k6 — concurrent Town Hall participant API load
    ├── townhall.spec.ts      # Playwright — concurrent Town Hall browser load
    └── playwright.config.ts  # config for the browser load test
```

We chose `tests/` at repo root rather than colocated `__tests__/` directories.
The repo is large; centralizing tests keeps the application tree clean and
makes the suite easy to reason about as a unit.

## What we test

| Area | Test | Why it matters |
| --- | --- | --- |
| Admin-only gate | `requireAdmin` returns 404 unauth, null for admin | Internal decks must not leak to anon |
| Audit logging | `logDeckDownload` is fire-and-forget | A logging failure must never block a download |
| AI input/output guardrails | `guardrails` profanity, refusal detection, output validity | Public survey + town-hall input/output are user-facing; bad output is brand risk |
| Rate limiting | `rateLimit` bucket exhaustion + reset | Public endpoints (respond) need real protection |
| Persona extraction | `personaExtractor` shape + missing fields + AI failure | We mock the LLM at `lib/ai`'s boundary; we want the parser robust to garbage |
| Usage logging | `usageLog` non-blocking | Usage logging must never crash a paid AI call |
| Brand-match scoring | `scoreBrandMatch` exact match, lookalike rejection, chain consensus | DataforSEO returns lookalikes ("Chuy's de Mexico") alongside the real brand; the scorer must rank the real chain `strong` and qualifier-prefixed lookalikes `weak` even when the chain's actual name differs from the user-typed brand |
| Sentiment slang + negation | `contentGuard.scoreSentimentFull` Gen-Z lexicon + negation valence-shifter | Modern slang ("mid", "lit", "ate", "sus") and "not"-style negations must score correctly; otherwise the sentiment column reads neutral on a large fraction of restaurant reviews |
| Probe info-only skip | `botProbeGuards.isInfoOnlyMessage` greeting/thanks/ack/sign-off detection | Bot CRITICAL OVERRIDE must not fire on "thanks!" or "ok cool" — otherwise the probe pivots feel jarring and the threshold logic burns its single shot on a no-content turn |
| Entity-from-KB extractor | `botEntityExtraction` batch boundary logic + slug-keyed aggregation + alias merging + majority-vote category resolution | The extractor is fire-and-forget against the AI boundary; the deterministic helpers (batching + aggregation) must produce stable output so re-extracts don't churn the catalog or lose hand-curated aliases |
| Entity-mention detection | `entityMentionDetector` word boundaries + case-insensitivity + plural/singular variants + multi-word longest-first precedence + alias matching + dedup-within-turn + cache invalidation | Every user turn runs this synchronously; a false-positive matches every common noun, a false-negative misses the entire feature. Hidden-row exclusion + variant expansion are the two correctness levers |
| Deflection routing | `deflectionRouter` question-signal regex, sensitive-topic match, decision rule (sensitive overrides feedback; question signal required when no sensitive hit) | Shared between bot + town hall chat routes; a regression in the decision rule fires AI deflection on every short answer (cost + UX hit) or never deflects at all (off-topic answers pollute aggregates) |
| Engagement signals | `engagementSignals` countWords edge cases, isCurtResponse threshold, SUBTLE_DISENGAGE anchor behavior, isSubtleDisengage wrapper | Used by the PulseIQ AI-tone-check fast path. Anchoring is critical — a bad regex matches "ok so what about housing" as disengagement and skips clarifying on real feedback |
| Phase 3 dual-write | `phase3DualWrite` flag gating (no-op when off), mirror call shape for turns / focus-flags / delete, **attribution written to the conversations upsert only for keys actually present** | The dual-write is observation-only with the flag off; the unit tests pin that contract so a future refactor doesn't accidentally make it always-on or break the table/filter shape. The attribution cases guard the only-present-keys rule — `upsert` is `ON CONFLICT DO UPDATE SET <provided columns>`, so emitting an absent key as `null` would let a later turn blank out the provenance the session's first turn stamped |
| Embed-URL attribution | `attribution` sanitizer (see the file list above) plus the dual-write cases | These values arrive from a public, cookie-free URL that anyone can POST directly, so the sanitize contract is a security boundary, not a formatting nicety. Deliberately unlike `?site=`: attribution is stored as data and never enters the system prompt, which is why it needs no allowlist — a test that let it reach the prompt would be the regression to catch. Real-database proof of the preserve-on-omit behavior lives in `scripts/_verify_attribution.mts` (untracked KEEP), since a mock can only assert payload shape |
| Sentry PII scrub | `sentryScrub` redacts `request.{data,body,cookies}` + auth/cookie headers + PII key names, reduces `user` to `{id}` only, scrubs email/phone in breadcrumb messages, drops the Office "Object Not Found" false-positive | The scrub is a `beforeSend` hook — bugs are silent (PII leaks to Sentry) and only caught at the next quarterly audit. Tests pin the contract so the redaction can't regress |
| Signal-stats cache freshness | `signalStats.computeSignalStats` serves cache only when theme-model hash AND row_count match; recomputes when rows are synced under a stable hash; self-heals legacy caches missing `row_count` | The TextMine toolbar caches off the theme-model hash, which is blind to synced rows — a stale strip read 67 records while the live Themes panel counted 80 (Coalition Donor collection). The row-count key is the only thing preventing the strip + exported decks from silently freezing after every sync |
| Theme-counts cache key | `themeCountsCache.themeCountsKey` / `readThemeCountsCache` — miss on any input that moves the numbers, hit on cosmetic reorder/case | The payload behind this key costs **33.4s** to recompute on a dataset above the 50K cap (three 10-page keyset scans), so the two failure modes have very different shapes: a key that's too loose serves numbers for the wrong theme model, and a key that's too tight silently restores the 33s wait on every load while looking like it works. Both are invisible without tests |
| PPTX entity analysis | `entityAnalysis` splitMentions delimiters, `catalogToAggregate` (sort/drop-zero/category rollup/one-quote-per-category), `entitySlideSpecs` slide shape (top-grid + bar + long-tail>24 + quotes) | StoryTime entity slides reuse the stored entity catalog (zero extra AI). The aggregate adapter and slide-spec builder are pure and shared with `/api/entity-analysis-deck`; a regression silently malforms the entity deck or re-introduces per-export AI cost |
| Post-hoc name extractor | `nameExtractor` input gating (≥10 char corpus), JSON-from-AI parsing (markdown-fenced + raw), name validation regex, source/confidence enum normalisation, AI-throw graceful fallback | Closes the "Anonymous in 88% of admin views" gap; the lib is fire-and-forget so silent regressions don't surface — tests cover the deterministic guardrails |
| Probe-focus classifier | `probeFocusClassifier` skip-short-message gating, disabled-focus filtering, NONE handling, hallucinated-slug drop, dedup, mixed-case lowercase match, AI-throw fallback | Runs on every user turn ≥3 words when `probe_focus_enabled` is set; a bad slug filter pollutes the analytics with phantom topics, a missing dedup inflates the topic frequencies |
| Admin usage drill-in | `/api/admin/usage/[type]/[id]` admin-gate, `VALID_TYPES` allowlist, totals + by_event + by_model + daily_trend aggregation, from/to + days range fallback, name/href resolution | The page surfaces per-bot/per-study cost; an aggregation bug shows misleading numbers to admins who use it for billing reconciliation |
| Deck routes | `/api/{pitch,architecture,engineering-reality,rollup}-deck` × {anon, admin} | Confirms each route both calls `requireAdmin` AND emits a real PPTX |
| Survey conversation engine | `useSurveyEngine` driven end-to-end in jsdom — full section walk, clarifier (AI + keyword + SKIP), deflection, verbose commands, kiosk device lock, every custom question type, skip logic, hidden fields; transcript snapshotted | 2,647 lines of imperative DOM collecting respondent data, with no coverage at all until 2026-08-18 (`components/**` isn't even in the coverage `include`). It is only unit-testable through a DOM harness, and the transcript is the one artefact that must not drift when its dependency graph is refactored. Paired with the untracked `scripts/_verify_survey_engine_live.mts`, which drives the REAL client bundle with Playwright against `npm run dev` (TEST) and seeds `Math.random` in the page, so two runs of a study take the same path and the transcript can be diffed across a code change. |
| Public survey endpoint | `/api/respond` happy + missing-field + invalid-JSON + inactive-study + 404 + **two-tier rate keying (Brief D)**: per-(ip,session_id)@20/min + per-IP backstop@600/min keys/limits asserted, two sessions same IP → separate buckets (no venue-NAT cross-throttle), backstop 429s independently, session-less → anon bucket | This endpoint accepts traffic from anywhere — its validation is load-bearing |
| High-traffic chat + study routes | clara/nora/bot/townhall chat (validation + rate-limit) + study/[guid] (404, 403, happy) | These are the most-trafficked public endpoints — validation must reject bad input fast |
| RLS isolation | Cross-org read returns null + every public table has RLS + no `USING(true)` policy outside allowlist (env-gated) | The single biggest multi-tenancy risk |
| Cross-org data egress | Per org-scoped table: Org B cannot read Org A row by id or list scan (env-gated) | Proves policies actually filter, not just that they exist — extends rls-isolation |
| Campaign route egress | Service-role-client campaign-by-id routes (`/export`, `/respondents`) 404 cross-tenant + control 200 owning-org (env-gated) | RLS doesn't apply to service-role queries — this is the safety net for handler-level org_id gates |
| Dataset / org route egress | `datasets/[id]/sync`, `datasets/[id]/auto-setup`, `regulations-sources/download-comments`, `org/logo` DELETE — 404/403 cross-tenant + control owning-org (env-gated) | Same safety net for service-role mutations on datasets and the organizations table |
| Auth flows | Real Supabase signInWithPassword + OTP + reset + admin-createUser invite shape + signOut (env-gated) | Mocking the auth client only proves wrapper code; this proves the round-trip |
| Agent admin-page org gate | `botPageOrgGate` — the service-role agent lookup pairs `id` with `org_id` for non-admins, redirects on a cross-org miss, and stays unconstrained for admins | The admin pages (`/bots/[id]/{history,entities,questions}`) load by guessable UUID via service role; the test pins the multi-tenancy invariant so a refactor can't reintroduce a bare-id cross-tenant read |
| Recordings coverage | `computeCoverage` per-topic counting + zero-count flagging, ≥5-min gap detection (leading/mid/tail + rounding), confidence histogram bucketing/clamp | Pure post-analysis report logic driving the reviewer's flags; deterministic, so cheap to pin against regressions |
| Recordings analyze | `analyzeRecording` Opus-extraction + Sonnet-curator parsing (markdown-fence tolerance, invalid-typology/empty-field drop), flag-merge precedence (curator beats low-confidence), emergent-topic override, two-pass cost (callAI mocked) | The PM-1-critical "audience question vs panel commentary" judgment lives here; the parser must survive garbage model output and the flag-merge must not regress |
| Recordings routes | The recordings API routes — 401 unauth, 403 feature-off, 404 cross-org (id+org_id pairing asserted), and input validation (instructions length, scope enum, duplicate filenames, status filter, document role/PDF + media-refusal §4.1e); Supabase + WDK mocked | Route handlers carry the org/feature gates and were shipped untested; the gate contract is the load-bearing part and must not regress |
| Export org gate | The service-role export routes (`datasets/export/{html,pptx,signals-pptx}`, `townhall/sessions/[id]/export/{pptx,route}`) return 404 when a non-admin requests another org's resource; same-org passes | Exports return an entire org's data; a June-2026 sweep found this class unguarded. The test pins the cross-org 404 so the leak can't reappear |
| E2E download | Login → /api/pitch-deck → pptx (env-gated) | Catches cookie/session breakage that unit tests can't see |
| Saved-view periods | `resolvePeriod`/`resolveComparison` calendar boundaries (month/quarter/year, current/last/specific), half-open `[start,end)`, leap-year self-correction, fiscal-year start, comparison offset; `rankPrimaryDateField` analytical>operational>fill>spread + constant-column drop (incl. name-only ranking when template schemas carry no field stats) | Pure date/ranking logic behind Saved Views (`docs/SAVED_VIEWS.md`) — boundary math and default-date selection are easy to get subtly wrong (off-by-one days, operational-date mispick) and feed every period filter |
| Saved-view comparison | `alignToDate` (§4.1) — full-vs-full for a completed period, equal-elapsed-span clip for an in-progress one, short-month cap; `comparisonDelta` (§4.2) — "—" when prior predates data, "new" on zero base, signed % otherwise | Comparison is the easy place to lie to a user (phantom −90% on day 8, fake −100% to a newer brand, ∞% on zero base) — these pin the guards |
| Saved-view routes | `datasets/[id]/views` + `/[viewId]` — 401/404 cross-org gate, 403 non-creator, id+org_id pairing on mutations, snapshot 30d default TTL, snapshot content-immutability (PATCH accepts only `expires_at`), graceful 404 on missing/deleted; `serializedFiltersEqual` dirty-diff (order-insensitive, Set-aware) | New org-scoped table behind a service-role write path — the gate + id/org_id pairing are the multi-tenancy invariant, and the snapshot immutability/TTL contract must not regress as the UI grows |

## What we deliberately skip

- **Snapshot tests for UI components.** High churn, low signal; they catch design
  changes, not bugs.
- **Exhaustive coverage of `app/api/datasets/*`.** Many routes; the high-leverage
  pieces (rate limiting, RLS, deck gate) are tested separately. Adding tests
  here as bugs are found is fine.
- **AI-provider integration tests.** We mock at the `lib/ai` boundary —
  testing that Anthropic's API works is Anthropic's job.
- **The PPTX exporter for analytics decks.** ~3K lines, low ROI; would require
  fixture management out of proportion to bug-discovery rate.
- **Comprehensive auth-flow e2e.** One golden-path e2e (login → deck) is the
  smoke test; full coverage is Playwright's long-tail and not worth carrying.

## Mocking strategy

Mock at the **module boundary**, not the network:

- `lib/ai` is the wrapper around Anthropic / OpenAI / Azure OpenAI. Tests
  `vi.mock('@/lib/ai', ...)` directly; no MSW needed.
- `lib/supabase/server` is the wrapper around Supabase JS. Tests mock
  `createClient` and `createServiceRoleClient` per-test to inject the
  exact rows / errors the assertion needs.
- `lib/rateLimit` and `lib/contentGuard` are mocked in the `/api/respond`
  test — they're orthogonal to the schema-validation behavior under test.

The service-role key is **never** committed and **never** logged. Tests use
the placeholder string `test-service-role-key`; the `lib/supabase/server`
factory is mocked before any module that calls it is imported.

## Adding a new test

_Pure-logic example: `tests/unit/serviceHealth.test.ts` (added 2026-06-16) covers the service-credit monitor's balance-threshold classification (`statusForBalance`) and out-of-credit detection (`isCreditError`) — see `docs/ENGINEERING.md` §4._

_Pure-logic example: `tests/unit/textmineNav.test.ts` (added 2026-06-25) covers the TextMine two-row-nav state map in `lib/textmineNav.ts` — the `(section,view)⇄(subTab,viewBy)` round-trips, the Comments lens-collapse, the uniform sub-menu, the theme-lock rule, and the `availableSections`/`defaultSection` gating — see ANALYTICS.md "Navigation IA"._

_AGENT_TIERS Phase 3 examples (added 2026-07-14): `tests/unit/callAIStream.test.ts` (raw-SSE parsing against a mocked fetch — text deltas, tool_use `input_json_delta` assembly, byte-split frames, in-stream errors, non-Anthropic fallback), `tests/unit/agentTools.test.ts` (fetch_page host allowlist + redirect re-check, negative-chunk holdout, tool-loop round budget + forced `tool_choice:'none'`), `tests/unit/components/ChatBotStreaming.test.tsx` (jsdom — the widget streams, reconciles to the done event, extracts chips, falls back to JSON, offers Retry on a mid-stream error). The live bar is `scripts/_verify_tool_loop.mts` (untracked KEEP): real Anthropic streaming + a real gnu.org fetch through the loop._

1. Pick the boundary. If you're testing a pure function in `lib/`, write a
   unit test under `tests/unit/`. If you're testing a route handler, write
   an integration test under `tests/integration/` and mock at
   `@/lib/supabase/server` and any other side-effecting modules.
2. Mock with `vi.mock()` **before** the dynamic `import('@/...')` of the
   module under test. Static `import` lines hoist; dynamic imports give
   you mock-ordering control when a mock value depends on `beforeEach`.
3. Assert observable behavior, not implementation. Status codes, response
   shape, and "did the side-effect fire?" — not "was this private helper
   called with these args?".
4. Each test file must run independently. No shared mutable fixtures across
   files.

## Workflow DevKit tests

The recordings pipeline is a Workflow DevKit run (`workflows/recordings.ts`).
For these:

- **Unit-test the steps directly.** Each `"use step"` is just an async
  function — the directive is a no-op without the compiler. Import and
  call them under `tests/unit/recordings/` with mocked Supabase + libs.
- **For workflow-level orchestration tests** (try/catch behavior,
  step ordering, status transitions), wire `@workflow/vitest` in a
  separate integration config when needed — not installed today; the
  per-step unit tests cover the v1 PM-1 milestone.
- **`scripts/pm1-smoke.ts` is the calibration harness, not a unit test.**
  It calls real Claude (Opus + Sonnet, ~$1/run) against a stored PM-1
  transcript fixture and scores extraction quality vs PDF ground truth.
  Run manually; never invoked from CI.

## Env-gated tests

Six suites need real infrastructure and are **skipped** unless the
environment is configured: four Vitest egress/RLS suites, auth-flows, and
one Playwright e2e. All follow the same prefix/cleanup pattern: test rows
carry a unique `_<name>test_<runId>_` marker so partial failures are
findable and deletable by hand. None run in CI — service-role keys do not
belong in GitHub Actions.

### RLS isolation (`tests/integration/rls-isolation.test.ts`)

Self-contained: the test creates its own test orgs / users / study via the
service role, runs the assertions, then deletes everything. All test rows
are prefixed `_rlstest_<runId>_` so partial failures are easy to find and
delete by hand.

Run it:

```bash
npm run test:rls
```

That sets `RLS_TEST=1` and points at whatever `NEXT_PUBLIC_SUPABASE_URL` +
`NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` are in
`.env.local`. Without `RLS_TEST=1` the suite calls `describe.skip` so it's
visible-but-skipped in default test output.

**Pre-launch (no real customers yet)**: pointing this at the production
Supabase is acceptable. The test data is namespaced and cleaned up; the
risk is one stale row if the test crashes mid-run, which is recoverable
by hand via the `_rlstest_` prefix.

**Dedicated test project (decided 2026-07-02: paid Supabase project).**
Until it exists, CI + local isolation runs hit **prod** (the `SUPABASE_TEST_*`
secrets hold prod values) — a real risk: the prod service-role key lives in
GitHub Actions and CI writes `_rlstest_*` rows to prod on every run. To close
it:
1. **Owner:** create the paid Supabase test project in the dashboard; copy its
   Postgres connection URI + anon/service_role keys.
2. Seed its schema from prod (schema-only, no data):
   `TEST_DB_URL='postgresql://…' bash scripts/bootstrap-test-db.sh`
3. Repoint the three `SUPABASE_TEST_*` GitHub secrets (and optionally
   `.env.local`) from prod values to the test project.
4. Re-run the bootstrap after any prod migration to keep schema parity.
Real auth.users rows shouldn't share an instance with paying customers,
regardless of how careful the cleanup is.

### Cross-org data egress (`tests/integration/cross-org-egress.test.ts`)

Where rls-isolation proves "every table has RLS turned on and no policy
is unconditionally `true`," this suite proves the next layer: for each
org-scoped table, the policy actually filters cross-org reads. Seeds one
row per table in Org A; signs in as Org B's anon-key client; asserts no
row leak via either get-by-id or list-by-id scan.

```bash
npm run test:egress
```

Sets `EGRESS_TEST=1`. Same .env.local + pre-launch caveats as RLS. Test
data is prefixed `_egresstest_<runId>_`.

### Auth flows (`tests/integration/auth-flows.test.ts`)

Real Supabase auth round-trips — covers what mocking can't: that
`signInWithPassword` actually mints a JWT that decodes back to the same
user, that `admin.createUser` (the invite-flow path) produces a user who
can immediately sign in, and that `resetPasswordForEmail` / `signInWithOtp`
/ `signOut` wire through. Email-sending paths tolerate
`over_email_send_rate_limit` since the throttler firing isn't a wiring
failure.

```bash
npm run test:auth-flows
```

Sets `AUTH_FLOWS_TEST=1`. Test users prefixed `_authflowtest_<runId>_`
and deleted in afterAll. Test emails use Gmail `+suffix` aliasing on a
mailbox the owner controls (`got2surf2+authflowtest_<runId>_*@gmail.com`)
so that the two paths which actually send mail (`resetPasswordForEmail`,
`signInWithOtp`) deliver instead of NXDOMAIN-bouncing back to the
project's configured sender.

### Campaign route egress (`tests/integration/campaign-routes-egress.test.ts`)

RLS doesn't apply to service-role queries, so handler-level org_id gates
on the `/api/campaigns/[id]/*` family need their own safety net. This
suite mocks `@/lib/supabase/server` to return real signed-in clients
(Org B for `createClient`, service-role for `createServiceRoleClient`),
then drives the route handlers in-process to assert that a cross-org
caller receives 404 and that the owning org receives 200.

```bash
npm run test:campaign-egress
```

Sets `CAMPAIGN_EGRESS_TEST=1`. Test data prefixed `_campaignroute_<runId>_`.

### Dataset / regulations / org route egress (`tests/integration/dataset-routes-egress.test.ts`)

Sister suite to campaign-egress, covering the service-role routes that
mutate datasets, regulations downloads, and org-level state. Locks the
W19-audit "bare-id lookup" pattern on four route handlers:

- `POST /api/datasets/[datasetId]/sync`
- `POST /api/datasets/[datasetId]/auto-setup`
- `POST /api/regulations-sources/download-comments` (batch + finalize)
- `DELETE /api/org/logo`

Each route is asserted to 404/403 for a cross-org caller and to NOT-404
for the owning org (control). The control assertions are loose on
purpose — sync/auto-setup may legitimately 400 on a test study with an
empty config; what matters is that the wrong code path doesn't fire.

```bash
npm run test:dataset-egress
```

Sets `DATASET_EGRESS_TEST=1`. Test data prefixed `_datasetroute_<runId>_`.

### Playwright e2e (`tests/e2e/*.spec.ts`)

**`smoke.spec.ts` — the CI smoke suite (2026-07-13), runs on every push.** Fully
self-contained: `global-setup.ts` mints a throwaway login (`e2e-smoke@sentimetrx.test`
in `e2e-smoke-org` on the TEST project, fresh random password per run — no human
credentials) and seeds a 60-row dataset with schema + themes; `global-teardown.ts`
removes the dataset (org + user persist). Auth is a constructed `sb-*-auth-token`
storageState cookie — one sign-in per run, so repeated logins never trip auth rate
limits. Seeding hard-refuses the prod project ref. CI (`e2e` job) runs it against a
**production build** (`npm run build` + `next start`); locally it reuses a running
dev server. Covers: authed shell (TopNav + breadcrumbs), /analyze listing, the
dataset tab dance **including return visits** (the 2026-07-13 "Schema comes up once
then never again" wedge — invisible to server-side tests), the Schema editor +
"Refresh from data", and the Filters modal. Its first run caught a real infinite
update loop on the Statistics tab (unmemoized `themeSetForField` identity churn).
Without TEST creds every test self-skips; the CI job fails loud instead (same
contract as the isolation job). The deploy job gates on it.

The legacy specs below require an admin login on a running instance:

```bash
E2E_ADMIN_EMAIL=...
E2E_ADMIN_PASSWORD=...
E2E_DATASET_ID=...                   # for saved-views.spec.ts — a dataset the admin can open in /analyze
E2E_BASE_URL=http://localhost:3000   # optional — Playwright will start `npm run dev` if unset
npm run test:e2e
```

When the env vars are not set, each test calls `test.skip(...)` and the
suite reports the reason inline.

- `deck-download.spec.ts` — admin → investor decks → downloads a real pptx.
- `saved-views.spec.ts` — Saved Views (single test on purpose: one login, then everything
  rides that authed context — repeated sign-ins trip auth rate-limiting). Asserts the ViewsBar
  renders on the workspace, then drives a view+snapshot CRUD round-trip through the authed API
  (auth cookie → route → service-role + RLS → linked DB): create/list/rename a view, freeze a
  snapshot (asserts the 30-day default TTL), confirm snapshot content-immutability (PATCH name
  → 400) but retention mutability (PATCH `expires_at` → 200), a clean 404 on a missing item, and
  deletes every row it created (names are `_e2e_*` + timestamp). Mutating verbs set an `Origin`
  header to satisfy the `proxy.ts` CSRF guard (the browser UI sends it automatically). Verified
  green 2026-06-22 against a live dataset.

## Load testing

The k6 suite in `tests/loadtest/` covers the four load-bearing surfaces
(extended 2026-07-04 for the capacity model — measured results and the
re-run policy live in `docs/CAPACITY.md` §3/§7):

- `townhall.k6.js` — k6 hits `/api/townhall/join`, `/api/townhall/chat`,
  and `/api/townhall/responses` as raw HTTP. Tunable via `VUS`,
  `ITERATIONS_PER_VU`, `RAMP_UP_S`. Exercises the per-participant 20/min
  chat cap and the per-IP 600/min backstop. **Real Anthropic spend.**
- `chat-turn.k6.js` — public agent chat: scrapes the agent UUID from
  `/b/{BOT_SLUG}` then loops `POST /api/bots/{id}/chat` (full chatCore
  turn). **Real Anthropic spend** — keep `VUS` modest.
- `survey-submit.k6.js` — public survey ingestion: `GET /s/{SURVEY_GUID}`
  + partial/final `POST /api/respond` per VU (upsert path, MV-refresh
  debounce, 120/min/IP limit). No AI cost — can push high VUS.
- `rows-fetch.k6.js` — authenticated TextMine bulk rows
  (`all=true&sampleMax=50000`); measures payload size + latency. Needs a
  `SUPABASE_AUTH` cookie (how-to in the header comment). No AI cost.
- `townhall.spec.ts` — Playwright drives N real Chromium browsers against
  `/pi/[guid]`, mirroring the actual participant journey (visit, type,
  send via Enter). Catches UI-layer breakage that HTTP-only load can't.
- `playwright.config.ts` — a load-specific Playwright config (separate
  from the e2e config) with no built-in webServer and tunable workers.

Run (always against the TEST project via `npm run dev` — never prod):

```bash
SESSION_ID=<uuid-or-slug> TARGET=http://localhost:3000 npm run loadtest:k6
BOT_SLUG=<slug>     TARGET=http://localhost:3000 k6 run tests/loadtest/chat-turn.k6.js
SURVEY_GUID=<guid>  TARGET=http://localhost:3000 k6 run tests/loadtest/survey-submit.k6.js
DATASET_ID=<uuid> SUPABASE_AUTH='<cookie>' TARGET=http://localhost:3000 \
  k6 run tests/loadtest/rows-fetch.k6.js
SESSION_ID=<uuid-or-slug> TARGET_BASE_URL=http://localhost:3000 BROWSERS=5 \
  npm run loadtest:browsers
```

None run in CI — the AI-path scripts cost real Anthropic spend and all
write real DB rows. The town-hall drivers refuse to start without
`SESSION_ID`, which must be a session you've created and clearly named
(e.g. "Load Test — DO NOT USE").

## Bot regression scripts (Sarina)

The NOWOCATS Sarina agent has a 22-scenario regression script — Arjun's
2026-05-17 test suite encoded as machine-checkable assertions. Same data
backs three runner surfaces:

- `app/admin/sarina-regression/tests.ts` — single source of truth: per
  scenario, `turns[]` (1-3 user turns to send), `mustInclude` regex
  array, `mustNotInclude` regex array, `expectedFromDoc` narrative.
- `app/admin/sarina-regression/` — admin UI button-driven runner.
  Sends each scenario to `/api/bots/[id]/chat` with `debug:true`,
  surfaces per-test reply + transcript + RAG debug + per-pattern
  pass/fail. Re-runnable after any KB or system-prompt change.
- `scripts/sarina-regression-run.ts` — terminal-driven equivalent
  (committed; replaces the older `_run_sarina_regression.ts` local
  variant). Hits any base URL (default https://sentimetrx.com) against
  the same chat endpoint; prints pass/partial/fail per row plus a
  by-category breakdown, and dumps the full JSON to `/tmp/sarina-
  regression-<timestamp>.json`. Usage: `tsx scripts/sarina-regression-
  run.ts <botId> [baseUrl]`. Used as the regression gate for the
  convergence Phase 2 `lib/` extractions (see `docs/CONVERGENCE.md`)
  — captured a baseline against live Sarina at the start of Phase 2;
  each extraction commit re-runs against the same bot and compares
  pass/partial/fail counts to baseline before merging.
- `scripts/oneoff/_generate_sarina_regression_doc.ts` — one-off generator that
  writes a Word doc to `~/Downloads/` comparing Arjun's original log
  with the latest run side-by-side. Uses the `docx` npm package; output
  matches the Calibri 11pt look of Arjun's NOWOCATS handoff doc.
- `scripts/oneoff/_test_sarina_anchor_regression.ts` — focused regression test
  for the anchor-re-ask incident (`bs_mpdjyxz9_lfem0e`, 2026-05-20).
  Walks Sarina through a 13-turn feedback-path conversation that
  crosses the 12-message compression threshold. Verifies neither
  anchor (A1 User Type, A2 Priority Category) is asked twice. Returns
  exit code 1 if either anchor is re-asked — suitable for CI later
  once we have a sandbox bot id (running it against live is fine for
  manual one-offs but costs ~$0.30/run in model calls). Passes after
  the two-layer fix in commit `83daff5` (prompt rule
  ANCHOR-ASKS-ARE-ONE-AND-DONE + chat-route summarizer that preserves
  must-have fields and emits a machine-readable ANSWERED ASKS line).

Neither runner runs in CI — both cost real model calls against the
live bot. Run after any change that touches Sarina's prompt, intents,
guardrails, or knowledge base. Target ~$1–$3 per full pass.

## CI

`.github/workflows/ci.yml` runs typecheck + Vitest on push to `main` and
on every PR. Playwright is not in CI (real Supabase + login + dev server)
— it's a manual local check. README has the badge.

## Tracked test gaps

The weekly audit (`docs/weekly-reports/YYYY-WXX.md`) has flagged
"route handlers and React components remain largely untested" in every
audit from W19 onward. The Tests score has been pinned at 4/10 (15%
weight) by the test-files-to-source-files ratio (~0.044 in W21).

**Queued route-handler test additions (highest leverage)**:

- `/api/respond` — status enum transitions (in_progress → complete),
  partial-save persistence across resumes, retry idempotency. Extends
  `tests/integration/respond.test.ts` or new file.
- `/api/bots/[id]/chat` — input validation (missing session_id,
  oversize message, malformed JSON), rate-limit bucket exhaustion +
  reset, inactive-agent → 404, CORS preflight, session_id regex.
  New `tests/integration/bot-chat-validation.test.ts`. Highest-traffic
  public endpoint.
- `/api/townhall/*` participant routes — `join/[sessionId]` GET+POST
  (bad slug, status-gate, participant-id mint), `live/[sessionId]` GET
  (active-only), `themes/[id]` POST + `themes/custom` POST (input
  shape, content-filter). Covers both legacy `townhall_*` substrate
  and phase-3 `pulseiq_sessions` (via `lib/townHallAdapter.ts`).

Each surfaces 8–15 cases / file, adds a test file (lifts the
file-count ratio), and exercises real route logic (closes the audit's
narrative). Queued in the open-work-queue memory as the highest-ROI
next-session items after the W22 push lands.

### entityCountFailure.test.ts
A FAILED entity count must not read as a measured zero (`count_entity_terms` 57014). Pins: no persist on failure, persist on success, `counts_failed` surfaced, zero-count drop suspended. Verified to fail against the pre-fix code.

### analyzableFieldsKey.test.ts
The `RowsProvider` remount key. The rows API drops `ignore`/`hidden` columns (sql/186), so the payload's shape is a function of the schema; `DatasetShell` keys the provider on this signature to refetch when the carried-column set changes. 9 cases pin both directions: it **must change** on an ignore/hidden flip (else a re-enabled field stays unusable until a page reload), and **must not change** on field reordering, a label/sqt/hierarchyLevel edit, or a fresh array with identical content (else the whole dataset view remounts on every render). Also pins that two columns cannot collide with one.

### opinionPopoverContext.test.tsx — denominator cases (added 2026-08-17)
Five cases pin the word modal's share readout — **which denominator** it is against, and that it renders on its **own line** (`display: block`, no leftover inline `marginLeft`), since a theme name is long enough to wrap a parenthetical mid-phrase. Denominators: the dataset share when there's no theme scope, the **theme** share when there is (10/40 = 25% vs 33% dataset-wide, so the test cannot pass against the old behaviour), reconciliation with the theme card's own count using `pctOfThis` rounding, and a fall-back when the theme count is zero (never divide by zero). Each asserts **both** render sites agree, since header and stats row derive from one memo. Verified to fail against the pre-fix component.

### statsUtils.test.ts — deterministic subsampling (added 2026-08-18)
8 cases on `deterministicSubsample` / `mulberry32`. The load-bearing one is that repeated calls return the **identical** sample: the Statistics module subsamples above its cap inside a `useMemo`, and React may discard and recompute a memo at any time — with the old `Math.random()` shuffle that would have re-drawn the sample and silently changed every statistic on screen. Also pins that it samples rather than slicing, returns exactly `cap` distinct items, is total on degenerate caps, and that the PRNG is reproducible per seed and stays in `[0, 1)`.

