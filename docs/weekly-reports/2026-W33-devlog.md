# 2026-W33 devlog

## Context view: the legacy right-click collocates, ported (Aug 13)

Owner asked for a capability the previous text-analytics platform had — right-clicking a word (or theme) to see the context it's used in, rendered as a cloud of co-occurring words with counts.

**What was already there, and why it wasn't enough.** Clicking a cloud word already opens a modal with Opinions / Comments / Insights. The Opinions tab is close but deliberately narrow: it keeps only words in the sentiment lexicon, inside a ±2-token window. That's the right rule for "what do people say *about* X" and the wrong one for "what is X talked about *with*" — it throws away exactly the polarity-free nouns (quality, portions, notch, customer) that carry the subject matter. Also found `trendingWords.contextTermsFor`, whose doc comment describes this feature almost word for word and which **has no callers** — written at some point and never wired up. It's whole-comment scoped and token-counted, so it wouldn't have held up anyway; marked superseded rather than deleted.

**Built** `lib/collocations.ts` + a `ContextCloud` component, wired as a **Context** tab in both the word modal and the theme modal. Not a right-click menu: the app's cloud words are already left-click-to-modal, and a context menu is unreachable on touch. Same place as Comments/Insights, so it's discoverable.

**Two decisions worth recording.**

*Counting unit is the comment, not the token.* A cloud that says 280 and drills into 312 comments is a credibility bug, not a rounding difference — same principle as the deck-number rule. `filterCooccurringRows` applies the identical sentence-scoping rule that produced the count, and the QC harness asserts chip == drill-down on real data before anything ships.

*Frequency alone reproduces the legacy weakness.* The reference screenshot the owner sent has "OF" and "COME" sitting in the cloud for "food" — noise that crowds out signal. Added a **Distinctive** toggle (G² log-likelihood vs the corpus baseline) so words common everywhere in the dataset get demoted. Default stays Frequency for parity with what the owner knows.

**Two things the real data caught that the unit tests didn't.** Ran it against 25K real reviews in the TEST project rather than trusting fixtures:

1. **G² over-rewards exclusivity on small selections.** On 174 comments the Distinctive list was mostly count-2 words appearing nowhere else ("amount", "begin", "offering") — technically maximal association, useless to read. Floored the distinctive ranking at 3 comments (or 2% of the target's comments), falling back to unfloored only when the floor would empty the tab. After the fix, "service" ranks slow / outstanding / expectations / above / exceptional — the genuinely service-specific vocabulary.
2. **It was too slow.** 770ms per target over 18.6K comments, running synchronously on tab open — a visible freeze. Restructured into two passes: pass 1 tokenizes only rows that actually mention a target (most don't); pass 2 scans every row for just the ~150 candidates pass 1 surfaced, so the corpus is never tokenized. 770ms → 310ms, byte-identical output. The remaining 310ms is deferred one tick past mount behind the Lottie loader, so the tab paints instead of freezing.

**One invariant defended.** In the theme modal a context word narrows the **sample comments only**, never `matchedRows` — otherwise the theme's headline "10 mentions · 50% of comments" would silently start meaning "of the co-occurrence subset". There's a test pinning the header across a drill-down.

Verified: 27 new tests (15 pure collocation, 6 component render, 4 word-modal path, 2 theme-modal path — the last two covering the drill-down count matching its chip, the dual highlight, and the theme header holding steady), full suite 1634 green, typecheck + per-file lint clean. Real-data QC harness kept untracked at `scripts/_verify_context.ts`. **Owner browser-QC passed the same day** — cloud layout, sizing, and the Opinions tab all confirmed in the browser after the tokenizer fix below.

## Context view: contraction + function-word noise (Aug 13, later)

Owner put the Context tab on the Trump spoken-remarks corpus — a conversational register the restaurant reviews never exercised — and the top of the cloud came back **WE'RE 332 · BECAUSE 217 · IT'S 209 · THEY'RE · THAT'S · LOT · OTHER · WAY**. Useless.

Two causes, both in how `lib/collocations.ts` tokenized:

1. **`trendingWords.tokenize` keeps contractions whole.** Its stop list carries "we", "it", "they", "that" — but the tokens are `we're`, `it's`, `they're`, `that's`, which match nothing and sail through. Restaurant reviews barely use contractions, so this never showed up; spoken transcripts are made of them. Fixed by stripping the enclitic and **re-testing against the stop list** (`don't`→`do`, `isn't`→`is`, `can't`→`ca`→too short). The same pass folds possessives into the base word, so `trump's` now counts toward `trump` instead of splitting the term across two entries.
2. **A handful of function words aren't in that stop list at all** (because, lot, other, way). Added a Context-specific set.

**The trap I walked into and backed out of.** My first pass at that stop list mirrored WordCloud's, which also drops *good, great, well, new, long, time, day*. That broke a test — and the test was right. The owner's own reference screenshot has **GOOD 2059** and **GREAT 1897** as the top two context words for *food*. Those are the ANSWER here. A word that's noise as a word-cloud entry can be the entire point as a collocate, so the Context stop list is deliberately narrower than the cloud's and holds only unambiguous function words. There's now a test named for it so nobody "fixes" the inconsistency later.

Both passes and `filterCooccurringRows` share one `contextTokens` helper — if the co-occurrence pass and the drill-down disagreed about `trump's`, the chip count would stop matching the comments behind it, which is the one contract this feature cannot break. A test covers exactly that case.

After: *food* → service / great / amazing / excellent / delicious / good / atmosphere (matches the legacy reference). *border* → patrol / southern / open-border / illegal / crossings / ice / invasion. *drug* → dealers / prices / lords / gang / cartels. Perf unchanged (~305ms per target on 25K rows, single field).

## The metric strip claimed "0 comments" on 49,033 of them (Aug 13, later²)

Owner opened the Trump spoken-remarks dataset and the TextMine header read **"0 comments · 0% of 49,033 answered · Theme fit Diffuse 0%"** — while the cards immediately below it said 49,033 COMMENTS and individual themes counted 5,510.

**Cause.** The strip leads with the *substantive* comment count (sql/178/179 — comments carrying usable feedback, dropping "N/A"/"Nothing"/one-word answers). All 49,033 rows had `substantive` **NULL**: the flag was never stamped. That dataset was ingested by the Trump-corpus lane's own scripts, which write rows directly and bypass the ingest hook that stamps it. The counting RPC asks for stamped-true, so unstamped read as zero.

**Fixed the data** — ran the untracked `_backfill-substantive.mts` against TEST (49,033/49,033 substantive, 100%). Note for next time: **the signal-stats cache is keyed on theme-model hash + row count, and the backfill changes neither**, so the strip kept serving the stale zero until the `signal_stats` key was dropped from `dataset_state.analytics`. A backfill without a cache drop looks like it did nothing.

**Fixed the display too, which is the part that actually mattered.** Unstamped and "scored, and none qualified" rendered identically, and the unstamped case is the common one — any dataset from a direct-write script or legacy import. Presenting it as "0 comments · Diffuse 0%" is a damning verdict on data that was simply never scored, and it contradicts every other number on the page. In front of a client that's indefensible.

The strip now guards on the DATA, not just the cache shape: when `substantiveRecords === 0` it falls back to the all-based counts, **suppresses the "% of N answered" clause** (rendering it off the fallback would assert 100% from a measurement never taken), and swaps the tooltip. It deliberately claims neither "not scored" nor "zero substantive" — it falls back to the count it can defend. Swept the class: `DatasetAboutPopover` had the same "0 substantive (0% of answered)" pattern per field and now suppresses that clause under the same condition. 4 new tests, suite 1645 green.

## TextMine sat behind one spinner because theme-counts had no cache (Aug 14)

Owner's brief: optimise the TextMine slow-call path, and **do it with progressive rendering rather than only a faster query** — "for our older system we added pieces progressively, so the UI came up and then things got added to it. This avoided the long-spinning-icons issue."

**The headline finding is that signal-stats was the wrong suspect.** It has been cached in `dataset_state.analytics.signal_stats` for a while and returns in ~50ms after its first compute — which is exactly why the metric strip filled in quickly while the theme cards sat spinning. The uncached call was **`/theme-counts`**, whose only cache was the in-memory, per-tab-session `clientRequestCache` that dies on every page reload. So each fresh load of a dataset above the 50K sampling cap re-ran three independent 10-page keyset scans over the sample. Measured cold on the 128,619-row Outback GuestLens dataset (6 themes, TEST project):

| | |
|---|---|
| `sampledSignalCounts` | 13.4s |
| `sampledThemeCooccurrence` | 9.1s |
| `sampledThemeDimensions` | 10.9s |
| **one uncached request** | **33.4s — every load, forever** |

**I chased the faster query first and it was the wrong lever, which is worth recording.** Each of the ten pages is a uniform ~1.6s (5,000 rows × 6 themes of POSIX regex), and they are serial only because the keyset cursor comes from the previous page. Page boundaries turn out to be cheap to precompute — an index-only scan over `idx_drf_sample`, 139ms, 19 heap fetches — so I fired all ten concurrently. **15.9s → 11.5s, a 28% win, not the 9× I expected**: the pages returned in a perfect ~1.1s staircase, i.e. the database executed them serially anyway. The work is CPU-bound in Postgres, not latency-bound. A second measurement in the same direction: extracting the row's text once instead of once per (row × theme) takes a page 736ms → 462ms, but that only touches one of the three scans and buys ~8% of the cold path for a migration on a shared RPC. Neither is worth it next to caching the result. Both numbers are in ANALYTICS.md so nobody re-runs the experiment.

**So: `lib/themeCountsCache.ts`**, the same shape as the signal-stats cache. The payload goes into `dataset_state.analytics.theme_counts`, keyed on a hash of the theme model (ids + lowercased, sorted keywords) + fields + the extras flags, with the row count checked for freshness. A theme edit or a sync invalidates exactly as they already do for `signal_stats`; a cosmetic reorder in the theme editor does not, which matters when the alternative is 33 seconds. Bounded to 6 slots and skipped above 512KB, because the co-occurrence matrix is N×N in themes. Filtered requests are never cached — per-view by definition and already bounded. Measured warm against the real endpoint from the browser: **~0.6–0.7s including dev-mode overhead, against 33.4s.** 12 unit tests plus an 11-check harness run against the real TEST database (`scripts/_verify_theme_counts_cache.ts`, untracked), because the jsonb round-trip and the analytics merge are the parts a mock can't prove.

**Then the progressive rendering, which is what the owner actually asked for.** Two things were serialised that didn't need to be:

1. `fetchServerThemeCounts` hung off `rowsLoaded` — it waited for a payload of up to 50,000 rows before issuing a request that needs nothing from it. It now fires as soon as the active Text selection settles, one tick after mount, and runs alongside the row download. The gate is the *selection* rather than the rows because firing earlier would request the wrong field on a restored session that opens on a different Text pill.
2. The whole Themes tab was gated on `rowsLoaded`. The cards now paint from the server counts while the rows stream in behind a slim banner explaining that filters, ratings and sample comments arrive when they finish.

**The trap in that second change**, and the reason `themesPaintable` requires a *positive* server base rather than merely a non-null one: the responses denominator is a client-side count over the loaded rows, so painting early would divide by 0 and render "0 comments · Diffuse 0%". That is the exact failure the metric strip shipped yesterday — a loading state that reads as a damning verdict on the data. Same lesson, one day and one component apart.

**And the owner's follow-up, mid-build: show "calculating" where the counts are.** Right, because the pre-rows and post-rows numbers are not identical (see below). `countsPending` is true while the server scan is in flight and the cards + Distribution header now label the counts with it — provisional, not final. It's cleared in a `finally`, since the fetch has an early return when the response carries no counts and a failed scan has to clear the marker too. Verified in the browser on a deliberately cleared cache: the chip appears with the client recounts, then disappears when the server numbers land and the co-occurrence chips fill in.

While wiring that I found the cards rendering **"95% CI: 0–0%"** before the rows load — the interval is computed client-side over the loaded rows and the old `?? 0` fallback put a fabricated statistic next to a real count. It now says "calculating…" instead.

**One thing I did not fix, deliberately, because it's a decision and not a bug.** The server count and the client recount don't agree: for *Food Quality* the server says **1,817** and the client recount says **1,962**. Both are correct under their own rule — the server numerator is substantive-gated (sql/181, matching the metric strip's model), the client recount counts all matches — and both divide by the same 19,709, so each is internally consistent. This predates today; the server counts were always overwritten by the recount once rows loaded, so nobody saw the difference. Progressive rendering makes it briefly visible, and the co-occurrence percentages inherit it (13% vs 14%). The "calculating…" chip labels precisely that window. Picking which rule is canonical is the owner's call, not something to slip into a perf commit.

Zero lint delta (20 warnings on the touched files before and after), tsc clean, suite 1657 green.

## Theme-cloud term percentages were a share of the corpus, not the theme (Aug 14, later)

Owner, looking at the Pricing row: *price 2%, bill 1%, cost 1%, expensive 0%, portion size 0%, value 0%*. "Feels like it should be of the theme — so we read it as *10% of the people talk about food quality and prep, and 30% of them tie back to overcooked*."

He's right, and the old behaviour was worse than merely unintuitive. Both the theme badge and every term chip divided by the same corpus total (`WordCloud.tsx`, `totalResponses={total}`), and **a term inside a 9% theme mathematically cannot exceed 9% of everything** — so the chips were squeezed into a 0–9 point range and several genuine contributors rendered a flat **0%**. The view was displaying a number whose ceiling was set by the row it sat on.

Terms in the **grouped** view now divide by their own theme's comment count. Same row, after: *price 19%, bill 15%, cost 7%, expensive 6%*. Food Quality reads *overcooked 27%, dry 20%, undercooked 15%, burnt 11%* — exactly the sentence the owner wanted to be able to say.

**The thing I checked before touching it**, because "30% of them" is a claim about people: whether `freq` was an occurrence count or a comment count. It's comments — the keyword scan adds 1 per matching row, and the general-word pass carries a `seen` Set that de-dupes within a row. So `freq / t.count` is comments-over-comments, a like-for-like share, and the chip reconciles against the "View 1,962 comments" button right next to it. Had it been occurrences the percentage could have exceeded 100% and meant nothing.

**Verified against the database rather than eyeballed** (same 50K deterministic sample, same strict `\bword\b` the cloud uses):

| chip | substantive comments | ÷ theme | shown |
|---|---|---|---|
| overcooked | 528 | 1,962 | 27% |
| price | 331 | 1,724 | 19% |
| forgot | 292 | 784 | 37% |

All three match the rendered chip exactly, and the sample's substantive row count came back 19,709 — the number in the cloud header. Worth recording that my *first* query returned 580 for overcooked, not 528: the gap is one-word answers that are literally just "Overcooked", which the substantive lens correctly drops. The raw match count and the displayed numerator are not the same thing, and checking the wrong one would have made a correct number look broken.

Three details that came with it:

- **The 3% hide threshold now uses the same denominator as the chip.** It was filtering on % of corpus while displaying % of theme, so "+7 below 3% hidden" would have been describing a percentage nobody could see. Note now reads "below 3% of this theme hidden".
- **The flat (ungrouped) cloud keeps the corpus denominator.** It mixes terms from every theme plus non-theme words under one heading, so the shared total is the only scale every chip can be compared on. `themeTotal` is passed only by the grouped view.
- **The synthetic placeholder chip no longer shows a percentage at all.** For a theme whose comments match no keyword strictly enough to count, the code pushes a chip with `freq` borrowed from the theme's own count — under the new denominator that renders a flat, meaningless **100%**. It's now flagged `synthetic` and the share is suppressed, with a tooltip explaining why it's there.

Tooltips now state the denominator in words ("528 of the 1,962 comments in Food Quality & Preparation Issues mention it"), and the header carries "terms are % of their theme". tsc clean, suite 1657 green, zero lint delta.

## Measuring the 65s row fetch: two good ideas that didn't survive contact (Aug 14, later²)

The dev log showed `/rows?all=true&sampleMax=50000` taking **65 seconds**. Owner asked me to measure it properly rather than guess — fair, given I'd already guessed wrong once today about signal-stats.

**Where the time is.** 21s warm, 36s cold (the 65s was dev overhead plus contention with the then-uncached theme-counts). Per 5,000-row page: **~0.9–1.2s of server think-time** (building a 9.5MB jsonb, gzipping it) against **~0.15–0.4s of transfer**. Node is noise — `projectRow` 491ms and `JSON.stringify` 324ms across all 50,000 rows. So the lever is building a smaller value, not moving it faster.

**Rejected idea 1: parallel pages.** theme-counts was CPU-bound so parallelism bought only 28% there; this one looked I/O-shaped, so I expected better. It's worse, and then it's catastrophic:

```
concurrency 1: 20.9s  all ok      <- fastest AND safest
concurrency 2: 29.6s  all ok
concurrency 3: 25.1s  all ok
concurrency 4: 28.8s  slowest page 11.9s
concurrency 10:       EVERY page hit the statement timeout, 0 rows
```

Ten-wide doesn't degrade the load, it destroys it. The existing serial pager is already optimal. Worth remembering the shape of this: two superficially similar bottlenecks, opposite responses to the same intervention.

**Rejected idea 2: columnar payload.** 62.8% of every row is the same 32 question-sentence keys, repeated 50,000 times — an obvious 4× win. Raw, it is exactly that: 8.12MB → 2.05MB. Gzipped it's **1.4×** (0.61 → 0.44 MB), because gzip already collapses repeated strings, and parse saves 8ms per page. A large invasive change for ~1.7MB and ~80ms. Killed it.

**What shipped: stop sending fields nobody reads (sql/186).** 14 of the 32 fields are marked `ignore` in the schema, and *every* analyze surface already filters those out — TextMine's `hiddenFields`, Charts, Stats, Snapshot, FilteredCommentsPanel. `RowsProvider` sends no `fields` param, so `projectRow`'s fieldSet was null and only `_tx` was stripped — in Node, after the transfer. The route now reads `schema_config` and passes the ignored/hidden fields as `p_drop_keys`, dropped in SQL.

**And the honest result, which is not the one the payload numbers imply.** Payload −34% (80 → 53 MB), but a fair alternating A/B gives **11% faster** (11.5s → 10.2s median), not the proportional cut I'd predicted to the owner. Two reasons: gzip had already absorbed most of the repetition, and a lot of the per-page cost is fixed round-trip and planning overhead that shrinking the payload doesn't touch. My first measurement of this looked like a *regression* (13.6s vs 28.1s) purely because I ran the new shape cold and the baseline warm — the alternating harness exists because of that.

**The half that actually matters is privacy, not speed.** The ignored columns on this survey are **First Name, Last Name, Email Address, IP Address, Transaction ID, DR Card Number_Member**. They were being serialized, gzipped, transferred and parsed 50,000 times per page load into a client-side payload readable in devtools — for rows the UI never renders. That's the same class as the Town Hall RSC-payload lesson from July: what lands on the client is published whether or not anything renders it. 32 fields per row → 19.

`type === 'id'` is deliberately left alone: `ChartsModule`'s column list filters only `ignore` + hidden, so it keeps id fields, and dropping them would break a live consumer. Only `ignore`/`hidden` — the ones excluded everywhere — are dropped. An explicit `?fields=` projection still wins over the drop.

Verified against the real TEST database (`scripts/_verify_rows_dropkeys.ts`): same 50,000 ids **in the same order** so the deterministic sample is provably unchanged, every retained field byte-identical, 0 surviving ignored columns. The under-cap path drops the same keys in Node — no transfer saving there, since PostgREST can't project inside jsonb, but a smaller dataset shouldn't get weaker handling.

sql/186 is **applied to TEST only**; the prod apply and the `docs/db/schema.sql` refresh go together when a prod migration is authorised. tsc clean, suite 1657 green, zero lint delta.

## End-to-end A/B: what the TextMine work actually netted out to (Aug 15)

Owner asked for a real before/after rather than per-call numbers multiplied together. Ran an alternating A/B on the 128,619-row Outback dataset: baseline = the six code files reverted to `d4dfefdd`, treatment = current `main`, same dev server, same TEST database, three measured loads per arm after a discarded warm-up so webpack route compilation isn't counted. Timings come from the browser's Resource Timing API plus a `MutationObserver` recording first paint of `.theme-card`, so nothing depends on my polling latency.

**Time to theme cards — 20.4s → 2.6s (7.8×).** Baseline runs: 22.0 / 20.4 / 19.5s. Treatment warm: 3.0 / 2.6 / 2.2s.

**Time to fully settled — 58.0s → 16.0s (3.6×).**

The traces show the structure better than the medians do. Baseline run 2:

```
rows          1,505 -> 19,978     cards appear 20,354
theme-counts 20,355 -> 57,973     <- only STARTS once rows finish
```

Treatment, warm:

```
theme-counts  1,319 ->  2,148     cards appear  2,624
rows          1,306 -> 16,036     <- concurrent, behind the banner
```

Two slow calls in series became two concurrent calls, one of which is now a cache read. Both halves of the change are load-bearing: the cache alone would still have left theme-counts waiting on `rowsLoaded`, and the unblocking alone would still have paid 37s for the counts.

**The part worth being honest about: the first-ever load barely moves.** Cold cache — a new dataset, or any load right after a theme edit — measured theme-counts 1,320→48,987 against rows 1,305→24,109, so the cards still appear at ~24s because theme-counts loses the race and the paint falls back to `rowsLoaded`. That is baseline-equivalent within noise. Settled time does improve (49s vs 58s) purely from the overlap. So the headline 7.8× is a statement about **every load after the first**, which is the case that matters day to day, not about first contact with a dataset.

Caveats that belong next to the numbers: dev mode on the TEST instance, so absolute seconds are pessimistic versus production; the bulk row fetch alone varied 15–24s run to run, so ±25% is noise, not signal; three iterations per arm, not thirty. The ratios are solid, the absolute seconds are indicative.

Also worth recording for whoever measures this next: my first attempt read as a *regression* because I ran the new shape cold against a warm baseline. Alternate the arms, or don't bother.

## Cold loads: one walk instead of two, counts before extras — and a result that isn't flattering (Aug 15)

Owner pushed back on two things, both correctly. First: "most loads will be cold cache" — the cache key includes row count, so any sync invalidates it, and a nightly-syncing reviews dataset is cold every morning. I'd leaned on "every load after the first" without checking whether that matches real usage. Second: "does sampling make a 200K and a 500K dataset load in the same time?"

**Answer to the second, measured: no, and the reason matters.** Two above-cap datasets, both scanning exactly 50,000 rows:

```
Outback    (128,619 rows)  shared hit=2096 read=2967   1,895ms
Carrabba's  (56,117 rows)  shared hit=5052 read=11        28ms
```

Same rows, same ~5,060 buffers touched, **67× apart** — purely buffer-cache residency. The sample is the 50K rows with the smallest `hash(id‖dataset_id)`, and hash order is uncorrelated with physical order, so the sample is scattered at random across a ~922MB heap (2GB with TOAST). The bigger the dataset, the less of that footprint stays cached and the more of the walk becomes random disk I/O. End-to-end that showed as **1.68× slower for a 2.3× bigger dataset**. So `sql/160`'s "cost is independent of dataset size" is true about rows scanned and false about time. It also retro-explains the 15–24s spread I kept seeing on identical queries and dismissed as noise — that was cache residency, and I should have chased it.

**The corollary drove the fix: the number of WALKS matters more than the work per row.** A cold `/theme-counts` walked the same scattered 50,000 rows three times — counts 13.4s, co-occurrence 9.1s, dimensions 10.9s. `sql/187` merges the two extras into one page function (`sampled_theme_extras_page`), each half keeping its original matching semantics verbatim so no number moves. Verified against the real TEST database: co-occurrence matrix and dimensions breakdown **byte-identical** to the two-walk path, and **29% faster** (25.0s → 17.7s). Not 50%, because the second walk was already benefiting from the first's cache warming.

**Two-phase load.** The cards need `counts` + `totalNonEmpty`; the co-occurrence and Dimensions chip rows have their own skeletons. The client now asks for counts alone, then fetches extras with a new `extrasOnly` flag that skips the counts scan rather than recomputing it. Sequential, not concurrent — the two scans contend on the same instance, and concurrency there was already measured to make things worse.

**And the result that isn't flattering.** Measured cold, end to end:

```
counts   2,073 -> 26,037     cards appear 26,126
rows     2,061 -> 25,870
extras  26,222 -> 44,314
```

Cards at **26.1s**, against a **20.4s** baseline. The counts phase alone is 13.4s in isolation but took **24s** here, because it now runs concurrently with the 50K-row bulk fetch and the two contend for the same instance. That concurrency came from `0760187a` (moving the counts fetch off `rowsLoaded`), not from today's split — and my earlier cold measurement of 24.1s vs 20.4s, which I wrote off as "baseline-equivalent within noise", was the same effect showing up consistently.

It is not purely a regression, which is why it needs stating carefully rather than either hiding or over-claiming. Baseline showed cards at 20.4s carrying **provisional client recounts** that were then replaced 38s later when the server counts landed at 58s. Now the cards appear 5.7s later carrying **final server counts**, and the whole tab settles at 44.3s instead of 58.0s. Warm is unaffected (cards 3.2s).

So the honest scorecard, cold: **time-to-cards 20.4s → 26.1s (worse), time-to-settled 58.0s → 44.3s (better), and the numbers on screen are correct on arrival instead of changing under the user.** Whether that trade is right is a product call, not mine to make silently.

The obvious next experiment is to stop the contention rather than accept it: fire the counts request and hold the bulk row fetch until it returns. Counts alone is ~13s, so cards would land ~13s cold — better than baseline on both axes — at the cost of delaying Clouds and Comments, which need the rows. Not built; it changes load order in a user-visible way and should be a deliberate decision.

`sql/186` and `sql/187` are both applied to TEST only. tsc clean, suite 1657 green, zero lint delta.

## Telling the user what's still coming (Aug 15, later)

Owner, on the two-phase load: "we should just indicate things are getting completed in case the user clicks on something that is still being progressively completed." Right — and checking it turned up a hole I'd opened an hour earlier.

**The Dimensions chip row had no loading state.** It rendered from `serverThemeDimensions[t.id] || []` and drew nothing when empty. That was harmless while counts and extras arrived in one response. After the split, Dimensions land in phase 2 — up to **~18s later on a cold load** — so the row silently disappeared for that entire window. An empty panel isn't neutral; it's a claim. A user clicking through would reasonably conclude the dataset has no dimensions. It now shows the same placeholder-chips-plus-loader treatment the co-occurrence row has always had, gated on `extrasLoaded` (renamed from `cooccurrenceLoaded`, since it now governs both halves), so a theme with genuinely no tagged rows still collapses to nothing once the phase finishes.

**Nav views whose data is still arriving carry a pulsing dot.** Clouds, Compare and Comments all tokenize or filter the loaded rows client-side, so they cannot render until the bulk fetch lands. Now that Overview paints early they *look* ready when they aren't, and clicking one drops you on a bare loader with no explanation. `NavViewItem.pending` marks them; the dot reuses the existing `pulse-dot` keyframe. They stay fully clickable — the goal is that someone who clicks through already knows why they're waiting, not that they're blocked. A dot rather than a spinner on purpose: three can be pending simultaneously and a row of spinning glyphs reads as an error, not as progress.

Verified in the browser on a cold load: at t=1.4s the nav reported `pendingLabels: ["Clouds","Compare","Comments"]` with `rowsDone:false`, and they cleared once the rows landed at ~25.9s. At t=31.7s — phase 1 complete, phase 2 still in flight — all five cards showed the Dimensions block with placeholder chips, where before the fix they showed nothing at all.

Also answered two questions from the same message, both worth recording because the answers aren't symmetrical:

**Does filtering cause database passes?** Depends on the surface. **TextMine: no** — its theme-counts body carries no `rowIds`, so filtering recounts client-side over the already-loaded 50K rows. That is the payoff for the expensive bulk fetch. **Charts: yes** — `ChartsModule` sends `rowIds`, and the route deliberately bypasses the cache whenever they're present, since a filtered result is per-view. It also switches to the exact path bounded to the ≤50K id set, so it is O(filtered rows) rather than O(dataset) and shouldn't degrade with size the way the sample walk does. Unmeasured; that's where to look if Charts filtering feels slow.

**Is the sample deterministic?** Yes for a fixed row set — same rows in, same sample out, and the sql/186 field-drop was verified to return the same 50,000 ids in the same order. On append it *evolves* rather than reshuffles: a new row joins only if its hash falls below the current 50,000th, so new data participates proportionally. ⚠️ **One edge case worth knowing: the cache key is theme-model hash + row COUNT.** A sync that deletes N rows and adds N leaves the count unchanged while the sample genuinely changes, so the cache would serve numbers computed over a sample that no longer exists. Narrow, but real for any sync path that replaces rather than appends.

tsc clean, suite 1657 green, zero lint delta.
