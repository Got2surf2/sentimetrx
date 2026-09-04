# Analytics / TextMine Module

> **Update (2026-06-04).** Recordings was **promoted out of Analyze** into the top-level **Town Hall** product (own nav item + `/recordings/*` routes; gated on `features.recordings` alone). The `/analyze` header Recordings button and the `/analyze/new` source tile were **removed**. Analytics is now the parent feature only for **googleReviews / reddit / substack** (`effectiveFeatures` forces those off when `analyze` is off — recordings is no longer in that set). A Town Hall recording still **mirrors into a `source='recording'` dataset** that lives in Analyze as the analytics view (TextMine/Charts/Stats; `buildRecordingSchema()` incl. the **Sentiment** facet) — reachable from the report's "Open in Analytics" cross-link. The Datanautix PowerPoint export (`POST /api/recordings/[id]/export/pptx`) and the report now live under the Town Hall product (`docs/RECORDINGS.md`).

## Overview

Full-stack text analytics engine. AI-powered theme mining, lexicon-based sentiment scoring, 13+ chart types, statistical hypothesis testing, and consulting-quality PPTX export. Works with any data source: surveys, CSV uploads, Google Reviews, agent conversations, **PulseIQ town halls (both legacy `townhall_*` and new-substrate `pulseiq_sessions`)**, Reddit/Substack/Regulations.gov ingests, and **recorded meeting Q&A** (`source='recording'`; see `docs/RECORDINGS.md`). Each new source type gets a `build<Name>Schema()` in `lib/datasetUtils.ts` that declares the schema_config (fields + `primaryTextField`, and — for relative-period filtering — an optional `primaryDateField`, ranked by `rankPrimaryDateField()`; see `docs/SAVED_VIEWS.md`) so TextMine/themes/stats work without per-dataset configuration; `buildRecordingSchema()` is the latest entrant (2026-05-30).

> **Substrate-aware town-hall sync (2026-05-22, Gap #5)**: `/api/townhall/sessions/[id]/analyze` POST projects both legacy `townhall_turns` AND phase-3 `conversation_turns` (joined through `pulseiq_session_conversations` → `conversations`) into the same `dataset_rows_flat` row shape `{turn_id, participant_id, turn_number, bot_message, user_message, topic, topic_type, source, language, sentiment, sentiment_score, responded_at}`. Town-hall datasets are substrate-agnostic in Ana — TextMine + Stats + Charts + PPTX export don't need to know which substrate produced any given row. Multi-event customers (e.g. Vindman runs N town halls across districts) get one dataset per event; cross-event rollup combines datasets in Analytics. Theme model auto-populated from `pulseiq_topics` (phase-3) or `townhall_themes` (legacy). See `docs/CONVERGENCE.md` § 10 changelog.

> **Bot-level town-hall attribution (2026-05-22, Gap #6)**: `/api/bots/[id]/analyze` row shape gains `town_hall_slug` + `town_hall_name` columns. Populated by joining `conversations` → `pulseiq_session_conversations` → `pulseiq_sessions` for each session_id in the sync batch. Empty string for 1:1 widget conversations (not linked to any town hall). Lets Ana filter a single bot's dataset by town hall — e.g. compare all Vindman events vs widget visitors inside one dataset, without combining per-event datasets. Same field added to `buildBotSchema()`. The per-event-dataset workflow (Gap #5) still works for users who prefer one dataset per event; this just adds the option to operate at bot scope with town-hall filtering.

Dataset cards on `/analyze` carry a **favorite star** (per-user, via the platform-wide `user_favorites` table in migration 075). Starred datasets float to the top of the `/analyze` grid above a thin orange divider, surface in the `★ Favorites` section on `/m` (PWA), and are listed on the desktop `/favorites` cross-resource page. The grid also exposes a **Sort** dropdown (Last updated / Created / Name, persisted in `localStorage.sentimetrx.sort.analyze`) — "Last updated" uses `last_sync_at` when present, falling back to `created_at`. None of this changes any analytics behavior.

---

## TextMine (Theme Detection & Analysis)

### Navigation IA (two-row bar — Target B, 2026-06-25)


**Print-to-PDF fully retired on the Advanced pages (2026-09-02).** The owner:
"for any view with a PDF download that uses print-to-PDF, generate a high
quality PDF — the print version looks tacky." The two remaining print surfaces
— the **Outlet Leaderboard** and the **hierarchy rung view** (Network / Region
/ District roll-up) — now produce real composed documents:
`buildLeaderboardHtml` / `buildHierarchyRungHtml` in `lib/outletReportPdf.ts`
(sharing the deep-dive's `DOC_CSS` visual language + `brandedPdfChrome`),
served by `POST /api/datasets/[id]/outlet-leaderboard-pdf` and
`…/hierarchy-report-pdf` — both POST-the-page's-data (payload contracts +
validators in `lib/outletPdfPayload.ts`), both gated by `outletReportingOn`,
both listed in next.config `outputFileTracingIncludes` (mandatory for
headless-Chrome routes). The leaderboard button lives in the K-slider toolbar
and exports at the K the page currently shows. `PrintButton.tsx` is deleted —
no surface prints anymore. Pixel-QC'd from real TEST data (Cheddar's
leaderboard 7 themes/25 dims; BareBurger Network rung) and both buttons
verified E2E (POST → 200 → download).

**Dimension drills unified into the shared Comments view (2026-09-02).** The
owner-reported inconsistency: a theme click landed in Comments with its
keywords highlighted; a dimension click either opened the Dimensions
Overview's own internal list (a different UI) or landed in Comments with
NOTHING highlighted. Now: ① embedded in TextMine, TaxonomyModule's sub-
dimension cards/chips route to the shared Comments view via `onDrillDimension`
(and the axis-level "Read all comments" adds every sub of the axis as OR'd
facets via `onDrillAxis`) — the same destination the Dimension Clouds/Compare
and theme-card chips already used; severity-alert drills stay internal (they
are severity-scoped, which the Comments filter can't express), as does the
standalone `/analyze/[id]/taxonomy` page (no callbacks). ② `get_rows_by_filters`
returns `dim_evidence` per row (sql/196): the matched assertions' evidence
windows, which `FilteredCommentsPanel` highlights — phrases match WITHOUT word
boundaries because the classifier evidence is a fixed-width window that can cut
mid-word (pinned in tests/unit/filteredCommentsHighlight.test.ts). ③ Fixed on
the way: the Comments dimension-facet loader called `/taxonomy` without the
analyzed `fields=` params, got zero axes back, and the facet picker + active
dimension chips silently never rendered. Verified in-browser on TEST Cheddar's:
sub click → Comments, "300 of 743" matches the card's count, evidence
highlighted per row; axis click → 5 removable facet chips, "300 of 4,184".

**File upload is now a server-side ingest (2026-09-02)** — the browser PUTs the raw file to Storage and `POST /api/datasets/[id]/ingest` parses/loads it in the background with polled progress. Full contract in `docs/DATA_SOURCES.md` (UploadClient section).

**Repeat-open row cache (2026-09-02, PERF §8 follow-up).** The bulk rows
payload (≤50K sample, tens of MB) is cached client-side in IndexedDB
(`lib/rowsCache.ts`) keyed by `row_count : last_synced_at : hash(schemaFields)`
— reopening a dataset hydrates locally with ZERO bulk fetch (verified: 19.7K
rows, repeat open ~3s total page load, no `/rows?all=true` request). Schema is
part of the key because value aliases are baked into the cached rows. Kept to
the 4 most-recent datasets; every IDB failure degrades to a normal fetch.
First-open speed note: parallelizing the sample RPC pages was MEASURED AND
REJECTED (12.7s vs 11.8s serial on a 128K dataset — page cost is DB CPU
building/gzipping ~9MB jsonb per page on 2 shared cores, not round-trips; the
wire is already gzip ~11:1). Don't re-attempt without a bigger compute tier.

TextMine is **four peer sections** in a persistent **two-row bar** — the shared `TextMineNav` (`components/analyze/TextMineNav.tsx`): **row 1 = sections** `[Themes] [Dimensions] [Entities] [Advanced Analytics]`, **row 2 = the active section's views** `Overview · Clouds · Compare · Comments` (uniform across the three lens sections; Advanced shows `Brand Health · Leaderboard · Outlet Deep-Dive`). Replaces the old flat sub-tab strip + the right-aligned "View by Theme/Entity" toggle (the toggle **folded into the Entities section** — picking a section sets the lens). The pure state-map + gates live in `lib/textmineNav.ts` (unit-tested in `tests/unit/textmineNav.test.ts`).
- **Chrome real-estate (2026-06-25).** To keep more of the viewport on data, three rows were collapsed: (1) the shared `DatasetMetricStrip` (records · signals · theme-fit · rating) and `ViewsBar` (saved views / period) now render in **one row** in `DatasetShell` — both accept an `embedded` prop that drops their own bar wrapper; this benefits *every* analyze tab. (2) The multi-text-field picker ("Review / Owner Response", shown only when a dataset has >1 open-ended column) **moved off its standalone bar onto the views-nav row** via `TextMineNav`'s `viewsExtra` right-slot. (3) The two nav rows were tightened (row 1 36px, row 2 32px). (4) The **Themes Compare** (`CompareTab`) header — previously a big "Group Comparison" h2 + ★ legend + paragraph + a bordered control *card* — was collapsed to the same single compact top-bar the Dimensions/Entities compares use (legend folded into the "?" hint), so all three Compare views are the same height.

- **`section`/`view` are the canonical state**; the legacy `subTab ∈ {themes,clouds,compare,comments,dimensions}` × `viewBy ∈ {theme,entity}` the content renderers key off are **derived** via the pure `deriveLegacy(section, view)`. This is required because `(subTab, viewBy)` can't represent the full grid — Dimensions×Clouds/Compare have no subTab encoding, and Dimensions vs Themes Comments both collapse to `subTab='comments'`. `sectionOf`/`viewOf` survive only for the sessionStorage back-compat map.
- **The cells** (re-keyed onto `(section, view)`): Themes×{Overview=Themes view, Clouds=Theme Clouds, Compare=`CompareTab`, Comments=unified panel}; Entities×{Overview=stat strip + `EntitiesCard`, Clouds=`EntityCloud`, Compare=`EntityCompareTab`, Comments}; Dimensions×{Overview=`<TaxonomyModule>`, Clouds=`DimensionCloud` (one flowing cloud of sub-buckets sized by mentions, colored by axis, with axis filter-chips + show-all — same card/sticky-header chrome as `EntityCloud`), Compare=`DimensionCompareTab` (same bar-chart UX as `CompareTab`/`EntityCompareTab`: a left-aligned "Break down by:" field selector + an axis selector → By Group / By Dimension horizontal-bar cards with over/under-index ★ markers, sort-by-impact, show-all; **two levels** — the default **"All" axis** compares the seven top-level axes against the field via the `tax_axis_crosstab` op (sql/133 `taxonomy_axis_crosstab` RPC = one scan UNION-ing the seven axis arrays; clicking a dimension drills into it), and a **single axis** compares that axis's level-2 sub-buckets via `tax_crosstab` (clicking a bar opens Comments). Bars not a matrix; no rating metric since the crosstabs carry counts only), Comments}. All three lens Clouds + Compare share one loader treatment (centered `LottieLoader size=120` on initial load, `64` transient overlay) so the views read identically. The section highlight is always correct because `section` is explicit, not inferred from `subTab='comments'`. `cellHasContent` is the single gate that swaps a not-yet-built cell for a centered "Go to Overview" placeholder — **every lens cell has a renderer today**, so it's a safety net only.
- **Advanced Analytics is a peer section, folded under the same bar.** Its three server pages (`/analyze/[id]/{improvement-plan,outlet-leaderboard,outlet-report}`) render `AnalyticsNav`, which now renders the shared `TextMineNav`: row 1 = the four sections (Advanced active; the lens sections deep-link back to `/textmine?section=…&view=overview`), row 2 = the three Advanced views. The old "← TextMine" back link is gone. `AnalyticsNav` passes only strings + the page's `action` as children (no server→client function props).
- **Section switch from Comments lands on Overview (2026-06-30 fix).** `selectSection` preserves the current view across a section switch — EXCEPT the **Comments** view, which renders the same comment list across every lens (it only differs once you select an entity/dimension facet). Preserving it made switching INTO a section while on Comments read as "nothing happened" (the owner's repro: on the Comments view of a themed+entity dataset, clicking **Entities** kept the identical comment list). Now entering any section from Comments lands on that section's **Overview** — its home, where the entity cloud/list (and dimensions grid) actually render.
- **Section gates** are the single source of truth in `availableSections({datasetSource, taxonomyEnabled, hasEntities, outletCount})`: Themes always; Dimensions when `google_reviews || taxonomyEnabled`; Entities when the entity catalog is non-empty; Advanced when `google_reviews && outletCount≥5`. The bar maps over it, and a guard effect resets to `defaultSection` (Themes) if the active section becomes unavailable (e.g. an empty entity catalog after async load). The `hasEntities` flag is **server-prefetched** (`initialHasEntities` — a non-hidden `entity_catalog` count for the scope, computed in `textmine/page.tsx` alongside `outletCount`) and seeds the gate **only while** the client catalog fetch is in flight, so the Entities pill is present on first paint instead of popping in; once the live catalog loads it governs (a scope whose entities match no rows live still drops the pill, unchanged). A view is **locked** (needs a theme model) when its underlying subTab is clouds/compare/comments and no themes exist — so Dimensions Clouds/Compare (subTab stays `dimensions`) are never theme-locked.
- **State & URL:** section/view round-trips through **`?section=&view=` URL params** (shallow `history.pushState`, shareable + back/forward via a `popstate` listener); `sessionStorage` persists `section`/`view` (back-compat-mapping older saved `subTab`/`viewBy`) as the last-used default. URL wins over the restore on load. In-content drills (theme/entity/dimension chips) jump to Comments **within the current section** and remember the prior view for the back button; they don't rewrite the URL (the highlight stays correct since it reads `section`/`view` directly, and drill filters aren't URL-encoded).

### Core Features (4 lens views)

**1. Themes**
- AI-mined or library-selected themes with keyword matching
- Each theme: name, description, keywords[], sentiment, count, percentage, confidence interval
- Each theme card shows **both a ★ avg-rating badge (colour-ramped) AND the sentiment badge** (was either/or behind the colorMode toggle — `theme.avgRating`/`ratingDelta` come from `recountThemes(..., ratingField)`)
- Per-keyword rating breakdowns (which keywords drive higher/lower scores)
- Dual color mode: sentiment gradient vs rating gradient
- Sampling control with 95% confidence margin-of-error display
- Breakdown by any categorical field (by group / by theme views)
- The scope-wide **Entities** card is **not** hosted here — it lives on the dedicated **Entities** section (Entities×Overview; see Entity Discovery below). The Themes view no longer duplicates it.

**2. Theme Clouds**
- One word cloud per theme — the words that appear most often inside that theme's matched comments
- Each theme's header carries a **★ avg-rating badge** (green/red vs the dataset overall, via `ratingDelta`)
- **Two different denominators, deliberately (2026-08-14).** The badge on the left of each row is the theme's share of **all substantive comments** ("10% of people raise Food Quality"); the percentage on each **term** is its share of **that theme's own comments** ("and 27% of them say *overcooked*"). Both numerators are **comment** counts, not occurrence counts — the keyword scan adds 1 per matching row and the general-word pass de-dupes within a row — so each is a like-for-like share, and the term figure reconciles against the "View 1,962 comments" button sitting next to it. Terms previously divided by the corpus total, which made them useless as contrast: a term inside a 9% theme mathematically cannot exceed 9% of everything, so real contributors rendered a flat **0%** (*expensive*, *portion size*, *value* all read 0% under Pricing). Verified against the database on the 128,619-row Outback dataset: *overcooked* 528 substantive comments / 1,962 = 27%, *price* 331 / 1,724 = 19%, *forgot* 292 / 784 = 37% — each matching the rendered chip exactly (the raw match counts are higher; the gap is one-word non-answers like "Overcooked", correctly dropped by the substantive lens).
  - The **3%-hide threshold uses the same denominator as the number on the chip** — if it kept using the corpus total, the "+N below 3% hidden" note would be describing a percentage the user can't see. The note now reads "below 3% of this theme hidden".
  - The **flat (ungrouped) cloud keeps the corpus denominator**: it mixes terms from every theme plus non-theme words under one heading, so the shared corpus total is the only scale every chip can be compared on. `themeTotal` is passed only by the grouped view.
  - The share is **clamped to 100%** defensively and **suppressed entirely on the synthetic placeholder chip** (the borrowed-`freq` entry pushed for a theme whose comments matched no keyword strictly enough to count) — it would otherwise render a meaningless flat 100%.
- Each theme also gets an **"Items" chip row** (on both the **Theme Clouds** and the **Theme Cards** — "Items mentioned") — the named entities reviewers mention *within that theme's matched comments* ("when they talk about steak, what items?" → ribeye 45 / filet 30 / …). The theme×entity cross-tab lives in **`lib/themeEntities.computeThemeEntities`** (shared by `WordCloud` and `TextMineModule` so the two views never diverge): one pass over the filtered rows matching entities (combined `expandEntityTerms` regex) against precompiled per-theme keyword regexes (`buildKwRegex`), crediting each entity to every matching theme, keyed by theme id. Top 6–8 per theme, count ≥ 2, category-dot colored to match the Entities card. Filter-aware; renders only for themes that have entity mentions.
- Useful for spotting the exact language people use within a theme
- On datasets with **Dimensions** enabled (`datasetSource==='google_reviews' || taxonomyEnabled`), each theme card **and Theme Cloud** also shows a **"Dimensions" chip row** — the top taxonomy sub-buckets (across all 7 axes) carried by the reviews that match the theme ("when people talk about *steak*, which Dimensions do they discuss?" → product·steak 1044 / touchpoint·server 418 / attribute·flavor 339 / …). This is the classification-side analog of "Items mentioned": computed **server-side** by the `theme_dimension_counts(dataset, fields, keywords)` RPC (regex match like `count_theme_matches` → read the matched rows' embedded `data._tx` axes, sql/151), requested by `fetchServerThemeCounts` via the `theme-counts` route's `dimensions` flag and summed across member datasets for collections. Top 6–8 per theme, axis-dot colored; renders only for themes whose matched rows carry tags (so an unclassified dataset shows nothing). Both the card and cloud chips are **drillable** into the Comments filter.

**2a. Context view (word + theme modals, 2026-08-13)**
- Clicking a cloud word opens the word modal (`OpinionPopover`); clicking a theme title opens the theme modal (`ThemePopover`). Both carry a **Context** tab — *"what is this term actually talked about with?"* — the legacy Ana right-click Context view, ported to a tab so it's reachable on touch and sits alongside Comments/Insights.
- Distinct from the **Opinions** tab, which keeps only sentiment-lexicon words within a ±2-token window. Context keeps **every content word sharing a sentence** with the target, which is what surfaces polarity-free nouns ("quality", "portions", "notch") that carry the actual subject matter.
- **Counting unit is the comment, not the token** — deliberately, so the number on a context word equals the number of comments the drill-down returns. Clicking a context word switches to the comments list scoped to the pair, aspect word highlighted amber and context word blue, with a clearable chip. `filterCooccurringRows` applies the identical sentence rule that produced the count, so chip and drill-down can't disagree.
- Two rankings via a toggle: **Frequency** (legacy parity) and **Distinctive** (G² log-likelihood vs the corpus baseline, so words that are common everywhere in the dataset are demoted). G² over-rewards exclusivity on small selections, so the distinctive ranking is floored at 3 comments (or 2% of the target's comments, whichever is larger), falling back to the unfloored list only when the floor would empty the tab.
- In the **theme** modal a context word narrows the **sample comments only** — never `matchedRows` — so the theme's headline mention count and % keep meaning one thing regardless of what's been clicked.
- `lib/collocations.ts` runs two passes shaped by the 50K client-side row cap: pass 1 tokenizes only rows that mention a target; pass 2 scans every row for just the ~150 candidate words pass 1 surfaced, so it never tokenizes the whole corpus. Measured ~310ms per target over 18.6K comments; the tab defers compute one tick past mount and shows the Lottie loader rather than freezing mid-switch.
- **Tokenization is Context-specific** (`contextTokens`, 2026-08-13). `trendingWords.tokenize` keeps contractions whole while its stop list carries only the uncontracted forms, so `we're`/`it's`/`they're`/`that's` topped the cloud on spoken corpora; the enclitic is now stripped and the base re-tested, which also folds possessives (`sarah's` → `sarah`). The extra function-word stop set is **deliberately narrower than WordCloud's** — the cloud drops *good/great/new/time/day*, but those are the ANSWER for a collocate ("what is food talked about with?" → good/great/delicious). Both passes and `filterCooccurringRows` share the helper, so the chip count and its drill-down can't diverge on normalization.
- Supersedes the unwired `trendingWords.contextTermsFor` (whole-comment scoped, token-counted, no drill-down).
- **Related concepts (2026-09-03, `lib/contextConcepts`).** The tab now LEADS with the
  structures the platform already computed for the target's comment set — **themes**
  (whole-comment membership via `commentMatchesTheme`), **dimensions** (read from the
  per-row `_tx` verdicts stamped at classify time — never recomputed), and **entities**
  (catalog terms matched over the subset text) — with the raw word cloud demoted below.
  Everything runs over the target's subset only (the never-re-tokenize-the-corpus perf
  rule); counts are whole-comment with a floor of 3 (the G² floor's spirit — 1-2
  comments is an anecdote); chips are informational with explanatory tooltips, no drill,
  so the chip-count == drill-count invariant cannot be violated. The theme modal's own
  theme is excluded from its concepts. Threaded as `conceptThemes`/`conceptEntities`
  through both popovers from TextMineModule's model + entity catalog.

**Theme counts are substantive-only on BOTH sides (2026-08-18).** `recountThemes`
(`lib/themeUtils.ts`), the client recount that runs once the rows land, used to
count matches over all **non-empty** text while the card divided by the
**substantive** base — numerator and denominator from different populations, so a
theme could be credited with hits inside comments the base excludes. The client
recount always won, because it runs after the server counts arrive and overwrites
them. It now gates on `isSubstantiveText`, per FIELD, matching the stored SQL map
(`substantive ? fld`, any field) rather than testing the joined text — otherwise
two short answers would add up to a passing word count.

Verified against the database on three TEST datasets: the JS gate selects
**exactly** the rows the server's `theme_counts_substantive` (sql/181) is computed
over — 19,708/19,708, 19,133/19,133 and 27,234/27,234 agreeing, zero divergence
either way. That parity is the point: sql/178 stores the verdict per comment
precisely so JS and SQL cannot drift, and the client is now reading the same
population.

⚠️ **Numbers move, and the old ones were wrong.** On review datasets the shift is
small (Cheddar's Food Quality 4,455 → 4,275, 39% → 37%). On **survey** datasets,
where short answers are common, it is large: on Carrabba's GSS, Food Quality read
**89%** (8,393 matches over a 9,482 substantive base) and now reads **58%**
(5,521); Service Excellence 83% → 59%. The old figure was inflated by counting
one- and two-word answers that the denominator never included. Anything exported
before 2026-08-18 will not reconcile against the current cards — same class of
one-way move as sql/191.

**Every displayed verbatim is premise-checked (2026-08-18).** A quote is
evidence, so it must carry the claim above it. `lib/verbatimGuard` gates every
polarity-premised quote surface — the outlet weakness/strength cards, the
snapshot's "What guests consistently praise" block, the per-outlet Dimensions
evidence, and the three deck builders' quote slides. **A rating selects the
REVIEW; the premise is a property of the TEXT DISPLAYED** — a 1–3★ review whose
first sentence is "I got seated fast!" is correctly selected and wrongly quoted.
Where the whole review is available the guard picks the strongest *supporting*
sentence rather than filtering the tile away, so surfaces stay full as well as
on-message. Full rationale in ENGINEERING.md.

**Dimensions on the per-outlet report (2026-08-18).** `computeOutletReport` has
always produced `selected.dimensions: ComparisonBlock`, and until now the only
thing that read it was the narrative sentence — the chain-wide Leaderboard showed
Dimensions beside Themes, the per-outlet report showed themes only. It is now
rendered by `OutletDimensionsView`.

**Form.** The data is a *signed distance from the network average* per dimension,
so it is a **diverging bar centred on that average**: position carries the sign,
length the size, and both arms share one scale — independently-scaled arms would
make a +4 look like a −40.

**Placement (owner call, 2026-08-18).** It has its **own titled card and is
PRINTED** — page 3 of the export, after the snapshot and the AI action plan
(`print:break-before-page`). It first shipped inside the screen-only "Deeper
analysis" block, which was defensible on IA grounds (that block is the
peer-relative bucket) but made the sharpest per-location read on the page the
least visible thing on it, and kept it out of the client deliverable entirely. It
still stays **out of the snapshot card**: that block is deliberately **absolute**
(GM-facing "how am I doing"), this is **relative to the network** — a titled
section of its own keeps that distinction legible instead of folding the two
together.

**Colour.** Diverging = two poles + neutral midpoint: **teal-600 `#0d9488`**
(ahead) ↔ **rose-600 `#e11d48`** (behind), gray centre rule. Validated with the
dataviz palette checker against this page's white surface — CVD ΔE 10.2 (deutan),
normal-vision 32.4, both ≥ 3:1 contrast, all PASS. ⚠️ **The obvious
emerald-600/rose-600 pair FAILS at ΔE 5.8**, below the 6 floor — the classic
green/red collapse. Don't "restore" it. Identity is never colour-alone anyway:
the side of the centre rule, the signed tip value and the legend each carry it.

⚠️ **A quote is presented as "a review mentioning each", never as proof of the
sentiment.** The classifier's `evidence` is a *fixed-width window*
(`extractSentence`, `lib/outletReport.ts`), so the sentence around it does not
reliably read as the polarity — a ▼ weakness was quoting *"Forgot how delicious
the food is"*. Two guards followed: `extractSentence` gained a `requireEvidence`
mode (used only by `buildDeltas`) that returns null rather than the review's
first sentence when the phrase can't be located, **and** rejects a quote that
`clamp` truncated before reaching its own evidence. The remaining mismatch is
evidence granularity, not rendering, so the UI stopped claiming otherwise.

**Net rates are signed.** `outletNet` is (positive − negative) / total and goes
below zero; it renders as e.g. `−100% net`, never `−100% positive`.

**Outlet reporting is an explicit capability (2026-08-18).** Until now the
Leaderboard and Outlet Deep-Dive appeared automatically for any `google_reviews`
dataset with ≥5 locations — no enable, no way to switch them off, and no route
by which any other dataset could ever get them. They are now gated on **two
independent conditions, both required**:

1. **Enabled** — the org `outletReporting` feature OR the dataset's
   `schema_config.outletReporting` toggle (Schema tab). One helper,
   `outletReportingOn(features, schema)`, is the single answer; the TextMine
   "Advanced Analytics" pill and both `/outlet-*` routes all call it. A hidden
   pill that still leaves the URL reachable is not a gate, so the routes enforce
   it too (they previously had no check of their own and relied on the layout's
   `features.analyze` redirect).
2. **The data supports it** — still `google_reviews` + ≥5 locations, because
   outlet identity comes from `review_source_locations`. This is the clause that
   widens when outlets can be derived from a schema-designated location column;
   the enable above does not change.

**"Location" and "hierarchy level" are one marker.** `locationField()`
(`lib/hierarchy.ts`) returns the **deepest** designated `hierarchyLevel` — a
client with Region → District → Store has three rungs and the Store is the
location; a client with a single `Site` column designates one rung and that IS
the location. Deliberately derived rather than stored as a second `isLocation`
flag, so there is exactly one answer to "which column identifies an outlet" —
the same reasoning that keeps the tree derived from the data rather than an
org-structure table. The Schema tab leads with **Location** and presents the
hierarchy as the optional elaboration above it.

✅ **Grandfathering — DONE.** Deploying the gate without a backfill would have
REMOVED these surfaces from every brand that had them.
`scripts/backfill-outlet-reporting.mts` sets the per-dataset toggle on exactly the
datasets that qualified under the old rule (idempotent, dry-run by default,
`--prod --apply` for production). **Applied to TEST (11 datasets) and PRODUCTION
(12 datasets) on 2026-08-18**, then re-run to confirm idempotency (12 already
enabled, 0 written) and read back independently: 12 prod datasets carry the flag,
all `google_reviews`/active, and nothing outside the qualifying set was touched.
Prod list: BareBurger · Capital Grille (+demo) · Ruth's Chris · Zuma · Flemings
demo · Eddie V's · Tabla · Nobu · Cheddar's · US National Park · Rubio's.

⭐ **Admin-org feature grants were three hand-written literals, two of them
already stale.** `resolveOrg` granted admin orgs every module *including*
`taxonomy`; `getUserContext` granted a list that was *missing* `taxonomy`. So an
admin org got Dimensions on pages reading features through `resolveOrg` and not
on pages using `getUserContext` — a nav pill and the route behind it could
disagree. Both now call `allModulesOn()`, derived from `MODULE_KEYS`, so a new
feature key cannot silently miss one path again.

**Signals, the signal ratio, and the coverage trio (owner, 2026-09-03)**

Three metrics settled by definition, after "signals" had drifted into meaning two
different things in two places.

- **A signal is one theme carried by one comment.** A comment matching three
  themes contributes three signals. The dataset total (`SignalStats.signals`) is
  therefore the sum of the per-theme counts, and `signals >= inThemes` whenever
  any comment is multi-theme.
- **Signal ratio = total signals / total comments** — the average number of
  themes a comment carries. Ranges ~0.5 (thin, off-model corpora) to ~2.9 on
  dense review text; a 5.8 was measured on a rich town-hall transcript.
- **Coverage trio: total rows -> carry a comment -> that comment is
  substantive.** Substantive stays the existing text rule (`isSubstantiveText`:
  ≥5 words, or 4 with a function word) and is deliberately NOT "has ≥1 signal" —
  gating it on theme matching would collapse Theme fit to 100% by construction
  and move every substantive denominator a second time (they already moved once
  on 2026-08-18).

Two invariants hold this together:

1. **Signals are counted on the SUBSTANTIVE base** (`p_substantive_only`, sql/181),
   the same gate `theme-counts`' `themeMatchCount` uses. This is not cosmetic: the
   theme cards display those per-theme counts, so a signals total counted on any
   other base would publish a second denominator for the same data. Verified
   exactly (strip total == sum of per-theme counts) on 12 datasets including 4
   brand collections.
2. **An unmeasured tier is dropped, never rendered as a zero or a 100%.** Because
   signals ride the substantive base, a dataset whose `substantive` flag was never
   stamped reports zero signals for the same reason it reports zero substantive
   comments — nothing was measured. The strip suppresses the whole signals span
   there rather than printing "0 signals · 0.00 per comment", which is the same
   verdict-on-unmeasured-data trap as the 2026-08-13 guard below. Tier 1 is
   likewise dropped when `datasets.row_count` is stale (below the measured comment
   count), and the ratio is `null`, never `0.0`, when there is no base.

**Not to be confused with `snippetCount`.** The 2026-05-12 vocabulary used
"signal" and "snippet" interchangeably; they were settled apart here. Snippets are
KEYWORD OCCURRENCES ("slow" 3x in one comment = 3), computed client-side in
`recountThemes` and shown only on the theme cards. Signals count THEMES. The Data
Story's `signalsPerComment` was dividing snippets and now divides signals.

**Where they surface.** The metric strip leads every /analyze/[id] tab with
`N comments · X% of R wrote, Y% substantive · S signals · r per comment`. The Data
Story carries the same ladder as tiles plus a signals total, with each share
naming its base (`82% of the 1,000 analyzed`) so a sampled story can't be read
against the full row count. The **listing cards deliberately do not** carry
signals or the substantive tier: those need the 1-4s-when-cold `signal-stats`
compute, which on a listing is one cold compute per card (and has already hit the
DB statement timeout in production on a single 27K-row dataset). Cards keep the
two tiers that come free with cached analytics — rows and how many carry a comment.
`STATS_MODEL_VERSION` = 4; v3 entries hold the old ungated signals total and
recompute once on next read.

**Metric strip — unstamped `substantive` guard (2026-08-13)**
- The strip leads with the SUBSTANTIVE comment count (`sql/178/179`). A dataset ingested outside the stamping path (a direct-write script, a legacy import) has the flag unstamped, which counts as **zero** — and the strip used to render that as *"0 comments · 0% of 49,033 answered · Theme fit Diffuse 0%"*, a damning verdict on data that had simply never been scored, flatly contradicting the theme cards below counting the same rows in the thousands.
- `DatasetMetricStrip` now guards on the DATA as well as the cache shape: when `substantiveRecords === 0` it falls back to the all-based `records`/`inThemes`/`themeFitPct`, **suppresses the "% of N answered" share** (rendering it off the fallback would claim 100% off a measurement never taken), and swaps the tooltip. `DatasetAboutPopover` suppresses its per-field "N substantive" clause under the same condition. Neither asserts "not scored" nor "zero substantive" — they fall back to the count they can defend.
- Remedy for the underlying data is the untracked `scripts/_backfill-substantive.mts` (`--only <id>`, idempotent, TEST by default); the stats are cached on theme-hash + row count, **neither of which the backfill changes**, so drop the `signal_stats` keys from `dataset_state.analytics` afterwards or the strip keeps serving the stale zero.

**3. Compare**
- Cross-group analysis by a categorical breakdown field (region, channel, age bracket, etc.)
- Stacked bar distributions, by-group / by-theme views
- **Bar-metric toggle (% ↔ ★ Rating):** when the dataset has a rating field, a toggle switches the bars between **theme/mention share** (relative to the largest segment) and **average rating** (absolute, scaled to the rating field's max; bar colored on a red→green ramp so a low-rated segment reads at a glance). The right-hand columns (%, n, ★ rating) stay visible in both modes — only the bar's encoded metric changes. Present on both the **theme** Compare (`CompareTab`) and **entity** Compare (`EntityCompareTab`). Falls back to share when no rating field exists.
- **Segment-level avg rating in the By-Group card header.** Each By-Group card header (e.g. per outlet) shows the segment's **overall** average rating (`★ 4.5`) next to the "N% of dataset · M responses" label — distinct from the per-row theme/entity ratings inside the card. It's colored green/red vs the dataset-overall average (`compStats.overallRatAvg`) so high/low-rated locations read at a glance, with a tooltip carrying the exact value + delta. `CompareTab` (themes) and `EntityCompareTab` (entities) only; `DimensionCompareTab` omits it (the crosstab carries counts, no rating). Driven by the per-segment `groupRating` already computed for the rating sort.
- Two-proportion z-test flags groups whose theme mix differs meaningfully from the baseline
- **By-Group segment ordering + nominal-N collapse.** In the "By Group" view (one card per breakdown segment — e.g. each outlet), a **Sort** dropdown orders the cards: **Responses (high→low)** is the default so data-rich segments lead, plus **Name (A→Z)** and (where a rating field exists) **Avg rating (low→high)** to surface the worst segments first. Segments with **< 30 responses** are collapsed behind a *"Show all N segments (M with < 30 responses)"* expander so a tail of nominal-N outlets doesn't bury the meaningful ones (the collapse is skipped when *every* segment is nominal, and never applies to the canonical signal-tier ordering). Consistent across all three Compare views — `CompareTab` (themes), `EntityCompareTab` (entities), `DimensionCompareTab` (dimensions; threshold reads mentions, no rating sort since the crosstab carries counts only). The dropdown is the By-Group control; "Smart Axes"/"Sort by impact" remains the By-Theme/By-Entity/By-Sub control (it orders the unit rows, not the segment cards).
- **Breakdown-field list is filtered for Google Reviews.** The shared `catFields` (the "Break down by:" options across Compare *and* the Overview breakdown selector) drops per-review noise fields on `google_reviews` datasets — `author` (one reviewer ≈ a handful of reviews, so every group is n≈4), `review_id`, `place_id`, `owner_response`, `location_address` — leaving only fields that actually segment the data (rating, outlet/location, city, state). Single denylist in `TextMineModule` (`GREVIEW_NOISE_FIELDS`), gated on source; other dataset types keep every categorical field.
- Welch t-test for rating significance across groups
- (Crosstab is a chart type in the Charts module, not a TextMine view.)

**4. Comments**
- Collapsible inline **search** at the top of the tab (a "🔍 Search comments" toggle that expands the panel, closeable). Scoped, client-side `CommentSearchPanel`: it searches **only the rows currently in view (the filtered set) × the active open-ended field(s)** — so it respects the current filters, the field selection, and the schema (turned-off / non-open-ended fields are never searched). Instant, no fetch. (This is deliberately NOT the dataset-wide `SearchPanel` + `/search` FTS endpoint, which matches every field of every row regardless of view; that still powers the dataset-header search modal.)
- **Unified filter bar (Themes + Entities + Dimensions), AND-combined.** Three facet rows let you stack any mix of selected **themes** (the multi-select strip), **entities** (a "+ Entity" picker from the scope's catalog), and **dimensions** (a "+ Dimension" picker grouped by axis, on Dimensions-enabled datasets). Comments must match ALL active facets (AND across facets; OR within a facet). Selecting any entity or dimension switches the results to a **server-filtered** panel (`FilteredCommentsPanel`) backed by `POST /api/datasets/[id]/comments` → `get_rows_by_filters` (sql/113): theme/entity matching reuses the `get_rows_by_entity` FTS prefilter + open-ended recheck, dimension matching tests the embedded `data._tx` axis arrays (sql/151; so it scales past the 50K client cap and handles collections via member datasets). Returns up to 300 rows + a window-count total; the panel sorts/grids/infinite-scrolls client-side and highlights the active theme keywords + entity terms. **CommentsPanel-parity port (2026-09-04):** the server-filtered panel now carries the two rich-panel features it lacked — (1) **per-theme colored highlights**: each selected theme's keywords mark in that theme's palette (`kwPalettes`, lowercased keyword → THEME_PALETTE entry, with a singular/plural fallback so expandEntityTerms variants keep their color) while entity terms and dimension evidence stay amber; (2) an **AI Summary** header button (platform-key era — no BYO key gate; enabled when the header AI toggle is on) that summarizes an even ≤60-row sample of the FILTERED set via the mine-themes summary field, rendered as a dismissible strip naming the active filters. **Themes alone** (no entity/dimension) keep the richer client-side `CommentsPanel` (signal tier, per-card theme chips); retiring it in favor of the unified panel is the remaining (deferred) half of the merge. **Every count pill drills into the filter:** clicking an entity (Entities card / Entity cloud / a theme card or Theme-cloud **Items mentioned** chip), a theme card's **Co-occurs** pill (→ that theme), or a **Dimensions chip** (theme card *and* Theme Cloud) adds it to the corresponding facet and opens the tab pre-filtered. On the theme cards the Items/Dimensions chips also select their parent theme (→ theme ∧ entity / theme ∧ dimension); in the clouds they drill the entity/dimension alone.
- Paginated comment browser with keyword highlighting
- Filter by theme, sentiment, or custom criteria
- Clause-boundary highlight expansion (not just the keyword, but surrounding context)
- Entity highlights expand to plural/singular variants (`lib/entityVariants.ts`)
  so "Brussels Sprout" matches when the canonical is "Brussels Sprouts", and
  irregulars (geese/goose, leaves/leaf) are caught via `lib/lemmas.ts`

---

## Theme Mining (AI-Powered)

### API: `POST /api/datasets/[datasetId]/mine-themes`
- Uses Claude to extract 4-7 distinct themes with 8-15 keywords each
- Keywords must be corpus-literal (the prompt says so explicitly): single distinctive
  words respondents actually wrote, informal variants, 2-3 word phrases only where a
  single word is ambiguous
- Input: caller-supplied `texts[]` + field name + schema context (no hard cap;
  the calling page picks the sample) + optional `sampleNote` (consensus mining
  passes the stratified sample's composition so the AI doesn't collapse a mixed
  sample into its dominant tone; when both satisfied and dissatisfied voices
  appear, at least one theme per side is required)
- **Stratified + consensus mining (2026-09-03, `lib/consensusMining`).** A single
  mine is one draw of a stochastic process — measured failure on EA Football: a
  350-review sample whose own summary said "overwhelmingly negative" lost the
  corpus's positive theme (~half the reviews recommend the game). Every AI mine
  from `TextMineModule` (single and first-open sequential) now runs
  `mineWithConsensus`: K=3 mine-themes calls **in parallel** on **disjoint
  stratified samples** (proportional allocation over rating-bucket × time-quartile
  strata; rating buckets are raw values when ≤6 distinct, else low/mid/high
  thirds; deterministic — same corpus → same samples). Themes are matched across
  runs by the STRONGEST of three scaled signals (matcher-equivalent keyword
  Jaccard > 0.8×description-token overlap > 0.7×name-token overlap — a weighted
  average dilutes a decisive signal; measured: keyword+name alone scored two
  crash themes 0.14 and dropped a 3/3-stable theme); only themes recurring in
  ≥2 runs survive. Merged theme: medoid name/description, keywords by cross-run
  votes (union, cap 15), sentiment by majority. Each theme carries
  `stability { support, runs, kwAgreement }` (theme-card badge "✓ 2/3 runs");
  the model carries `consensus { runs, kept, dropped, minSupport }` and the
  summary appends "Validated by consensus: X of Y candidate themes were stable
  across K independent stratified samples." Falls back to one classic
  `evenSample` mine when the corpus can't support K disjoint runs of ≥30
  (or the user's sample slider covers most of the corpus); failed runs degrade
  gracefully (consensus over the survivors; 1 survivor → classic behavior).
  Route `timeoutMs` on the main call is 100s (at 60s exactly one of the three
  parallel calls timed out in three consecutive generations) and `maxDuration`
  is 300. `foodService` is decided by majority across runs. Tests:
  `tests/unit/consensusMining.test.ts`. Caveat (stated): consensus stabilizes
  STRUCTURE, not truth — stratification protects representativeness, consensus
  kills run noise; both halves are required.
- **Substantive-only corpus (2026-07-14).** `TextMineModule.prepareCorpus` filters the
  mining texts with `scoreUsefulness` (`lib/usefulness.ts` v1 = `isSubstantiveText`:
  ≥5 words, or ≥4 with a function word) instead of the old `length>0`. "Nothing"/"N/A"/
  "all good" answers carry no theme signal and previously diluted both the AI's discovery
  sample and the sample-fit denominator — a Liked-Least field read "Diffuse 30%" when 45%
  of its answers were non-substantive; over real feedback the same themes cover ~48%. The
  "usefulness" scorer is versioned/swappable (v2 later = an LLM "actionable feedback?"
  judgment).
- **Stored per-comment flag (sql/178, 2026-07-14).** The scorer's verdict is STORED at
  ingest on `dataset_rows_flat.substantive` (a `{field: true}` map) + `substantive_v` (the
  scorer version) so every count is a cheap boolean read that agrees everywhere — no
  JS↔SQL drift. `stampRowSubstantive` (lib/usefulness.ts) stamps every non-`_` field of a
  new row at all 12 insert paths; `apply_substantive_flags` (sql/178) is the batched
  backfill/re-score writer (`scripts/_backfill-substantive.mts`). Because the map is a pure
  function of `data` (scored over ALL fields, only true keys kept), it needs no schema at
  ingest and survives a field being re-classified open-ended — a count filters one
  open-ended key at a time (`substantive ? 'LEAST'`), so keys for non-open fields are inert.
  Substantive is a TEXT-insight lens (mining, theme-fit denominator, word clouds, the
  dataset-level %, Ask Ana): it always SHOWS the % and never silently drops rows.
  CARVE-OUTS keep the full denominator — rating averages, numeric/categorical stats, raw
  counts, exports.
- API key: **defaults to the server's `ANTHROPIC_API_KEY`** so customer orgs piggyback
  on the platform key; usage is logged per-org in `usage_log`. The body accepts an
  optional `apiKey` override but it is not required — there is no localStorage-only mode.

**Mine-time corpus validation (`lib/themeMining.ts`, 2026-07-13).** The AI's keywords are
never trusted blindly anymore: the route scans the mining sample with the real matcher
(`buildKwRegex`) and compares each theme's scan coverage against the AI's own prevalence
estimate. Themes falling under 60% of their estimate (estimates ≥3%) trigger ONE refinement
call: the unmatched sample responses go back to the AI, which must add keywords copied from
the respondents' literal wording. Zero-hit keywords are then pruned (min 3 kept per theme),
and each theme's `count`/`percentage` are restated from the measured scan — so the stored
model reports the same numbers every counting surface will display, not the AI's readership
estimate. The response carries `fit: {sampleFitPct, refined}`. Validation is best-effort and
never blocks mining. WHY: measured on Carrabba's GSS "Liked Least" (3K verbatims), the AI
estimated 28/25/16/13/12% per theme while its invented keywords matched 7/3/2/2/0.3% — 63 of
105 keywords matched ≤1 comment, shipping a silent "Diffuse 12%" fit. The validated pipeline
measures 60.3% fit on the same corpus (was 17.9%).

**Keyword matching semantics (`kwPatternFragment`, 2026-07-13).** One canonical pattern per
keyword, built in `lib/themeUtils.kwPatternFragment` and used EVERYWHERE: `buildKwRegex`
wraps it for JS matching (client recounts, exports, theme entities), and the server counting
paths pass the same fragments into the SQL RPCs (`count_theme_matches`,
`theme_dimension_counts`, `compute_theme_cooccurrence_matrix` take them unescaped in their
`\m(…)` alternation; `sampled_signal_counts` accepts them as a `patterns` array per theme,
sql/166, with a legacy escaped-keyword fallback for deploy-order safety). Single words match
lemma-expanded stems (unchanged); **multi-word phrases match their words in order with up to
4 intervening words** ("slow service" matches "slow table service"; order still matters —
"poor service" does not match "service was poor"). Fragments are POSIX-safe (no lookarounds)
because Postgres ARE evaluates them too. Known edge: keywords starting with a non-word
character (e.g. "$10 deal") don't match in the `\m`-anchored RPCs (pre-existing) but do in
JS and the sampled RPC.

**Multiple open-ended columns → one theme set PER column (per-field theme sets, 2026-07-11).**
`dataset_state.theme_model` still keeps the legacy shape at the **top level** — the *active*
selection's model, bound via `fieldName`/`fieldNames` — so every consumer that reads
`theme_model.themes` (exports, share, signalStats, projectReportLoad, entities, collections,
Charts `__themes__`) keeps working unchanged. New alongside it: **`theme_model.fields`**, a map of
one persistent `ThemeModel` per Text selection, keyed by `themeFieldKey()` (`lib/themeUtils` —
same convention as `taxonomyFieldKey`: single field = its name, multi = sorted `' + '`-join).
The **dataset state route** (`/api/datasets/[id]/state` PUT/PATCH) is the single choke point:
every `theme_model` write is merged with the stored blob via `mergeThemeModelWrite()` — the
incoming model becomes the top level AND is mirrored into `fields[key]`, while every other
field's entry is preserved. Legacy blobs (no map) wrap lazily as one entry under their own key
(`themeFieldEntries()`); no backfill migration. This means even a legacy-shaped write (Ana's
theme edits, a stale tab) can never clobber another field's set — verified live on the
Carrabba's most/least TEST replica.
In **TextMine**, the Text toggle (`TextMineNav` `viewsExtra`) is a **single-select switch**
(2026-07-11, same day): clicking a question selects it ALONE and swaps to its own set (stash-
then-swap; a never-mined question shows the mine prompt and its pill is dimmed with a `+`).
The old checkbox toggle silently created a combined `a + b` corpus — the owner clicked "Liked
Least" on an already-mined dataset and unknowingly mined both verbatims concatenated ("very
nominal match"). Combining is retired from the UI; stored multi-field entries are treated as
artifacts (excluded from deck sections and the export picker — an ACTIVE combined model still
exports via the canonical path). **AI mining now auto-saves** the freshly mined set
(`persistThemeModel`, same as library-apply always did) — a mined set costs a real AI call and
must not depend on remembering the Save press.
Models with **no field binding** (pre-mining empties; keyless legacy blobs) keep the old
show-as-is behavior. Default remains the saved selection, else the first open-ended column.
**Exports surface every set (2026-07-11).** The PPTX deck (`export/pptx`) renders **one Theme
Analysis block per stored set** — section + theme-card grids + per-theme quote slides — each
**counted against its own field(s)** (`computeCanonicalThemes`/`themeDetailQuotes` take a
fields override); with a single set the deck is unchanged, with several each block is labeled
with its prompt (section titles hard-truncate to one line — a wrapped title strikes through
the divider rule; the subtitle carries the full question). The HTML report gives each
open-ended field **its own set's** themes (falling back to the active set when a field has
none — the pre-map behavior). The export dialog groups the theme picker by prompt with
independent per-set selection, sent as **`selectedThemesByField`** keyed by `themeFieldKey`
(theme ids repeat across sets — `t1..tN` in each — so the flat `selectedThemeIds` list can
only address the active set; empty array = skip that set; extra sets are also gated on their
field being among the export's selected fields). `themeSetsForExport()` (`lib/themeUtils`) is
the shared enumerator (active set first; keyless legacy blobs yield no entries so their top
level exports as before). Regression: `tests/integration/export-perfield-themes.test.ts`.
**Charts/Stats + Ana are per-question aware (2026-07-12 — closes the two scoped leftovers).**
`themeSetForField()` (`lib/themeUtils`) is the shared resolver — "which themes go with this
question?" answers identically in ChartsModule, StatsModule, AskAnaPanel, and the ask-ana
route. ⚠️ It returns a **fresh object every call** (stripFieldEntries spreads, even for the
top-level match), so render-path consumers MUST memoize the resolution — Charts/Stats wrap it
in `useMemo([themeModel, themeSourceField])` (2026-07-13: the unmemoized call invalidated
Stats' memo/effect chain every render → an infinite update loop that pegged the Statistics
tab; caught by the e2e smoke suite's first run). One-shot handlers (Ask Ana) are fine. Charts/Stats: the existing **theme source-field dropdown** no longer just re-targets
the active set's keywords — a question with its OWN stored set charts/derives `__themes__`
with THAT set (counts, KPI, pills, table, theme-counts payload all follow; the theme-pill
selection resets on switch since the old set's names would filter the new set to nothing).
A never-mined source field falls back to the active set matched against it (pre-map
behavior); saved charts are untouched (`__themes__` field id unchanged). Ask Ana: the panel
tracks TextMine's active Text pill (same `dataset-active-field-changed` event as the metric
strip) and sends `themeFieldKey` — Ana's framework context names the question it belongs to,
and her create/update/merge/delete edits apply to THAT set (the state route's merge-on-write
mirrors it into `theme_model.fields`, preserving every other question's set); '' / other
tabs = the saved active set, as before. **Dimensions get the identical treatment (sql/164, same day):** the source-field
picker also drives the `__dim_*` chart aggregates — see the `__dim_<axis>__`
virtual-field section below. Still deliberate: signals-pptx + share/analytics
stay on the active set.

**First-open multi-question setup (2026-07-11).** When TextMine opens with rows but no themes
and the dataset has **>1 open-ended field**, the empty state shows a **question checklist**
("Which questions should get themes?", all checked by default, per-question answer counts) and
the mine CTA becomes "Mine themes — N questions": `mineFieldsSequentially()` mines each checked
question **sequentially into its own per-field set**, persisting after every field (a failure
partway keeps everything already mined), then lands on the first mined question. Smart
Dimensions auto-enable runs once, off the first field's foodService verdict. Un-checking a
mis-flagged column is the escape hatch at setup time; fixing its type on the Schema tab removes
it permanently.

**Open-ended detection is content-based (2026-07-11, `computeFieldStats`/`analyzeTextContent`
in `lib/datasetUtils`).** `open-ended` used to be the fallback for any high-cardinality text —
Store IDs, person names, emails and street addresses all landed there and were theme-mined /
entity-scanned platform-wide until the user fixed the Schema by hand. Now a text column is
open-ended only when it **reads as prose**: ≥15% of (sampled) values are ≥4 words containing an
everyday function word (multilingual en/es/fr/de/pt stopword net; ≥8-word values count even
without a recognized stopword so unsupported-language prose isn't demoted), or the column
averages ≥4 words. Recognizable non-prose shapes get a **`semantic` tag** on the schema field
(`email` / `url` / `phone` / `identifier` / `name` / `address` — `SchemaFieldConfig.semantic`)
and stay **`categorical`** in the core type system (charts/filters/exports unchanged; the tag
records why the column isn't open text and feeds future PII handling). Person-name tagging
needs high uniqueness (repeated city/menu values stay plain categorical) and a name-ish header
for the lower pattern bar; a comments column where some respondents paste an email stays
open-ended (semantic tags require the column to be clearly non-prose). Anything else
high-cardinality now defaults to **categorical**, not open-ended. Existing datasets keep their
stored schema — detection applies at upload/auto-detect time; the Schema tab remains the
override. Tests: `tests/unit/datasetUtils.test.ts` ("freeform vs identifier/PII detection").

**Metric strip + listing cards (2026-07-11).** The dataset metric strip (`DatasetMetricStrip`,
every /analyze/[id] tab; since 2026-09-03 it reads
comments · coverage trio · signals · ratio · Theme fit band/% — see the signals
section above) now (1) **re-fetches when themes
are saved in-session** ('dataset-themes-saved' fires on every theme-model persist; fresh uploads
used to mine in the first visit and the strip stayed hidden until reload), and (2) **follows the
active Text pill**: TextMine dispatches 'dataset-active-field-changed' (themeFieldKey) and the
strip fetches `/signal-stats?field=<key>` — `computeSignalStatsForSet` serves that stored set's
stats. **Per-set caching (2026-07-11, first-open audit):** every non-active set now has its own
cache slot in `dataset_state.analytics.signal_stats_by_field`, keyed like the active slot
(that set's model hash + row count) — a Text-pill switch pays the 1–4s compute once per set,
then ~50ms; slots for removed/renamed sets are pruned on write and `invalidateSignalStats`
drops the whole map alongside `signal_stats`. Non-empty "records" counts are **comma-safe** via `count_nonempty_rows`
(sql/161, field as bind parameter) shared by signalStats / theme-counts / filter-options blanks /
analyticsCompute through `lib/nonEmptyCount.countNonEmptyRows` — the raw `data->field` PostgREST
filter silently matched nothing for question-sentence column names (comma = filter separator).
The Comments KPI tile shows the **substantive comment count** for the active question
(`isSubstantiveText`, lib/datasetUtils: ≥5 words, or ≥4 containing a function word; deterministic,
client-side) — the two-count base; the earlier separate "% substantive" line was dropped, its rule
kept in the tile tooltip.

**Substantive theme-fit + header "% substantive" (sql/179, 2026-07-14).** The metric strip
now LEADS with the substantive fit — `inThemes-among-substantive / substantive` — and reveals
the all-based number on hover (no toggle). Both numerator AND denominator are gated on the
stored substantive flag (sql/178): a denominator-only shortcut overstates fit ~6pts because
~12% of keyword matches land on non-substantive rows. `signalStats` computes the twin on both
paths — the exact path calls `count_nonempty_rows` / `count_theme_matches` with the new
`p_substantive_only` gate; the sampled path reads `records_substantive` / `union_substantive`
from `sampled_signal_counts` (same signature, extra keys). Verified end-to-end on the Carrabba's
GSS (the origin case): all-fit 21% (7,480/35,606) → substantive-fit 34% (6,554/19,134) — the
"Diffuse" reading was a denominator artifact (46% of the field's answers were non-answers).
The analyze **header** carries a filter-aware **"N% substantive"** next to the row count — the
share of answered rows (any open-ended field filled) whose text is real feedback, computed
client-side over the loaded rows (`DatasetShell`). CARVE-OUTS keep the full denominator: rating
averages, numeric/categorical stats, raw counts, exports.

**Dataset "About" popover (2026-07-14).** ONE shared component
(`components/analyze/DatasetAboutPopover.tsx`) with two triggers: an `(i)` on each `/analyze`
listing card, and a hover on the row-count cluster in the analyze banner. It reads
`GET /api/datasets/[id]/about` (org-gated, read-only): rows, source, field count by type, date
range, last synced, per open-ended field its fill-rate AND **% substantive**, and rating fields
with n. The per-field fill/substantive counts come from ONE `sampled_signal_counts` pass with no
themes (exact ≤50K, deterministic sample above), so it never full-scans; everything else is read
straight from the stored `schema_config` + `analytics.fieldSummaries`.

**Two-count model — per-theme prevalence on the substantive base (sql/181, 2026-07-14).** Owner
directive: "ignore non-substantive like blanks — only TWO counts, total rows + total (substantive)
comments; every %/prevalence divides by the substantive comment base." So EVERY theme-prevalence
% (not just the strip's single Theme fit) now divides by substantive comments, with the theme
NUMERATOR gated to substantive in LOCKSTEP — a full-match numerator over a substantive denominator
would overstate each theme. Surfaces:
- **`/theme-counts` route** — the shared prevalence source for the Charts theme bars AND
  TextMine's server counts. Exact path (≤50K): `count_theme_matches(p_substantive_only:true)` /
  `count_nonempty_rows(...,substantiveOnly)`. Sampled path (>50K): `sampled_signal_counts` now
  returns `theme_counts_substantive` (sql/181, per-theme hit-AND-substantive) alongside
  `records_substantive`; the route scales both. `totalNonEmpty` in the response IS the substantive
  comment total.
- **TextMine distribution / Compare** — `totalResp` and the Compare `groupTotal`/`totalRows`/
  `unclassified` count substantive rows (`isSubstantiveText` per field, matching the SQL map);
  theme match counts are substantive-gated too, so the CompareBars z-test (`sigTest`) runs
  numerator+denominator on the same base. The Comments KPI tile shows the substantive count (rule
  in a tooltip; the separate "% substantive" line was dropped per the two-count model).
- **Charts** — the `__themes__` virtual field's denominator (`nonNull`) is the substantive comment
  total from `/theme-counts` (filter-aware) instead of `analytics.totalRows`.
- **Statistics** — NO prevalence denominator to flip: StatsModule uses themes/dimensions only as
  GROUPING variables for chi-square/t-test/ANOVA (group totals = classified counts, not an
  all-non-empty base), and dimension counts are already clean. Left untouched.
- **About popover per-field** — shows the substantive **comment count** (the two-count base) AND
  its rate as a **"(N% of answered)"** — the designated rich-stats home for the substantive share
  (the strip/main chrome stays two counts; this is where the "% real feedback vs non-answers" signal
  lives). The TextMine AI-mined banner reads "AI analysis of N **substantive** comments" (was
  "open-ended"), rule in the hover.
- Verified on Carrabba's GSS (56K, both paths): 35.6K non-empty → 19.1K substantive (46%
  non-answers); Service & Staff Issues reads its true **12%** vs a diluted 7%, Food Quality 10% vs
  6% — numerator ⊆ denominator throughout (`scripts/_verify_deck_substantive.mts` full-scan +
  `_verify_theme_counts_route.mts` sampled RPC agree within sampling noise).

**Decks/exports inherit the substantive base (2026-07-14).** "N comments" and every theme
prevalence % in the PPTX deck (`export/pptx`: `computeFieldThemes` / `computeCanonicalThemes`
filter rows with `isSubstantiveText` — so numerator+denominator flip together) and the Heads-Up
alert engine (`themeSignals.buildThemeSignals` filters `docs` to substantive) count substantive
comments only; the About-This-Report methodology line states the base. CARVE-OUTS stay full: raw
verbatim quote lists, rating averages, response/completion scope counts, and the Survey Overview
"With comments" engagement KPI (a participation metric, kept consistent with the funnel's fill
stages). `projectCompare` (the multi-source project-report matrix) is NOT flipped — its counts are
assembled upstream per source; a denominator-only flip would inflate, and threading substantive
per-source counts through the project-report pipeline is deferred.

**Export rows = the app's deterministic sample (Model A, 2026-07-14).** Every dataset export that
counts over rows now loads the SAME sample the app view analyzes, so a deck/report — and any PDF
made from it — reports the identical numbers: **`export/pptx`** (the PPTX deck), **`export/html`**
(the HTML report → HTML-to-PDF; was a smaller first-10K/30K load), and **`export/signals-pptx`** (the
reddit/substack signals deck; was first-10K). All three: ≤50K → every row (exact-full); >50K → the
`idx_drf_sample` hash sample (sql/160) via `pageSampledRows` (proportional per-member shares for
collections; sequential first-N fallback if the RPC is absent). None scale — they count exactly over
the sample. Verified on Carrabba's: the deck sample yields exactly 17,048 substantive on Liked Least,
identical to the strip/mined banner. A **PDF converted from the PPTX** inherits the PPTX numbers.
(The Ask-Ana ad-hoc report PDF is a separate narrative mechanism over `loadAnaSample`'s own
substantive-first sample — not code-computed theme counts.)

**Model A — the 50K sample IS the view; report EXACT sample counts, no scaling (owner 2026-07-14).**
Above the cap the analyze view stopped extrapolating: `signalStats` (strip) and the `/theme-counts`
route (Charts/TextMine theme bars) now return the EXACT counts of the deterministic 50K sample
instead of scaling them to the full dataset — so there is no more "~" and every number on the page
agrees (the strip's comment count now equals the mined banner's, both ~17,048 on Carrabba's Least,
because both count the same deterministic sample). `scaleSampledCount` is no longer called on these
count paths (theme-fit % is a ratio, unaffected). Rating averages keep their own "~" — a
ties-to-Google carve-out that still averages all rated rows. Rationale: "at this point we're looking
at the sample as our view, so everything is based on the 50K." The same exact-sample rule extends to
every export (PPTX / HTML / signals deck) and the Ask-Ana ad-hoc report (see below).

**Model A scope boundary — what still scales (as of 2026-07-14, an OPEN item).** Model A is applied
to the **theme / comment / substantive** count surfaces (strip, theme prevalence, decks, Ask-Ana
report). It is NOT yet applied to the **other** `/aggregate` count surfaces, which still scale a 50K
sample up to the full dataset on large datasets: **categorical field distributions** and
**numeric-stats counts** (`lib/sampledAggregate`, `scaleSampledCount`), **Dimensions sub-counts**
(taxonomy rollup / `sampledTaxonomy` twins), and **Entity mention counts** (`sampled_count_entity_terms`,
shown with "≈"). So on a >50K dataset a "Region" bar or a Dimensions count is still a scaled estimate
while the comment/theme numbers are exact-sample. Making these fully Model-A-consistent (drop the
scaling on the COUNT surfaces; means/medians/stddev are inherently unscaled) is tracked as an open
sweep. `lib/projectCompare` (multi-source project-report matrix) likewise still counts over each
source's full `rowCount` — deferred (its counts are assembled upstream).

**Charts calculation-correctness sweep (2026-07-14).** A pass over every chart type's math, verified
against the real Carrabba's GSS dataset (56,117 rows) in the TEST project:
- **"No groups found." on an Average bar — the real root cause was a virtual VALUE field hitting SQL.**
  A remapped categorical (a satisfaction question with a `remapping`, `scoreField:true`) is offered in
  the numeric picker as a virtual `__mapped_<field>__` field computed ONLY client-side by `enrichRows`
  — it is not a key in the stored JSONB. `BarAggInner` blindly sent `group_stats` with that virtual key
  to SQL, which read `data ->> '__mapped_…__'` = NULL for every row → zero groups. `BarAggInner` now
  detects a virtual value/category field (`startsWith('__')`) and routes through the enriched client
  rows (like `BarStackedInner`), which also makes the Average bar filter-aware. Verified: Visit Type ×
  Rating now yields Dine-In 4.63 / Carry Out 4.37 / Delivery 4.08 (full-dataset and 50K-sample agree).
- **Numeric VALUE parity (a separate robustness fix).** The field-type classifier
  (`lib/datasetUtils.ts`) types a field numeric via `!isNaN(Number(v.trim()))`, but the aggregate RPCs
  filtered values with a stricter, un-trimmed regex `^-?[0-9]+\.?[0-9]*$`. A *real* numeric field whose
  cells carried a stray leading space (or `.5` / `1e3` / `5.`) would likewise produce
  ZERO surviving rows → the Average bar renders "No groups found." and Statistics/Distribution go
  blank. `sql/182` centralizes numeric detection in two IMMUTABLE helpers
  (`drf_numeric_ok` / `drf_to_numeric` = btrim + tolerant pattern + cast) and routes every value
  filter/cast in `group_numeric_stats`, `numeric_field_stats`, `date_series_stats` and their sampled
  twins through them. The client rows-fallback paths (collections / virtual fields) use the matching
  `toNumericOrNull` (`lib/numericValue.ts`) instead of `parseFloat`, which mis-read `"1,000"`→1 and
  `"4.5abc"`→4.5. Genuinely non-numeric values ("4/5", "4 stars") still fail both, so nothing spurious
  is admitted. **Requires the sql/182 migration on prod to fix the live chart.**
- **Percentage bar denominator.** A non-stacked Percentage bar divided by the sum of the shown top-30
  categories, not the true total — inflating every % on a clipped chart. Now divides by all categories.
- **Time-series timezone bucketing.** `bucketKey` parsed date-only ISO strings as UTC midnight, then
  read local components → the previous day in negative-UTC zones, misbucketing period-boundary dates
  and disagreeing with the TZ-safe SQL `::date` path. Now parses ISO strings as local calendar dates.
- **Time-series false-dip.** A metric bucket with rows but no numeric value plotted 0 instead of a
  gap; now null (count mode still shows a real 0).
- **Score Driver regression staleness (fixed).** A react-hooks warning surfaced that the regression
  effect was missing `rows`/`schema`/`themeModel` from its deps — so it did NOT recompute when the
  filtered rows changed, leaving stale regression results under an active filter. Deps added.
- **Filter-awareness for summary-driven charts (now fixed).** A plain Count/Percentage bar, no-split
  Distribution, Treemap, Packed Bubbles and Waterfall read the whole-dataset precomputed
  `fieldSummaries` and used to ignore active filters, while the stacked/Average bars (aggregate API +
  `rowIds`) were filter-aware. `recomputeFilteredSummaries` now recounts those fields from the filtered
  rows when a filter is active (reusing the whole-dataset histogram bin edges; COUNT surfaces scaled by
  `totalRows/sampledCount` to match `scaleSampledCount`, means/extents unscaled) and overrides the
  summaries in `enrichedAnalytics` — so the whole tab agrees under a filter.

**Charts audit fix set (2026-09-03; audit registered in `docs/AUDITS.md`).** A second correctness pass
over every chart type — the findings and their fixes:
- **Truncation now always keeps the biggest categories.** Treemap, Packed Bubbles, Waterfall, Funnel
  (and Bar with Smart Axes off) sliced their top-N *after* `smartOrder`, which is **alphabetical** for
  nominal fields — so a clipped chart could silently drop its largest categories while the badge
  claimed "Showing top N of M". The shared `topCategoryKeys` helper now picks the subset by count
  (ties alphabetical) FIRST; display ordering (scale order, alphabetical, count) applies to the
  subset. The Average bar subsets by group size n, the stacked bar by row total, and the crosstab caps
  both dimensions at top-30 by marginal count (its rows-fallback path was unbounded) — all three now
  disclose the clip in the title, where before they truncated silently.
- **Funnel is always monotonic.** Stages sort count-desc regardless of Smart Axes (which used to
  reorder them by scale/alphabet, producing mid-bulging funnels).
- **One theme matcher.** `enrichRows` (the `__themes__` virtual column behind stacked bars, crosstab,
  time-series breakdowns, the table) matched keywords with a raw `includes()` substring test, and
  Score Driver carried a private near-duplicate regex builder — three matchers, three counts for the
  same theme. Both now use `themeUtils.buildKwRegex`, the canonical lemma-aware pattern shared with
  TextMine's recount and the SQL counting RPCs. `__themes__` remains winner-take-all single-label
  (one column per row); the simple Themes bar shows the server's multi-label counts — that difference
  is inherent, the matcher no longer is.
- **No fabricated distributions.** The Distribution fallback for a summary without a histogram fed
  `[min, avg, median, max]` to Plotly *as data points* (it derived quartiles from those 4 numbers).
  It now renders a real box from the rows (`DistRowsFallbackInner`). Remapped-Likert virtual fields
  (`__mapped_*`) additionally get a synthesized discrete histogram (one bin per scale value) plus
  real p25/p75, so they take the normal histogram path.
- **Gauge bands tell the truth.** The Bullet/KPI gauge always painted fixed quarters of the min–max
  range but labeled them "Bottom 25% / Middle 50% / Top 25%". Band boundaries now sit at real
  quartiles when available (field summaries carry p25/p75 since sql/199; `tax_group_stats` returns
  q1/q3; the client rows path computes them) and keep the percentile labels; without quartiles the
  fixed bands remain but the legend reads "Low / Mid / High range". `recomputeFilteredSummaries` also
  computes p25/p75 so the bands stay honest under a filter.
- **Gantt takes numeric ranges only.** Its Range slot accepted `date` fields the renderer nulls out
  via `toNumericOrNull` — a silent blank chart. The slot is numeric-only, an empty result now says
  so, and the bars use the selected palette instead of hard-coded colors.

**Compute follows the 50K sampling doctrine + fails loudly (2026-09-03, ANES).** `computeAnalyticsSQL`
ran the exact per-field RPCs (`count_field_values`, `numeric_field_stats`) at ANY size; on the 126K
ANES dataset every numeric scan hit the DB statement timeout and the silent `!nr.n` fallthrough
persisted `nonNull=0` for all 25 numeric fields — a poisoned snapshot that looked computed. Above
`AGG_SAMPLE_CAP` (50K) the compute now uses the deterministic sampled block twins
(`sampledCountFieldValues` / `sampledNumericFieldStats`, sql/169/191) and scales counts — the same
path and semantics as `/aggregate`, matching the Charts UI's "≈ estimated from a 50,000-row sample"
banner; `sampledNumericFieldStats` gained real interpolated `p25_val`/`p75_val` (percentile_cont
parity) so sampled snapshots keep true quartiles. On the exact path (≤50K), an RPC **error** now
throws — failing the compute request — instead of writing fake zeros; a genuinely empty field still
summarizes to zero.

**Chart options pass + guided drag-and-drop (2026-09-03, owner ask: "% option… best available
options for characterizing… naive users").** Every chart type re-reviewed for whether its options
can honestly characterize the data; what shipped:
- **Time Series % share** (the headline ask): with a breakdown active, a Count / % share toggle —
  each line as a share of that bucket's total, separating a category's drift from overall volume
  drift. Shares are computed over the FULL category set even when the new **top-12 series cap**
  (by volume, disclosed in a caption) hides small lines; empty buckets are null, not 0%. Both
  breakdown and single-line count charts now **zero-fill quiet calendar buckets** (reusing
  `periodCompare.fillBuckets`) so the line shows a real 0 instead of gliding over missing weeks.
- **Crosstab Count / % of row / % of column** pills + **in-cell values** (≤400 cells, like a
  Tableau highlight table); hover always carries count AND both shares so no mode hides the base n.
- **Scatter**: deterministic **jitter** (±0.35, hash-of-index — identical on re-render/export;
  auto-ON when both axes are small-int scales, where two ratings collapse onto ~25 lattice
  positions), an OLS **trend line** with R², and a **5,000-point cap** (deterministic even sample,
  disclosed) replacing the unbounded SVG scatter.
- **Distribution** histogram: Count / % of responses toggle (extracted to `DistHistogramInner`).
- **Funnel** stages show value + **% of the top stage** (the conversion reading); **Treemap** tiles
  show label + value + **% of total**.
- **Data Table**: click-to-sort headers (numeric-aware comparator `compareCells`, blanks last) —
  the tooltip's "Sortable" claim is finally true.
- **Guided drag-and-drop**: dragging a sidebar field announces its type to every slot — viable
  slots light up with a dashed accent ring + "▼ drop here", incompatible slots dim to 30% and stop
  accepting pointer events so a wrong drop can't even register. Complements the existing smart-drop
  body banner. Behavior pinned in `chartsOptionsUI.test.tsx` (real ChartsModule + Plotly mock:
  % shares sum to 100, zero-fill bucket count, highlight + dim + dragend cleanup).
- Also fixed in passing: chart loaders rendered a literal `…` (JSX attribute strings don't
  process unicode escapes) — now a real ellipsis.
Not built (unchanged from the audit's deferred list): saved charts still don't capture display
options; `_aggCache` invalidation; the ChartsModule file split.

**Charts "never computed" recovery + last matcher copy (2026-09-03, follow-up).** The prod ANES
dataset (script-uploaded, 125K rows) sat unplottable: its analytics blob carried only TextMine caches
(no `totalRows`/`fieldSummaries` — the compute route is only triggered by the Analyze-button/wizard/
append flows, which a scripted upload bypasses), and the Charts tab's `hasData` gate rendered a bare
"No data loaded." with no cause and no way out. The tab now distinguishes **never computed** (no
`totalRows` AND no `fieldSummaries`) from **computed-and-empty**: the former renders `ComputePrompt`
— "Analytics haven't been computed for this dataset yet" plus a **Compute analytics** button that
POSTs the normal compute route and reloads (pinned in `chartsMissingAnalytics.test.tsx`). Also fixed
in the same pass: `StatsModule`'s theme-enrichment kept a private raw-substring keyword matcher — the
last copy the 2026-09-03 unification missed — now on canonical `buildKwRegex` like every other
consumer. (Stats itself loads raw rows and never needed the analytics gate.)

**Statistics → Regression: Logistic mode (2026-07-15).** The Statistics `RegressionPanel` gained a
Linear/Logistic toggle. Logistic fits a binary outcome via maximum-likelihood IRLS/Newton
(`lib/statsUtils.logisticRegression`, reusing `invertMatrix`) and reports **odds ratios** with 95% CI,
Wald z/p, McFadden pseudo-R², a likelihood-ratio χ² test vs the intercept-only model, and AIC; it flags
non-convergence / (quasi-)separation instead of showing garbage coefficients. The outcome is binarized
automatically when it already has two values, else at an adjustable cutoff defaulting to the **median**
(`y = 1` when `outcome ≥ cut`); both classes need ≥3 rows. **Intelligent collinearity handling** (the
key requirement): before fitting, `pruneCollinear` computes per-predictor **VIF** and iteratively drops
the single highest-VIF predictor until all are ≤ 10, so a correlated cluster keeps one representative
and effects aren't split across redundant twins — the dropped predictors (with their VIF) are surfaced
in the panel. Above 50K rows this runs over the loaded 50K sample, like the other Stats panels. OLS
residual/Q-Q diagnostics are hidden in logistic mode. Math verified in `tests/unit/logisticRegression.test.ts`
(intercept recovery, effect sign, separation detection, VIF = 1/(1−r²), pruning). The **Bottom Line**
card carries the same Expert/Plain-English toggle as every other Stats result: Expert states it in odds-ratio
terms ("N of M terms significantly affect the odds… multiplies/cuts the odds X×… McFadden pseudo-R²"),
while Plain English (`logitBL(naive=true)`) is a **Gemini-style layperson brief** — no "odds", "McFadden", or
"pseudo-R²". It states the target, whether the effect is a real pattern vs. a fluke and the sample size it
holds across, the single biggest lever phrased as "makes that ~X% more likely" / "cuts those chances by ~X%",
then **names the movers as a scannable, colour-coded block** (not a run-on paragraph): a `logitBLNode()`
renders bold factor names in three rows — **LOWER THE ODDS** (red, odds-ratio &lt; 1) and **RAISE THE ODDS**
(green, &gt; 1), each factor tagged with its own ±% effect, plus **NO CLEAR EFFECT** (muted, the
non-significant terms) — so the reader sees *which* factors matter, in which direction, and which don't. It
opens with the target + sample size + real-pattern line and closes with the model-fit caveat ("together these
explain only a small part / a good part / most of the story — the rest comes down to things we didn't
measure"). `BottomLine` gained a `naiveNode` prop so the Plain-English register can be rich JSX while every
other Stats result stays a plain `naiveText` string. The **linear** regression Plain English uses the same
block (`regrBLNode`): rows are **LINKED TO LOWER** (red) / **LINKED TO HIGHER** (green) by coefficient
**sign** (not magnitude — OLS betas aren't standardized, so no per-factor %, unlike logistic's odds-ratio %),
plus **NO CLEAR EFFECT** (muted). The old string generator `regrBL_naive` was removed. The **linear** counterpart `regrBL_naive`
(`lib/statsUtils.ts`) mirrors this register — target + sample size + reliability + fit% translated to plain
words + **directional drivers** ("Linked to a higher / lower <outcome>: …", by coefficient sign). Both
registers must genuinely differ from Expert (logistic was identical for the significant-terms case until
2026-08-07; the linear naive text was enriched the same day).

**Logistic on categorical fields + themes (2026-07-15).** Because a survey's real drivers are its
Likert **categorical** fields and its **themes**, not raw numeric columns, the logistic panel is its
own `LogisticPanel` component that models a binary outcome from ANY field type via `lib/regressionDesign`:
numeric passthrough; **categorical → one-hot dummies** (each level vs the modal baseline, so odds ratios
read "level X vs the most common answer") with a per-field **ordinal** opt-in (uses the field's remapping,
else its `values` order); **theme → a 0/1 "mentioned it" column** (`commentMatchesTheme` over the theme
source field, same matcher as the theme bars). Rows are complete-case (outcome defined + every non-theme
predictor present; a theme's absence is a legitimate 0). The outcome can be a numeric/Likert field
(**top-box** threshold, default = the field's top level for a remapped Likert, else the median), a chosen
**category level**, or a **theme mention** (default outcome = a rating/satisfaction field). The design
matrix feeds the same `pruneCollinear` → `logisticRegression`, and coefficients are labeled by encoded
column (`Field = Level`, theme name). Verified end-to-end on the real Carrabba's GSS: top-box Rating
from the sub-scores + themes recovers sensible odds ratios (mentioning "Service & Staff Issues" → OR
0.05×; "Value for Money = Fair" → OR 0.05× vs the Excellent baseline; pseudo-R² 0.52). Design-layer math
in `tests/unit/regressionDesign.test.ts`; the numeric-only inline logistic (the 2026-07-15 first cut) was
replaced by this. `LinearRegression` (OLS) is unchanged (numeric outcome + predictors).

**Dual-purpose Likert fields — auto-quant at schema level (2026-07-15).** Schema detection
(`lib/datasetUtils`) now attaches an ordinal `remapping` to any categorical field whose values are a
recognized ranked scale, gated by the STRICT matcher `scaleUtils.strictScaleMapping` (≥3 recognized
scale points AND all-but-≤1 distinct values matched — so a nominal field with a coincidental hit is NOT
mapped). Such a field stays `type: categorical` (axes / distributions / crosstabs render ordered
categories) AND carries a `__mapped_<field>__` numeric twin for quantitative use (averages,
correlations, regression). Fully user-controlled in the Schema tab: the "Score Mapping" row has a
**Clear** button (disable → purely categorical) and per-value number inputs (adjust). Existing datasets
are backfilled by `scripts/_backfill_scale_remappings.mts` (dry-run by default; `--apply`, `--prod`).
The regression `ordinalMap` reads the stored remapping first, then falls back to on-the-fly detection.

*Single-entry picker (2026-07-15).* Rather than listing such a field TWICE — once as the raw categorical
and again as its `"… (score)"` numeric twin — the field pickers show it **once**, flagged dual-purpose
(a small `#/≡` badge), and the **target slot resolves which id to store**: an axis / category / colour
slot stores the raw categorical id, a value / metric / measure slot (accepts numeric, not categorical)
stores the numeric-twin id `__mapped_<field>__`. Saved configs keep the RESOLVED id, so this is
byte-compatible with existing saved charts + server aggregation (a value slot already stored the twin id
under the old two-entry picker). In **Charts** (`ChartsModule`) the twin is dropped from `pickerFields`;
`ChartSlot`/`getSmartSlot`/the slot dropdowns resolve per `accepts` (`resolveSlotFieldId` ·
`fieldMatchesAccepts` · `slotWantsNumericTwin`). In **Stats** (`StatsModule`) the type-scoped selects
already list one correct entry each (raw in categorical `DSSelect`s, the twin in numeric ones), so only
the *combined* lists are deduped: the left sidebar drops the twin whenever the raw is also present (it
stays on numeric-only panels as the field's sole numeric entry), `DSSelect` drop resolves a dropped dual
field to whichever id that select accepts, and the Logistic predictor list drops the twin entirely (the
raw remapped categorical already exposes the numeric reading via `buildRegVars`' ordinal toggle).

**Ranked Likert categoricals default to quantitative (2026-07-15).** A categorical whose values are a
recognized ranked scale (`scaleUtils.suggestMapping`/`isOrdinalScale` — Very Dissatisfied…Very Satisfied,
Poor…Excellent, Strongly Disagree…Strongly Agree, etc.) is marked `ordinalable` in `buildRegVars` with a
resolved 1→k `ordinalMap` **even when the field was never given a remapping**. In the logistic picker those
fields **default to ordinal (a single quantitative column)** and carry a "quant" toggle to switch to one-hot;
genuinely nominal fields (Visit Type, Store ID) stay one-hot. This also fixed a bug where the outcome
dropdown was empty (the shared `DSSelect` filters options by a section key the panel wasn't supplying — the
picker now uses a native grouped select). **Ridge fallback for separation:** `logisticRegression` fits the
pure MLE first and, only if the Hessian is singular (quasi-complete separation — common when predicting an
overall rating from its own sub-scores), escalates a small L2 ridge until it returns a finite fit, flags
`regularized`, and the panel warns that the magnitudes/p-values are unreliable and the near-deterministic
predictor should be dropped — so the model no longer silently disappears. Empty states now name the concrete
reason (too few complete rows for the predictor count, both-classes, all-collinear, or unfittable).

**Driver Simulator export (2026-08-28).** Both regression modes carry a **"Download simulation model
(.json)"** action in the Model Fit header, emitting the self-contained payload the standalone Monte-Carlo
Driver Simulator consumes (simulator-payload-spec v1.0). Builders live in `lib/simulatorExport.ts`:
linear → `link:"identity"` with `sigma` = residual SD (`sqrt(MSE)`); logistic → `link:"logit"` with
**log-odds** coefficients (`beta`, never the displayed odds ratios) and NO sigma. `se` + `corr` come from
the full `(k+1)×(k+1)` coefficient covariance both fitters now return (`RegressionResult.vcov` =
`(X'X)⁻¹·MSE`; `LogisticResult.vcov` = inverse Hessian), intercept first, Cholesky-verified positive
definite before emit. Per-predictor `mean/sd/min/max` are computed from the **estimation sample** — the
linear panel's listwise-deleted rows come from the same `estimationSample` builder the fit uses, and the
logistic panel maps its post-VIF-prune kept columns back to `buildDesign`'s matrix — so sliders always
match the model; a 0/1 dummy column emits `sd = sqrt(p(1−p))` per the spec's categorical rule. Export is
refused (with the reason shown inline) for separated/non-converged logistic fits, `|coef| > 15`,
`se > 10`, constant predictors, or any non-finite number. Tests: `tests/unit/simulatorExport.test.ts`
(mirrors the spec's consumer validation §15 and acceptance identities §16).

**"Sampled" chip on the metric-strip row (2026-07-14).** When the active dataset exceeds the 50K
cap (`RowsContext.sampled && totalRows > sampledCount`), `DatasetShell` leads the shared metric-strip
row (the one carrying comments · Theme fit · themes) with a compact blue chip "◱ Sampled P% ·
N/M" — the single disclosure that the on-screen counts are over the 50K sample (Model A). It rides
the existing strip row rather than its own banner — one signal, no extra vertical row — and persists
across tabs so a sample is never mistaken for the full dataset. The strip's comment metric reads
"**N** comments · **P%** of **M** answered" — the substantive count plus its share of answered
comments (`substantiveRecords / records`), the "% substantive" the retired AI-mined banner carried.
The separate AI-mined banner on the Themes tab was REMOVED (its count + rate now live on the strip;
the top-right "AI Mined" pill keeps the provenance) — one comment count, not two. The strip's cached
`signal_stats` carries `stats_v` (2 = Model A); v1 entries held scaled counts and recompute on the
next read (so the strip stops showing a stale scaled number like ~30,308 for a real 27,004).

**Metric-strip follows the active TEXT pill — dispatch moved before the swap-effect early returns
(2026-07-14).** The strip (`DatasetMetricStrip`) listens for `dataset-active-field-changed` to show
the active question's counts. That event was dispatched at the END of TextMine's per-field-swap
effect, AFTER three early returns (`!k`, a themes model with no field binding, or the set already
shown) — so on those transitions the strip never heard the change and kept showing the PREVIOUS
question's counts (e.g. Liked Most's scaled ~30,308 while Liked Least was selected). The dispatch now
fires at the TOP of the effect, unconditionally, before any bail-out (pure event emit, no setState).

**Substantive lens across insight surfaces (2026-07-14).** The stored flag is the DEFAULT scope
for text insights, always shown never silently dropped:
- **Mining** ✅ — `prepareCorpus` filters to substantive.
- **Theme-fit strip + header %** ✅ — sql/179 substantive twin.
- **Per-theme prevalence (Charts/TextMine bars) + decks** ✅ — sql/181, see above.
- **Word clouds** ✅ — `WordCloud` builds `perRowText` + the denominator from substantive rows
  only (client-side `isSubstantiveText`); the header notes "over N substantive of M answered".
- **Ask Ana** ✅ — `loadAnaSample` prioritizes substantive comments when the sample truncates
  (partition substantive-first, then shuffle/slice) so the model reasons over real feedback;
  a context note records how many carried real feedback. Its rows already come from the SAME
  deterministic idx_drf_sample population (sql/167). **Model A denominators (2026-07-14):** the
  reported "N of M matching rows" is now over the ≤50K sample, never scaled to the full dataset
  (`sampleBase = min(rowCount, 50K)`; `totalDatasetRows` kept as context). The one-shot **ad-hoc
  report** passes `exactSampleCounts` → scans the whole 50K sample for EXACT sample counts (no "~");
  the interactive chat keeps its fast budget scan but still reports sample-based numbers. Verified on
  Carrabba's: unfiltered report totalFiltered = 50,000 (exact), dataset context 56,117.
- **Dimensions** ✅ (sql/180, DENOMINATOR-only) — the "% tagged" header (`withSignal /
  rowsWithText`) now divides by `rowsSubstantive` (rows carrying usable feedback in any selected
  field, `dataset_rows_with_substantive_count`) so the tag rate isn't diluted by non-answers. The
  dimension COUNTS are left untouched (a non-answer doesn't classify, so they're already clean) —
  which is why no rollup re-classify was needed. `rowsSubstantive` is stored beside `rowsWithText`
  at classify time (live-RPC fallback for pre-fix entries). The rate is capped at 100% (a rare
  one-word answer can carry a signal yet not be substantive), labeled "% of substantive tagged".
- **Entities — WON'T BUILD (owner, 2026-07-14).** The lens is a denominator fix, and entity
  mention rates are already low single digits, so swapping non-empty → substantive in the
  denominator barely moves the number; entities lead with raw "X mentions" tiles (already clean),
  not a prevalence %. Not worth the `count_entity_terms`/`sampled_count_entity_terms` gate +
  `mention_count` cache-bust. Deliberately not a lens surface.
**Listing cards carry data facts only** (rows, fields/members, last-updated) — the per-card
records/signals/theme-fit line and its signal-stats-batch fetch were removed as a confusion
source (the numbers described one question's set without saying which); analysis metrics live
in-dataset where the question context exists.

**Degraded-analytics render safety (2026-07-12).** ChartsModule renders its degraded
states — never throws — when the dataset's analytics blob lacks `fieldSummaries`/
`totalRows` (script-seeded copies; any dataset whose compute failed): all
`analytics.fieldSummaries[...]` derefs are optional-chained and `renderChart`
defaults the summary map (regression: `tests/unit/chartsMissingAnalytics.test.tsx`;
found on the 785K prod scale test, where the unguarded remapped-fields summary
build crashed the tab to the error boundary).

**Tab-navigation fetch behavior (2026-07-11, first-open audit).** The /analyze tabs are
separate route segments under one layout: the shared layer (RowsProvider bulk rows, metric
strip, views, session filters) mounts ONCE and survives tab switches; each tab's *module*
remounts and re-fires its own fetches. `lib/clientRequestCache.ts` (`cachedRequest`) now
dedupes the recomputed-identically-per-remount ones — `theme-counts` (TextMine + Charts,
keyed by dataset + full request body so any theme/field change is a different key) and the
static `industry-themes` — cleared on the theme-save events + a 5-min TTL. The entity
catalog is deliberately NOT cached (Schema-tab entity management has no change event back
to TextMine). `/aggregate` gained `maxDuration = 60` to match its peer dataset routes.

**The bulk-row fetch stops shipping fields nobody reads (2026-08-14, sql/186).** `/rows?all=true&sampleMax=50000` measured **21s warm / 36s cold** on the 128,619-row Outback dataset — the single slowest call on the tab. The layer breakdown: **~0.9–1.2s of SERVER time per 5,000-row page** (building a 9.5MB jsonb + gzipping it) against only ~0.15–0.4s of transfer, with Node work negligible (`projectRow` 491ms, `JSON.stringify` 324ms across all 50,000 rows). So the lever is building a smaller value, not moving it faster. Two candidates were measured and **rejected** — recorded so they aren't re-attempted:
- **Parallel pages make it worse, then break it.** Unlike theme-counts (CPU-bound), this looked I/O-shaped, but concurrency 2/3/4 are all *slower* than serial (29.6s / 25.1s / 28.8s vs **20.9s**), and concurrency 10 makes **every page hit the statement timeout** — a working-but-slow load becomes a total failure. Serial paging is already both fastest and safest.
- **A columnar payload** (one key header + value arrays) is **4.0× smaller raw** — 62.8% of every row is the same 32 question-sentence keys repeated 50,000 times — but only **1.4× gzipped** (0.61→0.44 MB), because gzip already collapses that repetition, for ~80ms of parse. Not worth the invasiveness.

What shipped instead: the route reads `schema_config` and passes the fields marked **`ignore`/`hidden`** as `p_drop_keys`, dropped in SQL. **`type === 'id'` is deliberately NOT dropped** — `ChartsModule`'s column list keeps id fields (it filters only `ignore` + hidden), so dropping them would break a live consumer; `ignore`/`hidden` are excluded by *every* analyze surface (TextMine `hiddenFields`, Charts, Stats, Snapshot, FilteredCommentsPanel). An explicit `?fields=`/`?field=` projection wins over the drop. **Honest result: payload −34% (80→53 MB) but only ~11% faster** on a fair alternating A/B (11.5s→10.2s median) — the proportional speed-up the payload cut suggests does not materialise, because gzip had already absorbed the repetition and much of the per-page cost is fixed round-trip/planning overhead. The at-or-under-cap path drops the same keys in **Node** (PostgREST can't project inside jsonb, so it saves no transfer) purely so a smaller dataset doesn't get weaker handling.

**The more valuable half is data minimisation, not speed.** On that survey the ignored columns are **First Name, Last Name, Email Address, IP Address, Transaction ID, DR Card Number_Member** — serialized, gzipped, transferred and parsed 50,000 times per load into a client-side payload, then discarded by the UI. `RowsProvider` sends no `fields` param, so `projectRow`'s fieldSet was null and only the reserved keys were stripped. Verified against the real TEST database (`scripts/_verify_rows_dropkeys.ts`, untracked): same 50,000 ids **in the same order** (the deterministic sample is unchanged), every retained field byte-identical, 0 surviving ignored columns, 32→19 fields per row.

**TextMine Themes paints progressively (2026-08-14).** The tab used to render nothing until
the whole bulk row payload — up to 50,000 rows, tens of MB — had downloaded and parsed: one
full-page loader for the entire wait. Two changes, per the owner's direction that the fix is
progressive rendering rather than only a faster query:
- **`fetchServerThemeCounts` no longer hangs off `rowsLoaded`.** It needs nothing from the
  rows — the saved theme model, the field list and the row total are all server-rendered
  props — so it now fires as soon as the active **Text selection settles** (one tick after
  mount) and runs concurrently with the row download instead of after it. The gate is the
  selection, not the rows, because firing before it settles would request the wrong field on
  a restored session that opens on a different Text pill; a `useRef` token dedupes to one
  scan per (dataset, field set).
- **The cards render on the server counts, before the rows land.** `themesPaintable` =
  themes exist **and** the server returned a positive `totalNonEmpty`; the responses base
  falls back to that server figure until `rowsLoaded`, so numerator and denominator come
  from the same computation. Requiring a **positive** base is load-bearing: dividing by a
  not-yet-loaded 0 would render "0 comments · Diffuse 0%", which reads as a verdict on the
  data rather than a loading state (the trap `DatasetMetricStrip` fell into on 2026-08-13).
  A slim banner says the counts are whole-dataset and that filters, ratings and sample
  comments turn on when the rows finish. Clouds and Comments stay row-gated (they tokenize
  client-side) and keep their own loaders.

**In-progress affordances for the two-phase load (2026-08-15).** Splitting counts from extras created a window where a panel is genuinely absent rather than merely empty, and an absent panel is a claim: a user who clicks through during it can reasonably conclude the data doesn't exist.
- **The Dimensions chip row gained the same skeleton the co-occurrence row already had.** It rendered on `serverThemeDimensions[t.id] || []` and drew nothing when empty. That was fine when counts and extras arrived together; with the split, Dimensions land in phase 2 up to **~18s later on a cold load**, so the row silently vanished for that whole window — reading as "this dataset has no dimensions" rather than "not here yet". Now gated on `extrasLoaded`, so a theme with genuinely no tagged rows still collapses to nothing once the phase completes. The flag was renamed `cooccurrenceLoaded` → `extrasLoaded` because it now governs both.
- **The bulk row fetch now WAITS for the counts phase.** It used to start on mount, concurrently with the counts scan, and the two **contend on the same instance**: counts measured 13.4s in isolation but **24s** running alongside the 50K-row fetch, which pushed cold time-to-cards to 26.1s — worse than the 20.4s it replaced. Concurrency against this database has lost every time it has been measured (ten parallel sample pages made *every* page hit the statement timeout). Deferring the rows until phase 1 settles measured cold **time-to-cards 26.1s → 19.8s**, now marginally ahead of the pre-change baseline, with settle unchanged (~45s). The trade is deliberate and visible: cards much sooner, Clouds/Compare/Comments somewhat later. Every terminal bail-out in the counts effect releases the fetch (`startRowFetch`, a one-shot ref) — a dataset with no mined themes issues no counts request and must not wait for a phase that never runs; only the transient "selection hasn't settled" return withholds it.
- **Two indicators, different jobs (2026-08-16).** A **heartbeat dot** is always on while a view is pending — it has to be readable at a glance across the whole nav row without pointing at anything — and the **`LottieLoader`** swaps in **on hover**, when you've singled a view out and want confirmation it's actively working. The dot uses a real two-beat-then-rest keyframe (`tm-heartbeat`) rather than a sine pulse, so it reads as alive rather than as a status light. ⭐ The pill uses **`aria-disabled` + a no-op click, NOT the `disabled` attribute** — Chrome fires no mouse events on a disabled button, so hover, and therefore the Lottie, would never trigger.
- **The hover indicator is the standard `LottieLoader`** (2026-08-16 correction). It first shipped as a bespoke pulsing dot plus `cursor: 'wait'` — and Chrome renders `cursor: wait` as *its own* blue spinning cursor, so hovering a pending tab produced a second, non-Lottie spinner. `components/ui/LottieLoader` is the one loader in this codebase; the dot and its orphaned `.tm-nav-pending` keyframe are gone and the cursor is `default`.
- **Nav views whose data is still arriving are DISABLED, not merely marked** — landing on a bare loader is worse than a moment's wait. Gated on `!rowsLoaded` rather than `rowsLoading`: now that the fetch is deferred there is a window where it hasn't *started* and `rowsLoading` is still false, which is precisely when a click would strand someone. `!rowsError` too, so a failed fetch re-enables the tabs instead of locking them forever (the Overview carries the retry). The **active** view is never disabled — a deep link straight to Clouds must still render, and disabling the tab you're standing on would strand the user.
- **Nav views whose data is still arriving carry a pulsing dot** (`NavViewItem.pending`, `.tm-nav-pending` reusing the existing `pulse-dot` keyframe). Clouds / Compare / Comments tokenize and filter the loaded rows client-side, so they can't render until the bulk fetch lands — and now that Overview paints early, they *look* ready when they aren't. They stay fully clickable: the point is that someone who clicks through lands on a loader already knowing why, not that they're forbidden. Deliberately a dot rather than a spinner — three can be pending at once, and a row of spinning glyphs reads as an error state.

**"calculating…" on provisional counts (2026-08-14).** `countsPending` is true while the
server theme-count scan is in flight, and the theme cards + Distribution header label the
counts with it. Any count on screen during that window is provisional — the saved model's
stored numbers, or a client recount that the server scan is about to replace — so it is
marked rather than presented as final. Cleared in a `finally`, since the fetch has an early
return when the response carries no counts and a failed scan must clear the marker too. The
same pass stopped the per-card confidence interval rendering **"95% CI: 0–0%"** before the
rows load: the interval is a client-side computation over the loaded rows, and the old
`?? 0` fallback put a fabricated statistic next to a real count.

**`/aggregate` scalar ops — filter-aware + sampled at scale (2026-07-13, perf review §7 Brief C + Brief F escalation #1).** The five scalar chart/stat aggregates — `crosstab_counts`, `group_numeric_stats`, `date_series_stats`, `count_field_values`, `numeric_field_stats` — were full O(N) jsonb scans that **(a)** 57014'd at ~1M rows and **(b)** ignored active filters (full-dataset numbers under a filtered UI, while the sibling taxonomy family already honored them). Both closed in `sql/169` + `lib/sampledAggregate.ts`:
- **Filter-awareness:** each exact RPC gained `p_row_ids bigint[] DEFAULT NULL` (`id = ANY(p_row_ids)`, the same predicate the tax family uses). `ChartsModule.useAggregation` now forwards the view's `filteredRowIds` to **every** spec (the `isTax`-only gate was dropped; `fieldKey` stays tax-only), so scalar charts reflect filters. The route appends `p_row_ids` and drops it on `PGRST202` (deploy-order safe — an un-migrated DB answers without filters, the pre-fix behavior).
- **Sampling:** each RPC gained a keyset-paged `sampled_*` twin over `idx_drf_sample` (same 50K sample the bulk-rows route serves + the metric strip counts over). The route routes to the twin when `datasets.row_count > 50K`, scales **counts** by `total/scanned`, and reports **means/medians/stddev UNSCALED** (a uniform sample's mean/quantile is a direct population estimate; percentiles ride raw values to Node since they can't merge from partial aggregates). The twins also take `p_row_ids` so a filtered above-cap view narrows the numerators without touching the sample-walk denominator. Twin failure (incl. pre-migration `PGRST202`) falls back to the exact RPC. Charts carry a dataset-level "≈ Estimated from a 50,000-row sample" affordance (same "~" doctrine as the strip) when `totalRows > 50K`. Verified sampled-vs-exact within ±2% on proportions (56K/128K) and no-57014 on the 1M PERF TEST (`scripts/_verify_aggregate_sampled.mts`). StatsModule's scalar tests already compute client-side over the loaded sample (filter-applied); only its **dimension** tests hit `/aggregate` and were made filter-aware in Brief F. **Collections don't reach this route** — the client renders their charts from raw rows.

**Dimensions (taxonomy) charts are sampled at scale too (2026-07-13, perf review §7 Brief C Part 3, `sql/171` + `lib/sampledTaxonomy.ts`).** **Since 2026-09-04 the tax_* ops go EXACT up to 200K rows** (`TAX_EXACT_CAP` in aggregateOps): the 57014 that justified sampling was measured at ~1M, and the deterministic block sample systematically under-covers small strata on row-order-correlated fields — on ANES (year-ordered rows) 1998 got 1 of an expected ~10 flagged rows into the sample and charted as "100% threat" where the truth was 19% of 26. Exact-when-affordable beats a biased estimate; the twins remain for >200K. The five `tax_*` aggregates (`taxonomy_sub_counts`/`group_stats`/`crosstab`/`date_series`/`axis_crosstab`, sql/164) unnest `data._tx` over every row and 57014 at ~1M **once a taxonomy rollup is registered** so `taxonomy_field_or_primary` resolves a field (`taxonomy_sub_counts` measured 8.1s at 1M). Each gained a keyset-paged `sampled_taxonomy_*` twin over the same 50K `idx_drf_sample`; the route routes to the twin when `row_count > 50K`, scaling **counts** by `total/scanned` and reporting **means/medians/quartiles/stddev UNSCALED** — identical doctrine to the scalar twins above. Per-question resolution (`p_field_key` → `taxonomy_field_or_primary`) rides into each twin so the source-field picker keeps driving dimensions; `p_row_ids` narrows numerators for a filtered above-cap view. Twin failure falls back to the exact RPC (`PGRST202` deploy-order safe). The dataset-level "≈ Estimated from a 50,000-row sample" affordance already covers dimension charts (it's keyed on `totalRows > 50K`, op-agnostic). Verified sampled-vs-exact within ±2% on the 128K Outback and no-57014 on the 1M PERF TEST (`scripts/_verify_taxonomy_sampled.mts`, which temporarily injects a rollup so the resolver fires, then reverts).

**Theme-prevalence bars are filter-aware too (2026-07-13, Brief F escalation #2, `sql/170`).** The Charts `liveThemeCounts` → `/theme-counts` bars showed dataset-wide % under a filtered UI because the numerator (`count_theme_matches`) and denominator (`count_nonempty_rows`) took no filter param. Both gained `p_row_ids`; ChartsModule forwards the view's `filteredRowIds` in the POST (in the cache key + a stable id-signature in the effect deps so it re-fetches on filter change, incl. the async null→ids transition). The route skips its sampling path when filters are active (the id set is bounded ≤ sample → exact) and drops `p_row_ids` on `PGRST202`. Verified filtered numerator/denominator parity vs an independent JS count.

**Theme-card extras are sampled at scale too (sql/173, perf review §7 Brief E item 2).** The three optional `/theme-counts` extras — the **co-occurrence matrix** (`compute_theme_cooccurrence_matrix`), **topical words** (`extract_theme_topical_words`), and **per-theme Dimensions** (`theme_dimension_counts`) — each full-scan `dataset_rows_flat` per member and 57014 at ~1M (deferred by sql/170 as "not the reported bug"; closed here). Each gained a keyset-paged, **multi-theme** twin over the 50K `idx_drf_sample` (`sampled_theme_cooccurrence_page` / `_topical_page` / `_dimension_page`, sql/173) via `lib/sampledThemeExtras.ts`: one page RPC covers every theme (a member needs ~10 calls, not ~10×N), Node merges the per-page partials and scales counts by `total/scanned`. The route routes a member to the twin when its `row_count > 50K`, else the exact per-theme RPC unchanged; twin failure falls back to exact (`PGRST202`-safe). A single-call sample aggregation isn't viable — heap-fetching the 50K sample's full `data` runs ~30s at 1M — so paging is mandatory (same reason the counts twins page). Topical's canonical stopword list moved to the shared `topical_stopwords()` SQL function (used by both the exact and sampled paths, ending the "keep in sync" duplication). Verified sampled-vs-exact within ±3% on 128K Outback and no-57014 on the 1M PERF TEST (`scripts/_verify_theme_extras.mts`).

### API: `POST /api/datasets/[datasetId]/merge-themes` (collection theme-merge)
On a **collection** dataset, TextMine's "merge" mode ("import component topics") fetches each member's existing `theme_model` (members with ≥1 AI-mined theme; needs ≥2 such members) and calls this route to AI-merge them into one unified set (shared vs. unique themes, tagged with `memberLabels`). **Same key policy as mine-themes** — falls back to the platform `ANTHROPIC_API_KEY` when no personal `apiKey` is supplied (the **2026-06-28 fix** removed a stale `NO_API_KEY` rejection that blocked the merge for orgs without a personal key, even though mining worked); `merge_themes` usage is logged per-org. **Members without mined themes are silently excluded** — mine themes on each member first to include it.

### recountThemes() — Core Algorithm (`lib/themeUtils.ts`)
1. Filter rows to non-empty text
2. Pre-compile keyword regexes (lemma-aware, case-insensitive)
3. Per theme: count matching rows, score sentiment, accumulate ratings
4. Compute: percentage, Wilson 95% CI, sentiment classification, avgRating, ratingDelta, per-keyword ratings
5. Performance: O(rows x themes x keywords), single pass

### Signal-stats toolbar (`lib/signalStats.ts`)
**Date-field range (2026-06-24):** `computeFieldStats`/`mergeSchemaStats` (`lib/datasetUtils.ts`) now persist true `dateMin`/`dateMax` on date fields (`SchemaFieldConfig` in `analyzeTypes.ts`), widened across incremental sync batches — the categorical `values` list is still capped at 500 (which, sorted ascending, used to drop the *recent* end on long-running review datasets). The `FiltersModal` review-date slider takes its absolute domain from the **union of schema `dateMin`/`dateMax` and the loaded-row extents**, so the recent end can't be lost whichever path truncates.

The TextMine strip ("N comments · M signals · theme-fit X% · K themes · ★ R avg rating · 📅 date range") and the
`/analyze` listing cards are powered by `computeSignalStats`. **Terminology (2026-06-28):** the text unit is called **"comments"** everywhere user-facing (strip label, theme cards "N comments", theme-fit tooltip "% of comments", listing card). The internal field/property stays `records` (= the exact non-empty analyzed-text count); only the displayed noun changed. ("comments" was chosen over "records"/"verbatims" — see the comments-terminology note; the count is still the max non-empty count across analyzed text fields, `signalStats.records`.) The **date range** and **avg rating**
are added in the `signal-stats` route (not the cached compute). **Tenancy (2026-07-02):** `computeSignalStats` runs on the RLS-bypassing service-role client, so the route resolves `datasets.org_id` and 404s on a cross-org caller (admin-org bypass) **before** any read — matching the gate on `theme-counts`/`signal-stats-batch`. It previously authenticated the caller but skipped this org check, a cross-tenant read leak fixed here. The date range comes from
`datasets.description.start_date/end_date`; the **avg rating** detects the dataset's rating field from
`schema_config` (numeric with `sqt` rating/nps/likert or `scoreField` — the same rule TextMine uses) and
averages it over **ALL rated rows** (every review with a rating, including rating-only reviews with no
comment) via `numeric_field_stats(ratingField)` — so the headline number **ties back to the rating shown
on Google and in a downloaded export.** This is the standing **"ratings = all reviews"** principle: any
*overall/aggregate/location* rating is over all reviews; only *per-theme / per-entity / per-dimension*
ratings are text-scoped (you can only attribute a theme to a review with words), so those can sit slightly
below this headline — the real "comment-leavers rate lower" gap (e.g. Cheddar's all-rated ★4.14 vs
comment-only ★3.90), not a reconciliation bug. **Remapped rating fields** (a survey scale tagged numeric
whose stored values are text labels mapped to numbers via the field's `valueAliases`, e.g. "Highly
Satisfied"→5) are detected (any numeric alias value) and averaged via `field_aliased_avg(field, '', aliases)`
(sql/110, `presentField=''` = no text gate) — which maps each label to its number before averaging, since
the raw value is the label (numeric_field_stats would cast nothing). **Above the 50K cap** both exact
aggregates are full scans that blow the statement timeout (the ★ silently vanished on large datasets), so
the route averages over the deterministic `idx_drf_sample` sample instead — `sampled_numeric_field_stats`
(sql/163, keyset-paged like sql/162, value predicates byte-identical to both exact functions, alias mode
included; pager `sampledNumericFieldStats` in `lib/sampledSignalCounts.ts`) — and returns
`ratingSampled: true` (strip renders `~` + a tooltip note). A uniform sample's mean is unbiased and
includes rating-only rows, consistent with the all-reviews principle (verified on real 56K data:
sampled 4.5830 vs exact 4.5823). Exact path is the fallback if the RPC isn't migrated yet. (Earlier this strip was deliberately
text-only via `numeric_field_stats_present` so it matched the theme/dimension numbers; that was reversed
under the all-reviews principle — the theme/dimension deltas now compare against this all-reviews baseline,
see `recountThemes` below.) Read via the RLS-enforced user client (org-safe, no row scan); shown only when present. `records` is the
**max** non-empty count across the saved theme model's fields (summed across
collection members); `signals` / `inThemes` come from `count_theme_matches`.
**Sampled above the cap (2026-07-11, first-open audit):** the exact counters are
FULL SCANS per call (1 + themes + 1 of them) — past ~50K rows each scan reads
GBs of jsonb and blows the DB's 8s statement timeout (the 785K prod dataset
500'd the strip even post-VACUUM; it's volume, not bloat). Members above
`SIGNAL_SAMPLE_CAP` (50K) now compute all three count groups in **one
keyset-paged pass over the deterministic `idx_drf_sample` sample** —
`sampled_signal_counts` (sql/162, same sample the bulk rows route serves, same
regex semantics as `count_theme_matches`; pager in `lib/sampledSignalCounts.ts`)
— scaled to the member's total rows and flagged `sampled: true` (strip renders
"~" + a tooltip note; verified ±1.3% of exact on a 128K TEST dataset). Members
at/under the cap stay exact; if the RPC isn't migrated yet the exact path is the
fallback. `theme-counts` (TextMine/Charts) uses the same sampled pass above the
cap (response gains `sampled` + `sampleSize`, surfaced as "N of M responses
sampled").

**Entity counts sample for COLLECTIONS too, not just single datasets (2026-08-15, from Sentry).** `entityFilter.computeEntityCounts: canceling statement due to statement timeout | 57014` from `GET /api/cron/entity-discovery`, **12 events** — the most frequent production error. The sampled path was gated on `singleDataset && total > ENTITY_SAMPLE_CAP`, on the stated assumption that a collection is "many small member datasets, not 1M-row ones". A collection whose members *sum* above the cap therefore took the exact `count_entity_terms` path and 57014'd. Worse, the error is logged-and-swallowed (`if (countsErr) void logError(...)`, then the empty map is returned), so a failed run produced **empty counts rather than a loud failure** — entities silently showing zero mentions. Now anything above the cap samples: members split `ENTITY_SAMPLE_CAP` proportionally via `allocateSampleShares` (the same allocator the bulk-row path already uses for collections), and each member's counts scale by **its own** row total before summing, so a large member can't distort a small one's contribution. ⏭ The logged-and-swallowed empty-count path is still there by design ("best-effort, never breaks its caller") — worth revisiting, since an empty count reads as a real zero.

**Signal stats degrade to the sample when the exact path times out (2026-08-15, from Sentry).** Production reported `count_nonempty_rows failed … canceling statement due to statement timeout` on `GET /signal-stats` for a **27,234-row** dataset — comfortably *below* the 50K cap, so on the exact path. Being under the cap is not the same as being safe: the exact count measured **2,431ms on TEST**, and prod runs this RPC roughly **2.5× slower** (7,981ms vs 3,171ms on the same Carrabba's call), which puts a mid-size dataset around 6s against an 8s statement-timeout ceiling — any contention tips it over. `countNonEmptyRows` correctly **throws** rather than swallowing to `0` (so the Rubio's/BareBurger cache-poisoning class does not fire here), but the throw propagated out of the route and blanked the entire metric strip. `computeSignalStatsRaw` now catches a statement timeout (57014, or the message PostgREST surfaces) on the exact path and falls back to the same sampled path used above the cap, flagged `sampled: true` so the existing "Sampled" chip discloses it. Non-timeout errors still throw — only timeouts degrade. A labelled estimate beats a 500.

**`/theme-counts` gained the same server-side cache (2026-08-14).** It had none —
only the per-tab-session `clientRequestCache`, which dies on page reload — so
every fresh TextMine load of a dataset above the cap re-ran **three** independent
10-page keyset scans over the sample. Measured cold on the 128,619-row Outback
GuestLens dataset (6 themes, TEST): `sampledSignalCounts` **13.4s** +
`sampledThemeCooccurrence` **9.1s** + `sampledThemeDimensions` **10.9s** =
**33.4s per load, forever**. (Each page is ~1.6s of regex over 5,000 rows and the
pages are CPU-bound in the database, not latency-bound: firing all ten
concurrently with precomputed boundaries only takes 15.9s → 11.5s, so paging in
parallel is not the fix — caching is.) `lib/themeCountsCache.ts` now stores the
whole payload in `dataset_state.analytics.theme_counts`, a slot map keyed on a
hash of the theme model (ids + lowercased, sorted keywords) + fields + the
`cooccurrence`/`topical`/`dimensions` flags, with the row count checked for
freshness — so a theme edit or a sync invalidates exactly as they already do for
`signal_stats`, while a cosmetic reorder does not. Measured warm on the real
endpoint: **~0.6–0.7s** (dev-mode overhead included) vs 33.4s. Bounded to 6 slots
(LRU by `computed_at`) and skipped above 512KB, since the co-occurrence matrix is
N×N in themes. Filtered requests (`p_row_ids`) are never cached — per-view by
definition, and already bounded/cheap. `invalidateSignalStats` drops the
`theme_counts` key too, for the changes the key can't see (a substantive backfill,
a re-classify that moves the per-theme Dimensions breakdown).

Signal-stats results are cached in `dataset_state.analytics.signal_stats`, keyed on **both**
the theme-model hash **and** the current row count: editing/re-mining the themes
flips the hash, and syncing rows in/out changes the count — either forces a
recompute on the next read. **The freshness row count is the stored
`datasets.row_count`** (summed over collection members; 2026-07-11) — the old
exact head-count was an O(N) scan on every call *including cache hits* just to
validate a ~50ms cache read; stored-column semantics match the bulk rows
route's sampling gate, and null (legacy) falls back to one exact count. **Atomic analytics writes (2026-07-02):**
`dataset_state.analytics` is a shared JSONB blob (independent keys `signal_stats`,
`totalRows`, `fieldSummaries`…). All writers now go through
`lib/datasetAnalytics.ts` (`mergeDatasetAnalytics` / `deleteDatasetAnalyticsKey`
→ jsonb `||` / `-` RPCs, sql/145) so each touches only its own key — the prior
read-modify-write let a concurrent writer (e.g. the compute route) clobber the
cached `signal_stats`. **Bulk-row cap (2026-07-02):** `GET
/api/datasets/[id]/rows?all=true` reservoir-samples while paging, bounded by
`BULK_ROWS_HARD_CAP` (50K), so it never buffers a full 500K-row dataset into
memory even when the client omits `sampleMax` (the cap previously lived only in
the TextMine client). **Above the cap**, the route takes a SQL-side
deterministic **O(sample)** sample via `sample_dataset_rows` (sql/160): the
`cap` rows with the smallest uniform `hash(id‖dataset_id)`, served by the
`idx_drf_sample` expression index as an **index range scan**, paged by the
`(hash, id)` keyset with each page a single jsonb value. Only the ~50K sampled
rows are heap-fetched, so a load costs the same at 100K, 1M, or 10M rows — and
the expression index self-maintains on every insert, so appended rows
participate immediately (datasets grow continuously via syncs/appends). **Fix
history (sql/160, 2026-07-10):** the first dataset to cross the cap (56,117-row
upload) hit the route budget. sql/157 (`ORDER BY md5 LIMIT`) re-sorted a
disk-spilling full-jsonb sort per page (→ 30s timeout); an un-paged jsonb call
truncated to PostgREST's 1000-row cap (→ themes mined from ~1K rows instead of
~43K, owner-caught); an interim `row_index` keyset over a hash predicate was
O(total)-scan and climbed with dataset size (real 514K = 46s). The indexed
design is flat (~16-22s at any size, verified stable after appending 20K rows).
Deterministic per dataset (D6). `maxDuration` 60s. **Collections (2026-07-12,
first-open audit):** the collection union used to JS-page EVERY member fully
(O(total across members) — a 184K-row brand collection was ~184 serial
1000-row requests), the same disease sql/160 cured for single datasets. When
the members' stored row counts sum past the cap, each member now contributes a
**proportional share** of the same deterministic sample (`allocateSampleShares`
+ shared pager `pageSampledRows` in `lib/bulkRowSample.ts` — also used by the
single-dataset path; floored shares never exceed the cap, non-empty members
get ≥1 row). Verified live on TEST: 128,619+56,117 members → 34,811+15,188 =
49,999 unique sampled rows in ~21s. At/under the cap the full-union reservoir
path is unchanged. **Trim (2026-07-12):** the Schema-tab "remove rows before a
date" flow (`POST /trim`) deletes in 1000-row select→delete ROUNDS until the
cutoff is fully applied — PostgREST caps every select at 1000 rows (verified
live), so the old single select silently trimmed at most 1000 matching rows
per click while reporting success. A 45s budget returns `hasMore` and the
client loops with progress. The post-trim analytics recompute now goes through
`mergeDatasetAnalytics` (per-key, sql/145 doctrine) — the old full
`.update({analytics})` wiped `signal_stats`/`signal_stats_by_field`/stored
`taxonomy` rollups. Comma-containing date field names get an explicit 400 (the
raw filter silently matches nothing, sql/161 class). Trims need no special
cache/sample handling beyond this: deleted rows leave the deterministic sample
automatically (expression index) and the row-count recount invalidates every
stats cache on the next read. **Poisoned-cache self-heal (2026-06-25):** the cache key (hash + row_count) can't see a *malformed* cached value, so a cache with `records === 0` but `signals/inThemes > 0` (impossible — `records ≥ inThemes`) is treated as poisoned and force-recomputed. This shape came from `computeSignalStatsRaw` swallowing a transient statement-timeout on the exact-count `records` query (→ `null → 0`) while the theme-match RPCs in the same parallel batch succeeded; the records query now **throws** on error so a bad partial is never persisted (the batch endpoint catches → next load retries). **Error visibility (2026-07-10):** the other Supabase `if (error)` branches in `signalStats` fire-and-forget `logError` (they degrade gracefully — a card just renders without its stats line, not a 500). Each now passes `{datasetId}` so Sentry names the failing dataset, and `logError` prefixes the operation (`where`) into the title so an empty-message driver error reads `signalStats.resolveDatasetIds: {"message":""}` instead of a context-free `{"message":""}` that groups unrelated failures. The row-count key matters because a sync that adds
rows leaves the theme model (and its hash) untouched, which previously left the
strip frozen at a stale snapshot while the live Themes panel counted the new
rows (Coalition Donor collection, 67 cached vs 80 live). Note this strip can
read **lower** than the Themes panel's "responses": the panel counts the
**union** of currently-active fields (`.some()` non-empty), while `records`
takes the single largest field — they intentionally use different denominators.

**Listing card stats (2026-06-27):** the `/analyze` `DatasetCard` second stat row shows **comments** = `signalStats.records` (the exact non-empty text count, *not* a sample), falling back to "rows" (`row_count`) when no signal stats exist; the signals stat carries a density readout **"(signals ÷ comments per comment)"**. Both reuse the already-loaded `SignalStatsBrief` — no extra query. The card also surfaces a **"✎ Brand glossary"** link on brand cards and on any dataset with a `brand_collection_id` (→ `/collections/[id]/glossary`, the Phase-5 editor).

**Source filter (2026-06-27):** the listing `DatasetFilterBar` source pills are **All · Surveys (`study`) · Uploads (`upload`) · Agents (`bot`) · Reviews (`google_reviews`) · Town Halls (`recording`) · PulseIQ (`townhall`) · Other**. "Other" is a **catch-all** = any `dataset.source` not in `NAMED_SOURCES` (so reddit/substack/collection/regulations stay reachable without their own pill — `AnalyzeClient` filter logic). `bot` (Agents) + `recording` (Town Halls) are real DB sources now declared on the `source` union (`analyzeTypes` + `DatasetHeader`) and given 🤖 Agent / 🎙 Town Hall card badges + detail-header labels (previously both rendered as generic "Upload").

**Collection management (2026-06-28):** the collection card's ⋯ menu has **"👥 Manage members"** (`ManageMembersModal`) — full add + remove in one checklist: current members load **pre-checked** (from `GET /api/collections/[id]`, now admin-aware so cross-org collections load), uncheck to remove, check others to add, **Save** applies the diff. Add → `POST /api/collections/[id]/members`; remove → `DELETE /api/collections/[id]?member=`. **Both recompute** the merged schema (`buildMergedCollectionSchema` over the remaining/new full set) + `datasets.row_count` (the remove route did neither before). `[id]` = the collection's dataset_id; both the GET (read members) and DELETE (remove) are **admin-aware** (collections can live in a client org). Add mirrors the create route's validation (same-org, no nested collections, dedupe). Also fixed: **deleting a collection silently failed for cross-org collections.** An admin-org user can *create* a collection whose members belong to a client org (the create route honors `isAdmin`), so the collection lives in the **client** org — but the generic `DELETE /api/datasets/[id]` looked the dataset up with the auth client hard-locked to the caller's own org (`.eq('org_id', orgId)`), found 0 rows, returned **404**, and `AnalyzeClient.handleDelete` swallowed the non-OK response (looked like nothing happened). Fix: look the dataset up via the **service-role** client and enforce tenancy explicitly — **admins may delete cross-org** (symmetry with create), non-admins stay scoped to their org. Collections also skip the `created_by` creator-only gate (they're shared groupings; members survive deletion); normal datasets stay creator-only. `handleDelete` now alerts the server error instead of failing silently.

**Project report — synthesis roll-up (2026-06-28).** The collection card's ⋯ menu has **"📊 Project report (PDF)"** → a complete, source-attributed brand-level report synthesized across every town hall + agent in the collection. Distinct from the Ask Ana preview (which *samples*): this aggregates the per-input report **models**, so every Q&A pair and community comment is present and tagged with its source ("Town Hall · Jun 16" / "via Sarina").
> - `lib/projectReportLoad.ts` (server-only) normalizes each member into a `ProjectInputModel` — town halls from `recording_extractions` + `proceedings_summary`; agents from the cached Agent Study (`getAgentStudy`: `publicComments`, focus Q&A, KB summary). **Community voices only** — `isPanelMember` drops panel-authored content here (single source of truth).
> - `lib/projectReport.ts` `buildProjectReportModel()` — deterministic by-topic pooling with source tags, then **AI synthesis**: `synthesizeThemes()` merges synonymous topics across inputs into unified brand themes (e.g. "Funding" + "Budget" → one), `synthesizeExec()` writes the cross-input executive summary. AI only names/merges/summarizes; **all counts are computed in code so they reconcile**.
> - `lib/projectReportHtml.ts` renders it, **reusing the same shared `sourceSummary` + `commentary` renderers** as the per-input Town Hall + Agent reports (commentary now carries a `source` badge) so the project report reads as their sibling — sources manifest, per-input presentations/KB, merged themes with source-attributed Q&A, community commentary, aggregated entities/sentiment.
> - Routes: `GET /api/collections/[id]/project-report` (HTML) + `POST …/pdf` (download, headless Chrome via shared `lib/htmlToPdf.ts`) + `POST …/pptx` (Datanautix deck — **added 2026-06-29**). `[id]` = collection dataset_id; admin-org may build cross-org, non-admins org-scoped; `maxDuration` 300 (synthesis + agent-study compute). Verified end-to-end on the real NOWOCATS Collection (2 town halls + Sarina → 11 merged themes, panel excluded). All three formats share one model: `buildProjectModelForCollection` (in `lib/projectReportLoad.ts`) gates + loads + dispatches purpose → returns a discriminated `ProjectBuilt` (`kind: 'community'` → `ProjectReportModel` / `kind: 'compare'` → `CompareReportModel`); the HTML/PDF routes render it to HTML, the PPTX route renders it via `lib/pptx/projectReportDeck.ts` (`renderProjectReportDeck` → shared cream `renderDeck`). Community deck = at-a-glance KPIs + exec bullets + themes table + top-theme quote slides + entity grid; comparison deck = at-a-glance + exec + themes matrix table (focus brand ★, ▲▼ significance) + Dimensions matrix (when classified) + rating-over-time delta table.
> - **PDF template standard** (`lib/htmlToPdf.ts` `brandedPdfChrome`): every PDF gets a per-page running header (brand/project name, top-right) + footer (confidentiality · datanautix wordmark + datanautix.com · "Page X of Y"), and the renderer uses a `.keep` wrapper so a section title never orphans at a page bottom. **Apply to every new PDF template** (see `docs/ENGINEERING.md` + the `feedback_pdf_template_rules` memory). Shared **PDF design system** (`lib/pdf.ts`): tokens (font, colours, type scale), `pdfBaseStyles()`, `pdfDoc/pdfSection/pdfKpiGrid/pdfCoverHeader/pdfSentPill` — the single source of truth every PDF renderer composes with.

**Collection freshness / refresh (2026-06-28).** A collection's cached layers — merged `schema_config`, `row_count`, and `analytics` — are point-in-time snapshots computed at create/add/remove. They DON'T auto-update when a member dataset later changes (syncs new rows, gains fields/Dimensions, is re-analyzed). The `/analyze` listing now detects this: per collection it compares each member's `max(updated_at, last_synced_at)` against the collection dataset's own `updated_at` (its last recompute, +5s grace for write jitter) and sets `members_updated`. When true, the collection card shows an amber **"↻ Members updated — refresh"** badge → `POST /api/collections/[id]/refresh` (org-gated, admin-aware) → `refreshCollection` (`lib/collectionRecompute.ts`): rebuild merged schema over current members → `recomputeCollectionAnalytics` (analytics + row_count + drop signal-stats cache) → bump `updated_at` (clears the badge). The card then calls **`router.refresh()`** (NOT a full `window.location.reload()`) so the server re-renders the list and clears the badge **without losing the client search / source-filter / sort state** held in `AnalyzeClient`. The `/analyze` filter bar also has a dedicated **"Collections"** source pill (`source='collection'`; added to `NAMED_SOURCES` so collections no longer fall under "Other"). The add/remove member routes also bump `updated_at` so a just-edited collection isn't immediately flagged. NOTE: the project/competitive **reports** already read members' LIVE data each gen (`loadProjectInputs`), so new rows/Dimensions flow into reports automatically — only the collection's own cached schema/aggregates go stale, which is exactly what refresh fixes.

**Persisted purpose (2026-06-28).** A collection's purpose is now a first-class property — `collections.purpose` (`community|competitive|brand_360`, nullable; sql/138). It's set at **creation** in `NewCollectionModal` (a purpose picker with an "Auto" default that smart-infers from the selected members: all town-hall/agent → community, else competitive; the create route applies the same default when no explicit pick) and drives which report the **card** offers: a competitive collection shows only "Competitive report", a community one only "Community report", etc. — instead of dumbly offering all three (a competitor set wrongly offered a "Community report"). Legacy collections with `purpose = NULL` fall back to showing all three (back-compat). The collection card's report items + Manage members were also **moved to the TOP of the ⋯ menu** (they were buried at the bottom of a long menu and hard to find). The report builder still accepts a `?purpose=` / body `purpose` override (the persisted value is the default, not a hard lock). Member-count rollup in the `/analyze` listing now uses a service-role read (the collection set is already RLS-filtered) so an admin viewing a cross-org collection sees the true member count — fixes "0 datasets despite 16,989 comments" (RLS hid cross-org `collection_members` from the admin's RLS client).

**Purpose-typed reports (2026-06-28).** The report adapts to the collection's purpose; a `?purpose=` / body `purpose` overrides the smart default (`inferPurpose`: all town-hall/agent → community, else competitive):
> - **community** — `lib/projectReport` (themes/voices across meetings + agents; built earlier).
> - **competitive** + **brand_360** — one shared comparison engine `lib/projectCompare.ts` (`buildCompareModel` + `renderCompareReportHtml`): each input is a column, themes aligned across columns into a matrix (cells = volume + dominant sentiment + avg rating). **competitive** is a **primary-focused deep-dive** — a designated focus member (body `primary` = dataset_id; defaults to first) titles the report and is highlighted ★ Focus; the AI exec + per-theme insights are written from its POV vs. the benchmark field. **brand_360** triangulates one brand's data sources (agreement vs divergence). AI aligns/labels; matrix counts are deterministic.
> - **Shared-theme alignment (2026-06-28) — fixes flaky matrices.** The matrix used to mine **each member's own** themes and AI-merge them per report — non-deterministic, so a run could split synonyms into duplicate rows ("Special Occasions" vs "Special Occasions & Celebrations") with blank cells. Now every member is scored against **ONE shared theme set** (keyword match via `scoreSharedThemes`/`buildKwRegex` over a one-time row read in `loadGenericInput`, `sharedThemes` threaded from `loadProjectInputs`), so all columns carry **identical labels** → the matrix aligns by exact label, no AI merge, no blanks. The shared set is the collection's own `theme_model` when present, else a deterministic **collapse** of the union of members' themes (`deriveSharedThemes`: greedy label-token / keyword-Jaccard clustering, union keywords — chosen over re-mining from raw text). Sentiment is rating-derived (≥4 pos / ≤3 neg) per member-theme. Falls back to per-member + AI-align only for ad-hoc groupings with no shared set.
> - **Statistical significance (2026-06-28, competitive only):** each non-focus cell carries a two-proportion z-test (`twoPropSig`) of its share on the theme vs the **focus** column's → renders **▲/▼ sig.** (higher/lower) / **ns** with a legend. Large samples make most gaps significant — the value is surfacing the rare **ns** (true parity).
> - **Normalization (2026-06-28):** cells show the **% of that competitor's reviews** on each theme with the raw count in parentheses; the AI exec + per-theme insights compare on the % basis (the brands differ in size, so raw counts aren't comparable). Also: trailing-padding/`:last-child` margin reset in `lib/pdf.ts` + the project renderer kills the blank-last-page edge case in `page.pdf()`. Each input's themes come from: recordings → `analysis_summary.topic_summaries`; agents → focuses; reviews/CSAT/upload → `theme_model` (generic loader in `projectReportLoad`). `loadInputsForDatasets` loads an ad-hoc grouping (not-yet-a-collection). Verified: real Ruth's-Chris competitive deep-dive vs Capital Grille/Nobu/Tabla (65.5K reviews). brand_360 code-complete (no real one-brand-many-sources collection exists yet to demo).
> - **Statistical significance (2026-06-28, competitive only):** each competitor cell carries a `sig` flag from a **two-proportion z-test** of that competitor's share on the theme vs the **focus** column's share (`twoPropSig` in `lib/projectCompare.ts`; n = each column's `rowCount`, x = the cell count). The matrix renders **▲ sig.** (significantly higher than focus) / **▼ sig.** (lower) / **ns** (tested, not significant) under each non-focus cell, with a legend in the matrix note. brand_360 has no focus → no significance computed (`sig` undefined). NOTE: with large review samples almost every gap clears p<0.05 — the real value is flagging the rare **ns** (genuine parity, e.g. a 17% vs 16.9% theme).
> - **Dimensions matrix (2026-06-28):** for inputs that carry the ABSA taxonomy (`google_reviews` etc.), the competitive + brand_360 reports render a **second matrix — "Dimensions comparison"** — below the themes matrix, comparing the fixed aspect taxonomy (`Axis: Sub`, e.g. "Service: Wait Time") across the same columns. Same `buildMatrix` engine, same cell shape (volume % + sentiment + avg ★). Each input's dimensions are loaded by `loadDimensionsForInput` (`projectReportLoad`) via the **server-side aggregate RPCs** (`taxonomy_primary_field` + per-axis `taxonomy_sub_counts`/`taxonomy_group_stats`, sql/115) — NOT a per-row read — so a competitive set of 10–30K-row datasets stays cheap (1 + 7×2 lightweight queries per input, no paging). Sentiment is rating-derived (avg ★ per sub: ≥4 positive, ≤3 negative, else mixed). The whole section is omitted when no input is taxonomy-classified (recordings/agents → `dimensions: []`).
> - **Rating trajectory (2026-06-29):** the **competitive** report renders a **multi-line rating-over-time chart** (after the competitors manifest, before the theme matrix) so a reader sees whether each brand is climbing or sliding and how far apart they are — the focus brand emphasized (thick/dark line + bold legend). Data: `loadGenericInput` computes a compact `monthlyRatings` aggregate (`{ym,sum,n}`) for free from the rows the shared-theme path already reads (`readMemberRows`, ≤80K cap → full for typical 8–30K sets), gated to review inputs with dates. `lib/ratingTrend.ts` (`buildRatingTrend`, pure + unit-tested) re-buckets to a **dynamic cadence** via `lib/trendWindows` (month/quarter by span, ~6–12 points), clamps the y-axis to the actual star range, and computes a **recent-vs-prior Δ** per competitor (▲/▼ in the legend, with a ≥10-review min-bucket guard). Rendered as **inline SVG** (`renderRatingTrendSvg`, PDF-safe). Needs ≥2 dated review inputs, else omitted. Same dynamic-window helper feeds the Dimensions/theme Heads-Up trend alerts.

> **Org gate (cross-org READ fix, 2026-06-08):** the body-driven server query routes that read tenant rows with the service-role client — `POST /api/datasets/[datasetId]/theme-counts`, `…/theme-impact`, and the listing-page `POST /api/datasets/signal-stats-batch` — previously authenticated the caller but never checked their org, so any logged-in user could mine another tenant's theme counts / topical words / signal stats by posting their `datasetId`(s). All three now resolve the caller's `org_id`+`is_admin_org` and gate the dataset (404 cross-org; admin-org bypass), and `signal-stats-batch` filters the requested ids to those the caller's org owns. Their already-gated siblings (`aggregate`, `rows`, `comments`, `taxonomy`) were unaffected. See `docs/SECURITY.md` § 2; regression in `tests/integration/dataset-query-routes-gate.test.ts`.

### Sentiment Scoring (Lexicon-Based, `lib/sentimentLexicon.ts`)
- `POSITIVE_WORDS`: good, great, excellent, amazing, friendly, clean, helpful, etc.
- `NEGATIVE_WORDS`: bad, terrible, slow, rude, dirty, expensive, disappointing, etc.
- `NEGATORS`: negation flips polarity, checking up to 3 preceding words
- `classifySentiment(pos, neg, minResponses=5)` returns one of:
  `'positive'` (≥70% pos), `'negative'` (≤30% pos), `'mixed'` (between),
  `'insufficient'` (total scored words < `minResponses`). `'neutral'` is only kept
  as a fallback when a theme has zero matched rows.

---

## Entity Discovery & Catalog

A flat, scope-level catalog of the named entities a dataset talks about — dishes,
drinks, places, people, brands. Surfaces "who/what was mentioned" alongside themes.

**Why the rebuild (May 2026):** v1 ran per-row NER on comma-split cell fragments and
produced garbage entities ("attentive", "Great food", "service"). v2 separates two
concerns: *discovery* (a small sample tells us the **list** of entities) and *counting*
(full-text search gives **accurate counts** across the whole dataset, not a sample).

### Scope model

Entities are catalogued per **scope**, not per dataset+field:
- A **plain dataset** reads its own catalog — scope `('dataset', dataset_id)`.
- A **branded dataset** (`datasets.brand_tag` set) reads a shared **brand-collection**
  catalog — scope `('collection', brand_collection_id)`. A brand's datasets across
  every source (reviews, survey, Reddit…) share one catalog.
- A **collection** virtual dataset reads its collection catalog, counted across members.

Brand-collections are auto-curated: a free-text `brand_tag` on a dataset find-or-creates
the brand-collection and syncs membership via DB triggers (migrations 060–062).
`lib/entityFilter.ts::resolveEntityScope` maps any dataset id to its scope + member list.

### Discovery (`lib/entityDiscovery.ts`)
1. Resolve the dataset's scope; sample ~500 rows at random across its member datasets
   (`DEFAULT_SAMPLE_SIZE = 500`, clamped to `[25, 1000]` via `opts.sampleSize`).
2. Concatenate **only the schema-selected entity-extraction fields** of each row; batch
   through Claude Haiku NER (`ROWS_PER_BATCH = 25` rows/call, `NER_CONCURRENCY = 4`
   batches in flight). The prompt is **strict** — only specific *named* things, never
   adjectives, sentiments, or generic nouns ("service", "atmosphere", "the food").
3. Aggregate by `slug` (JS mirror of the SQL `slugify()`); merge aliases.
4. **Canonicalisation pass** (`canonicaliseDiscovered`) — per-batch NER produces
   cross-batch near-duplicates ("Filet" / "Filet Mignon" / "Mignon"; "Brussels Sprout" /
   "Brussels Sprouts"). One more Haiku call over the full entity list merges variants
   under one canonical (pre-merge canonicals kept as aliases so the FTS query still hits
   them) while preserving real distinctions ("Lobster" ≠ "Lobster Mac & Cheese"). Best-
   effort — a failed pass just leaves the slug-aggregated map.
5. Upsert the flat catalog into `public.entity_catalog` (UNIQUE on `scope_type, scope_id,
   slug`) — first canonical/category wins, aliases union, `sample_count` accumulates.
6. Log the run to `public.entity_catalog_refresh` (before/after/new counts, sample size,
   cost estimate, duration).

**Provenance + source authority (2026-06-27).** Each discovery run stamps the catalog
rows with a **source-kind** (`source`, `sql/137`) derived from `datasets.source`
(`datasetSourceToKind`: uploaded/published docs → `document`; google_reviews → `review`;
study → `survey`; townhall → `transcript`; reddit → `conversation`) and a `provenance`
trail (jsonb). Reviews / survey responses / ASR are **corroborating** sources: discovery
already first-wins on the canonical, so a UGC run never overrides an existing canonical,
and it never downgrades a `document`/`crawl`/`manual` owner. This authority model
(`lib/correction/provenance.ts`, ENGINEERING.md → "Shared correction layer") only gates the
**correction glossary** (which keeps authoritative canonicals) — the catalog still holds
every entity for TextMine analysis. See BOTS.md §9.y.2c for the agent-KB side.

**Field selection** (`SchemaFieldConfig.entityExtraction`): discovery reads a dataset's
`open-ended` fields *only* — categorical/location/numeric/date/ignored columns are never
fed to NER (they produce noise like "Florida" or "Texas"). Each open-ended field carries
an opt-out flag, toggled per-field on the **Schema tab**: absent/true = included,
`false` = skipped. `eligibleEntityFields()` resolves the set; a dataset with none
selected contributes nothing. **All discovery modes are additive** (manual, cron,
incremental) — a re-run never wipes existing entries. Catalog cleanup is the explicit
"Reset discovered entries" action (POST `/api/datasets/[id]/entities/reset-discovered`),
which only deletes `source='discovered'` rows so hand-curated entries survive.

**Category-restricted discovery** (`opts.excludeCategories`, `opts.autoExcludeFromCurated`):
the NER prompt can be told to skip categories whose entities already have a curated
catalog. The weekly cron and the per-dataset incremental run both pass
`autoExcludeFromCurated=true`, which checks the scope for `source='manual'` rows by
category and adds any category with ≥10 manual entries to the exclude list. Result:
for a brand with a menu seed, the cron stops asking Haiku to surface dishes it
already knows about — saves roughly half the AI cost on brand-collection re-runs
since `food` and `drink` are the bulk of the catalog. The manual "Discover" button on
the Schema tab does NOT auto-exclude (user may want to re-explore even curated
categories). Post-filter on the NER result also drops any excluded-category entity
the model returned despite the instruction.

**Subject context**: field selection stops *structured* location columns from reaching
NER, but the subject brand and its cities are also genuinely written into review prose
("we love Fleming's in Tampa") — a generic extractor flags them as `brand` / `place`
findings. So discovery passes a **do-not-extract list** into the prompt:
`gatherDiscoveryContext()` collects the scope's brand name(s) (`datasets.brand_tag`) and
every categorical field's distinct `values` (cities, states, location labels), and the
prompt instructs NER to skip them — they are what the data is *about*, not findings in it.

`sample_count` is a discovery-frequency hint, **not** a row count — real counts are live.

### Counting (`lib/entityFilter.ts` + `count_entity_terms`)

> **A failed count is not a measured zero (2026-08-17).** `count_entity_terms` 57014s (statement timeout) on large scopes — Sentry recorded 12 such events from the entity-discovery cron. The error was logged and swallowed, leaving an empty count map **indistinguishable from "every term has zero mentions"**, and two things followed from that: `storeEntityMentionCounts` **persisted** the zeros via `apply_entity_mention_counts` (so a transient timeout durably zeroed the catalog), and because default reads drop zero-count entries, the UI then showed an **empty entity list** rather than an error. `computeEntityCounts` now returns **`failed: boolean`**; on failure `storeEntityMentionCounts` **declines to write** (leaving the previous stored counts intact), `getEntitiesWithCounts` skips the background store-refresh, **suspends the zero-count drop** so the catalog can't blank, and surfaces **`counts_failed`** on `EntitiesResult` so a caller renders "couldn't measure" instead of a real-looking zero. Pinned by `tests/unit/entityCountFailure.test.ts` (verified to fail against the pre-fix code). Same defect class as the substantive-count fallback — an unmeasured value must never render as a measured one.

At read time, `getEntitiesWithCounts`
builds one `websearch_to_tsquery` per entity (canonical + aliases OR'd) and calls the
`count_entity_terms` SQL function (migrations 064 + 070) — a single set-based query
across the scope's members. An optional theme query ANDs in a theme's keyword match.
Zero-count entities are dropped from results (self-heals on the next discovery run).

**Stored + sampled counts at scale (sql/172, perf review §7 Brief E item 1).**
`count_entity_terms` ran on EVERY entities read (the card isn't client-cached) and
57014'd at ~1M rows — common terms match hundreds of thousands of rows via the GIN
`tsv` prefilter, × up to ~300 catalog terms. Two mechanisms close it:
- **STORED counts.** Four `entity_catalog.mention_count*` columns cache the computed
  count per row, keyed by the scope's total `row_count` (the signal-stats keying).
  A **default read** (no theme, no field scoping, not the Manage panel) serves the
  stored value with **zero scans** when every row is populated and keyed to the current
  total; otherwise it computes live and fires `storeEntityMentionCounts` in the
  **background** (fire-and-forget) so the next read is a hit. Discovery + manual-add
  both re-store at the end (they already rebuild the catalog). Theme / field-scoped /
  Manage reads always compute live (their counts vary per request).
- **SAMPLED compute** for a **single-member** scope above the 50K cap (plain dataset OR
  a branded upload with no siblings): `sampled_count_entity_terms` (sql/172)
  keyset-pages the deterministic 50K `idx_drf_sample` and matches terms per page (same
  tsv-prefilter + open-ended recheck), page size adapting to the term count so no page
  nears the timeout; the caller scales by `total/scanned` and flags the result
  `sampled: true` → the Entities card shows a "≈ sampled" chip. Below the cap the walk
  reaches every row = exact. Multi-member collections (many small members) stay on the
  live path. Verified sampled-vs-exact within ±2% on Carrabba 56K
  (`scripts/_verify_entity_counts.mts`).

**Open-ended recheck (migration 070)**: `dataset_rows_flat.tsv` is built from *every*
string value in a row — including structured columns like `location`. Counting raw `tsv`
matches meant a place entity ("Tampa") matched every review *located* in Tampa, not the
ones that *mention* it (780 vs. 46 rows for Fleming's). The fix keeps the GIN-indexed
`tsv` as a fast prefilter (an open-ended-only match is always a subset), then rechecks
each candidate against a tsvector rebuilt from *only* the open-ended fields.
`count_entity_terms` and `get_rows_by_entity` take a `p_text_fields` jsonb map
(`{dataset_id: [field, …]}`) that `lib/entityFilter.ts` derives from each member's schema
via `resolveScopeTextFields()` + the shared `eligibleEntityFields()`. The theme keyword
match stays on the full `tsv` (theme keywords are content words, not structured labels).
`p_text_fields` is optional (`NULL` = legacy full-`tsv` behaviour).

### Triggering
Discovery does paid Haiku NER, so each path is gated to run only when it adds value:
- **Manual** — Schema tab → one **"Discover entities"** panel per dataset (not per
  field). POST `/api/datasets/[id]/discover-entities`, mode `manual`. Works for any
  dataset, branded or not.
- **Incremental** (Phase 6) — the compute route calls
  `lib/brandRules.discoverBrandEntitiesIfNeeded` after a branded dataset's analytics
  compute succeeds — the first point its rows are guaranteed to exist (the create
  routes run before rows load). Gated **once per dataset**: the gate reads
  `entity_catalog_refresh.datasets_sampled`, so subsequent syncs/computes are free.
  Backgrounded via `waitUntil` — never adds latency to the compute response. Mode
  `incremental`, samples only the dataset that just landed.
- **Weekly cron** (Phase 6) — `/api/cron/entity-discovery` (Sun 05:00 UTC, vercel.json
  `"0 5 * * 0"`) re-runs discovery for **every brand-collection**, sampling across all
  of the brand's member datasets. Mode `cron`. Brand scope only — plain datasets are
  not refreshed on a schedule (bounds AI cost; brand-level analysis is the use case).
- A run samples ≤1000 rows (default 500); ballpark a few cents per run.

### Person suppression at collection scope
Brand-collection catalogs cover many locations, so individual staff names
("our server Maria") are noise — each appears in 1–2 reviews and dominates
the catalog without adding brand-wide signal. `getEntitiesWithCounts` filters
out `category='person'` rows when `scope.scopeType === 'collection'` for
default reads (cloud, compare, drill, schema preview, Ask Ana). The Manage
Entities panel (`includeHidden=true`) still sees them so users can hide
specific entries or recategorise standout named chefs as `brand`. Standalone
dataset scopes (single-location operators) keep person entities — there,
named-server mention counts are real signal.

### Manual catalog curation (migration 073)
The catalog is no longer NER-only. Two columns on `entity_catalog` separate curation
from discovery:
- `source` (`'discovered'` | `'manual'`, default `'discovered'`) — discovery upserts
  never overwrite `manual` rows; the "Reset discovered entries" action only deletes
  `discovered` rows.
- `hidden` (boolean, default `false`) — soft-delete flag. Hidden rows are excluded
  from cloud / compare / drill reads (`getEntitiesWithCounts` filters them out unless
  `includeHidden=true`) and `lib/entityDiscovery.ts` skips them on re-discovery upsert,
  so NER noise stays hidden across runs.

The Manage Entities panel (Schema tab) drives these via:
- POST `/api/datasets/[id]/entities` — single or bulk create with `source='manual'`.
  Accepts `{ canonical, category?, aliases? }` or `{ entities: [...] }`. Bulk paste
  format is `Canonical | category | alias1, alias2` per line. **Auto-hide**: after
  upserting the manual rows, the endpoint slugifies every alias and soft-deletes
  any `source='discovered'` row in the same scope + category whose slug matches
  an alias-slug. This catches the cross-slug duplication case the UNIQUE index
  can't (e.g. `Filet Mignon` and `Filet` have different slugs but are
  conceptually the same — the alias rule hides the latter). Same-category guard
  prevents a food entity from hiding a brand or place that shares a name.
  Response includes `entities_auto_hidden` count for visibility.
- PATCH `/api/datasets/[id]/entities/[slug]` — toggle `hidden`, edit aliases,
  canonical, category. Exposed in the Manage Entities panel via a per-row **Edit**
  button that swaps the row for an in-place form (name input, category dropdown,
  aliases textarea); Save round-trips PATCH and reloads the catalog.
- DELETE `/api/datasets/[id]/entities/[slug]` — hard-delete (`source='manual'` only;
  discovered rows must be hidden to survive re-discovery).
- POST `/api/datasets/[id]/entities/reset-discovered` — escape hatch that wipes every
  `source='discovered'` row in the scope; manual rows survive.

Menu-PDF seeding is the canonical brand-bootstrap workflow: dump a menu PDF into
Claude Code, extract dishes / drinks with categories + aliases, POST to the bulk
endpoint. The brand-collection scope means one POST seeds every dataset in the brand.

### Read APIs (all scope-resolving)
- `GET /api/datasets/[datasetId]/entities` → catalog entities with live counts + category
  rollup + `last_refresh`. `?theme=<themeId>` intersects counts with the theme's
  keywords; `?limit=<n>` default 50, max 200. `?manage=1` returns the full catalog
  *uncapped* (no `catalogLimit` ceiling), sorted by `source DESC, sample_count DESC`
  so `manual` entries pull to the top regardless of their NER sample frequency;
  includes hidden rows + `source` + `hidden` flags. Drives the Manage Entities
  panel; the no-cap rule prevents the truncation bug where high-mention manual
  rows with low `sample_count` (e.g. menu-PDF seeds, sample_count=1) get cut
  off the bottom of a 500-row catalog limit.
- `GET /api/datasets/[datasetId]/rows-by-entity?entity=<slug>` → the rows mentioning one
  entity, across the scope's members (via the `get_rows_by_entity` RPC, same open-ended
  recheck as counting). `?limit` default 100 / max 500, `?offset`.

### Where entities show up
- **Schema tab** — one per-dataset panel with two modes. Preview mode shows
  last-discovery timestamp, catalog size, and a top-12 chip preview with live
  counts + category dots. Manage mode (`?manage=1`) surfaces the full catalog
  (including hidden rows + source flag), **grouped by category (type)** with a
  per-type **Show all / Hide all** control (ignore a whole type — e.g. people — at
  once). Hide/show edits are **staged locally** (`pendingHidden`) — clicking no
  longer PATCHes + refetches per click (which scrolled the panel to the top); a
  **Save** button (was "Done managing") flushes the staged changes (chunked PATCHes)
  and a **Close** exits manage mode (confirms if there are unsaved changes). Plus the
  single-add form, bulk-paste textarea, per-row Edit, and the "Reset discovered" admin action.
- **TextMine → Themes tab** — a dedicated **Entities card** (`components/analyze/
  EntitiesCard.tsx`), scope-wide, grouped by category. Pills are styled like the theme
  keyword pills; clicking one opens a modal of the comments that mention it (via
  `rows-by-entity`). Entities are *not* shown per-theme-card — dishes co-occur with every
  theme, so a per-card list just repeated the same entities and added clutter. When a
  rating field is selected, each pill carries a **★ avg-rating badge** (green/red vs the
  dataset overall) — computed client-side in `TextMineModule` by matching each entity's
  terms (`expandEntityTerms`) against the active text fields of the loaded/filtered rows
  and averaging `row[ratingField]`. The badge shows only once an entity has ≥3 rated
  mentions (`MIN_RATED`); the tooltip surfaces `n` and the delta. Mention counts stay
  scope-wide (SQL); ratings are filter-aware — the same split EntityCloud uses for sentiment.
- **TextMine → Clouds tab** — **Entity Clouds** (`components/analyze/textmine/
  EntityCloud.tsx`), rendered below the Theme Clouds. Words sized by `entity.mentions`
  — the SAME scope-wide count the Entities pill list uses (live full-text via
  `count_entity_terms`), so the cloud and pill list never show divergent numbers
  for the same entity. Sentiment coloring is computed client-side from the
  currently-loaded rows (clearly badged "sentiment from visible rows" when active),
  Sentiment is computed via a clause-aware proximity scan (text split on
  but / however / although / yet / though / while / whereas / comma; opinion-word
  hits in each clause credited to every entity that appears in that clause).
  Category chips at the top filter the cloud; click any entity to drill into
  its comments (same flow as the pill list). Hovering an entity dims every
  other category in the cloud (mirrors WordCloud's theme-chip hover) so the
  viewer immediately sees which category the entity belongs to.
- **TextMine → Compare tab (View by: Entity)** — **Entity Compare**
  (`components/analyze/textmine/EntityCompareTab.tsx`). Mirror of the theme
  `CompareTab` for entities: pick one or more categorical fields, see which
  entities over- or under-index in each compounded segment ("location × day
  of week"). Two views — By Group (per-segment entity prevalence) and By
  Entity (per-entity prevalence across segments). Significance markers (★)
  use the same `sigTest` 2-proportion z-test the theme version uses; rating
  significance per (group, entity) uses `welchTTest` when ≥5 ratings per
  side. Top 25 entities by total mentions across visible groups (Show all
  reveals the long tail). "Summarize findings" exports a copy-pasteable
  text outlier report. Per-row entity match-set computed once via the
  alternation regex shared with `EntityCloud` and `EntityBreakdownDist`,
  so counts stay consistent across all three entity views.
- **TextMine → Themes tab → Breakdown** — **Entity Breakdown by &lt;field&gt;**
  (`components/analyze/textmine/EntityBreakdownDist.tsx`), rendered below the
  theme `BreakdownDist`. Stacked bars per group segmented by entity, plus a By
  Entity view that flips the axis (each entity's prevalence across groups).
  Significance markers (★) come from `sigTest` (2-proportion z-test) — same
  module the theme chart uses, so over/under-representation signals are
  comparable across both charts. Per-(group, entity) rating averages shown
  when a rating field is selected, color-coded by delta vs the overall mean.
  Top 25 entities shown by default with a Show all toggle to reveal the long
  tail; a 1%-of-rows threshold keeps the chart legible. Matching uses the same
  alternation regex over `canonical + aliases + expandEntityTerms` variants the
  cloud does — built once per render and applied row-by-row to a per-row
  match-set so every cell derives from O(rows + groups × entities) work.
- **Ask Ana** — top 40 entities grouped by category appended to the system prompt.

### Tables (migrations 060–066)
- `collections.kind` / `slug`, `datasets.brand_tag` / `brand_collection_id` — brand-
  collection foundation; `slugify()` + `find_or_create_brand_collection()` (060–061).
- `set_brand_collection_id` / `sync_brand_collection_members` triggers (062).
- `entity_catalog`, `entity_catalog_refresh` — RLS enabled (default-deny), service-role
  GRANTs only; reads go through the scope-gated API routes (063).
- `count_entity_terms()` — live full-text count, `SECURITY DEFINER` + locked
  `search_path` (064; migration 070 adds the `p_text_fields` open-ended recheck).
- `get_rows_by_entity()` — entity drill-down read with the same open-ended recheck;
  `count(*) OVER()` carries the pagination total (070).
- `collections.rules` (reserved jsonb seam for brand-level rules) + `find_or_create_
  brand_collection()` now seeds a `dataset_state` row, so every brand-collection
  carries a merged schema and Charts/Stats work on it (066). The merged schema is
  rebuilt lazily from current members in the compute route; `lib/brandRules.ts` is
  the brand-rules seam (`rebuildBrandSchema` + Phase 6's
  `discoverBrandEntitiesIfNeeded`), both invoked from the compute route.
- **Phase 7 (migration 069, applied 2026-05-18):** the v1 `entity_mentions` table,
  `top_entities_for_theme()`, and `datasets.entity_extraction_state` are gone. App
  reads exclusively from the catalog + live `count_entity_terms()`. (067 = review-download
  limits, 068 = response-timestamp backfill.)
- **Manual curation (migration 073):** `entity_catalog.source` + `hidden` columns.
  Discovery is fully additive; hand-curated entries survive re-runs; hidden rows stay
  hidden across runs (NER skips them on upsert). Manage Entities panel + bulk-import
  endpoint enable menu-PDF seeding as the brand bootstrap path.

### Existing deck export
`/api/entity-analysis-deck?dataset=X&field=Y` predates the in-product feature and still
works — it runs canonicalisation fresh per call (no persistence) and produces a 4-slide
PPTX. Unaffected by the rebuild; kept for the "drop into a StoryTime deck" workflow.

---

## Restaurant Taxonomy Classifier (Taxonomy tab)

A restaurant-specific capability that classifies every review against one shared
**7-axis ABSA taxonomy** (touchpoint · attribute · product · beverage · ambiance ·
context · outcome) + a cross-cutting **severity flag** (`normal | alert | crisis`).
Full module spec: **`docs/TAXONOMY.md`**. Summary of the analyze-surface integration:

- **Emotion-language axis (2026-07-06).** The keyword pass also emits an 8th
  **`emotion`** axis — `disappointment` / `blame` / `churn intent` expressed-language
  flags (`lib/emotionFlags.ts`; design + gating rules in `TAXONOMY.md §2a` —
  five subs since 2026-09-03: disappointment, blame, churn intent, anger,
  threat ascribed). It rides
  every Dimensions surface through `DIM_AXES`: an extra pill/card set in the
  Dimensions view, DimensionCloud chips, DimensionCompareTab axis, the Comments
  dimension facet (`p_sub_emotion`, sql/158 — param sent only when a chip is
  selected), and Charts/Stats `__dim_emotion__`. Zero-suppressed end-to-end: the
  rollup omits the axis when nothing fired, so ideation-genre datasets never show
  a "0% emotion" pill. The aggregate route's `TAX_AXES` allow-list and the drill
  route's `AXIS_SET` include `emotion` (guards widened in sql/158).

- **Collections fan out to their members (2026-08-16).** A collection dataset holds
  **zero rows of its own**, so the whole Dimensions section — the rollup GET, the
  classify POST (both the full run and `pendingOnly`), the drill-down
  (`/taxonomy/rows`), and Compare's `tax_crosstab` / `tax_axis_crosstab` — resolves
  its scope through `resolveScopeMembers` (`lib/collectionScope.ts`) and runs over
  the member datasets. Before this the tab read *"No taggable text found"* on every
  collection (it never worked, not a regression). Verdicts are embedded in the
  **member** rows; the aggregated rollup is stored on the **collection**. Compare's
  "Source Dataset" breakdown (`_collection_label`) is synthetic and never stored on
  a row, so the fan-out stamps each member's label onto its own rows instead of
  grouping by a missing key. `tax_group_stats` is deliberately NOT fanned out —
  median/stddev can't be merged from per-member aggregates, and no collection
  surface asks for it (Charts already falls back to raw client-side rows for
  collections). Mechanics + the `IN (…)` planner gotcha: **`TAXONOMY.md §3`**.

- **Where it lives.** The **"Dimensions"** peer section **inside TextMine** (`TextMineModule` renders
  `<TaxonomyModule>` for the section's Overview view — `subTab==='dimensions' && activeView==='overview'`; the
  section also carries Clouds=`DimensionCloud`, Compare=`DimensionCompareTab`, and the unified Comments), shown when **`taxonomyEnabled`** is true — which the
  analyze pages compute as `datasetSource==='google_reviews' || dataset.taxonomy_enabled` (**owner decision
  2026-09-03: org capability alone no longer shows Dimensions UI on a dataset that hasn't enabled it** — the
  `orgTaxonomyEnabled` leg was dropped from the TextMine/Charts/Stats page props; the org capability still
  picks the FULL restaurant tier server-side in the classify route):
  (a) Google Reviews datasets (unsuppressed — the tab hosts the one-click Enable screen); (b) **per-dataset** — `datasets.taxonomy_enabled`
  (sql/109), set by an "Apply Dimensions" checkbox at CSV upload or a toggle on the Schema tab — since the
  **universal emotion tier (2026-07-06, TAXONOMY.md §2a.0)** this flag means "Dimensions on" for ANY dataset,
  not restaurant opt-in: the classify route decides the tier server-side (full restaurant ABSA for
  unsuppressed google-reviews / taxonomy-capable orgs; the vertical-neutral **Emotion** dimension only for
  everything else), so a donor survey that toggles Dimensions gets disappointment/blame/churn-intent
  language tags, never invented restaurant cards. `taxonomyEnabled` is threaded to TextMine/Charts/Stats. The classify
  route is org-gated, not source-gated, so classification already works on any dataset. Exempt from the theme-model lock. User-facing label "Dimensions"; internal key/route stays
  `taxonomy` (`/analyze/[datasetId]/taxonomy` still resolves but is unlinked). Moved here from a
  top-level tab 2026-06-04 so dimensions can later feed Charts/Stats like `__themes__`. Renders
  `components/analyze/TaxonomyModule.tsx`: a **Themes-scale header** (an `<h2>` + a one-line stat
  summary — **N rows with text · X% tagged** · ★ avg rating · flagged — replacing the old chunky
  KPI cards and the misleading "reviews classified / % with a signal" denominator), then a
  **pills + cards** layout (display redesigned 2026-06-06 — `TAXONOMY.md §4a`):
  the 7 axes are **Entities-style pills** (identity dot + mention-rate% + ★ avg-rating badge, red→green
  ramp from `data->>rating`), and the sub-buckets render as **theme-card-family cards** (axis dot +
  ★ rating + pos/neg sentiment bar + the sub's **share of its dimension** `sub.count/axis.count` /
  count; all %s rounded). The view is **multi-field & reactive**: tags are stored per
  `(row, fieldKey)` in the row's embedded `data._tx` block (sql/151; `fieldKey` is the
  combined key of the ANALYZE selection, `taxonomyFieldKey` — sorted ' + '-join; multiple
  open-ends are concatenated like Themes). The GET takes `?fields=`, so changing the selection
  **re-rolls the view for that field-set** (a new combination is **auto-classified on selection**
  — a brief "Classifying…" progress, no button — since dimensions are precomputed). (Charts/Stats
  `__dim_*`, theme-card chips, and the Comments dimension filter all read the same embedded
  verdicts.) A **drift nudge** (amber banner) appears when
  `rowsWithText > classifiedRows` — "N {field} rows aren't tagged yet · Classify N new rows" → POSTs
  `{ pendingOnly: true }` (`classifyPendingRows`, tags only untagged rows; the drift count uses the classifier's whitespace/control-stripping emptiness test so blank rows aren't perpetual phantoms). **Initial view = pills only** (no sub-cards until a dimension is picked); selecting a dimension pill closes any open comments panel; **picking a sub-dimension collapses the cards into a compact sub-pill row** above the comments (switch subs without closing). Sub-dimensions surface only at **count ≥ 35** (`MIN_SUB_COUNT`, the Themes-cutoff analog; severity alerts exempt). The **flagged-review count** (`alertRows` = distinct reviews with ≥1 severity
  alert) now rides on the ⚠ Severity pill, not a KPI card; the per-type alert counts are *per type*, so
  they can sum to MORE than `alertRows` when a review hits more than one (Cheddar's: 79
  food safety + 40 pests across 118 flagged reviews — 1 review hit both). **Severity is an 8th red pill** in the
  axis-pill row (status, not navigation); selecting it opens its alert sub-types (food safety / pests) as red cards
  that drill `?alert=`. Picking an axis pill **focuses** the card grid
  to that axis (no pick = top sub-buckets across all axes); **clicking a card** drills that
  sub-dimension and a **"Read all comments on this dimension"** header link does the axis-level
  drill (every comment tagged anywhere on the axis) → an **inline comments panel**
  (cards mirror TextMine's: text + meta chips + Show-more + a rating-coloured left bar + a 1–4
  column grid selector; each comment also shows its other axis·sub tag chips — hovering a chip
  highlights the span of the comment that triggered that dimension) (breadcrumb header + scrollable list + Export CSV + per-comment
  Copy) via `GET …/taxonomy/rows` (`?axis=` whole-axis, `?axis=&sub=`, or `?alert=`, **`?field=`** to scope to the analyzed open-end), matched-evidence quotes
  highlighted. The displayed comment text is the **classified field's value (`data[field]`)**, not a heuristic `pickText` pick, so the shown text matches the chips + evidence (prevents a different column showing next to another field's tags). (Inline panel reuses the same UX as TextMine comments but not the
  theme-coupled `CommentsPanel`; it's driven by the tag-filtered endpoint.) The evidence
  highlight **expands to whole-word boundaries** (stored evidence is a fixed-width char
  window, so the `<mark>` snaps out to full words rather than cutting mid-word).
- **Data.** Read via `GET /api/datasets/[datasetId]/taxonomy` (org-gated; pairs the
  dataset's `org_id`) → the **stored rollup** in `dataset_state.analytics.taxonomy`
  (written at classify completion; sql/151), falling back to `computeTaxonomyRollup` in
  `lib/taxonomyRollup.ts` over the embedded `data._tx` verdicts when no stored entry exists.
- **Classification (self-serve from the tab).** `lib/taxonomyClassify.ts`
  (`classifyDatasetKeyword`) runs the keyword tier over a dataset and embeds tags,
  idempotent per `(row, fieldKey)`; the layered dictionary (`lib/taxonomyDictionary.ts`,
  `resolveDictionary(core|rc|chuys)`) composes a shared core ⊕ per-brand overlay. Takes
  `mode: 'full' | 'emotion'` (2026-07-06): emotion mode skips the restaurant dictionary and embeds
  only the emotion axis — the universal tier; the route picks the mode server-side and
  `taxonomy_suppressed` forces emotion even on google-reviews sources. The rollup zero-suppresses
  every axis that never fired, so emotion-only datasets show a single Emotion dimension. **Smart auto-detect
  (2026-06-28):** Dimensions only make sense for restaurant data, so we detect that at theme-generation
  time instead of trusting the `google_reviews` source. (1) `mine-themes` asks the AI for a `foodService`
  boolean alongside the themes; when true the route sets `datasets.taxonomy_enabled=true` and returns the
  flag, and the client (`autoEnableDimensions` in `TextMineModule`) auto-enables + classifies in the
  background (PATCH flag → loop the pendingOnly classifier → `router.refresh`), with a 🍽️ "Restaurant
  data detected — classifying Dimensions…" banner — zero clicks. (2) Applying a **restaurant theme library**
  (`casual_dining`/`fine_dining`/`fast_food` ∈ `RESTAURANT_INDUSTRIES`) triggers the same. (3) The inverse — when the
  AI judges the data is **NOT** food-service — sets `datasets.taxonomy_suppressed=true` (sql/139), which
  **hides** the restaurant Dimensions for that dataset even though it's `google_reviews` (a hotel's /
  clinic's reviews) — **and (2026-07-06) auto-runs the universal emotion tier instead**: `autoTagEmotion`
  in `TextMineModule` loops the pendingOnly classifier (the route picks emotion mode since suppression
  was just stamped), then flips `taxonomy_enabled` ONLY if emotion language actually fired (genre gate —
  an ideation survey never grows a "0% emotion" tab), with a "Tagging emotion language…" banner. So
  every NEW dataset gets emotion at theme-mining time with zero clicks; existing datasets ride the
  one-time backfill. Suppression overrides **only** the source proxy: an explicit `taxonomy_enabled`
  (manual Schema toggle) or a restaurant-org capability still wins, so intentional opt-in is never undone.
  The gate is now `taxonomyEnabled || (datasetSource==='google_reviews' && !taxonomySuppressed)` in all
  three places (`textmineNav.availableSections`, `TextMineModule`, `ChartsModule`), threaded from both
  pages. NOTE: the `google_reviews`-implies-restaurant proxy was **kept** (not dropped) — dropping it
  outright would hide Dimensions from restaurant Google-reviews datasets that haven't had themes mined yet
  (the common case); the suppression flag is the targeted fix for the non-restaurant false positive instead. **One-click
  enable+classify (2026-06-28):** an unclassified dataset's Dimensions tab shows a single **"Enable
  Dimensions"** button — it PATCHes `taxonomy_enabled=true` (hygiene, idempotent) AND runs the
  classifier in one action (`enableAndClassify` in `TaxonomyModule`), replacing the prior silent
  auto-classify-on-open + the separate Schema-tab toggle step (the Schema "Apply Dimensions" toggle
  remains only to *reveal* the tab for non-Google restaurant datasets; its stale "click Classify this
  dataset" copy was fixed). Classification still runs via `POST /api/datasets/[datasetId]/taxonomy`
  (org-gated, 10K-row resumable chunks, `core` overlay) with a progress bar — no AI cost. The button
  only ever appears inside the restaurant-gated Dimensions tab (`google_reviews || orgTaxonomy ||
  dataset.taxonomy_enabled`), so it never surfaces on non-restaurant data. The
  classified **field follows the ANALYZE selection** (passed as `fields`/`fieldLabel`; the old
  "Field to classify" dropdown was removed 2026-06-06), and the prominent **Re-classify** button
  was removed (destructive + expensive — re-classification is deferred to the dataset level).
  `scripts/taxonomy-classify.ts` remains for brand-tuned (`rc`/`chuys`) runs. Auto-classify-on-sync
  runs for previously-classified Google Reviews datasets only; CSV/study upload auto-classify + a
  dataset-card "N unclassified" nudge are the planned model (TAXONOMY.md §4/§6).
- **Vendor benchmark.** For datasets with legacy vendor labels, the classifier reproduces
  ~90% of the vendor's topics at higher coverage and far higher alert precision (see
  `docs/TAXONOMY.md` for the critical-category audit). The in-app vendor-vs-us side-by-side
  is **not built** (the vendor-tagged corpus isn't ingested) — backlog.

---

## Charts Module (13 Types)

Defined in `CHART_TYPE_DEFS` (`components/analyze/ChartsModule.tsx`). Slots are from
`CHART_TYPE_SLOTS` in the same file.

| Chart | Slots | Use Case |
|-------|-------|----------|
| Bar/Column (`bar`) | category (req), colorBy, value | Counts across categories |
| Distribution | field (req numeric), splitBy | Histogram or box plot |
| Scatter | x (req numeric), y (req numeric), colorBy | Two-variable relationship |
| Crosstab | rows (req cat), cols (req cat) | Heatmap of two categorical fields |
| Time Series | date (req), metric, colorBy | Metric over time with breakdown; **Compare periods** (2026-09-03, `lib/periodCompare`): a control on the single-line chart overlaying the current period against the **previous period** (the filled bucket span split into equal halves) or the **same period last year** (trailing ≤1-year window vs the same calendar window a year back), plus a delta summary line (count totals, or count-weighted metric averages, with % change). Bucket alignment is calendar-exact — the observed buckets are filled into a complete sequence first, so a month with no rows is a real 0 (count) / honest gap (metric) and sparse data can't shift the window. Falls back to a "not enough history" note below the controls when a side would have <4 buckets (or yoy lacks a year of earlier data); hidden for hour/year buckets and breakdowns; smoothing is suspended while comparing. |
| Treemap | category (req), size | Hierarchical rectangles |
| Packed Bubbles (`bubbles`) | (numeric measures) | Circles sized by numeric measures |
| Waterfall | category (req) | Running total contribution |
| Bullet/KPI (`bullet`) | field (req numeric), splitBy | Gauge with performance bands |
| Funnel | category (req) | Ranked bars in funnel shape |
| Gantt/Range (`gantt`) | category (req), range (req numeric/date) | Min-max range bars |
| Score Driver (`driver`) | themes, rating | Which themes drive higher/lower scores |
| Data Table (`table`) | any fields | Sortable, filterable data table |

When a Bar/Column chart has a numeric **value** assigned and the **Average** mode is on (`BarAggInner`), the bars show the per-category mean and the chart overlays a dashed **overall-average reference line** ("Avg N") — the **count-weighted** mean across all groups (i.e. the true mean of the value field, not the unweighted mean of the bars), so each bar reads against the dataset baseline at a glance. Works in both orientations (horizontal line for vertical bars, vertical line for horizontal) and on taxonomy-dimension averages (`tax_group_stats`).

### Synthetic categorical fields

Three families of virtual fields are spliced into the chart field list alongside the real schema fields:

- **`__themes__`** — single best theme per row, re-derived client-side from row text (keyword match in `enrichRows`). Forces the client-rows path.
- **`__mapped_<field>__`** — numeric remap of a categorical (Likert→number).
- **`__dim_<axis>__`** (Dimensions, 2026-06-04) — one per taxonomy axis (Touchpoint, Attribute, Product, Beverage, Ambiance, Context, Outcome), gated to `datasetSource==='google_reviews'` **or the org's `taxonomy` capability flag** (`taxonomyEnabled`, threaded to ChartsModule/StatsModule alongside TextMine). **Values are the axis sub-buckets** (steak, seafood, manager…) and are **multi-value** — a review tagged `product=[steak,seafood]` counts in BOTH. Unlike `__themes__`, dimension values are **never** re-derived on the client (the 250+ keyword dictionary is ~30s/50K rows); they are aggregated **server-side** via three `tax_*` ops on `/aggregate` (`tax_counts`, `tax_group_stats`, `tax_crosstab`; RPC names from `sql/105`, bodies rewritten in `sql/151` to unnest the axis arrays embedded in `dataset_rows_flat.data._tx` — rating/date/crosstab fields come from the SAME row, no join). **Per-QUESTION (2026-07-12, sql/164):** every tax_* RPC takes an optional `p_field_key` — the Charts/Stats **source-field picker drives dimension charts too** (`useAggregation` injects `fieldKey` into tax_* specs centrally, same spot as `rowIds`; Stats' Group Tests pass it via `GroupTestsPanel.dimFieldKey`); `taxonomy_field_or_primary` resolves it server-side — the requested question when it has a stored rollup, else `taxonomy_primary_field` (most classified rows wins — the old always-behavior, still what already-deployed code gets since the param defaults NULL; the aggregate route retries without the param on PGRST202 pre-migration). Charts' per-axis `dimSubCounts` GET now passes `?fields=<source field>` (it passed nothing and got the per-field route's empty shell — silently dead since the per-field taxonomy split). And as of `sql/116` they are **filter-aware**: the RPCs take an optional `p_row_ids bigint[]` and the chart **passes the view's filtered row-id set** (`useAggregation` injects `rowIds` into any `tax_*` spec when filters are active; `null` = whole dataset). The flat row id rides to the client as `_rowId` (the rows GET takes `?withRowIds=true`, set by `RowsContext`). So dimension charts now honor the same field + filters as the rest of the view. (Datasets >50K are filtered over the 50K client sample, consistent with how regular charts already aggregate.) Counts reconcile exactly with the Dimensions section rollup (same source). Helper: `lib/dimensionFields.ts`. In the chart field picker the dimension fields render in their **own collapsible "Dimensions" group** — since 2026-09-03 filtered to the axes that actually FIRED on the dataset (once the `dimSubCounts` rollup fetch lands; all axes show until then): an emotion-tier dataset (ANES-style, emotion axis only) offers just **Emotion Language** instead of 7 dead restaurant axes (and `__themes__` in a **"Themes" group**) — both pulled out of raw "Categorical" since they're *derived* categories, not schema columns (2026-06-07). The group shows the **short** axis label (`DIM_AXIS_LABEL` — Touchpoint…) with the **verbose** name on hover (`DIM_AXIS_LABEL_LONG` — "Service — who served you"…); that long map is the single source of truth, re-exported by `taxonomyRollup` as `AXIS_LABEL` (the tab's pill/card labels) so the two never drift. The `tax_*` ops live in `sql/105`–`106` (date-series + quartiles added in 106). **Wired chart types — 10 of 13**: Bar (count/% from the rollup-fed summary; average via `tax_group_stats`), Crosstab + stacked Bar (`tax_crosstab`, dimension × any scalar field, either orientation), Treemap / Bubbles / Waterfall / Funnel (count from summary), Bullet/KPI + Gantt (`tax_group_stats` — avg / min-max per sub), Distribution (precomputed box plot from `tax_group_stats` q1/median/q3/min/max/mean), Time Series breakdown (`tax_date_series` — dimension × time, count or avg per sub per bucket). **Excluded** (hidden from those charts' dim pickers via `pickerFields`): Scatter (colours each *point* — needs per-row tags), Data Table (lists *rows*), Score Driver (a theme-keyword regression engine; redundant with the avg Bar). **Stats module — Group Tests panel (Phase B.2)**: a dimension axis can be the group/variable. t-test + ANOVA are computed from per-sub summary stats via `welchTTestFromStats`/`anovaFromStats` (Welch and one-way ANOVA need only mean/variance/n), chi-square from a server crosstab via `chiSquareFromTable`, and the group box plots from the q1/q3 quartiles. Mann-Whitney is unsupported for dimensions (needs raw ranks). Dim fields are spliced only into Group Tests' categorical list (`groupTestCatFields`), never the row-based panels. (This work also fixed a pre-existing `incompleteGamma` bug — the χ²/F p-value series overflowed for large statistics, so chi-square/ANOVA on large samples silently returned wrong p-values; now series for `x<a+1`, continued fraction above.)

### Drag-to-Assign Interface
- Drag fields from sidebar to chart slots
- Smart slot selection: prefers empty required > empty optional > replace
- Session caching for chart state persistence
- Color palettes: Hermes, Ocean, Sunset, Earth, Pastel, Vivid, Mono

---

## Statistics Module (Hypothesis Testing)

> **Subsampling is DETERMINISTIC (2026-08-18).** Above the row cap the module analyses a subsample. That selection used a `Math.random()` Fisher-Yates shuffle **inside a `useMemo`** — and React treats `useMemo` as a performance hint, not a semantic guarantee, so a recompute could draw a **new subsample and silently change every statistic on screen** with no user action. It now uses `deterministicSubsample` (`lib/statsUtils.ts`, seeded mulberry32): the same rows + cap always select the same sample, so a figure is stable across recomputes, remounts and reloads, and can be reproduced when someone audits it later. This matches the server-side deterministic sampling of sql/160 / sql/167. ⚠️ **One-time effect: the selected rows differ from the old random draw, so a sampled statistic can move once.** Above-cap figures were never reproducible before, so nothing that *was* stable becomes unstable. Pinned by `tests/unit/statsUtils.test.ts`.


### 6 Analysis Panels

Panel list lives in `ANALYSIS_TYPES` in `components/analyze/StatsModule.tsx`.

**1. Descriptives**
- Mean, median, std dev, min, max, Q1/Q3, skewness, kurtosis
- Shapiro-Wilk normality test
- Bootstrap CI (Monte Carlo) on mean, median, std

**2. Correlations**
- Pearson r (linear correlation) with p-value and 95% CI
- Spearman rho (rank correlation, handles non-linear)
- Correlation matrix with click-through detail

**3. Group Tests** — combines two-sample, k-sample, and contingency tests in one panel:
- Welch's t-test (two groups, unequal variance) + Cohen's d
- Mann-Whitney U (non-parametric rank test with tie correction)
- One-Way ANOVA (k groups) + pairwise Tukey HSD post-hocs
- Chi-square test of independence + Cramer's V (observed vs expected frequencies)

**4. Regression**
- OLS linear regression (one model per selected outcome)
- Coefficient p-values, 95% CI per term
- R-squared, adjusted R-squared, F-statistic
- Residuals for diagnostics

**5. ✦ Auto-Insights**
- Auto-scans the dataset for significant correlations, group effects,
  and distribution flags; surfaces them as ranked findings.
- **Findings render as a dense TABLE, not stacked cards (2026-08-16).**
  Columns: `# · type · relationship · strength chip · effect · significance`
  (`n` sits as a muted second line inside the effect cell),
  with the effect size right-aligned and labelled (signed `r` / Cohen's `d` /
  `η²` / skewness). At 100+ findings the old card list wasted ~80% of its
  vertical space and buried the effect size mid-sentence, so a list headed
  "sorted by effect size" had no scannable column to check the order against.
  Group effects keep their highest/lowest detail as a muted second line inside
  the relationship cell — visible, not behind an expander, compacted to
  `▲ highest 5.0  ▼ lowest 1.6`. **The Stats centre column is ~560px, not the
  module's 860px maxWidth** (fixed field-list sidebar left, analysis-type panel
  right) — seven columns pushed the effect size off-screen, which defeated the
  point, so the type column is icon-only with a tooltip and `n` moved inside the
  effect cell. `AutoFinding` carries
  `effect`/`effectLabel`/`n`/`sub` populated from the SAME computed values the
  prose `detail` already quoted (which is retained, because the AI narrative and
  the deterministic summary both read it) — no number is recomputed and no sort,
  filter or threshold moved.

**6. Outlier Analysis**
- Flags groups that are statistically above or below the overall mean
  for a chosen metric.

### Statistical Infrastructure (`lib/statsUtils.ts`)
- Distribution functions: t, F, chi-square, normal CDF
- Matrix operations: Gaussian elimination for regression
- Effect sizes: Cohen's d, eta-squared, Cramer's V
- Significance labels: *** p<.001, ** p<.01, * p<.05
- (Fixed 2026-06-08: `normCDF` applied the erf approximation to `z` instead of `z/√2`, returning Φ(z·√2) and understating two-tailed p-values for `mannWhitneyU`, `tDist2p` at df>100, and `shapiroWilk`. Now correct — those tests read more conservatively than before. The `incompleteBeta` path — t-tests/correlations at df≤100 and ANOVA — was never affected.)

---

> **Open consideration (brainstorm, NOT built — 2026-06-23):** themes and dimensions are conceptually the same object — a way to bucket review text into categories, then measure prevalence + sentiment per bucket (entities are a third such lens). The prevalence/comparison/leaderboard analyses already treat themes + dimensions in parallel (shared `{pos,neg,total}` accumulators in `scanDataset`), and since the Target B IA (2026-06-25) TextMine's section bar already switches between the Theme / Entity / Dimension lenses (the old "View by Theme | Entity" toggle folded into the Entities section). A future unification would make **dimensions a first-class "categorization lens"** with the same analysis suite (clouds, compare, charts, *and* the Advanced Analytics predictor/what-if/playbook) — `clouds/compare/charts/predictor` each taking a `lens` param. Three real differences to reconcile, not just organic-vs-predefined: (1) **sentiment resolution** — dimensions carry per-assertion polarity + evidence (aspect-level: +Food/−Service in one review), themes use whole-review `lexiconScore`; unifying means leveling this (ideally upgrade themes to sentence/aspect-level, which the quote fix started); (2) **structure** — dimensions are 2-level (axis→sub), themes flat; (3) **provenance** — themes organic/per-dataset (drift), dimensions a fixed vocabulary (comparable across brands → the right substrate for cross-brand benchmarking). Prerequisite for dimensions as a predictor lens: fix the keyword-classifier quality (the everything→"Experience" collapse) — until then themes are the better lens.

> **Navigation (Target B IA, 2026-06-25 — supersedes the 2026-06-23 consolidation):** the three multi-location views — **Brand Health** (`improvement-plan`), **Leaderboard** (`outlet-leaderboard`), and **Outlet Deep-Dive** (`outlet-report`) — are the **row-2 views of the "Advanced Analytics" peer section** of TextMine. All three server routes render **`AnalyticsNav`** (`app/analyze/[datasetId]/AnalyticsNav.tsx`), which now renders the **shared two-row `TextMineNav`**: row 1 = the four sections (Advanced active; the lens sections deep-link back to `/textmine?section=…&view=overview`), row 2 = Brand Health · Leaderboard · Outlet Deep-Dive. The old "← TextMine" back link is gone; you no longer lose the section bar on the Advanced pages. They stay separate server routes (no recompute). Same gate: `google_reviews` + `outletCount >= 5`. Where older text below says "Outlets sub-tab" / "Leaderboard sub-tab" / "Improvement plan button on the Leaderboard," read it as a row-2 view of the Advanced Analytics section.

> **First-open blank content area — the deferred-start window (fixed 2026-08-17).** Opening a dataset showed the shell (nav, tabs, row count) with a **completely blank content area** for the whole multi-second server counts scan, and no loader. It looked fine on a revisit only because rows were already loaded by then. Cause: the full-page loader was gated `!rowsLoaded && rowsLoading && …`, but `startRowFetch` is a **one-shot that only fires after the counts request finishes** (or a terminal bail-out releases it) — so between mount and that moment `rowsLoading` is still `false` and **no branch rendered at all**. Now gated on `!rowsLoaded` alone, the same fix the nav tabs needed for this identical window (2026-08-16), with an honest message per phase ("Counting themes across the dataset…" before the row fetch starts, "Loading dataset rows… N%" after). Every bail-out releases the fetch, so it always resolves. Browser-verified on the 128,619-row Outback set.

> **A re-enabled field is usable without a reload (fixed 2026-08-17).** Re-enabling a previously-`ignore`d field and then selecting it in TextMine's Text picker snapped the choice back to the first open field. Chain: the rows API **drops `ignore`/`hidden` columns from the payload** (sql/186), `RowsProvider`'s fetch is a one-shot (`if (rowsLoaded) return`), and `router.refresh()` after a schema save re-renders the server layout **without remounting** the provider — so the re-enabled column stayed absent from the in-memory rows, and TextMine's "auto-switch away from empty fields" effect read *absent* as *empty* and bounced the selection. `DatasetShell` now keys `RowsProvider` on **`analyzableFieldsKey(schemaFields)`** (`lib/datasetUtils.ts`) — a sorted, U+001F-joined string of the non-ignored, non-hidden field names — so the provider remounts and refetches **exactly** when the set of carried columns changes, and never on ordinary re-renders, a field rename, or prop-identity churn. `FilterProvider` sits outside, so filters survive. Belt-and-braces: the auto-switch effect now skips fields whose key is **absent from the payload**, so a stale payload can never override a deliberate selection. Pinned by `tests/unit/analyzableFieldsKey.test.ts` (9 cases: changes on ignore-flip, stable on reorder/rename/identity churn).

> **The word modal's percentage is a share of the THEME, not the corpus (2026-08-17).** `OpinionPopover` stated its share against the whole dataset in both the header pill and the stats row — a word inside a theme read as "1% of comments", which is not the question a reader is asking. It now takes an optional **`themeScope: { label, count }`** and expresses the share against that theme, labelled with its name: **"19% of Food Quality & Preparation Issues"**. `count` must be the theme's own displayed comment number (`theme.count`) — the figure the card prints as "N comments" — so the percentage **reconciles with the card** (verified: 358 / 1,895 = 19%, where the old code showed 358 / 17,157 = 2%). Rounding matches `pctOfThis`, the "% of this theme" convention already used by the co-occurrence chips, so the two agree. Both readouts derive from a single `share` memo, so the header and stats row can never disagree. Scope resolution (corrected 2026-08-17): the theme is the one the word was **opened from** — a keyword chip on a theme card, or a word inside that theme's **cloud row** (Theme Clouds draws one cloud per theme). Tracked by theme **id** so both entry points share it. An earlier pass keyed Clouds off `selectedThemes` — the *filter* selection, normally empty there — so every cloud word fell straight back to "% of comments", i.e. the bug it was meant to fix. ⭐ **The modal also reads the THEME'S rows** (`commentMatchesTheme`, the same matcher behind the theme's own count): pairing a dataset-wide mention count with a theme denominator is a ratio of two different populations and can exceed 100% — "server" showed 950 dataset-wide mentions over the theme's 2,231 comments (43%) while the cloud counted 896 *in* the theme (40%). The share renders on its **own line** beneath the title, not as an inline tail — a theme name is arbitrarily long, so inline it wrapped mid-phrase ("(10% of Special / Occasions & Celebrations)") and read as broken text. ⚠️ A residual ~1pp gap can remain versus the cloud's own chip label because the modal's mention count and `WordCloud`'s token frequency use different matchers; the modal is internally consistent either way. **Every case names its denominator**, which is the deck-number-credibility rule applied to a UI readout. This is a deliberate divergence from the otherwise-canonical `totalCommentsWithText`; `ThemePopover`'s "% of comments" is theme-level, where % of total is correct, and is unchanged. Pinned by `tests/unit/opinionPopoverContext.test.tsx` (4 cases, verified to fail against the pre-fix code).

## Client-defined hierarchy (`lib/hierarchy.ts`)

**Foundation landed 2026-08-16; the Schema-tab UI and the rolled-up Outlet
Deep-Dive landed the same day (see "Rolled-up hierarchy view" below).**

A dataset's schema can designate existing columns as hierarchy **levels** —
`SchemaFieldConfig.hierarchyLevel`, 1-based with 1 broadest (Region 1 -> District
2 -> Store 3). The tree is **derived from those columns' values**, so there is no
org-structure table to hand-maintain and nothing to drift as rows sync: a client
who already carries their structure in the data gets the hierarchy for free.
(Owner direction 2026-07-15; supersedes the earlier org-structure-table design.)

`hierarchyLevel` is deliberately a **marker on an ordinary categorical field**,
not a new `AnaFieldType` — the column stays a normal categorical for charts,
filters and breakdowns, it just also names a rung.

Two correctness properties the roll-ups depend on, both pinned by
`tests/unit/hierarchy.test.ts`:

- **Nodes are keyed by full PATH, never by value.** "Downtown" under East and
  "Downtown" under West are different districts; a name-keyed tree would merge
  them and every number below would be wrong.
- **No row is ever dropped.** A blank at any level buckets as `(unassigned)`
  rather than vanishing, so leaf counts sum to the dataset total and a roll-up
  always reconciles with the flat numbers. `(unassigned)` sorts last regardless
  of size, so it never leads a list.

API: `hierarchyLevels` / `hasHierarchy` (needs >=2 levels — one is just a
breakdown) / `buildHierarchy` / `findNode` / `breadcrumb` / `crumbsForPath` /
`rowsUnder` (what a rolled-up snapshot is computed over) / `nodesAtDepth` /
`pluralLevel`.

**Assigning levels — the Schema tab (2026-08-16).** `SchemaEditor` exposes the
marker on **categorical fields only** (a rung is a grouping of rows by a repeated
value; a free-text or numeric column has no tree to derive). Expanding a
categorical field shows an **"Add as level" / "Remove"** control, and a collapsed
card carries a **`Lv N`** pill so the chain is readable off the field grid. Above
the grid an **Org Hierarchy strip** lists the rungs in order with ▲/▼/✕, and warns
while only one level is set. Levels are **renumbered contiguously from 1 on every
change**, so a saved schema can never carry a gap or a duplicate — two fields
sharing a level would sort arbitrarily in `hierarchyLevels()` and the tree would
depend on field order rather than on what the user chose. `mergeSchemaStats`
spreads the existing field (`{...f}`), so an incremental sync preserves the
marker.

## Outlet Report (Advanced Analytics ▸ Outlet Deep-Dive)

> **Added 2026-06-17.** A one-page **per-outlet vs. peer-group** summary for multi-location review brands. Answers "what does *this* location excel at / need to work on, relative to its sibling outlets?" — the building block was missing before (per-location aggregation and taxonomy existed, but nothing compared one outlet to the group).

> **Scan cached in `dataset_state.outlet_scan_cache` (sql/195, 2026-09-01).**
> All three Advanced pages (and the deck routes + action-plan route) build from
> ONE `scanDataset` pass in `lib/outletReport.ts`, which used to page the ENTIRE
> dataset's JSONB per view (~20 MB / ~3.4 s per click on Cheddar's 19.7K rows —
> the "frozen tab switch," PERFORMANCE_REVIEW.md §8). `loadScan` now persists
> the scan (per-outlet aggregates + a ~30 B/row digest, `lib/outletScanCache.ts`
> `PersistedScan` v1 — 1.8 MB for those 19.7K rows) keyed by a fingerprint of
> row_count + last_synced_at + theme model + hierarchy designations + taxonomy
> rollup `updatedAt`s (the sql/194 filter_options pattern). Compute-on-miss: the
> first view after a change re-scans and re-writes; every other view — option
> switches, outlet switches, hierarchy drills, deck downloads — is one bounded
> read (warm ≈ cheap-page latency; verified on TEST Cheddar's + BareBurger
> hierarchy). Each route also has a `loading.tsx` (LottieLoader) so the cold
> rebuild shows progress instead of a frozen page. Cache read/write failures
> degrade to a plain scan; NULLing the column is always safe.

> **Rebuilt 2026-07-15 → GM-facing "Location Performance Snapshot".** The page now **leads with an absolute snapshot** (`OutletSnapshotView.tsx`, presentational, print-first) that matches the Datanautix Bareburger snapshot PDF — not the peer-relative deltas. Its data is a new `snapshot: OutletSnapshot` block on `report.selected` built by `computeSnapshot` in `lib/outletReport.ts` (one extra pass, all from data we already have): **rating distribution** (5★→1★ counts+%), **5★ share** + **detractor (≤2★) share**, **owner-response rate** (`data.owner_response` non-empty ÷ reviews) with a plain-English band, a **recent-trend chip** (trailing-12-month avg + ▲/▼ vs all-time, falling back to the most-recent 30% when a year is thin), **fleet position** (rank + qualitative band among the **≥200-review** stores only, `FLEET_MIN` — so a tiny-sample store can't claim a flattering rank), and the **absolute theme table** (per theme: mentions · avg★ · %negative[≤3★ share] · **READ verdict** FIX/WATCH/SOLID/STRENGTH from `themeRead`, thresholds calibrated to reproduce the PDF; worst READ first). Plus deterministic **praise chips** (top SOLID/STRENGTH theme labels) + real 5★-preferred **verbatims** (`highExamples`, deduped by quote). The theme table's per-theme stats are a new rating-keyed `themeAbs` accumulator (mentions/avg★/%≤3★), distinct from the lexicon `themeSubs` that still feeds the peer-relative deltas. **The peer-relative `OutletReportTabs` (Summary/Themes/Dimensions + what-if) are retained but demoted to a screen-only "Deeper analysis" block below the snapshot (`print:hidden`)** — so the printed output is exactly the snapshot (+ AI action plan). Datanautix-branded (deck-export brand exception). Verified against the real 29-store "BareBurger Reviews" dataset on TEST.

> **AI Action Plan (page 2) — LLM-narrated, cached.** Below the snapshot the page renders `OutletActionPlanSection.tsx` (`'use client'`): the PDF's **"3 things to work on next"** — per priority a diagnosis + a **real 1–3★ verbatim** + a concrete **operator playbook** (bag-check rule, tamper-seal, portion audit…), then a "keep doing" note. The **theme selection is deterministic** (worst READ first — FIX then WATCH, by avg★), which feeds a single **Claude call** (`lib/outletActionPlan.ts` `generateActionPlan`, tier `advanced`, `event_type:'outlet_action_plan'`); the LLM narrates but **cites only computed figures** and its verbatims are **validated against the real candidate quotes** we pass in (`validateVerbatims` — a returned quote must be a normalized substring of a real 1–3★ review, else it's replaced; nothing fabricated). Generation takes ~25–30s so it is **cached** per outlet in `dataset_state.outlet_action_plans` (sql/183, a place_id-keyed jsonb map, atomic per-outlet `merge_outlet_action_plan` merge), keyed by a `basis` = review count + the theme READ verdicts — a view regenerates only when that changes. Fetched lazily via `POST /api/datasets/[datasetId]/outlet-action-plan?outlet=<place_id>` (org-scoped like the page; get-or-generate, write-through cache). **POST since 2026-08-18:** the cache key is `actionPlanBasis(reviews, themeTable)`, and the route used to rebuild those two inputs by re-running `computeOutletReport` — a full scan (~7s) paid on **every** page view including pure cache hits. The page already rendered both values, so it posts them and the warm path is ~200ms; on a cache **miss** the route still scans and generates server-side, so nothing client-supplied is ever persisted into the shared plan cache. so the snapshot paints instantly while the plan streams in behind a LottieLoader. A `fallbackPlan` (real themes + quotes, no narration) covers an LLM error/timeout. The selected outlet's one-real-quote-per-theme evidence is exposed as `report.selected.lowQuotes` (from `scanDataset`'s `lowExamples`).

> **The export is a REAL composed PDF (2026-08-18) — supersedes "print IS the
> export" below.** Owner: *"I don't like the PDF being an export of the print
> view — we need to generate a real PDF otherwise we look half baked."* The nav
> action is **Download PDF** (`DownloadPdfButton.tsx`) → `POST /api/datasets/[datasetId]/outlet-report-pdf?outlet=<place_id>`,
> which typesets the document server-side (`lib/outletReportPdf.ts`
> `buildOutletReportHtml`) and renders it through `htmlToPdfBuffer` with the
> shared `brandedPdfChrome` header/footer (page numbers, confidentiality line,
> datanautix wordmark). Nothing is recomputed and nothing is fabricated.
>
> **Why POST — the page already has the data (2026-08-18, second pass).** It was
> a `GET` that recomputed everything: `computeOutletReport` (a full
> `dataset_rows_flat` scan, ~7s) plus, when the page's own plan fetch was still
> in flight, a **second** ~34s Sonnet call for an action plan it was already
> generating. One measured download: `200 in 54s (application-code: 52s)`. The
> page (`outlet-report/page.tsx`) already computes and ships every figure to the
> browser, so the button **posts back the payload it rendered** and the route only
> authenticates, applies the same `outletReportingOn` gate, validates and
> typesets. Measured after: **520ms–1.4s** of application code. The contract and
> its parser are `lib/outletPdfPayload.ts` — `OutletPdfPayload` +
> `parseOutletPdfPayload(body, outlet)`. The trade is explicit: figures become
> **client-asserted**, which is acceptable because the document is rendered for,
> and returned only to, the authenticated requester and is never stored or
> shared. What is *not* assumed is well-formedness — the parser rejects only when
> the body has no subject (`selected.placeId` missing or ≠ the requested outlet →
> 400) and **coerces** everything else, because the builder interpolates numbers
> into unquoted CSS (`style="width:${w}%"`). Body >2MB → 413. Cross-field
> arithmetic is deliberately *not* re-derived — that would be a second
> implementation of `computeOutletReport`. Covered by
> `tests/unit/outletPdfPayload.test.ts`. The `plan` rides in the payload; if the
> page couldn't get one the route falls back to a **cache-only** read
> (`getOrGenerateActionPlan(…, { cacheOnly: true })`) and never generates.
>
> **The button has states.** It was a bare `<a href>`, so 52s of real work read as
> a hang. `OutletPlanContext.tsx` owns the plan fetch for the whole page (the
> section displays it, the button posts it back — one fetch, no child→parent state
> push, keyed by outlet so no stale plan leaks into the next download); the button
> reads *Preparing PDF…* (disabled) → *Download PDF* → *Building PDF…*, and
> *Download PDF (no action plan)* when the plan failed.
>
> **Content parity with the page (2026-08-18).** Owner: *"the pdf report feels a
> lot shorter than the html version… we have tabs for different views, need to
> show those as well."* The document now carries the page's screen-only
> **"Deeper analysis"** block — both tabs — since the payload makes it free.
> Sections in narrative order: header (address · N reviews (range) · full N-store
> network) → snapshot KPIs → rating distribution (**▶ lowest · │ avg · ◀ highest**
> across the network, plus raw counts, per-star bar colour) → theme table → praise
> (**filtered through `verbatimSupports(quote,'positive')`** — the PDF used to
> print quotes the page suppresses) → **review score over time** (the dual-line
> SVG ported from `TrendChart`) → action plan (now with the theme anchor chips,
> the "AI-generated from N guest reviews" badge and the Method footnote) →
> Dimensions vs the network (with the page's **empty state**, which the PDF used
> to render as a silent hole) → narrative → **Recovering this location's unhappy
> guests** + the systemic-driver callout → **lever cards** (rank badge, percentile
> pill, guarded quote, "Learn from" exemplars) → **What-if** → **strength cards** →
> the peer-ranking method note.
>
> **What-if is the one thing that can't be ported literally** — it is a slider
> panel, and `print:hidden` even on the page. The document states the benchmarks
> instead: a `theme | you now | peer median | best-in-class | trend` table sorted
> by biggest gap to the median, plus one resolved scenario ("if every theme
> reached the peer median": detractors recovered · 1–3★ rate · rating + rank)
> computed with the same pure `projectRecovery` (`lib/outletPredictor.ts`) the
> panel calls, so the two cannot disagree.
>
> **Layout rule learned here:** forcing `break-before:page` per section produced a
> 3-page document with two pages a third full and a lone "Keep doing" block
> orphaned on page 3 — exactly the half-baked look. The document flows
> continuously with `break-inside:avoid` on each section **and** each card
> (card-list sections are `break-inside:auto`), and a `.keeptog` wrapper binds
> each such heading to its **first** card so the heading can't orphan. A single
> `avoid` block taller than a page is undefined behaviour, so the deeper-analysis
> half is many small blocks, never one section. **~4 pages** on real data (67-store
> Ruth's Chris); a 6-page result means something is over-spaced — treat it as a
> defect, not a data variation.
>
> **Levers are ordered by IMPACT, and the systemic callout names all the drivers
> (2026-08-18, owner).** The callout used to read *"The chain's **one** systemic
> issue is X — and you're bottom-quartile on it. That makes it your
> highest-leverage fix."* Two defects. (1) `predictor.brandLevers` is a **list** —
> every actionable theme over-represented among 1–3★ reviews brand-wide (`lift =
> pBad/pGood >= driverLift`, default 1.2, with `nBad >= 20`) — and the copy rendered
> only `[0]` under the hardcoded word "one". On the 67-store Ruth's Chris set
> **three** qualify (Value & Pricing 5.32× · Operational Issues 2.78× · Food
> Quality 1.38×). (2) It then called that theme the outlet's *highest-leverage
> fix*, conflating two different measurements: brand **lift** is a
> *discriminator* (does this theme separate happy from unhappy guests?), not a
> measure of local size. Value & Pricing wins on lift only because happy guests
> almost never mention price (pGood 3.1%); Operational Issues appears in **41.9%**
> of all 1–3★ reviews chain-wide versus 16.5%.
>
> The callout now names every driver (`listWords`), states which of them this
> outlet is bottom-quartile on, and makes **no leverage claim** — that claim moved
> to where it is computed. `ThemeStanding` gained **`soloRecovery`**: detractors
> this outlet wins back by moving **that theme alone** to the peer median, via the
> same pure `projectRecovery`. `outletLevers` sorts by it (ties fall back to the
> old percentile order), each card states its own number, and the heading is
> **"Work these — biggest win first"**. It is deliberately *solo* and therefore
> conservative — `projectRecovery` gates each review by its least-improved theme,
> so a theme with a wide peer gap but heavy co-occurrence lands near zero, which
> is the correct signal (Special Occasions: a 1.5pp gap but only 1 of its 11
> citing reviews cites it alone). Sub-1 is spelled out rather than rounded to
> "~0 guests", which would read as *pointless* instead of *rarely arrives alone*.
>
> **The AI Action Plan follows the same order (2026-08-18).** `pickPriorityThemes`
> ranked by READ severity then worst avg★, so "Priority 1 · BIGGEST LEVER" could
> name a different theme from the lever card directly beneath it — one page
> recommending two different first moves. The **candidate set is unchanged**
> (still FIX/WATCH only — absolute health decides what is even a problem), but
> the **order** is now `ActionPlanInput.leverOrder`, the impact-ranked
> `predictor.outletLevers` themes, passed by `/outlet-action-plan` from the same
> scan. Themes absent from that list — notably lagging OUTCOME themes like brand
> loyalty, which the predictor excludes as symptoms — sort last, then by the old
> severity rule. Pinned by `tests/unit/outletActionPlan.test.ts`.
> **`actionPlanBasis` bumped `v4` → `v5`**: the selection RULE moved while its
> inputs did not, which is exactly what the version prefix exists for. Every
> cached plan regenerates on next view (one Sonnet call per outlet, lazily).

> ⚠️ **`OutletSummary.topIssue` is deliberately NOT `outletLevers[0]`.** It is
> pinned to the worst **percentile** theme, because Brand Health and two decks
> render it under the label *"Worst-ranked issue (vs all outlets)"* — letting it
> follow the new impact order would make that column say something it doesn't
> mean.

> **Shared wording lives in `lib/outletPeerWords.ts`** (`pct1`, `rankWord`,
> `topWord`, `locOnly`, `monthLabel`), imported by both `OutletReportTabs.tsx` and
> the PDF builder — that shared import is what stops the two surfaces drifting on
> a phrase.
> Same capability gate as the page (`outletReportingOn`) — an export must not be
> a way around a hidden surface; verified 404 with the capability off.
> ⚠️ The route is registered in `next.config.js` `outputFileTracingIncludes` with
> `@sparticuz/chromium/bin/**`. Without it the function dies on Vercel with
> "input directory /var/task/node_modules/@sparticuz/chromium/bin does not exist".
> `getOrGenerateActionPlan` moved into `lib/outletActionPlan.ts` so the page's
> fetch route and the PDF route share one cache, and a download can't silently
> pay for a second AI generation.
> ⏭ Rolled-up **hierarchy rungs** (Network / Region / District) still use
> `PrintButton` — the PDF composes ONE outlet's document and needs a `place_id`,
> which a rung has no equivalent of.

> **Print IS the export (2026-07-15) — SUPERSEDED, see above.** Per the owner's "one component → screen + PDF, no drift" directive, the page's own **print output is the export**: a `PrintButton` ("Print / Save PDF" → `window.print()`) is the **only** nav action. (A secondary `outlet-plan-deck` **PPTX** "GM deck" link sat beside it until 2026-08-18, when it was removed on owner direction — two export buttons handing back different documents from one page was confusing, not useful. ⚠️ `app/api/datasets/[datasetId]/outlet-plan-deck/route.ts` and `lib/pptx/outletPlanDeck.ts` still exist but are now **unreferenced**.). Print CSS (Tailwind `print:` utilities) hides the nav/picker/deep-dive, drops the gray page chrome, renders the snapshot as page 1 (KPIs forced 4-across at print width via `sm:grid-cols-4`, tightened `print:p-6`/`print:py-1` so the whole snapshot fits **one** page, `print:break-inside-avoid` on each block), and `print:break-before-page` starts the AI Action Plan on a fresh page (its cards carry `print:break-inside-avoid`). The action-plan section is `print:hidden` until its plan has loaded, so an early Ctrl-P yields a clean 1-page snapshot rather than a blank page 2. Verified by rendering the real components to a Letter PDF (clean 4-page output, no orphaned/blank pages).

> **Owner-QC refinements (2026-07-15).** (1) **Rating-distribution bars are colour-coded by rating** (5★ green → 1★ red) using the shared `RATING_GRADIENT` (`lib/ratingGradient.ts`, extracted from ChartsModule's `ORD_GRAD` so Charts + the snapshot match), and each bar carries **network markers** — ▶ lowest outlet · │ average · ◀ highest outlet (per-star share across outlets with ≥30 rated reviews; `RatingBucket.net`), so a GM sees this location vs the system on every bar. (2) The **AI action-plan cards name their theme**: a theme-anchor line (theme · avg★ · %negative · mentions, from `themeTable` passed to `ActionPlanBody`) sits under each title, and the LLM diagnosis now names the theme in its first sentence (basis bumped `v1→v2` to invalidate cached plans); the theme name renders as a neutral **Sarina-teal pill** (white text — a red/severity tint would wrongly read as an alarm; severity is carried by the coloured avg★/%-negative beside it). The distribution's ▶ lowest marker is **white** (drop-shadow edge) so it stays visible sitting on the coloured bar. (3) The peer-relative **"What needs work" cards dedup verbatims** (`buildDeltas` — a review matching several themes kept its quote on the strongest-delta card only). (4) The **Dimensions and Themes tabs were removed** from the deep-dive `OutletReportTabs` — both are now redundant with the snapshot's absolute theme table + AI action plan, leaving **Action Plan · Summary** only (the peer-relative `Block`/`ThemeCard` render path was deleted with them). (5) **Print pagination fixed** — the analyze app-shell's `height:100vh` + `overflow:hidden/auto` clip chain was cutting print to page 1; a global `@media print` reset (`app/globals.css`) releases the inline overflow/height and hides the fixed `nav`. (6) Action-plan loading is resilient: honest copy, a 90s client timeout, and a Retry (generation is ~30s the first time, cached after).

### Rolled-up hierarchy view (2026-08-16)

When the dataset's schema designates **≥2 hierarchy levels**, `/outlet-report`
opens at the **Network** rung and drills down (`Network › New York › Long Island
City`) instead of jumping straight to one location. Owner direction: the roll-up
lives **on the Outlet Deep-Dive**, not in a fourth Advanced view — one page and
one component means a region's snapshot cannot drift from a store's.

- **The same component, the same numbers.** `computeSnapshot` was generalised
  from an `Outlet` to a **`SnapshotUnit`** — the additive subset it actually reads
  (placeIds, review/rating counts, star buckets, owner responses, date span,
  `themeAbs`). One outlet is a unit; a node is `mergeUnits(members)`. Nothing
  per-level is invented: a region's rating distribution is literally the sum of
  its stores'. Theme figures add per theme, so a rolled-up theme row is the same
  ratio over more reviews — **not an average of averages**, which would weight a
  40-review store like a 4,000-review one. `OutletSnapshotView` renders both,
  taking only `unitLabel` / `subtitle` / `rankNoun` overrides.
- **The tree is built over OUTLETS, not rows.** Every figure then reconciles by
  construction: a node's review count is exactly the sum of its member outlets',
  and the locations listed at the deepest rung are exactly the ones summed.
  Building it over rows would let a store whose rows carry two different
  districts contribute to both, and the rung totals would quietly exceed the
  network total. A store's region is a property of the store, so disagreement
  means dirty data — each such outlet is counted under its **most common** value
  and the count is **surfaced** (`strayOutlets`, an amber note naming the
  columns), never silently resolved.
- **Peers are the entities at the same rung.** A store is compared against every
  store network-wide; a region against every region — so the distribution markers
  and the rank mean the same thing at every level. At the Network root there is no
  same-kind peer, so the markers fall back to the range across individual
  locations (what "network" means there) and the rank pill is hidden.
  `FleetPosition` gained **`peerNoun`** so the tile reads truthfully per rung.
- **Drill-down** (`HierarchyNav.tsx`): child rungs are listed **weakest-rated
  first** with locations · reviews · avg★ · vs-network delta; the deepest rung
  lists its locations instead. The path travels as **repeated `?node=` params**,
  never a delimited string — a client's column values are arbitrary text and any
  separator we picked would eventually appear inside a real district name. Opening
  a location carries the path along, so the breadcrumb survives the jump and the
  way back up is one click.
- **The AI action plan stays outlet-only** for now (owner call): its voice is
  operator-specific ("bag-check rule"), and a region-level playbook is a different
  writing job, not the same prompt over more rows.
- Verified by `scripts/_verify_hierarchy_rollup.mts` (untracked, exits non-zero)
  against the real 29-store BareBurger set on TEST with State → City: root covers
  29/29 locations and 14,683/14,683 reviews, children sum to their parent at both
  rungs, listed locations sum to their node, and a leaf's rating equals the
  review-weighted mean of its members (4.743 vs 4.743).

**Where it lives.** Route `app/analyze/[datasetId]/outlet-report/` (server component + `OutletPicker`/`PrintButton` client bits). **As of the Target B IA (2026-06-25) it's the Outlet Deep-Dive view (row 2) of the Advanced Analytics section** — a server-rendered route reached via `AnalyticsNav`'s shared two-row bar (earlier, 2026-06-22, it was an "Outlets" sub-tab `<Link>` in TextMine; before that a top-level `DatasetHeader` tab). It preserves the server render + shareable `?outlet=` URL. Same gate as before: `datasetSource === 'google_reviews'` **and** `outletCount >= 5`; the count is computed server-side in `textmine/page.tsx` (a cheap `count` off `review_source_locations` for the dataset's `review_source`, service-role) and passed to `TextMineModule` as `outletCount`. (`layout.tsx` still computes `outletCount` for `DatasetHeader`'s generic `minOutlets` tab-gate machinery, now unused by any tab but retained as reusable infra.) Switching outlets shows a `LottieLoader` overlay (`OutletPicker` wraps the navigation in `useTransition`).

**Tabbed report** (`OutletReportTabs.tsx`, client; tab order **Summary · Themes · Dimensions**, default **Summary**):
- **Themes** — the dataset's **theme model** (`dataset_state.theme_model`). For each outlet, its reviews are matched to each theme's keywords (whole-word regex) and the matched review is sentiment-scored with `lexiconScore` (`lib/themeUtils`); the outlet's net-positive rate per theme is compared to the chain's. Shown whenever a theme model exists (so it's effectively always available for review brands).
- **Dimensions** — the 7-axis taxonomy (the embedded `data._tx` verdicts, sql/151), the original logic. When the dataset **has no taxonomy** (never classified), this tab shows a **"Dimensions comparison requires classification — run TextMine → Dimensions"** message instead of a misleading "0 analyzed / no themes" (ratings + rank still render from the flat rows; the Themes tab is unaffected).
- **Summary** *(default)* — leads with a **review-score-over-time chart** (inline SVG dual-line, no chart dependency): this outlet's monthly avg rating vs the network's, from `review_date`, last 24 months (`selected.trend` = `{month, outletAvg, networkAvg}[]`). Below it, a deterministic narrative (no AI) built from rank/rating + the top theme & dimension deltas: "this location ranks #N…, stands out on X, trails on Y."

Each axis surfaces top excels/needs-work by peer-delta with the same stability floors (`MIN_N_OUTLET`/`MIN_N_CHAIN`/`MIN_POLAR_SHARE`/`DELTA_THRESHOLD`).

**Leaderboard — a separate brand-level view (added 2026-06-22).** The **inverse of the per-outlet report**: instead of one outlet across all themes, it fixes each theme/dimension and ranks the outlets. Deliberately **not** a tab inside the single-location report (that view is per-outlet) — it's its **own server route** `app/analyze/[datasetId]/outlet-leaderboard/` — the **Leaderboard view (row 2) of the Advanced Analytics section** (same gate `google_reviews` + `outletCount >= 5`). One card per theme and per dimension item (items sorted most-discussed first by `chainN`); each card shows **Top K / Bottom K** outlets ranked by net-positive rate. The **bold figure is the gap vs the chain average** in points (green above / red below — so color and sign agree; a below-chain outlet reads "−19 pts", not a confusing red "+62%"); the outlet's own net-positive rate, `n`, and ★ are grey context. **K is a slider** (`min 1 … max = min(10, ⌊outlets/2⌋)`), defaulting to **3 for ≤15 outlets, else round(20% × outlets) capped at 7** (`leaderboard.defaultK`). When an item's qualifying-outlet count `≤ 2K` the two columns would overlap, so it renders a single best→worst list; when `>20` outlets qualify, only the top-10 + bottom-10 are carried to the client (`truncated`) with a "+N in between" note. An outlet ranks for an item only with **≥`MIN_N_OUTLET`** mentions, and an item appears only if it clears `MIN_N_CHAIN`/`MIN_POLAR_SHARE` chain-wide. Computed by `buildLeaderboard`; client render in `outlet-leaderboard/LeaderboardClient.tsx`.

**One scan, three views.** `lib/outletReport.ts` was refactored (2026-06-22) so a single `scanDataset()` pass over flat rows + taxonomy assertions builds the per-outlet/chain `{pos,neg,total}` accumulators that **all three** views read from: the per-outlet report (`buildReport` → `computeOutletReport`), the leaderboard (`buildLeaderboard` → `computeOutletLeaderboard`), and the **Action-Plan predictor** (`buildPredictorFromScan` → `computeOutletPredictor`). The report page uses `computeOutletReportWithPredictor` to get the report **and** its predictor from one scan. **Theme labels are read from `theme_model.themes[].name`** (older payloads used `label`); reading the wrong field collapsed every theme into a single "Theme" bucket.

**Action Plan — the "recover your 1–3★ guests" predictor (added 2026-06-22).** The report's **default tab**, powered by `lib/outletPredictor.ts` (`buildPredictor`, pure/unit-tested). **Frame** (after an earlier severity/★-per-mention model was rejected as overstated + tautological): a brand's average is dragged down by its **low-rated (1–3★)** reviews; the goal is moving those guests up. Per outlet the headline is its **1–3★ rate vs the brand's best-run quarter** (`targetLowRate`). The body is **peer quartiles per theme** — the operational layer: for each actionable theme, every outlet is ranked across the chain by its **problem rate** (`# reviews that are 1–3★ AND cite the theme ÷ the outlet's total reviews`). An outlet in the **bottom quartile** (`peerPercentile ≥ 75`) on a theme has a real, peer-relative **weakness** (`outletLevers` — shown worst-first, *all* of them, so a broadly-failing outlet shows multiple issues, never "diffuse"); **top quartile** (`≤ 25`) = a **strength** (`outletStrengths`, shown as full cards — "top 10/25%" badge, low problem rate, and a **praise quote** from a 4–5★ review citing the theme, captured as `highExamples` alongside `lowExamples` in `scanDataset`). Each weakness card shows the percentile ("bottom 10/25%"), the problem rate, a verbatim 1–3★ quote (`lowExamples`), and the **top 3–5 performers** to learn from on that theme (`themeExemplars` — a LIST, not one outlet: the top performers are ~tied at zero problems, so a single pick collapses to whichever outlet is best *overall* and gets recommended for every theme; a handful gives varied, theme-specific options). Two key earlier decisions stand: **outcome themes** (loyalty / brand experience — matched by `OUTCOME_RE`) are **excluded** from weaknesses/strengths and reported only as a brand-health *signal*, because they're lagging symptoms of the operational drivers, not manager levers; and per-review **theme membership** (bare keyword match, same matchers as the leaderboard) is captured in `scanDataset` as `reviewMatrix: {placeId, rating, themes[]}[]`, with the 1–3★ vs 4–5★ split supplying sentiment. **Quote attribution is sentence-level** (2026-06-22): the captured quote is the *sentence containing the matched keyword* (`scanDataset` uses `tm.re.exec` to locate the match, then `extractSentence`), so a quote filed under a theme is actually about it — not just the review's first sentence (which used to let a Cleanliness keyword surface a staff complaint). Client render: `ActionPlan`/`LeverCard` in `outlet-report/OutletReportTabs.tsx`. The tab also carries the GM-context layer (added 2026-06-22): **"where you stand"** (this outlet's `lowRateRank` of N on 1–3★ rate, vs brand avg + best), a **systemic-driver connection** (passes `brandLevers[0]` — "the chain's one systemic issue is X, and you're bottom-quartile / top-quartile / mid on it"), and a **peer-cohort** count per weakness (`cohortSize` = # outlets in that theme's bottom quartile). An **interactive what-if** (`WhatIfPanel`, added 2026-06-23) lets a GM **drag a per-theme slider** to set each theme's target 1–3★ problem rate (with Reset / peer-median / best-in-class presets) and see the projected **1–3★ rate + rank** update live, framed as **detractors recovered** (no fabricated stars). Each slider runs on an intuitive per-theme axis: **left = 0% (perfect), right = the rounded-up worst-in-class rate** (`themeTargets.worstRate` = the worst any outlet does on that theme) — both **anchors are labeled on the bar**, and the handle + benchmark ticks (`Marks`) share the scale. Three ticks — **You (current)** Ana orange `#E85A1A`, **Peer median** brand Sarina teal `#0F7173`, **Best-in-class** bright lime green `#84CC16` — three distinct hues — with a legend above and the median/best values in the right-hand readout (what you're striving toward). It's **two-directional**: drag **left** to improve (past best-in-class toward 0) or **right** to model the theme *worsening* (toward the worst peer) — improvement uses the careful least-improved-theme recovery (a floor), worsening adds a directional estimate (Δrate × reviews, capped at the happy pool). The result reads **detractors recovered** (green) / **added** (red), the **1–3★ rate**, and the outlet's **overall rank** — a *conventional* rank by **average star rating including the 4–5★ pool** (`ratingRank`, **1 = best**), projected by shifting net-recovered detractors from the outlet's detractor-avg up to its happy-avg and re-ranking against every outlet's `allRatings`. (The "1 = worst" 1–3★-rate rank was replaced — people think "I'm #45, this brings me to #29.") `buildPredictor` gained `themeTargets.worstRate`, `outletSummaries.ratingRank`, `outletWhatIf.{avg,detractorAvg,happyAvg}`, and `allRatings`. **Star ratings here follow the "ratings = all reviews" principle (2026-06-26):** per-outlet `avg`, `chainAvg`, `ratingRank`, and the what-if base are over **ALL rated rows** (from `outletReport`'s `ratingSum/ratingN`, via `PredOutlet.{rating,ratingN}`), so they tie back to Google / exports; the projection denominators are the all-rows counts (`model.ratedPopulation`, `outletWhatIf.ratedReviews`). The **recovery model stays text-pool** — `detractorAvg`/`happyAvg`, `lowRate`, `lowCount`, and the recoverable `reviews13` are over reviews-with-comments only (the only ones carrying themes to act on), so a recovered detractor's star lift is spread over the all-rows total. `population` (text) vs `ratedPopulation` (all rated) are kept distinct. It's honest about co-occurrence: the pure `projectRecovery` (in `lib/outletPredictor`, unit-tested) recovers a review **gated by its least-improved theme** — a review citing a theme left at its current rate stays a detractor, and recovery scales with how far the binding theme moves (a conservative floor). Each theme row carries a **brand-wide QoQ trend badge** (▲ worsening / ▼ improving / flat) from `themeTrends` — problem rate in the most recent full quarter (≥40 reviews) vs the prior, flagged directional only on a ≥0.5pp **and** ≥25% move (so noise on a ~1% base reads flat); per-outlet-per-quarter is too sparse, so trends are brand-level. The same badge appears on the brand page's driver cards. The predictor exposes `outletWhatIf` (per outlet: its 1–3★ reviews as actionable-theme index sets + current per-theme rate), `themeTargets` (peer-median + best-quartile problem rate per theme), and `allLowRates`; the page ships only the selected outlet's slice to the client. (This is the deliberately-narrow successor to the original ridge "★ what-if" that was rejected as overstated — same interactivity, defensible unit.) An **"Export GM plan"** button (`GET /api/datasets/[datasetId]/outlet-plan-deck?outlet=<place_id>`, org-scoped) — **removed from the UI 2026-08-18; the route and builder remain but nothing links to them** — renders that single outlet's plan as a Datanautix-branded PPTX via `lib/pptx/outletPlanDeck.ts` (where-you-stand KPIs + systemic-driver note → "what to work on" weakness table with per-theme learn-from → complaint quotes → praise-quote strengths → how-to-use) — the per-store-manager counterpart to the brand deck. Associational — a prioritization signal benchmarking outlets against their peers, not a causal star change.

**Brand improvement plan — the executive summary (added 2026-06-22).** The brand-level "why you need us" view, fed by the same predictor. Route `app/analyze/[datasetId]/improvement-plan/` — **NOT a new tab**; reached via an **"Improvement plan →" button on the Leaderboard** header. Sections: **the opportunity** (brand 1–3★ rate + its *spread* across outlets — e.g. 1.4% best vs 40% worst — plus the projected rate if every outlet hit the best-quartile target); **recommended actions** — a greedy, impact-ranked, **de-duplicated playbook** (`buildRecommendedActions`, pure/unit-tested): candidate actions are outlet turnarounds (fix an outlet's themes to peer median) and theme programs (fix one theme at its bottom-quartile cohort); each round picks the action with the highest *marginal* detractors-recovered (over a shared bad-review pool, recovery gated by each review's least-improved theme), so the list is additive not double-counted. Theme programs tend to lead (single-issue complaints aggregate across the cohort); outlet turnarounds mop up multi-issue stores. It's an **interactive plan builder** (`PlaybookPanel`, 2026-06-23): each action ships its per-review recovery contributions (`rec` = review-index→weight), so checking/unchecking actions recomputes the **de-duplicated** total (union: max weight per review, never the overlapping sum) live, plus the projected **brand 1–3★ rate** and **brand avg ★** (recovered detractors shift from the brand's `model.detractorAvg` up to `model.happyAvg`). Brand-level interactivity is deliberately grounded in *concrete actions*, not a vague chain-wide rate slider (which would imply uniform dialing + has no brand "rank"); **the systemic driver** (`brandLevers` = the one/few themes over-represented in 1–3★ vs 4–5★ *chain-wide* — base-rate-controlled, so loud-but-neutral topics don't mislead — with `outcomeSignals` flagged as a lagging symptom — and made actionable via `outcomeCorrelations`: the operational themes most correlated with loyalty erosion among 1–3★ reviews [co-occurrence lift], computed **brand-level** since per-outlet loyalty-citing reviews are far too sparse, so "fix the drivers and loyalty follows" names *which* drivers; and non-drivers listed); a **"where to start" hot-list** (`outletSummaries`, *highest 1–3★ rate first*, with each outlet's worst-ranked issue + weakness count); a **"by issue" section** (`themeFocus` — per actionable theme, the bottom-quartile outlets to coach, each rendered as a clickable **chip** with its problem rate [and the "Learn from:" exemplars as chips], the card heading showing the **peer-median problem rate** [`themeTargets.medianRate`] as a baseline frame of reference — 2026-06-24 readability pass); and **who already does it well** (`exemplars`). The page's one export control is the **Operational Review** button (below). `buildPredictor` returns `{model, drivers, brandLevers, outcomeSignals, actionableThemes, exemplars, outletSummaries, outletLevers, outletStrengths, themeFocus, themeExemplars}`.

**Operational Review Report — the single merged export (replaces the two separate exports, 2026-06-24).** The Brand Health (improvement-plan) page now ships **ONE** export control (`OperationalReviewExport`, a client control in the nav action slot). Clicking it opens a **cover-info modal** (2026-06-25) that collects: **presentation title** (default `${brand} — Operational Review`), **subtitle** (optional, blank → the auto stats line), **prepared for** (audience/client), **prepared by** (default Datanautix), **competitors** (comma-separated, drives the live benchmark), and **franchise states**. Blank fields are omitted from the URL so they fall back to builder defaults; Generate navigates to the route (download). These flow through as `title`/`subtitle`/`preparedBy`/`preparedFor`/`competitors`/`franchiseStates` query params → `OperationalOpts`, and the **dark cover slide** (`renderTitleSlide`) renders the custom title/subtitle plus "Prepared for {x}" / "Prepared by {y}". The export: an **Operational Review** that **merges the operator improvement-plan detail with the independent-acquirer diligence framing** into one deck, and adds a **NEW Dimensions (aspect-sentiment ABSA) section**. It supersedes the previously-separate "Export deck" (improvement plan) and "Export diligence report" buttons — the `DiligenceExport` control and the `diligence-deck` route were removed; `improvementPlanDeck.ts` + the `improvement-plan-deck` route remain (the merged builder copies their slide logic conceptually, and the route may be referenced elsewhere). Route `GET /api/datasets/[datasetId]/operational-review-deck` (org-scoped, cloned from the old diligence-deck gate: `getCallerOrgContext` + service-role dataset fetch + `!isAdmin && ds.org_id !== orgId → 404`; `force-dynamic`, `maxDuration 120`), backed by `computeOutletPredictor` + `lib/diligenceData.ts` (`computeDiligenceData`) + the persisted **taxonomy rollup** (`lib/taxonomyRollup.ts` `computeTaxonomyRollup`, over the dataset's default free-text field — same field-detection rule as the Taxonomy tab; for google_reviews that's `review_text`) → `lib/pptx/operationalReviewDeck.ts` (`buildOperationalReviewDeck(p, d, brand, opts)`, where `OperationalOpts extends DiligenceOpts` with `dimensions?: TaxonomyRollup | null`). **Slide order:** Executive Summary (KPIs) → **How we read the reviews — two lenses** (a themes-vs-dimensions explainer up front: themes = *organic* / emergent from the guests' words; dimensions = *pre-defined* fixed taxonomy, **defines ABSA = Aspect-Based Sentiment Analysis** — so the audience isn't assumed to know it) → Brand Health (star dist + cautionary volume flag) → Performance by State → Location Leaderboard (top-5 rows tinted green / bottom-5 red for at-a-glance separation) → Where to Start (highest 1–3★ outlets) → What Drives the Stars (protect/fix two-column) → The Systemic Driver (if drivers) → one **"Where to Focus — {theme}"** table **per actionable theme** → Value-Creation Levers → **Dimensions — Aspect Coverage** (column chart of the 7 ABSA axes by mention rate %) + **Dimensions — What Stands Out** (top ~10 sub-aspects: mentions, %-positive, avg ★, with the lowest %-positive called out as the fix list and any food-safety/pest severity alerts surfaced) → What Guests Are Telling You (quotes) → Who Already Does It Well → Competitive Benchmark (if competitors) → merged Method & Diligence Notes. **The Dimensions section is omitted** when the rollup is null or `withSignal === 0` (unclassified dataset) — the rest of the deck still renders. **Two rating lenses, kept distinct:** 18-month blended vs lifetime Google rating. **Competitors typed at generation time** trigger the same **one-time live competitor benchmark** (`lib/competitorBenchmark.ts`, non-fatal) as before. The brand's own Maps search term is a **cleaned `brandSearch`** (prefers `review_sources.brand_name`, strips a trailing "reviews"/"restaurant reviews") — the raw dataset name (e.g. "Ruths Chris Reviews") doesn't match the real listing ("Ruth's Chris Steak House") and produced a brand rating of 0. `norm()` also **removes apostrophes** (so "Ruth's" → "ruths" matches the brand name) and the markets cap is 8. The competitor slide is **only attached when `brandLifetime.rating > 0`** (never a "0.00★" comparison). The `volumeRampFlag` cautionary note and the taxonomy/competitor reads are all non-fatal — the deck ships without the affected section rather than 500-ing. Filename `${brand}_Operational_Review.pptx`. Every figure traces to the predictor, `diligenceData`, or the taxonomy rollup — nothing fabricated. Datanautix-branded export (the deck-export brand exception): each content slide carries the **subject brand prominently top-right** (with the small `data·nautix` producer mark in the footer) — a shared `slideRenderer` chrome change, so every deck export gets it.

**Header & which-location identity.** The eyebrow shows the **brand** (dataset name); the **h1 is the location**, resolved by `resolveLocationName()` — use `location_name` when it carries location-specific words *beyond the brand* (brand tokens from the dataset name + a generic-word stoplist removed), e.g. "Tabla Indian Restaurant **Lake Nona**"; else fall back to **"City, State"** (so a `location_name` that's just the brand, e.g. "Rubio's Coastal Grill", doesn't dupe the eyebrow → shows "Redlands, California"). The subtitle is the street **address · N reviews**, which uniquely pins the outlet either way. The narrative uses the same resolved location name.

**What it shows.** For the selected outlet (dropdown switches via `?outlet=<place_id>`):
- **Headline KPIs** — two: avg star rating vs. peer-group average, and peer **rank (#N of M)** + percentile. Per-outlet rating + review counts come straight from `dataset_rows_flat.data.{rating,place_id}`. (Per-axis analyzed-review counts moved into each tab's footnote.)
- **"Excels at" / "Needs work"** — per tab (Themes or Dimensions), the items where the outlet's **net-positive rate** (`(pos−neg)/total`) most beats / trails the chain average for that same item, each with the gap (in points), the rate vs. peers, mention count, and a representative customer quote.

**How the comparison is computed** (`lib/outletReport.ts`, server-only):
- Outlets are keyed by **`place_id`** — several locations share a name + city, so the human label alone is ambiguous (labels disambiguate by appending the street when name+city collide).
- Sentiment reads the per-field taxonomy assertions straight off each flat row's embedded `data._tx` blocks (`{axis, sub, polarity, evidence}`, sql/151) — one entry per classified field, no join needed.
- Stability floors filter noise: a theme needs ≥6 mentions at the outlet, ≥20 across the chain, ≥30% of its mentions opinionated (drops pure-mention subs like `touchpoint:server`), and a ≥8-point gap vs. peers to surface as a strength/weakness.
- **Quote recovery**: the classifier's `evidence` is a fixed-width window that starts/ends mid-word, so the report locates it inside the full `review_text` and expands to sentence boundaries.
- **Keyword false-positive guard**: the classifier is 100% keyword-based (uniform 0.85 confidence), so the cleanliness keyword "dirty" false-fires on menu items ("dirty soda", "dirty cherry cola") and the idiom "dirty look(s)". `isNoiseAssertion()` drops those from the Clean axis. This is a report-layer patch; the proper fix is vocabulary-level in the classifier.

---

## Filters & Breakdown

### Filter Types
- **Categorical**: Checkboxes with "exclude blanks"
- **Numeric Range**: Min-max slider with "include blanks"
- **Date Range**: ISO date picker

### Global Filter Architecture
- Serializable: `serializeFilters()` / `deserializeFilters()` for URL/storage
- Application: `applyFilters(rows, filters)` returns filtered array
- Context Provider for app-wide state (`components/analyze/FilterContext.tsx`)
- **Filter-option metadata is live, not the loaded rows.** `FiltersModal` is fed *synthetic* rows (one per distinct value) built by `DatasetShell` from `/api/datasets/[id]/filter-options`, which queries the flat table directly for categorical value lists, numeric ranges, **date range** (`data->>field` min/max, empties excluded — NOT `row_index`, which returned two arbitrary insertion-order dates), and a **live per-field `blanks` count** (`SchemaFieldConfig.blanks`, total − non-blank). The modal prefers `f.blanks` over counting synthetic rows (which would fabricate blanks for any field with fewer distinct values than the widest).
  - **Single-pass sampled path (`sampled_filter_options`, sql/168, lib/`sampledFilterOptions.ts`).** The route no longer loops per field calling `count_nonempty_rows` + `count_field_values` + `numeric_field_stats` + two `.order('data->>field')` date probes — each a full scan that 57014'd at 1M (the modal never opened on large datasets). It now keyset-pages the deterministic 50K sample ONCE (`idx_drf_sample`, the same sample every sampled surface serves) and accumulates per field: non-empty count, categorical distinct values w/ counts, numeric min/max, date text min/max. **≤50K rows → the walk reaches every row = EXACT** (and surfaces up to **500** distinct categorical values vs the old 200 — the fix for the owner-reported "missing location values" bug, where a rare value ranked past 200 was silently absent). **>50K → deterministic sample**: non-empty/blanks scaled to `row_count` and the response flags `sampled: true` per field ("~"). Value lists are computed for **categorical only** (open-ended is never a checkbox filter). When a field's distinct count exceeds 500 the response sets `valuesCapped: true`; `FiltersModal` then shows a "Top 500 shown — search to add" note and a per-field **search box** that both filters the chip list and lets the user type a rarer value to add it to the allowlist. Legacy per-field path is retained as the PGRST202 deploy-order fallback.
  - **The client PREFERS the server `values` over sample-derived.** `DatasetShell` overwrites `SchemaFieldConfig.values` with the route's list (authoritative, 500-deep) — previously it only filled `values` when empty, so on a sampled dataset a rare value absent from the loaded 50K sample never appeared in the modal.
  - **One jsonb parse per row + cached + prefetched (sql/194, 2026-08-28).** The sql/191 walk was still field-count-linear: its cells CTE cross-joined the field list against the page and re-extracted `data->>field` per cell, re-parsing each row's jsonb once PER FIELD — measured ~80ms/field per 5K page on ANES (125,897 rows × 51 filterable fields) = a **41.5s** modal open. sql/194 rewrites cells to explode each row ONCE via `jsonb_each_text` hash-joined to the field list (aggregate re-anchors on the field list via LEFT JOIN so an everywhere-absent field still emits its zero row). The route also **caches** the computed options in `dataset_state.filter_options` `{fingerprint, computedAt, fields}` — fingerprint = flat row count + `last_synced_at` + sha1 of (field, type, label) — and serves the cache while it matches (one head-count query, ~150ms); cache read/write are isolated queries so a database without the column yet just misses. `DatasetShell` now **prefetches** `/filter-options` on mount instead of on first modal open, so clicking Filters is instant; the loading modal remains only for a click that beats a cold recompute.
- **Server-aggregate filter forwarding (`/aggregate` `p_row_ids`).** The Charts/Stats server aggregate path is filter-aware by materializing a `filteredRowIds` list (the flat `_rowId`s of the client-filtered rows, only when filters are active — else `null` = whole dataset) and passing it as `p_row_ids`. This is wired for the **taxonomy (`tax_*`) family** in BOTH the Charts tab (`ChartsModule.useAggregation`) and the Stats-tab **dimension tests** (`GroupTestsPanel` t-test/ANOVA/chi-square — filters-compliance sweep 2026-07-13; before, they ran over the whole dataset while the sibling Charts tab filtered the same RPCs). **KNOWN GAP (escalated, perf review §7 Brief F):** the five **scalar** `/aggregate` ops (`crosstab_counts`, `group_numeric_stats`, `date_series_stats`, `count_field_values`, `numeric_field_stats`) and `theme-counts` take no row-id/filter param, so on the server path (large datasets past the client-compute threshold) they render full-dataset numbers under a filtered UI. The fix — add `p_row_ids` mirroring the tax family — needs new SQL and is folded into the `/aggregate` sampled-twins work (Brief C).

### Saved Views & Snapshots (`docs/SAVED_VIEWS.md`)
A **view** is a saved `FilterContext` state; a **snapshot** freezes a view's aggregates.
API: `/api/datasets/[datasetId]/views` (views CRUD, snapshot CRD + `expires_at` lifecycle).
`FilterContext` exposes `loadView` / `activeView` / `isViewDirty` (live filters diverged from the
loaded view — via `serializedFiltersEqual()`). Relative **periods** resolve client-side through
`resolvePeriod()` into the existing `DateRangeFilter`; the default date axis is
`SchemaConfig.primaryDateField`. The `ViewsBar` switcher (`components/analyze/ViewsBar.tsx`) is mounted in
`DatasetShell` between the metric strip and filter chips, and hosts the **relative-period picker** (month/
quarter/year × this/last, gated on `primaryDateField`). A period is stored as intent and resolved into
`effectiveFilters` at read time, so "this quarter" recurs. **Snapshots** freeze
`computeAnalyticsFromRows(applyFilters(rows, effectiveFilters), schema)` into a `frozen` blob and render
read-only via `SnapshotModal` (drift-immune; no per-module render-from-frozen). The Schema tab
(`SchemaEditor`) lets a date field be designated the period axis ("Use for time analysis" →
`primaryDateField`). A period can also carry a **comparison** (previous period / same period last year); `ComparisonStrip` shows
primary-vs-prior record counts + delta with to-date alignment (`alignToDate`) and the §4.2 delta rules.
End-to-end coverage in `tests/e2e/saved-views.spec.ts` (env-gated). _Status: all phases built (foundation,
API/context, views UI, period picker, snapshot freeze/render, date-axis override, headline comparison);
per-chart two-series rendering deferred._

### Value Aliases (`lib/aliasUtils.ts`)
- Remap categorical values for display (e.g., "1" -> "Very Satisfied")
- Applied in: filters, chart axes, statistics output, breakdown labels, exports

---

## Export Features

The ExportModal offers exactly **two formats**: PPTX and HTML. There is no CSV
analytics export — dataset-row CSV download is not part of this module.

> **Org gate:** every export route (`/api/datasets/[datasetId]/export/{pptx,html,signals-pptx,html/share}`) resolves the dataset with the service role, so it pairs the lookup with the caller's `org_id` via `getCallerOrgContext` (admin-org may export any) and returns 404 cross-org. See `docs/SECURITY.md` § 2; regression in `tests/integration/export-org-gate.test.ts`.

> **All row-reading routes read `dataset_rows_flat` only (2026-07-02).** `theme-impact` (key-driver regression) was still reading the removed legacy `dataset_rows` batch table — which physically lingers with stale residue — and discarding the query error, so it silently returned empty/stale analysis. It now reads `dataset_rows_flat` (the sole source of truth). The dead `dataset_rows` fallback branches in `theme-counts` and `export/{html,pptx}` were removed too. `scripts/check-no-legacy-dataset-rows.ts` (CI: `npm run check:no-legacy-rows`) now fails the build on any new legacy-table *read* (deletes are still allowed for teardown cleanup).

### PPTX (Consulting-Quality Deck)
> **Naming (2026-06-29):** the user-facing button label is **"Reports"** (📊, plural, in the analyze-view header). The old cutesy "StoryTime" name was retired as opaque. Internal route/code names (`export/pptx`, `renderDeck`, etc.) are unchanged. A **unified "Reports" picker** is being rolled out — source of truth `lib/reportCatalog.ts` (`availableReports(ctx)`, pure + unit-tested), rendered by `components/analyze/ReportsMenu.tsx`. **Surfaces live (2026-06-29):** (1) the collection card ⋯ menu renders the catalog (community/competitive/brand-360) under a "Reports" header with **PDF + HTML** pills (were PDF-only), competitive keeps its focus picker; (2) the **analyze-view header "Report" button** is catalog-driven — and (refined 2026-06-29) when a **deck** is available it runs the deck DIRECTLY (the common case, zero extra clicks), with a **caret ▾** beside it that opens the full picker for the other types (Operational Review on restaurants, ad-hoc, …). A collection (no deck) makes the button itself the picker toggle, and the caret now shows there too (consistency). (Earlier the button always opened the picker → one extra click for the deck; the owner flagged it, this is the fix.) **Dropdown positioning (2026-06-30 fix):** the picker is rendered `position: fixed` anchored to the button's bounding rect — the header tab strip is `overflow: hidden`, which silently CLIPPED the old `position: absolute` dropdown (it opened but was invisible → "the caret does nothing"). The deck-direct modal was unaffected (it's a full-screen fixed modal), which is why only the caret/picker looked broken. `ReportsMenu` renders configurable types as a single row (format chosen in their own modal) and one-click types with format pills; the header's launcher dispatches GET→open / POST→blob-download. The **ad-hoc Ask-Ana report** endpoint is built — `POST /api/datasets/[datasetId]/ad-hoc-report {prompt, format, filters?}`: org-gated + content-safety-checked → `loadAnaSample` (the shared Ana data layer, `lib/anaReportContext.ts`, extracted from ask-ana) → one `callAI('advanced')` producing a grounded HTML fragment → `pdfDoc` → HTML or PDF. Collections route through the same datasets endpoint (`source='collection'` id). **Wired + live (2026-06-29):** `components/analyze/AdHocReportModal.tsx` (prompt textarea + PDF/HTML choice) opens from the "Ad-hoc report" picker row on both the collection card and the analyze-view header; `adHocEnabled` is on in both. The header ad-hoc **honors the in-view filters** — `DatasetShell` serializes the active filters → `DatasetHeader` `inViewFilters` → the modal → the endpoint's `loadAnaSample` (so: full dataset from a card, filtered from the analyze view). **Format honesty (keep-me-honest):** deck **PDF** is intentionally NOT offered — the deck's HTML form is a Reveal.js *presentation* (won't print cleanly) and PPTX→PDF needs LibreOffice (unavailable on Vercel); the deck is PPTX (slides) + HTML (presentation), the ad-hoc reports are HTML+PDF. Collection reports are now **PDF + PPTX + HTML** — the collection **PPTX** shipped 2026-06-29 (`projectType.formats` = `['pdf','pptx','html']`; renderer above), so both the card ⋯ menu and the analyze-view header offer a PPT pill on community/competitive/brand-360; the competitive PPT path reuses the focus picker (the chosen format is stashed in `projectFormat` until the focus is picked).
**Data Story (2026-09-02) — shareable narrative web page.** A new one-click
"Data Story" row in the Reports picker (`data-story` in `lib/reportCatalog.ts`,
datasets with AI on) generates a self-contained narrative HTML page from the
dataset's ENGINE numbers and returns a **share link — no login, expires in 7
days, revocable**. Pipeline (`POST /api/datasets/[datasetId]/story` →
`lib/dataStory.ts`): org-gated; requires a mined theme model; fetches up to
50K rows (evenSample past the cap, labeled in the page's method note); every
theme figure comes from `recountThemes` over the substantive base — the same
numbers TextMine shows; a rating field (name heuristic) adds a
"what moves the score" avg-rating-by-theme section and a 2–6-value categorical
(≥60% coverage, ≥30 substantive rows per segment) adds a per-segment profile;
quotes are sentence-level, keyword-anchored, and MUST pass `verbatimSupports`
for the theme's sentiment (the verbatim-premise rule) — neutral themes get no
quote.

**Benchmark upgrade (2026-09-02 later, owner: match the bespoke
ea-football-explorer piece).** The story now ARGUES instead of inventorying —
findings-led throughout, plus three new deterministic analytics and reader
interactivity, all computed in code (the AI still writes prose only, and every
head has a deterministic numbered fallback in `deterministicNarrative`):
- **Thesis H1** — the AI writes a ≤90-char argument headline over the payload
  facts (deterministic fallback: `storyTitle`); the old title becomes an
  uppercase kicker. Every section H2 is a FINDING with its number in the
  sentence ("…hits 42% of College Football 27 reviews, against 22% in the
  Maddens"), never a category label.
- **Timeline** (`pickDateField` — typed date, else date-named + ≥70% parseable;
  `buildTimeline`) — buckets by week/month/quarter on span, drops buckets
  <20 rows, needs ≥4; per bucket: volume, avg rating, and share of the top ≤3
  non-neutral themes within that bucket's own substantive base. Findings:
  first-third→last-third rating move and the biggest theme-share shift. Two
  ONE-AXIS figures (rating line; theme-share lines with direct labels) — never
  a dual axis.
- **Numeric bands** (`pickBandField` + `buildBands`) — the benchmark's playtime
  move: a continuous behavior numeric (not the rating) split into quartiles
  **computed from the rows, not the stored analytics percentiles** (those can
  be degenerate — ea_football's snapshot had p25=median=p75); per band: n, avg
  rating, top complaint share. Finding: lowest-rated band, or (no rating) the
  widest complaint-share spread via `bandThemeSpread`.
- **Segment drift** (`computeDrift`) — the theme whose share varies most
  (≥5pp) across segments becomes the section's headline.
- **Derived score** (`deriveScoreField`) — when no numeric rating exists, a
  two-value recommend-style categorical (strict gate: recommend-ish name AND
  boolean-ish values, ≤5% stragglers) maps to 0/100 so every rating surface
  reads as **% recommended** (Steam-style); quote/explorer star meta is
  suppressed for derived scores.
- **Verbatim explorer** ("Read the responses yourselves") — up to 360
  evenly-sampled substantive excerpts (≤300 chars) embedded as JSON
  (`</`-escaped), tagged with matched themes / segment / rating / period;
  vanilla-JS filters (theme, segment, rating low/high, text search) render the
  first 60 matches with a count line. Labeled raw browsing, NOT curated
  evidence — the curated quotes keep the verbatim guard.
Narrative register (owner 9/03): muted, consultant-memo tone — findings with
figures, no drama verbs or news-headline framing. The themes intro must
INTERPRET the mix (concentration, spread, implications), never recite the
chart's own percentages.
**Score drivers + what-if modeler (2026-09-03, owner-directed).** When a
usable score exists, the story fits the outcome on theme indicators through
`lib/statsUtils.logisticRegression` — the SAME ridge-guarded engine behind the
Statistics driver panel — via `buildDrivers` in lib/dataStory: binary outcome
= above scale midpoint (derived % recommended, or top-box rating), estimation
sample = substantive rows with a valid score (≥300 required; each theme needs
≥50 rows on AND off), ≤8 non-neutral themes; suppressed entirely on
non-convergence or separation — no section beats a shaky one. Reported ONLY
in plain English (owner): average marginal effects as "reviews that mention X
are N points less likely to …, with the other themes held equal" — the words
logit/regression/coefficient/odds never appear on the page (test-pinned ban
list); diverging bar figure (orange = pulls down, teal = lifts) with baseline
and n; footnote names the Statistics tab as the recreation path and labels
the numbers associations, not causation. **What-if scenario modeler**: sliders
over the top-5 drivers' mention rates, live modeled likelihood = baseline +
Σ effect × Δprevalence (linear-in-AME planning aid, labeled "directional, not
a forecast"), reset-to-today. Number credibility (owner 9/03, live round): percent scores render as WHOLE
percents everywhere (fmtScoreValue; percent payloads rounded at build); the
modeler reconciles its written-reviews baseline against the all-reviews
overall on-page; timeline trend figures are POOLED over rated rows (never a
mean of monthly means); sliders carry "today" ticks; the drivers chart uses a
dynamic zero axis with in-bar value labels. Sections get a sticky jump-nav
(scroll narrative kept over tabs — deliberate), and every section COLLAPSES
on its heading (starts expanded; print always expands; nav click re-expands
its target). KPI tiles are centered and carry the **score denominator
ladder** (owner 9/03): score over all responses → among written responses →
among responses whose text carries ≥1 theme signal, plus theme signals per
written response (with the share carrying at least one) — so every rate
quoted later reconciles to a visible base. **The signal tile is COMPLAINT
signals only (owner decision 9/03):** matches against negative/mixed themes'
keywords, never positive — a re-mine that adds or drops a positive theme
must not move the figure (it swung 27%↔37% on identical data when the theme
set's polarity mix changed). No negative themes in the model → the tile
hides. Label: "recommend — with a complaint signal". Score values are passed to the
narrative AI PRE-FORMATTED ("49%") and quoted verbatim, so the % sign
always renders; the drivers chart reserves label headroom on both flanks
(outside value labels can never bleed past the box).
Robustness the owner hit live: the rating pick
now validates VALUES not the declared type (retyping "recommended" to numeric
in Schema silently blanked every score section — a text-valued "numeric" is
dropped and the recommend-derivation runs regardless of field type). Output-side American-English
backstop: `lib/americanize.ts` (explicit pairs, case-preserving) converts the
narrative prose at render; quotes/explorer stay verbatim.
Verified in-browser on TEST against ea_football_reviews (12,174 rows): thesis
H1, all five finding heads, % recommended derivation (49.49 overall), monthly
timeline with launch-window troughs, hours_played quartiles (37.34 low band vs
56.49), live explorer filtering. Narrative budget 700→1200 tokens. The AI writes narrative PROSE only (facts passed in, instructed to use
no other numbers; usage logged as `data_story`); on any AI failure the
deterministic narrative ships. Output is uploaded to the private
`report-exports` bucket and served through **`GET /api/story/[...path]`** on
OUR domain — Supabase Storage deliberately serves text/html as text/plain on
*.supabase.co (anti-phishing), so a raw signed URL shows page source (⚠ this
also affects the pre-existing `export/html/share` links — see the route
comment). The signed-URL token stays the sole capability (signature + expiry
verified by Supabase; the viewer route adds no bypass); deleting the storage
object kills every copy of the link instantly. **PDF export (2026-09-03, owner):** `GET /story/[slug]/pdf` renders the
stored HTML through the shared headless-chromium pipeline (brandedPdfChrome,
letter format; route registered in outputFileTracingIncludes — mandatory).
`storyPdfHtml` (lib/dataStory, string-level so pre-existing stories work)
strips the INTERACTIVE machinery — what-if modeler, verbatim explorer,
sticky nav — per owner decision, and forces sections + the data table open.
The viewer injects a floating "Download PDF" button (hidden in print). Same
capability model as the viewer: slug is the credential, revoked/expired = 410.
**Collections tell stories too (owner, 2026-09-04).** The Data Story appears in
every Reports menu — single datasets AND collections — with **HTML + PDF**
formats ('the PDF export needs to be globally available'; the pdf chip points
the opened tab at the short link's `/pdf` sibling, and the signed-token
fallback link opens the HTML viewer whose own Download PDF button covers it).
For a collection the route fans out to the members (proportional split of the
50K cap), tags every row with its member's label via an injected `__member__`
categorical, and passes `preferSegmentField` so **the members become the
story's segments** — per-member profiles, cross-member drift, member names on
quotes. `segmentFieldLabel` now carries the schema LABEL (never a raw key like
`__member__`). The launch flow (synchronous tab + fun-facts building screen +
TextMine-selection focus) is shared by the dataset header and the collection
card via `lib/storyLaunch.launchDataStory` (extracted on second occurrence).
**The story is told about the verbatim selected in the UI (owner, 2026-09-04):**
the header reads TextMine's session selection (`textMine_<id>` sessionStorage,
`activeFields`/`activeField`) and POSTs it as `{ fields }`; the route resolves
that selection's own theme set via `themeSetForField` (the per-field map) and
400s honestly when the selection was never mined ("mine themes on it first")
instead of telling a story about a different question's themes. No body / no
saved selection → the stored top-level model's binding (the old behavior).
Links are SHORT (sql/198): generation mints a crypto-random slug into
`data_stories` and returns `sentimetrx.ai/story/<slug>`; the public
`/story/[slug]` viewer checks `revoked_at`/`expires_at` on every request and
streams the HTML from the bucket — so expiry is EDITABLE after a link is sent
and one link can be revoked without touching storage. **Management surface
(2026-09-03): the Share Analytics modal carries a "Data Story links" section**
(`components/analyze/DataStoryLinks`, passed via ShareModal's `extra` slot)
listing every minted link with Copy / **+7d** (extends a live link's expiry;
REVIVES an expired one — 7 days from now) / **× revoke** (row grays to
"Revoked", the public link 410s immediately). Backing API on the same route:
`GET /datasets/[id]/story` (list) and `PATCH` (`{storyId, action: revoke |
extend, days?}`) — both org-gated, and every `data_stories` query pairs
`dataset_id` with the gated dataset's `org_id` (service-role invariant).
A pre-sql/198 DB returns an empty list, which hides the section. When the insert fails (a DB that has not run sql/198), the route
falls back to the long signed-token `/api/story` link — deploy-order safe.
The header opens the story in
a new tab (painted with a building screen whose centerpiece is a rotating
“Did you know?” fun fact — large type, dead center; a random 40 of the ~138
in `lib/funFacts.ts`, first fact only after 7s so a fast build never flashes
trivia, then a new one every 8s (reading-speed grounded: ~238wpm non-fiction,
160–180wpm subtitle standards, NN/g ~5–7s/frame) — the SAME pool and rhythm
as Ask Ana's wait-state; all well-documented, all in our own words while the ~30–90s build runs) and
copies the link. The h1 de-stutters a doubled trailing word in the dataset
name and adapts its suffix (“what the reviews say” when a trailing
“Reviews” was stripped, else “what the text says”); the layout is a
full-width 1040px column (owner feedback 2026-09-02: no narrow lede cap). Pages are Datanautix-branded (deck/report
export rule), noindexed, CSP-locked to inline assets + Google fonts.

**Ask Ana / ad-hoc data layer — filter-aware deterministic sampling (2026-07-13, sql/167).**
`loadAnaSample` (`lib/anaReportContext.ts`, shared by `POST /api/ask-ana` and the ad-hoc
report) no longer fetches a filter-blind random prefetch (`sample_row_pairs` =
`ORDER BY random()`, a full-partition sort that hit the 8s statement timeout at ~1M rows)
and filters in Node afterwards — a selective filter starved the sample (5% segment of 56K
→ ~30 analyzed rows; narrow filter → a wrong "No rows found"). It now pushes the
serialized filters into `sampled_filtered_rows` (sql/167): keyset pages over the
deterministic sample order (`idx_drf_sample`, the same D6 population every sampled surface
uses) with the filter predicate applied in SQL (`ana_row_matches_filters` — a plpgsql
mirror of `applyFilters`, incl. cat include/exclude, blanks, parseFloat-style numerics
with scientific notation, daterange on epoch-ms). Datasets ≤ the 50K cap are scanned to
the end even after the row budget fills, so the reported filtered population is **exact**
and reconciles with the exact numbers every other surface shows; above the cap the count
is an unbiased sample estimate and both AI prompt notes ("N of M match the filters") carry
"~" (`AnaSample.totalFilteredIsEstimate`). Datasets small enough to fetch whole filter in
Node via the **canonical** `applyFilters` — fixing two silent pre-167 bugs in the inline
copy: cat `exclude` mode was treated as include (inverted results), and `daterange`
filters were ignored entirely. RPC-missing (deploy order) falls back to legacy behavior.
Parity + scale verified by `scripts/_verify_ana_filters.mts` (untracked KEEP): 6 filter
shapes JS↔SQL exact-equal over the Outback 50K sample; 1.03M-row ask with a filter in
~4s (was: timeout); unit coverage in `tests/unit/anaFilteredSample.test.ts`.

**Ask Ana query engine — Ana queries, doesn't skim (2026-09-01).** Ana's numbers no
longer come from eyeballing the ~200-row context sample (statistically meaningless on
a 50K dataset, and irreconcilable with the tabs). `POST /api/ask-ana` now runs an
**agentic tool loop**: when the model calls a query tool, the server executes it,
feeds the result back, and lets the model continue — all inside one SSE response
(up to 8 rounds; `maxDuration` 120s; incremental prompt caching — each round
marks the latest tool results as a cache breakpoint so the next round reads
the shared prefix from cache, ~10× cheaper input on heavy multi-read
questions). Theme/report tools keep their original
client-confirmation-card behavior and end the turn. Two query tools
(`lib/anaQueryTools.ts`):
- **`query_data`** — dispatches into `lib/aggregateOps.runAggregateOp`, the op
  dispatcher **extracted verbatim from the charts aggregate route** (which is now a
  thin auth wrapper around it). Same RPCs, same ≤50K exact / >50K sampled-twin
  gating, same collection fan-out — so Ana's counts/crosstabs/stats/time-series
  **reconcile with the Charts/Stats tabs by construction**. The panel sends the
  filtered view's flat row ids (same set ChartsModule sends), so results scope to
  the user's active filters; the active question's `themeFieldKey` rides into the
  tax_* ops. Results are compacted (top-50 counts / 30 grid rows / 200 buckets) with
  explicit truncation notes. **Ana-composed subgroups (`where`, 2026-09-04 —
  owner-hit: "what issues do young black men identify" had no self-filtering
  path):** `query_data` and `read_comments` take a `where` array
  (`[{field, values[] | min/max}]`, ≤6 conditions) that `lib/anaSegment` resolves
  to row ids server-side with the SAME canonical semantics as `applyFilters`
  (blanks always excluded from a subgroup), then INTERSECTS with the user's
  active filters — both must hold. Resolution is wire-cost aware: categorical
  conditions run id-only jsonb-containment queries (string AND numeric storage
  shapes tried), numeric ranges Node-filter the already-narrowed ids (chunked;
  range-only walks up to the 50K cap and says `sampled`), and identical `where`s
  memo per turn. **Fuzzy value matching (owner ask, 2026-09-04):** requested
  values resolve against the field's ACTUAL stored values (count_field_values,
  limit 500) — exact, then case-insensitive, then normalized-substring either
  way ("black" finds "Black or African American"); a value with NO lexical
  match errors WITH the stored values listed so Ana bridges true synonyms
  (African American ≈ Black) and retries in the same turn — that retry is a
  logged tool step, so the semantic mapping is auditable. Every LEXICAL
  mapping used is recorded on the resolution (`mappings`) and spelled out in
  the result's scope note ('value mapping: "black" matched stored "Black or
  African American" — surface this mapping to the user'), which the
  provenance/logic trail captures; the subgroup label itself reports the
  stored values that actually ran, not the requested phrasing. Every scoped
  result carries a "subgroup … (N rows) — always report this subgroup" note.
  Verified live on TEST Carrabba's ("dissatisfied dine-in guests" → satisfaction
  ∈ [Somewhat/Highly Dissatisfied] ∩ visit type, 4,167 rows, stated in the answer).
- **`find_quotes`** — full-text search (`search_dataset_rows` RPC, textSearch
  fallback, collection fan-out via `resolveScopeMembers`) returning verbatim quotes
  (≤20, internal `_` fields stripped) + an **exact whole-dataset match count**
  (explicitly labeled as ignoring active filters — filtered counts go through
  `query_data`). When filters are active, quotes prefer the filtered view
  (`inFilteredView` flag).
- **`read_comments` (2026-09-02)** — the old-Ana qualitative capability, made
  targeted: for questions that need READING rather than counting ("what are
  people saying about X", characterizing complaints, summarizing suggestions)
  Ana pulls a sample of raw comments into context on demand — with a topic
  query, the most relevant full-text matches (rank-ordered RPC + exact total
  match count, in-view rows first when filters are active); without one, an
  evenly-spaced slice of the filtered view's own row ids, or the deterministic
  `sample_row_pairs` representative sample. ≤200 comments, 300 chars each,
  35K-char hard cap, internal `_` fields stripped. The result carries an
  explicit `scope` line and the prompt mandates stating the reading base
  honestly ("based on 120 of the 283 comments mentioning..."). Owner-directed
  9/02: the query tools covered counting; this restores reading — as a
  targeted on-demand pull instead of the old fixed upfront dump.
The system prompt reframes the row sample as an *orientation sample* and mandates:
every numeric claim from `query_data`, every quote verbatim from `find_quotes`/the
sample, "in the analyzed sample" phrasing whenever a result says `sampled:true`.
The schema context now carries the **data field key** in brackets next to each label
(query SQL addresses `rating`, not "Star Rating" — without the key, queries silently
match nothing). The panel shows a transient status line ("Counting values…") per
tool round via a new `status` SSE event; usage is summed across rounds and logged
once. Runtime budget: `maxDuration = 300` (raised from 120 on 2026-09-02 —
a 19-step ANES question was killed by Vercel at 120s mid-loop, leaving a
provenance trail with an empty answer; the panel now also renders an honest
"ran out of time" message when a stream ends with no text instead of an empty
bubble). Long waits also rotate a muted "Did you know?" factoid under the
status line (2026-09-03, owner — same `lib/funFacts` pool as the Data Story
building screen): appears only after 7 seconds so quick answers never see it,
rotates every 12s, clears the moment answer text streams. Browser-verified on Rubio's (9,905 rows, TEST): star-rating breakdown exactly
matched the dispatcher reference (463/223/296/1197/7726 = 9,905); with a location
filter excluded, scoped counts summed to exactly the header's 9,774 and the
per-rating complement to the 131 excluded rows. Unit coverage:
`tests/unit/aggregateOps.test.ts`, `tests/unit/anaQueryTools.test.ts`.

**"Ana remembers" — per-analyst memory + first-visit interview (2026-09-02, sql/197).**
The personal layer of the Persistent Analyst design. `analyst_memories` (RLS,
org-scoped SELECT; all writes through the service-role `/api/analyst-memory`
route pairing org_id+user_id from auth) holds one row per standing instruction,
with provenance `interview` / `correction` / `observed` and status
`active`/`pending`/`archived`. **The invariant: memories shape Ana's framing,
emphasis, and ordering ONLY — never the figures.** Numbers still come from the
query tools, identical for every analyst; count-changing corrections route to
the approval-gated theme tools (the account-level "house layer"), never to
personal memory.
- **Write path is confirm-only:** Ana proposes via the `remember_preference`
  ACTION tool (a ⭐ Remember card in the panel, like the theme cards); the
  analyst's "Remember this" tap POSTs the memory — nothing is saved silently.
- **Injection:** `lib/analystMemory.memoryPromptBlock` appends active,
  dataset-applicable statements to the system prompt with the framing-only
  contract and an instruction to make personalization audible ("parking ticked
  up too, but I know you don't lead with that"), plus `REMEMBER_GUIDANCE`
  teaching Ana when to offer a save.
- **The panel opens straight into chat (2026-09-02):** the old sampling
  chooser no longer gates the first screen — since the query engine, the
  sample is orientation context, not the analysis, so defaults apply silently
  (200 rows) and the header's Sampling button opens the old setup for tuning
  ("Let Ana help me decide" included). Owner-reported: leading with "choose
  how many rows" buried the interview and carried outdated messaging.
- **Interview → data-question handoff (2026-09-02, owner-hit):** asking a DATA
  question mid-interview used to loop forever — interview mode has no data
  access and nothing exited it (Ana flailed and re-proposed saved memories).
  The interview prompt now answers a data question with exactly
  `[[interview-done]]`; the panel catches the marker, ends the interview, and
  re-sends the same question through normal mode with full data access.
  Related hardening from the same session: memory POST is **idempotent on the
  statement text** (case-insensitive, `ilike` with escaped wildcards — a
  re-proposal or double-tap returns the existing row instead of duplicating),
  and Ask Ana's content guard drops the respondent-facing profanity/insult
  tiers (an analyst's "bite me in the butt" earned a "let's keep things
  respectful" scolding) while keeping slurs/threats/sexual + the always-on
  self-harm net.
- **The interview:** first-ever panel open (zero memories + no
  `ana_interviewed` user_features flag) starts a ≤4-question elicitation
  (what they look at first / audience / what to ignore / phrasing); each answer
  distills into a confirm chip. The interview prompt carries the already-saved
  statements — without them Ana re-proposed a captured preference (seen live
  9/02). Every interview reply's text ends with the next question so the
  conversation never stalls while a chip awaits confirmation. "Done / skip"
  sets the flag; having any memory also suppresses re-triggering.
- **"What Ana remembers" (Memory button in the panel header):** plain list
  grouped by provenance, inline edit, one-tap delete, pending-confirm for
  future observed suggestions, and the contract in the footer ("Nothing outside
  this list personalizes Ana").
Browser-verified on TEST (Rubio's): interview triggered on first open → two
answers produced two correctly-distilled chips (and, after the fix, no
re-proposals) → saved → a generic "how are we doing" answer came back
location-led and opened "leading with location, as your VP expects", no parking
mention → rows edited/deleted in the Memory view. Unit coverage:
`tests/unit/analystMemory.test.ts` (block filtering, org/user pairing, route
identity-stamping + cross-org refusal). Migration sql/197 is applied to TEST;
prod apply rides the next push batch (with 195/196).

**set_view — Ana offers to configure the canvas (2026-09-02, owner-directed).**
Ana once replied "use the platform's filter to set Age ≤ 35, then open the …
field in the analysis tab" — a to-do list. She now OFFERS instead: the
`set_view` ACTION tool renders a "🖼 SET UP THIS VIEW" confirmation chip
(summary + what it applies); one tap and the app does it. The constrained spec
(`lib/anaViewSpec`) carries filters ({field, cat values | range min/max} →
converted to the live Filters shape, invalid entries dropped), an optional
TextMine text column, and a target tab. Application path: the panel dispatches
`ana-set-view-filters` (DatasetShell merges into `useFilters` — every tab
follows), `ana-set-text-field` + a sessionStorage handshake (TextMine adopts
the column whether it's mounted yet or not), then navigates. The prompt bans
telling the analyst to configure the app themselves. Same trust posture as
memory: propose → one-tap approve → fully adjustable afterwards.
Browser-verified: "set me up to dig into 1-star Arizona reviews" → chip
("1-star reviews · Arizona · TextMine on Review", with Ana first confirming
Arizona exists in the data) → tap → header "134 of 9,905 rows", filter chips
State: Arizona + Star Rating 1–1, TextMine on the filtered comments.

**PDF take-away from Ana's answers (2026-09-02, owner-directed).** Any finished
answer (or the whole thread) exports as a branded findings PDF — the "send
away". `POST /api/ana/export-pdf` (auth mirrors ask-ana; the client POSTS the
answer content it already has — export routes never recompute; client-asserted
figures are fine because the document returns to the requester alone).
`lib/anaPdf.composeAnaFindingsHtml` renders Ana's markdown-ish answers to
print-grade HTML: pipe tables → real styled tables (numeric COLUMNS detected
per-column — decoration-tolerant, so "⭐ 4.57" counts — and centered together
with their header; cells top-aligned so a one-line count sits on the first
line of its wrapping neighbor, owner-hit 9/02),
blockquotes → teal pull-quotes, inline ```chart blocks → print bar rows / SVG
trend lines, plus a masthead ("Analyst Findings · Prepared by Ana") and a
per-question "Provenance — how this analysis and report was derived" appendix carrying the logic trail with
its recreate-in-tab pointers. Chrome = `brandedPdfChrome` (datanautix footer,
confidentiality, page numbers); layout per the composed-PDF doctrine
(break-inside: avoid, never forced per-section breaks). Route registered in
next.config `outputFileTracingIncludes` (chromium bin — mandatory per PDF
route). Panel: "PDF" (that exchange) and "PDF · whole thread" buttons beside
Copy/slides, via `lib/browserDownload`. Pixel-QC'd through the real pipeline
(scripts/_qc_ana_pdf.mts, untracked KEEP): 2-page doc, tables/charts/quotes/
logic all clean; route smoke-tested 200 application/pdf.

**The panel renders Ana's markdown for real (2026-09-02, owner-hit: raw pipe
rows in the chat were "quite hideous").** `FormattedLines` in AskAnaPanel now
renders pipe-table runs as real tables (`AnaTable` — same column model as the
PDF: per-column numeric detection with stars/decorations stripped, numeric
columns centered header-and-cells, tabular-nums, top-aligned cells), plus
single-asterisk `*italics*`, `---` horizontal rules, and `>` blockquote
verbatims (orange-rule pull-quote) — all previously shipped as literal
characters. Narrow-panel fit is structural, not cosmetic: the message
bubble's `word-break: break-word` cascaded into table cells and let the
browser stack words letter-by-letter, so tables reset it; numeric headers
are nowrap; prose columns (any cell > 40 chars) take `overflow-wrap:
anywhere` so the table compresses to the panel instead of clipping. Verified
in-browser on TEST against a live Ana answer in both the docked (~360px) and
expanded (940px) panel.

**The panel reads as its own window and keeps its thread (2026-09-04).** The
header wears Sarina teal (`#0E7476`, the datanautix "data" teal — deliberate
contrast with the app's Hermes orange chrome), and the conversation persists
in sessionStorage per dataset across panel close/reopen (owner-hit: X-ing out
to view a chart full-screen lost everything). Streaming messages and
transient status lines are stripped on save; the Clear button is the reset.

**The panel coexists with the rest of the chrome (2026-09-04, owner-hit:
"sherpa disappears when Ask Ana is invoked" + clipped header items).** Three
rules, all verified in-browser on TEST:
- **The panel docks BELOW the global TopNav** (`top: 56`), so the top-level
  product nav (Favorites → Sign out) stays fully visible and clickable while
  Ana is open — it no longer overlays the nav's right half.
- **The dataset header collapses by CONTAINER width, not viewport width.**
  The `.ana-c1..c9` progressive-collapse ladder in DatasetHeader is
  `@container` queries on the header (`container-type: inline-size`), because
  opening the panel shrinks the header by 420/940px while the viewport is
  unchanged — viewport media queries never fired and the right-side actions
  were silently clipped by `overflow: hidden`. Same thresholds as before;
  they now respond to the width the header actually has. The whole-tab hide
  rules (≤850px, ≤640px) carry `!important` — the tabs' inline
  `display: flex` beat the stylesheet, so those rungs of the ladder had
  never actually fired.
- **Fixed bottom-right neighbors slide out from under the panel.** The panel
  (z-1500) announces its occupancy via an `ask-ana-panel` CustomEvent
  (`{open, width}`) on mount/unmount and expand/collapse, and stamps
  `data-ask-ana-width` on `<html>` so late-mounting listeners can catch up
  (Sherpa's HelpWidget lives in TopNav and remounts per page). HelpWidget
  offsets its launcher and chat window `right` by that width. Any future
  fixed bottom-right chrome should subscribe the same way.

**Aggregate ops fan out over collection members (2026-09-04, owner-hit).**
A collection holds no rows under its own dataset id, and `runAggregateOp`'s
scalar and taxonomy ops queried that id directly — so every one of Ana's
`query_data` calls on a collection answered zero (owner saw 8 ops, all
empty, on the 42K-row Darden Fine Brands collection; the Charts tab never
noticed because it computes client-side over rows the rows route already
fans out). Now `field_counts`, `date_series`, `numeric_stats`,
`group_stats`, `crosstab`, `tax_counts`, `tax_group_stats`, and
`tax_date_series` all run per member and merge in JS (per-member `.eq`
keeps `idx_drf_id_keyset`; counts sum, means are count-weighted, stddevs
pool via combined sum-of-squares — exact, not approximate). **A union
median is NOT derivable from per-member medians**: it survives only when a
single member holds all the values, else it is null with a `medianNote`
saying why — never a guess. `group_stats` on `_collection_label` (the
synthetic "Source Dataset" field that is never stored on rows) answers one
group per member from that member's own stats. Collections never use the
sampled twins (single-dataset walkers) — they fan out exact regardless of
size. Ana's `where` subgroup resolution (`resolveWhereRowIds`) takes the
member ids as `scope` and walks them for value discovery, containment
scans, and range walks (flat row ids are globally unique, so merged id
sets stay valid; the range-only walk shares one SCAN_CAP budget across
members). Verified against TEST on the exact owner-reported collection:
all ops answer and Σ per-member n reconciles to 42,224
(`scripts/_verify_collection_agg.ts`, untracked KEEP).

**Ana honors the Dimensions toggle (2026-09-04, owner-hit).** The ask-ana
route computes the same `hasDimensions` gate as Charts/Stats/TextMine and (a)
tells the model in the system prompt when Dimensions is OFF, (b) hard-refuses
`tax_*` ops at execution with a redirect to regular-field ops. Stored `_tx`
data may exist on a dataset whose owner disabled the feature AFTER
classification — answering from it would surface a switched-off feature
through a side door. Status labels for tax ops name the product feature with
the axis ("Counting Dimensions (emotion) tags…") — a bare "counting dimension
mentions" read as generic analysis-speak. Companion guard in TextMine: the
mining-time auto-enable paths (`autoEnableDimensions` / `autoTagEmotion`)
treat existing-classification + toggle-off as a STANDING HUMAN OPT-OUT and
skip entirely (no notice, no classify, no flag flip); first-time discovery
still auto-enables. The backfill script only flips flags on datasets with no
pre-existing emotion data (re-run safe).

**Ana subgroup (`where`) resolution is minutes→seconds (2026-09-04,
owner-hit: a 3-condition ANES subgroup took 5+ minutes and timed out).**
Containment scans and range narrows run in concurrent waves of 8 pages;
range checks pull ONLY the range fields via quoted jsonb arrow-select (the
full-blob pull dominated the walk on wide survey rows); value discovery uses
the 50K sampled twin above the cap (the exact RPC statement-times-out at
ANES scale); `NARROWED_RANGE_CAP` raised 60K→150K (a 64K-row party slice
must range-filter, not refuse); and resolutions memoize ACROSS turns in a
10-minute module-level LRU, so a rephrased question re-uses the resolved id
set instantly. **Then sql/200+201 moved the whole filter into Postgres:**
`segment_match_ids(dataset, conds, after, limit)` compiles the resolved
conditions (values → text equality, min/max → drf numeric range) into a
native predicate via format-%L dynamic SQL and evaluates it during the
keyset scan — one paged call sequence replaces all client-side id
enumeration; `segment_row_matches` remains as the executable spec of the
semantics (whereToFilters ≡ applyFilters) and the unit fakes mirror it.
The JS scan path stays as the PGRST202 fallback (deploy-order safe) and
value RESOLUTION stays client-side (fuzzy matching + mappings + the
stored-values error are product surface). Measured on the owner's exact
scenario (Republicans ≤39, ≥2012 on 126K rows): fail@minutes → 33s (JS
parallel pass) → **9s end-to-end cold, ~0s warm** (sql/201; the residual
is intrinsic detoast cost of wide survey rows). sql/200's first cut
evaluated a per-row SQL function over materialized blobs — 36s — before
201's compiled predicate; both applied to prod via the management API.

**Ana works the CURRENT VIEW (2026-09-02, owner-hit).** Ana answered from the
default verbatim column while the analyst had another selected, and leaned on
the 200-row sample for synthesis. Three changes:
- **ACTIVE VIEW anchoring:** the system prompt names the analyst's selected
  text column (from the TextMine pill's `themeFieldKey`) and instructs Ana to
  target it — read it, quote it, frame text findings on it — unless the
  question clearly points elsewhere.
- **Active-field recovery (2026-09-04):** TextMine dispatches
  `dataset-active-field-changed` on ITS mount — usually before the Ask Ana panel
  exists, so the panel's listener missed it and Ana was blind to the selected
  verbatim column until the user re-toggled it with the panel open. The panel now
  also reads TextMine's `textMine_<id>` session state on mount (same source the
  Data Story header reads), so the ACTIVE VIEW note is present from the first
  question.
- **Field-scoped reads:** `read_comments` and `find_quotes` take a `field`
  key; quotes come from that column ONLY — a row whose target column is empty
  is EXCLUDED and counted (`rowsWithoutThisField`), never padded with other
  fields (the original per-row fallback printed demographic metadata on wide
  survey rows — owner-hit 9/02 on an ANES-style corpus, where Ana honestly
  refused to synthesize three times because her reads returned "metadata
  strings"). Field resolution is label-tolerant (case-insensitive label→key
  map) and defaults to the ACTIVE VIEW column when omitted; results carry
  `fieldUsed`, and a zero-coverage pull returns a hint to check coverage via
  `query_data` first. The no-field fallback now prefers SUBSTANTIVE text
  (longest fields first) so descriptor fields never crowd out the response.
  **Fill-to-limit + representativeness (2026-09-02, owner):** a read now keeps
  pulling — paged search matches, evenly-spaced passes over the filtered view,
  over-fetched samples — until the requested limit holds REAL verbatims (max
  raised to 400, 60K-char budget) or the source is exhausted. And because a
  targeted pull can silently skew (one wave, one region, one age band), reads
  of ≥30 verbatims tally the pull's mix on the schema's `demographic`
  categorical fields against the dataset's own exact `field_counts`
  distribution (filter-scoped when filters are active): any value ≥5% of the
  dataset that shifts ≥15 points in the pull is reported as
  `representativenessDrift`, and the prompt mandates alerting the user
  ("note: this pull skews older — 34% are 65+ vs 21% overall").
- **The sample is now truly last-resort:** orientation default cut 200 → 60
  rows (Sampling button still raises it), and quoting/synthesizing from the
  sample is banned outright — every quote must come from a logged tool pull,
  making all evidence traceable in the provenance trail.
Browser-verified: with Owner Response selected, "what tone do we take in
these responses" produced an owner-response-only analysis (the two boilerplate
scripts with usage counts, verbatim quotes) instead of customer-review tone.

**Inline charts in Ana's answers (2026-09-02, owner-directed: "draw charts
instead of tables where appropriate").** Ana emits a fenced ```chart block
holding a constrained JSON spec — `{"type":"bar"|"line","title","unit?",
"data":[[label,value],…]}` — and the panel renders it as a real chart between
the text segments (`lib/anaChartSpec.ts` parses; malformed blocks degrade to
visible text, an unterminated fence mid-stream shows a "drawing chart…"
placeholder). Single-series only by design: the product orange carries the
series (no legend — the title names it), bar = the product's label/track/value
row idiom (≤12 rows, tail aggregated to "Other"), line = 2px SVG trend with
endpoint dot, low/high labels, and native per-point tooltips (≤60 points).
Values must be VERBATIM tool-result numbers; ≤2 charts per answer; tables stay
for mixed-column detail; the chart:true full-canvas handoff is separate.
**Same-commit fix — lone-surrogate 500s:** truncating emoji-rich review text
mid-surrogate-pair made the upstream API reject the whole request ("no low
surrogate in string", owner-hit on Tabla). `lib/jsonSafe.jsonStringifySafe`
scrubs unpaired surrogates from every string value at stringify time — wired
into BOTH the ask-ana upstream call and the shared `lib/ai.ts` client (sweep
the class).

**One thought at a time + provenance trail + full-width reading (2026-09-02,
owner-directed).** Three UX layers on the tool loop:
- **One transient thought at a time:** round 0's lead-in that streamed into
  the bubble gets a `demote` event once tool rounds follow — the client moves
  it into the italic status slot, where every subsequent thought/tool label
  REPLACES the last. The bubble only ever holds the final answer.
- **"🧠 Provenance — how this analysis and report was derived (N steps)"** (renamed from "Show my logic", owner 9/02 — the label is "Provenance" in the PDF and every user-facing view): every answer carries its work trail — one
  human-readable line per step (`logic` SSE events): each query with its op,
  target, and what came back ("Searched the full dataset for 'service slow' —
  68 matching reviews", "Ran date_series on review_date → 77 time buckets,
  exact"), plus Ana's interim reasoning (including dead ends and pivots).
  Every query line ends with its wall-clock duration (`· 4.2s`) and every
  interim reasoning line with its model-round time (`· thought for 8.1s`) —
  owner ask 2026-09-04, so a slow turn decomposes into query time vs
  thinking time at a glance. Collapsed behind a toggle under the answer;
  footer states the engine guarantee. **Recreatability principle (owner, 9/02): every finding must be
  reproducible by a human inside the platform** — each logic line names the
  surface to redo it in (Charts / Statistics / Search tab), and the prompt
  forbids Ana applying modeling/scoring logic the platform's own tabs can't
  express (simple arithmetic on tool results is fine; missing signals are
  named plainly, never proxied).
- **Expand (⤢):** the panel header toggles 420px ↔ min(940px, 92vw) for
  reading long answers.

**Tool-loop discipline (2026-09-02, owner-hit).** "What are people most upset
about?" once returned pure process narration ("Let me query… let me broaden…
let me also…") and then stopped — the model spent one tool call per round,
hit the round cap mid-gathering, and never wrote an answer. Fixes: the loop's
second-to-last round appends "[Tool budget exhausted — write your complete
final answer now]" and the final request pins `tool_choice: none`, so a
synthesis turn is guaranteed; the prompt mandates BATCHING (all queries in
one turn) and bans process narration/tool names (one short lead-in max);
rounds are separated by a paragraph break in the stream (text used to run
together); cap raised 6 → 8. **Narration is also suppressed STRUCTURALLY
(second pass, same day):** prompt bans alone didn't stop the play-by-play, so
continuation rounds' text is buffered server-side — an interim round's text
("the search terms are too restrictive…") renders only as the transient
status line, while the final round's text is flushed into the bubble. Round 0
still streams live (the lead-in, or the whole answer when no tools are
needed). Re-verified: the answer bubble opens directly with the finding
("⚠️ Two locations are underperforming — and one is your flagship"), zero
process text, thinking visible only transiently while she works.

**The briefing + the canvas handoff (2026-09-02).** The remaining two Phase-2
surfaces from the five-state design:
- **The briefing — Ana speaks first.** When the panel opens with an empty chat,
  the analyst has memories, and no interview is pending, a hidden trigger
  message auto-fires once per dataset per browser session (sessionStorage
  guard) with `briefing: true`. The route appends a BRIEFING MODE block: an
  unprompted opening read built THEIR way per ANALYST MEMORY — 1–3 query_data
  calls, ≤~150 words + one compact table, naming anything de-emphasized, ending
  with 2–3 next-step questions. The trigger message rides in conversation
  history (Anthropic requires user-first alternation) but is never rendered.
- **The canvas handoff — "Open in Charts".** A `query_data` call Ana flags
  with `chart:true` — the ONE query whose view directly answers the question —
  is mapped by `chartConfigForQuery` onto the Charts tab's `{chartType,
  config}` shape (the exact object a saved chart loads; dimension axes →
  `__dim_<axis>__`) and emitted as a `canvas` SSE event; the panel renders it
  as a chip under the finished answer. (Originally "last query wins" —
  retired 9/02 after it offered a rating × city heatmap for "what are people
  most upset about"; owner: "in no way answers anything useful". No flag, no
  chip.) Tapping it
  writes `anaChart:<datasetId>` to sessionStorage, dispatches
  `ana-open-chart`, and navigates to `/charts`; ChartsModule applies the config
  on mount (sessionStorage path) or live (event path, when Charts is already
  open). **The mapping is field-type-aware** — `field_counts` on a NUMERIC
  field goes to the distribution chart, because the bar chart's category slot
  only accepts categoricals (a type-blind mapping rendered "No data for this
  field", caught live 9/02). Questions answer in the panel; the canvas changes
  only on the tap — never a yank.
Browser-verified on TEST (Rubio's): fresh open auto-fired a location-led "VP
View" opening briefing with no visible trigger; "breakdown by state" produced
an Open in Charts chip whose tap (already on the Charts tab — the live event
path) snapped the canvas to State × Star Rating with exactly the answer's
numbers (7,462/2,166/248/29); the navigate-and-mount path was exercised by the
earlier rating-counts chip. Mapping unit tests in
`tests/unit/anaQueryTools.test.ts`.

- **API**: `POST /api/datasets/[datasetId]/export/pptx`
- **Rendering (2026-06-25 — the cream flip)**: the route no longer builds slides with its own
  bespoke navy/gold helpers. Its compute phase (auth + cross-org gate, row fetch under the
  no-sample-under-50K rule, filter recompute, live verbatim sampling, canonical-theme
  counting, AI narratives, rating→quote color map) is unchanged, but its **build phase now
  assembles a `DeckSpec.slides: SlideSpec[]` and calls the shared `renderDeck()`** in
  `lib/pptx/slideRenderer.ts` — the same **cream** renderer (single styling source of truth)
  every other deck export uses. Slide-kind mapping: cover → `deck.title/subtitle/preparedBy`;
  dividers → `section`; exec summary → `kpi_grid` + `bullets`; survey overview →
  `survey_funnel`; about → `kpi_grid` (methodology in the insight band); open-ended overview
  & per-theme detail → `quotes` (with an optional `insight` band carrying the AI narrative);
  theme grid → `theme_cards` (paged 5/slide); categorical/pie → `dist_bars`; numeric →
  `numeric_stats`; compact categorical → `compact_grid`; verbatim comments → `comments_grid`;
  key-driver → `theme_impact`; closing & verbatim instructions → `bullets`; recap → `table`;
  entity / provenance / custom-decks → their existing kinds. The old per-slide `build*Slide`
  builders and the navy `DN`-palette draw helpers were deleted. The cream `section` divider
  has **no emoji/PNG art** (the old navy dividers did).
- **Deck styles (2026-07-06)**: the renderer's palette is no longer hard-coded — presets live
  in `lib/pptx/styles.ts` (`DECK_STYLES`: **Datanautix Modern** = the exact former cream
  constant and the DEFAULT, **Datanautix Classic** = the original navy/teal/gold brand
  palette, plus **Warm** and **Ocean** variants). The ExportModal shows a swatched "Deck
  Style" picker (PPTX only — the HTML export keeps its fixed styling); the choice flows
  `body.style` → route validation against `DECK_STYLES` → `DeckSpec.style` → `renderDeck`,
  and lands on the recap slide for traceability. Inside the renderer the resolved palette
  rides the **per-request pptx instance** (read via `pal(pptx)` in every builder) —
  deliberately NOT a module global, because Fluid Compute serves concurrent exports from one
  warm instance and a shared global would bleed colors between two simultaneous exports of
  different styles. Every other `renderDeck` caller passes no style and renders
  pixel-identical to before (verified pre/post-refactor on a 9-slide spec). The datanautix
  footer mark stays in every style.
- **Audience levels**: `executive` (short, exec-only), `stakeholder` (default — charts + fields),
  `full` (full team — most detail, drives theme-impact slide inclusion)
- **Slides**: Title, executive summary, **survey overview** (survey sources only — see
  below), about/methodology, **Dimensions section** (see below), NPS/rating distributions,
  theme deep-dives (keywords + quotes), sentiment breakdown, theme impact on scores, field
  breakdowns, demographic annotations, methodology appendix
- **Executive Summary vs About — de-duplicated (2026-06-30 fix).** The two slides used to
  repeat the same scope metrics. Now **Executive Summary** carries *findings* KPIs — overall
  ★/score, top theme (name + share), themes-identified count — above the AI "Key Findings"
  narrative (a true summary of what the data says), while **About This Report** owns the
  *scope/method* KPIs and gains a **"Data Range"** KPI (min–max of the dataset's
  `primaryDateField` / `review_date`, e.g. "Jan 2024 – Jun 2026") distinct from the report
  generation date.
- **Dimensions (ABSA) section (2026-06-29)**: emitted after "About This Report" when the
  dataset has Dimensions (`taxonomy_enabled`, or the `google_reviews` proxy unless
  `taxonomy_suppressed` — mirrors `lib/textmineNav`) AND `computeTaxonomyRollup` returns
  `withSignal > 0`. Three slides: **Aspect Coverage** (`column_chart`, 7 axes by mention rate)
  + **What Stands Out** (`table`, top sub-aspects × mentions/%-positive/avg ★, lowest %-positive
  = the fix list) + **Heads-Up** (`table`, the exception alerts). The Heads-Up watch list is a
  pure, grounded, **lens-agnostic** engine `lib/insightAlerts.ts` (`computeInsightAlerts`,
  unit-tested) designed to span **three lenses — themes, dimensions, and quant variables**
  (rating + any other numerics): ranks 🔴 pain points (high volume + low %-positive / rating
  drag), 🟢 bright spots, ⚠️ safety flags (Dimensions-only, always surfaced), and — when a
  recent-vs-prior window is supplied — 📉 deteriorating / 📈 heating-up / ✨ improving trends,
  plus quant trend (avg drift, e.g. ★4.5→★4.2) and low-score-tail surges. Adapters
  `dimensionsToSignals` / `themesToSignals` map each lens onto a neutral `AlertSignal`; quant
  variables use `QuantSignal`. Merged into ONE watch list, lens-tagged, deduped to one alert
  per title (most-urgent wins), capped (default 8) with safety always kept. Adaptive
  min-mention floor (max(8, 2% of baseline rows)); every line carries `n` or an explicit
  before→after. Gated by the `includeDimensions` ExportModal toggle (default ON).
  **Status (2026-06-29, all three lenses + universal):** the Heads-Up is now a **full
  three-lens, lens-agnostic** slide rendered for **ANY dataset** that surfaces ≥1 alert —
  it is no longer nested inside (or gated on) the Dimensions section; it's assembled in its
  own block right after "About This Report" as the executive exception list, and the
  Dimensions section reuses the same rollup it computes.
  • **Quant** — `lib/quantSignals.ts` (`buildQuantSignals`) averages the rating + every numeric
    field over the **recent vs prior window** (dynamic via `trendWindows`) + low-score-tail
    surge ("Overall rating ★4.6→★4.1 (last 6 months vs prior)").
  • **Theme** — `lib/themeSignals.ts` (`buildThemeSignals`, pure + tested) re-matches each
    theme's keywords over the actual rows to compute **real per-theme pos/neg + avg ★** from
    the rated rows (rating ≥4 = positive, ≤2 = negative; null when no rating field — no
    invented precision) AND **recent-vs-prior windowed re-matching**, so an organic theme can
    fire 📉/📈/✨ just like a dimension. `themesToSignals` maps them onto the neutral signal.
  • **Dimension trends** — `computeTaxonomyRollup` accepts an optional `dateField` and returns
    `recent`/`prior` window rollups (`TaxonomyTrendRollup`); the route feeds
    `dimensionsToSignals(dim.recent || dim, dim.prior)` so sub-aspects get 📉📈, not just static
    pain/bright/safety. Per the engine contract, the recent window is the "now" when a trend is
    available, else the full-period snapshot. Slide titled **"Heads-Up"** (Signal · What · Detail).
  Gated by the `includeDimensions`/`includeThemeSlides` ExportModal toggles only for the lenses
  they control; the slide itself renders whenever any lens produces an alert.
- **Survey Overview slide (survey sources)**: first slide after the executive summary when
  the dataset is survey-shaped — `dataset.study_id` set, OR a collection whose member
  schema carries `custom`/`psychographic`/`demographic` sections, OR rows carry a `status`.
  ("With comments" counts responses with text in the theme/comment fields, matching the
  dashboard's `commentCount` — not every open-ended field.)
  Rendered as the cream `survey_funnel` kind: headline **Responses** + **With comments** KPI cards
  over a stage-by-stage **completion funnel**, all computed from the same flat rows the deck
  already loaded — mirroring the in-app shared-analytics dashboard (`/api/share/analytics`):
  stages are `Started → {rating label} → Conversation → Survey Questions (N) →
  Psychographics (N) → Demographics (optional) → Completed`, with retention % and per-stage
  drop-off. Replaces the older response-payload `buildFunnelSlide` (removed), which only ran
  for single studies and never for collections.
- **Themes per slide is user-controlled**: the ExportModal Theme Slides picker exposes a
  *Themes per slide* control (`Auto / 1 / 2 / 4 / 6` → `body.themesPerSlide`, capped at 5 by
  the cream `theme_cards` kind). Each card shows a share **%**, the theme name, a sentiment
  badge, `n of N`, and a row of **keyword chips** (each with its own %).
- **Readable type floor**: all body/content text renders at **≥12pt** (headings, bullets,
  KPI labels, table headers, bar-row labels, %/count values, quotes, theme descriptions,
  implications, recap rows). Chrome stays small by design — footers, page numbers,
  "Proprietary and Confidential", section-eyebrow chips, keyword/sentiment chips, annotation
  pills, chart axis ticks, and fine-print methodology notes.
- **No repeated field name on open-ended sections**: the section divider uses a category
  eyebrow ("Open-ended" / "Verbatim") rather than echoing the field label, and its subtitle
  falls back to a generic descriptor (never the label); the OE overview slide suppresses the
  prompt box and "Headline finding" when they would only repeat the field label (no real
  prompt / no AI finding). Previously the label could appear three times on one slide.
- **Branding**: exported decks carry the **Datanautix** company brand (the deliverable
  brand), while the **Sentimetrx** product name stays in the app/widgets. The deck uses the
  shared `renderDeck` chrome: a **modern white / cool-gray / deep-navy base** with the
  **Datanautix Ana orange `#E85A1A` as the signature accent** (left bars, KPI/value numbers,
  %-badges, keyword chips, header rules) and a **sky-blue** cool counterpoint (the two-tone
  `data·nautix` wordmark, quote marks). Deep-navy cover, the `data·nautix` wordmark in each
  footer, and the **subject brand prominent top-right** of every content slide. `pptx.author =
  pptx.company = 'Datanautix'` in file metadata. (Owner picked this scheme 2026-06-25 — the
  earlier cream/orange/teal read "old-school" against the modern type; decks are
  Datanautix-branded, product is Sentimetrx, per 2026-06-02.)
- **Canonical themes (one set, matches the app)**: themes are counted ONCE across the
  theme model's fields (`computeCanonicalThemes`, mirroring `/api/share/analytics` + the
  in-app Themes page) — not per open-ended field. The executive summary's TOP THEMES and
  the Theme Analysis slides both read this one set, so every theme % agrees. Per-question
  theme sections were collapsed into a single **Theme Analysis** (the per-field verbatim
  overview slides remain). Themes at/below **3% are hidden** (`visibleThemes`, fallback top 5).
- **Theme Analysis = `theme_cards` grid + per-theme `quotes`**: the canonical theme set
  renders first as `theme_cards` (paged ≤5/slide — share **% badge** + `n of N` + name +
  sentiment + keyword chips), then one `quotes` slide **per theme** with its representative
  verbatims (title = theme, subtitle = `% · n of N · sentiment`, optional `insight` = the
  theme description). `themesPerSlide` caps the grid density.
- **Quote selection**: `pickBestComments()` selects the representative quotes per theme
  (run during deck assembly, before `renderDeck`).
- **Comments + signals on text-analytics slides**: every open-ended/theme slide subtitle
  carries `N comments · M signals`, where *comments* = responses with text in that field
  and *signals* = total theme mentions (sum of per-theme match counts; one response can
  hit multiple themes, so signals ≠ comments). Computed live per field via
  `computeFieldThemes` / the canonical `canonMeta`, and appended to each slide's subtitle.
  The same meta is also surfaced on the **Executive Summary** subtitle and the **verbatim
  comment slides** (`comments_grid`) so a response/signal count is never shown bare.
- **Headline response count is live, not snapshotted**: the deck's "Total Responses"
  figure (`displayRows`) and the sampling denominator (`knownTotal`) source from the live
  fetched rows / flat-table count, not the persisted `analytics.totalRows` /
  `collection.row_count` snapshot — which goes stale when collection members gain rows
  (e.g. a 62 snapshot vs 108 live). Prevents the title/summary showing a different total
  than the provenance slide.

> **Collection recompute cascade (2026-06-02, deck-fix #11 — root-cause).** A
> collection dataset (`source='collection'`) holds no rows of its own; its cached
> aggregates (`datasets.row_count`, `analytics.totalRows`, `analytics.signal_stats`)
> are snapshots recomputed only when the collection is explicitly recomputed. Member
> sync (`/api/datasets/[datasetId]/sync`) used to recompute **only the member**, so a
> member gaining rows left every parent collection stale — the underlying cause of the
> 62-vs-108 deck mismatch *and* the earlier 67-vs-80 signal-stats drift (`displayRows`
> and the signal-cache row-count key were band-aids over this). The recompute logic is
> now a shared helper `lib/collectionRecompute.ts`: `recomputeCollectionAnalytics()`
> re-reads every member's flat rows, recomputes via `computeAnalyticsFromRows`, writes
> `row_count` + `analytics`, and calls `invalidateSignalStats`. Member sync calls
> `recomputeParentCollections()` (best-effort, logs-and-continues) after inserting rows
> so parents self-heal immediately; the manual `/compute` route's collection branch was
> refactored to call the same helper (single implementation, no parallel copy).
- **Entity analysis (`body.entityFields`)**: the Custom Builder's Entity Analysis picker
  selects open-ended fields that name organisations (e.g. "Charities Donated To").
  Slides are built from the **stored `entity_catalog`** (`getEntitiesWithCounts`) — the
  same pre-extracted, canonicalised entities shown on the Entities tab. If the catalog is
  empty it runs `discoverEntities` once (which stores the result for next time), unless AI
  is off. Rendered with the shared `entitySlideSpecs` + `renderEntityGrid/renderBarChart`
  from `lib/pptx/slideRenderer` (same renderers as `/api/entity-analysis-deck`, which shares
  the extraction core in `lib/entityAnalysis.ts`). Four deck-specific refinements over the
  raw catalog read:
  - **Field-scoped counts**: `getEntitiesWithCounts` is called with `textFieldKeys =
    entityFields`, so mention counts reflect only the *selected* field. Organisations named
    in other open-ended fields (a venue in a feedback field, a charity-rating site in a
    familiarity field) score 0 there and drop out — they no longer bleed onto the charity
    slide. Falls back to the unscoped field map if the selected keys match nothing.
  - **Platform self-reference drop**: catalog rows whose canonical is the platform name
    (`sentimetrx` / `datanautix`) are filtered — never a respondent-named org.
  - **Focus-area re-categorisation**: the catalog category is a general NER type
    (brand / place / person), the wrong dimension for a charity slide. One cheap Haiku pass
    (`categoriseEntityNames`) re-buckets the surviving names into **focus areas**
    (religious / health / humanitarian / community / youth / …) for the by-category chart;
    on AI failure it keeps the NER category. *(Per-export; not yet persisted back to the
    catalog.)*
  - **Global percentages + no circular quotes**: `entitySlideSpecs` sets each entity's
    `pct` against the **global** total mentions (so the long-tail slide of singletons shows
    a true ~2%, not a per-slide "10%"), and the export passes `includeQuotes: false` to drop
    the "representative mentions" slide, which was circular against the catalog
    (`"Salvation Army — mentioned as: salvation army"`).
- **Skip text analytics (`body.skipTextAnalytics`)**: when set (paired with entity fields),
  the theme/verbatim sections are dropped so the deck is entity-focused; categorical/numeric
  slides still render. Lets a deck be "just analyse Charities, no theme walls of text."
- **Theme picker counts**: the ExportModal theme cards fetch live counts from
  `/api/datasets/[datasetId]/theme-counts` (the saved `theme_model.themes` persist
  `count`/`percentage` as 0), so the cards show real `n`/`%` instead of zeros. For the
  **Executive Summary** TOP THEMES panel the deck applies the same fix server-side:
  themes are recomputed against the dominant open-ended field via `computeFieldThemes`
  before `buildSummarySlide`, so the panel shows live percentages instead of the persisted
  zeros that previously rendered as "Insufficient data".
- **Provenance slide — factual readout, not a sales pitch** ("How this deck was
  made", default ON via `includeProvenance`): a closing methodology slide. As of
  deck-fix #8 (2026-06-02) it reports only *work performed*, never theoretical
  capacity. Field counts come from the **defined schema** (`schema_config.fields`,
  excluding ignored) — open-ended / categorical / numeric / date — not the selected
  export subset. Removed: "potential cross-tabulations", "significance tests run",
  "response × theme pairings", and the "decisions made" headline (all theoretical
  surface, not work done). The human-analyst equivalent is a flat **~15 min per
  content slide** (`slidesSoFar − 1`, excluding the title + closing slides), with the
  assumption stated verbatim on the slide; the key-takeaways row is hidden when 0.
  The renderer (`renderProvenance` in `lib/pptx/slideRenderer.ts`) gained a generic
  `secondStat` (factual second top-stat) and collapses `low===high` hours to "~N hours".
- **Report-inputs recap slide** ("Report Inputs", default ON via `includeRecap`,
  deck-fix #10): an always-present appendix recapping the export request — mode,
  audience, title, selected fields, theme names, entity/impact fields, filters,
  comment options, appendices, and the **verbatim custom instructions**
  (`body.instructions`, otherwise unrecoverable — used transiently then discarded).
  Lets a deck's AI storytelling be retraced. Built by `buildRecapSlide`; renders even
  in quick mode / with no instructions ("None provided."). Suppressible for clean
  client deliverables (decks get emailed, so internal instructions must be hideable).
- **Exec-summary fallback**: when the AI writes no `executiveSummary` bullets, KEY FINDINGS
  falls back to a categorical-field snapshot that **excludes system/internal columns**
  (`status`, `sentiment`, `collection_label`, `language`, rating/score fields, `_`-prefixed)
  so internal plumbing never leaks into the readout.
- **Version numbering**: `STORYTIME_VERSION = '1.2.0'` (`route.ts:25`), shown on the
  About slide as `<audience> edition · v<version>`

> **Planned — deck style/personality picker (not yet built).** A future pass will let the
> export dialog choose a visual style (palette/personality), with the **Datanautix brand**
> (Ana orange `#E85A1A` / Sarina teal, `datanautix.com`) as the default and modern/bold
> variants as alternatives. The blocker is architectural: the generator hard-codes one
> palette (`DN`) as a module constant referenced in ~200 places across `route.ts`,
> `lib/pptx/shared.ts`, and `lib/pptx/slideRenderer.ts`. A *selectable* palette must become
> per-request data, and because the route runs on Vercel Fluid Compute (one instance serves
> concurrent requests), it must be threaded through the builders/helpers — **not** a mutable
> module global (that would bleed colors between concurrent exports). Scoped as its own
> focused refactor + an ExportModal control (`body.style`). See the open-work-queue memory.

### HTML (Shareable Dashboard)
- **API**: `POST /api/datasets/[datasetId]/export/html`
- Generates a Reveal.js HTML presentation from dataset analytics
- Interactive, responsive for mobile/desktop
- Companion `POST /api/datasets/[datasetId]/export/html/share` uploads the HTML to AWS
  for a shareable URL (used by the "Share" button in the success step of ExportModal)

### Signals PPTX (Reddit / Substack)
- **API**: `POST /api/datasets/[datasetId]/export/signals-pptx`
- Separate deck format for Reddit/Substack datasets that have signal-tier ranking
  — not exposed through ExportModal; called from the Signals view.

---

## Analytics Computation Pipeline

### Server-Side (`lib/analyticsCompute.ts`)
Two paths, both producing the same `DatasetAnalytics` JSON shape:

- **`computeAnalyticsSQL`** (main path, used by `/compute` for single datasets):
  pushes work into Postgres via RPCs (`count_field_values`, `numeric_field_stats`) so
  no rows are pulled into Node. Top-value lists are capped at `p_limit: 500` per field;
  open-ended summaries use a 20-row sample for shape stats and an exact `COUNT(*)` for
  nonNull. Numeric quartiles are REAL since sql/199 (`p25_val`/`p75_val` from the RPC,
  median fallback on a pre-199 DB) — before that this path stored **p25 = median = p75**
  for every numeric field ("approximate"), which is why any stored snapshot computed
  pre-199 has degenerate bands until the dataset's next compute/sync.
- **`computeAnalyticsFromRows`** (collection-rollup path): runs JS accumulators over
  rows already in memory (used when the rollup loads members for a virtual dataset).
  Uses Knuth/Vitter reservoir sampling for numerics: `NUMERIC_RESERVOIR_SIZE = 50_000`.

Output: `DatasetAnalytics` JSON with per-field summaries (categorical / numeric /
open-ended / date / id / ignore).

### Computation Triggers
- After upload batch completion
- After Google Reviews sync (and other source syncs)
- Manual re-compute from the Schema tab
- After brand-collection membership changes (rebuilds merged schema + recomputes)

---

## Shared Dashboards

### Public Sharing (`app/shared/[token]/`)
- Token-based access (no login required, read-only)
- Expiry options: 24h, 7d, 30d
- Response metrics, sentiment distribution, NPS trend, volume chart
- Theme visualization, auto-refresh
- Audit: all access logged with `last_accessed_at`

### Shared Analytics Links (Filtered vs Benchmark)
- **Purpose**: Send a stakeholder a view of how their subset (e.g., a specific restaurant) performs vs the system aggregate, without exposing individual data from other entities
- **Share type**: `analytics` — stored in `shared_links` with filter criteria in `metadata` JSONB
- **API**: `GET /api/share/analytics?token=...` — splits `dataset_rows_flat` into filtered and benchmark sets, returns only aggregates
- **UI**: "Share Analytics" button in Ana header bar opens `ShareAnalyticsModal` — use current active filters or pick new categorical filters, set label + expiry
- **Outlier Detection**:
  - **Numeric metrics**: z-score comparison of filtered mean vs benchmark (Welch-style SE). Flagged at p<0.05
  - **Theme frequencies**: two-proportion z-test of filtered rate vs benchmark rate. Flagged at p<0.05
- **Privacy safeguards**: minimum sample sizes enforced (n=10 filtered, n=10 benchmark, n=5 theme count). Benchmark data is aggregate-only — no individual rows or identifiable data exposed
- **Shared view**: side-by-side bars for each metric/theme, green/red outlier badges with p-values, filter criteria pills in header
- **Completion funnel (survey sources only, 2026-06-02)**: the shared view renders a stage-by-stage completion funnel (Started → rating → Conversation → Survey Questions → Psychographics → Demographics → Completed) **only when the dataset is survey-shaped** — `dataset.source==='study'`, OR the schema has `custom`/`psychographic`/`demographic` sections, OR an `experience_score`/`nps_score`/`status` field, OR rows carry `status` — and ≥3 stages exist. Otherwise the route returns `completion: null` and the page hides it (uploads / Google-reviews / other ingests have no funnel data, which would otherwise show a misleading "Started 100% → Completed 0%"). Same survey-source gate as the dataset-report Survey Overview slide.

---

## Key Files

| File | Purpose |
|------|---------|
| `components/analyze/TextMineModule.tsx` | Main shell — four peer sections × lens views (~3k lines) |
| `components/analyze/TextMineNav.tsx` | Shared two-row nav bar (sections row + views row); item-with-`href`→Link, else button. Used by TextMineModule + AnalyticsNav |
| `lib/textmineNav.ts` | Pure nav state-map + gates: `deriveLegacy`/`sectionOf`/`viewOf`/`viewsFor`/`cellHasContent`/`viewLocked`/`availableSections`/`defaultSection` (unit-tested) |
| `components/analyze/textmine/DimensionCloud.tsx` | Dimensions×Clouds — taxonomy sub-buckets as a per-axis cloud sized by mentions |
| `components/analyze/textmine/DimensionCompareTab.tsx` | Dimensions×Compare — axis × categorical-field crosstab (`tax_crosstab`) with over/under-index markers |
| `components/analyze/ChartsModule.tsx` | Chart builder (~2.5k lines) |
| `components/analyze/StatsModule.tsx` | Statistics (~2.2k lines) |
| `lib/outletReport.ts` | Per-outlet vs. peer-group compute (rating rank + sub-theme strengths/weaknesses) |
| `app/analyze/[datasetId]/outlet-report/` | Outlet Deep-Dive view of Advanced Analytics — one-page report (page + OutletPicker + PrintButton) |
| `app/analyze/[datasetId]/AnalyticsNav.tsx` | Renders the shared `TextMineNav` for the 3 Advanced Analytics pages (Advanced section active; row 2 = Brand Health/Leaderboard/Outlet) |
| `components/analyze/ExportModal.tsx` | Export workflow (~1.2k lines) |
| `components/analyze/FiltersModal.tsx` | Filter UI (~480 lines) |
| `components/analyze/EntitiesCard.tsx` | Entity catalog — the Entities×Overview home (also shown on Themes×Overview) |
| `components/analyze/textmine/WordCloud.tsx` | Themes×Clouds (and Entities×Clouds) view content |
| `components/analyze/textmine/ContextCloud.tsx` | Context tab — same-sentence collocates as a cloud, Frequency/Distinctive toggle, click-to-drill |
| `lib/collocations.ts` | `computeCollocates` (two-pass, comment-counted, G²-scored) + `filterCooccurringRows` (the matching drill-down) |
| `components/analyze/textmine/BreakdownDist.tsx` | Breakdown visualization |
| `components/analyze/textmine/CommentsPanel.tsx` | Theme comment browser (themes-only, client-side) |
| `components/analyze/textmine/FilteredCommentsPanel.tsx` | Unified filter results (theme + entity + dimension, server-filtered) |
| `components/analyze/textmine/ThemeEditor.tsx` | Theme CRUD |
| `lib/themeUtils.ts` | recountThemes(), Wilson CI, keyword matching |
| `lib/sentimentLexicon.ts` | POSITIVE_WORDS / NEGATIVE_WORDS / NEGATORS sets |
| `lib/filterUtils.ts` | Filter types & applyFilters() |
| `lib/statsUtils.ts` | All statistical functions |
| `lib/analyticsCompute.ts` | Server-side computation (SQL + JS paths) |
| `lib/analyzeTypes.ts` | TypeScript interfaces |
| `lib/timeBucket.ts` | Time series bucketing (hourly/daily/weekly/monthly/quarterly/yearly) |
| `lib/aliasUtils.ts` | Value aliases & remapping |
| `lib/entityDiscovery.ts` | Haiku NER discovery + canonicalisation |
| `lib/entityFilter.ts` | Scope resolution, eligible-fields, count plumbing |
| `lib/brandRules.ts` | Brand-collection schema rebuild + Phase 6 entity gating |
| `components/analyze/ShareAnalyticsModal.tsx` | Share analytics link creator |
| `app/api/share/analytics/route.ts` | Filtered vs benchmark analytics API |
| `app/api/datasets/[datasetId]/` | All dataset API routes (note: param is `[datasetId]`, not `[id]`) |


> **trendingTerms API (2026-07-03):** `lib/trendingWords.trendingTerms` now optionally accepts `{ text, source }[]` for the recent window plus `opts.exclude` (suppressed terms) and `opts.minSources` (require N distinct sources per term). Plain `string[]` callers (dataset analytics trending words) are unchanged — the new filters only engage when the caller opts in (the PulseIQ live screen does).


**Key-Driver auto-insight (2026-07-15).** The Statistics Auto-Insights tab leads with a `KeyDriversCard` that auto-runs (no button): it auto-detects the target — an overall rating/satisfaction numeric field (incl. the `__mapped__` Likert twin) via a name-priority heuristic (overall > rating/satisfaction/csat > recommend/nps > score), with a dropdown to change it — and ranks every other numeric field by its Pearson correlation with the target, shown as green/red importance bars + a plain-language summary ("N of M fields track <target> significantly; the strongest are X and Y"). Correlation (not a joint OLS) is deliberate: survey sub-scores are heavily collinear, so a joint regression goes singular / gives unstable partial effects; pairwise correlation is robust, always computable, and each pair uses its own complete cases. A footnote notes association ≠ causation. Verified on Carrabba GSS: Food Temp/Food Quality/Food Taste/Value for Money top the drivers of overall Rating.


**Likert axis colours follow the rating (2026-07-15).** Ordinal/Likert bars are coloured by the underlying RATING VALUE — low = red … high = green — via `ordinalBarColors(rawValues, remapping)` (ChartsModule), not by bar position. Previously the gradient assumed best-first and painted the worst rating green on a worst→best (smartOrder low→high) axis. Now it reads the field remapping (Likerts are auto-mapped), else the recognized scale rank, else falls back to position. Applied to both the count/% bar and the average bar.

## Row upload resilience (2026-08-26)

An upload is hundreds of sequential `POST /api/datasets/[datasetId]/rows` calls
(`CHUNK_SIZE`/`BATCH` of 50), which makes it the likeliest thing in the app to
meet a stale keep-alive socket. One did: a single batch out of ~590 failed with
`UND_ERR_SOCKET` while the same deployment logged 587 successful `201`s.

Both call sites treated any `!res.ok` as fatal, and `analyze/new/UploadClient`
goes further — it rolls back every uploaded batch **and deletes the dataset**.
So one dropped connection destroyed an entire in-progress load; both dataset ids
from that incident are gone from production.

Now defended in two layers. **Server**: the `dataset_rows_flat` insert is
wrapped in `retryTransient` (transport failures only — a constraint violation is
returned unchanged), and the POST answers **503 + `Retry-After`** rather than
401 when auth is unreachable. **Client**: `lib/postJsonWithRetry.ts` retries
429/502/503/504 and network rejections, honouring `Retry-After`; a 4xx is
returned untouched so the existing rollback/error handling is unchanged. Both
`UploadClient` (initial) and `SettingsClient` (append) use it — they had the same
loop, and a shared helper beat a third copy. See `docs/ARCHITECTURE.md`.

### CSV parsing correctness (2026-09-01)

Upload parsing (CSV / TSV / SurveyMonkey detection + two-header merge) lives in
**`lib/csv.ts`**, extracted from `UploadClient`. The old in-component parser
toggled its quote state on every `"` and never emitted one — any field with
interior quote marks was silently mangled (2,796 of 125,897 prod ANES rows) —
and it split on newlines before parsing fields, so a quoted field containing a
line break broke its row apart. `parseCSVRecords` walks the whole text once
(RFC4180): `""` inside a quoted field is a literal quote, commas/newlines inside
quotes are data, BOM and CRLF handled, fields trimmed as before. Tests:
`tests/unit/csv.test.ts`; verified end-to-end in the browser against the TEST
project (stored rows byte-identical).

### Upload page responsiveness (2026-08-26)

Typing on the new-dataset page went sporadic during a large upload. Not a race —
**O(rows) work in the render body, multiplied by a render per batch.**

`UploadClient` derived `previewRows` (a filtered copy of *every* row) and then ran
a real `splitChunks()` pass — `JSON.stringify` + `new Blob` per chunk — directly in
the component body, unmemoised. Both existed solely to display one number, the
batch count. Meanwhile the upload loop called `setUploadMsg` at the top of each
batch and `setUploadPct` at the bottom, separated by an `await`, so React could not
batch them: **two renders per chunk**.

Measured: one render body cost **78ms at 100K rows**, and the upload produced
**~4,000 renders** — roughly *312 seconds* of blocked main thread, which is why
keystrokes queued.

Fixed by deleting the derivations (the count is `Math.ceil(rows / CHUNK_SIZE)`,
verified identical to the real chunker for normal data — it only diverges when a
single cell is large enough to force a byte-split, so the label now reads
"≈N × up to 50 rows") and by routing progress through one throttled helper that
sets both values together, capped at ~4 updates/second.

**Also fixed a genuine race**: the loop had no unmount guard, so navigating away
mid-upload left it calling `setState` on a dead component and — worse — running
`router.push` at the end, yanking the user back to a page they had left. The
remaining batches are deliberately allowed to FINISH (aborting would strand a
half-loaded dataset with no rollback); only the UI writes are suppressed.

**Upload progress is a modal (2026-08-26, owner).** It was an inline block low on
a long form, so during a large upload the only thing on screen was a spinner and
"batch 233 of 2518" — no sense of how far along it was. Now a centred, dimmed,
non-dismissable dialog: Lottie, current phase, **percentage**, progress bar, and
a **time-remaining estimate** derived from measured throughput (mean
seconds-per-batch so far × batches remaining), withheld until 3 batches are done
because the first one or two include connection setup. `formatEta` rounds
deliberately — "about 2 minutes", "about 35 seconds" — since a per-second
countdown on a moving estimate reads as broken. Not dismissable on purpose: there
is no cancel path that wouldn't strand a half-loaded dataset.

⚠️ **`mountedRef` must be set true in the effect BODY**, not left to its initial
value. React's dev StrictMode mounts → unmounts → remounts, so the cleanup fires
once before the real mount; without the assignment the ref stays `false` for the
component's whole life and every guarded `setState` is silently skipped. Caught by
watching a real upload — the modal sat at "Preparing data… 0%" for three minutes
while batches uploaded fine behind it. `tsc`, lint and 1,800 unit tests all
passed. The same fault would hit production on any genuine remount.

**Client chunk size = the server stride (2026-08-26).** `CHUNK_SIZE` was **50**
against a `ROWS_PER_BATCH` of **200** — a quarter of what the server already
supports. Every batch pays ~6 fixed Supabase round trips (auth `getUser`, users
lookup, dataset check, `MAX(row_index)`, insert, `row_count` update) regardless of
payload, so a 125,897-row upload made **2,518** of them instead of 630. Both
upload paths now import `ROWS_PER_BATCH` rather than repeating a literal.

⚠️ **It must never exceed the stride.** The route writes
`row_index = batch_index * ROWS_PER_BATCH + offset`, and the rollback DELETE spans
exactly `[batch*STRIDE, batch*STRIDE + STRIDE)`. A larger client chunk overlaps the
next batch's index range: batches collide and a rollback deletes another batch's
rows. Pinned by `tests/unit/uploadChunking.test.ts`.

**Why wide datasets are slow regardless.** Insert cost scales with *column count*,
not just rows — measured 70ms (4 cols) → 174ms (20) → **626ms (52)** per 50 rows.
A `BEFORE INSERT` trigger (`drf_tsv_trigger`) loops every JSONB key in plpgsql with
a regex per value to build the tsvector, then two GIN indexes (`data`, `tsv`) are
maintained. A 52-column dataset pays ~9× a 4-column one. Not a bug — worth knowing
before promising an upload time.
