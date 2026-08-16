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

## Rows wait for counts; unfinished tabs go dark (Aug 15, later²)

Owner: "let's do the row fetch followed by the clouds etc. pulsating dot showing the fetch is in progress — ideally i would make the pills unclickable until the fetch is complete."

**The deferral fixes the cold regression I reported.** The bulk row fetch used to start on mount, concurrently with the counts scan, and they contend: counts is 13.4s alone but measured **24s** alongside the 50K-row fetch, which is why cold time-to-cards had gone to 26.1s — worse than the 20.4s baseline it replaced. Every time concurrency against this instance has been measured it has lost (ten parallel sample pages made *every* page hit the statement timeout), and I should have expected this one too.

Rows now wait for phase 1. Measured cold:

```
counts   2,483 -> 19,733     cards appear 19,766
rows    19,737 -> 44,455
extras  19,738 -> 45,351
```

**Cold time-to-cards 26.1s → 19.8s**, now marginally ahead of the pre-change baseline, with settle unchanged (~45s). Warm is 2.2s. The contention didn't vanish — rows and extras now overlap instead — but that pair costs nothing visible, because the cards are already up by then.

The fiddly part is the release paths. A dataset with no mined themes issues no counts request at all, so every *terminal* bail-out in the counts effect has to release the fetch or it would load no rows whatsoever; the one return that must NOT release is "the Text selection hasn't settled yet", which is transient and re-runs a tick later. `startRowFetch` is a one-shot ref so the paths can't double-fire.

**Unfinished tabs are now disabled rather than just flagged.** Clouds / Compare / Comments show the pulsing dot and are inert until the rows land — landing on a bare loader is a worse experience than a moment's wait. Two details that matter more than they look:

- Gated on **`!rowsLoaded`**, not `rowsLoading`. With the fetch deferred there is now a window where it hasn't *started* and `rowsLoading` is still false — exactly when a click would strand someone. My first pass used `rowsLoading` and left the pills live for that ~1.2s; the browser timeline caught it (`t=1,142ms: 0 disabled` → `t=2,372ms: 3 disabled`). After the fix: disabled from the first render at t=1,278ms straight through to t=24,411ms.
- **`!rowsError`**, so a failed fetch re-enables them instead of locking the tabs forever — the Overview carries the retry button.
- The **active** view is never disabled. A deep link straight to `?view=clouds` must still render (its own loader covers it); disabling the tab you're standing on would strand the user with nowhere to go.

Lint dropped 20 → 19 on the touched files (the removed mount effect took an `exhaustive-deps` warning with it), so the `lint:ci` ceiling goes 252 → 251 per the ratchet rule. ⚠️ Verified per-file only — `eslint .` OOMs locally, and another session is committing to this repo concurrently, so CI is the arbiter on the true total.

tsc clean, suite 1657 green.

## Stratified sampling: the primitive works, the payoff is 2.3x not 55x (Aug 15, later³)

Owner picked option 1 — swap the sampling basis wholesale, bump a version, accept that numbers move once. Built the primitive (`sql/188`), verified it, and measured it properly. The headline is that **I oversold this last message and need to correct it.**

**The primitive is sound.** `dataset_sample_blocks(dataset, cap, blocks)` returns K contiguous `row_index` runs spread evenly across a dataset's actual range — 50 blocks on the 128K dataset, non-overlapping, widths 2,572–2,573, collapsing to a single block when the dataset is under the cap. Deterministic (two runs share 50,000/50,000 ids) and gap-tolerant. Coverage checked in SQL across 20 slices: every slice populated, alternating 3,003 / 2,002 against an even 2,500 — the mild ripple you get when 50 blocks don't divide into 20 buckets, statistically fine. (My first harness reported "17/20 slices, 100% deviation" — that was a bug in the harness's bucket maths, not the sampler. Checked against SQL before believing it.)

**But the payoff is much smaller than the microbenchmark promised.** I quoted ~55× off a 5,000-row read that returned only a count. Measured over the real 50,000-row workload:

| path | hash (today) | stratified | |
|---|---|---|---|
| theme-counts style scan (read-bound) | 10,456ms | 4,498ms | **2.3×** |
| bulk row fetch (transfer-bound) | 17,909ms | 13,744ms | **1.3×** |

The 55× was a warm-cache microbenchmark with no payload. Across the full sample both approaches touch enough pages to spill, and the bulk path is dominated by shipping 87MB regardless of how the rows were chosen. Same mistake shape as the columnar experiment: an isolated measurement that didn't survive contact with the real workload.

Sanity check on equivalence: the theme match count came out 1,426 (hash) vs 1,401 (stratified), 1.8% apart — the expected variation between two different 50,000-row samples of the same population, which is also a preview of how much published figures would move.

**So the decision changed shape.** The cost is fixed and large: **20 SQL functions** and **5+ client pagers** all page on the `(hash, id)` cursor and must convert together — a partial swap would leave the client's rows and the server's counts describing different samples, which is exactly the numerator/denominator class of bug we've been fighting. Plus every cached analytic invalidated and every published number shifting ~2%. Paying that for 2.3× on one path and 1.3× on another is not obviously right.

The argument for doing it anyway is the **curve, not the constant**: at 1M rows the hash sample is 50,000 rows scattered across ~900,000 heap pages (nearly pure random I/O, degrading with every row added), while the stratified sample is ~50 sequential runs of ~250 pages each regardless of dataset size. The gap should widen substantially. **But I have not verified that, and I have now been wrong twice this session extrapolating scaling behaviour** — first predicting parallel pages would be ~9× (got 28%, then a total failure at concurrency 10), then predicting the field-drop would cut time proportionally to payload (34% payload, 11% time).

So the next step is to measure the curve rather than assume it: build a ~1M-row dataset on TEST and compare hash vs stratified there. If the gap widens to 5-10× the migration justifies itself; if it stays ~2× it probably doesn't. `sql/188` is committed and applied to TEST but **nothing calls it** — no behaviour change, no numbers moved.

## The 1M test settles the sampling question (Aug 15, later⁴)

Built a 1,000,000-row dataset on TEST (`scripts/_seed_scale_test.sh`, untracked — cycles the real 128K Outback rows so field names, row width, text content and keyword density are realistic; a narrower synthetic row would understate the very penalty being measured). Page layout came out comparable to real data, 4.7 rows/page vs 3.4, so if anything the synthetic is denser and understates it further.

Same theme-counts-style scan over a 50,000-row sample:

| dataset | hash (today) | stratified blocks | |
|---|---|---|---|
| 128,619 rows | 10,456ms | 4,498ms | 2.3× |
| **1,000,000 rows** | **36,585ms** | **4,774ms** | **7.7×** |

**Stratified is flat — 4,498ms → 4,774ms while the dataset grows 7.8×.** That is the O(sample) property sql/160's header always claimed and never actually delivered. Hash degrades from 10.5s to 36.6s, and theme-counts performs two such scans, so a cold load on a 1M-row dataset would spend over a minute in the database alone — worsening with every sync. This is the blocker for the 1M target and the justification for converting all 20 sampled functions.

Worth recording honestly: the match count came out 1,381 (hash) vs 1,180 (stratified), 15% apart, against 1.8% on the real 128K dataset. That gap is an artifact of the test fixture — the synthetic set is eight identical copies of the source, making it perfectly periodic, which is precisely the adversarial case for stratified sampling I flagged when proposing it. Real, non-periodic data is the 1.8% figure. The fixture accidentally became the worst case and stratified still held up.

⚠️ The `[SCALE TEST]` dataset (`dddddddd-…-cafe`, 1M rows, TEST at 3,866 MB) is being **kept** until the conversion is verified against it, then dropped with `bash scripts/_seed_scale_test.sh drop` (batched delete + VACUUM — a single DELETE of 1M rows blows the statement timeout, the same 57014 the Trump re-ingest hit). The previous 1M perf dataset had to be cleaned up for the same reason on 2026-07-14.

## Audit score drop: two of three drivers were already fixed, one was real (Aug 15)

Owner flagged that the health score dropped last Sunday and asked what's addressable before tomorrow's run. W33 (PR #28, still open) scored **77.0, −4.5 vs W31's 81.5**, naming three drivers. Checked each against the actual tree rather than taking the report at face value:

1. **`docs/TESTING.md` spec drift** — fixed. Three local commits update it.
2. **ESLint ceiling at 252/252 with no burndown** — fixed. Local `package.json` is at 251.
3. **`chatCore` multi-tenancy MEDIUM carried a second week** — the W31 fix (`d200d9fe`, pairing `org_id` on the `last_session_at` update) *is* in `origin/main` and line 1872 pairs correctly. But the finding wasn't stale: sweeping every service-role query in the file turned up **four others that don't pair `org_id`** while their siblings do.

**⭐ The first two are only "fixed" locally.** The audit scores `origin/main`, and there are 44 unpushed commits. Tomorrow's run will report the same two drivers again unless this work is pushed — the same trap noted in W31 ("score reflects origin/main only; a flat W32 means *unpushed*, not that the fixes failed").

**The real finding, now fixed.** `lib/chatCore.ts` had four service-role reads scoped only by `bot_id`/`session_id`/`conversation_id`:

```
 266  conversation_turns   (join on conversations.bot_id + session_id)
1099  conversations        (bot_id + session_id)
1107  conversation_turns   (conversation_id from the above)
1892  conversation_turns   (join on conversations.bot_id + session_id)
```

All four are reachable only through a `bot` that was already org-resolved upstream, so these are **defence-in-depth gaps rather than live leaks** — no cross-tenant read is possible today. They matter because the invariant exists precisely so that a later change to how `bot` is resolved cannot silently open a path, and because their direct siblings at 379/445/1872 *do* pair, which is the inconsistency the audit keeps flagging. `conversation_turns` carries its own `org_id`, so all four pair directly. Re-swept: 7/7 org-scoped queries in the file now pair. tsc clean, 1657 green, no lint delta.

This is a security fix in the frozen PulseIQ path, which CLAUDE.md explicitly permits ("bug/security fixes there are fine").

## There is no Sentry log — it was never switched on (Aug 15)

Owner asked me to review the Sentry log for fixable errors before tomorrow's audit run. There is nothing to review, and that is the finding.

All five Sentry env vars are present in **Vercel production as empty strings**: `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG_SLUG`, `SENTRY_PROJECT_SLUG`, `SENTRY_ALERT_TO`. (Confirmed by pulling the production env to a temp file, reading only the Sentry keys, and deleting it.) All three SDK configs guard initialisation on `if (dsn)`, and an empty string is falsy — so **`Sentry.init()` has never run in production and no event has ever been captured.**

Everything downstream is consequently hollow: the `/admin/sentry` triage page lists nothing, the daily `sentry-digest` cron reports on an empty project, and `lib/sentryScrub.ts` — a genuinely careful PII scrubber with its own test suite — has never scrubbed a real event. The build is complete and correct; it is simply not switched on.

`docs/ENGINEERING.md` described this as live ("catches uncaught exceptions", "lists live unresolved issues"), which is how it went unnoticed. Corrected in the same commit with an explicit status warning rather than deleting the description, since the wiring is real.

**This needs the owner.** Turning it on requires a Sentry project, its DSN, and an org auth token with `event:read` + `project:read` — dashboard actions the CLI cannot provision. Once those exist: set the five vars in Vercel production, redeploy (env vars apply at deploy time — the same gotcha the Deepgram/Twilio service-health rows hit on 7/30), and the digest starts populating.

Worth stating plainly for the audit: **production has had no error visibility.** Every "no errors reported" observation this project has made was measuring an unplugged sensor.

### CORRECTION: Sentry IS live — the previous entry was wrong (Aug 15)

The entry above ("There is no Sentry log — it was never switched on") is **incorrect and has been retracted**; the false claim added to `docs/ENGINEERING.md` is removed.

Sentry is capturing normally. The owner's `/admin/sentry` digest shows three unresolved production issues with real event counts and timestamps.

**How I got it wrong, because the method is the lesson.** I ran `vercel env pull --environment=production`, saw `NEXT_PUBLIC_SENTRY_DSN=""` along with the other four Sentry keys, traced the `if (dsn)` guard in all three SDK configs, and concluded the SDK never initialises. Every step of that reasoning was sound; the premise wasn't. What the env pull returns is not proof of what the running deployment has.

The product ships a surface that answers this directly — `/admin/sentry`, backed by `fetchUnresolvedIssues` — and I inferred from configuration instead of reading it. Worse, I had a working route (`/api/admin/sentry/issues`) I could have hit. `feedback_never_assume_verify_code` covers exactly this: verify against the system, not against what the config implies about the system.

Practical rule for next time: **when a product surface reports on a subsystem, read that surface before concluding anything about the subsystem from its config.**

## Sentry issue 1 of 3: signal-stats 500s when the exact count times out (Aug 15)

`Error: count_nonempty_rows failed for 0aca432b… : canceling statement due to statement timeout` on `GET /api/datasets/[datasetId]/signal-stats`, 1 event, 1 day ago. The dataset is **Ruths Chris Reviews, 27,234 rows** — comfortably *below* the 50K sampling cap, so it runs the exact path.

**Below the cap is not the same as safe.** Timed the exact count on TEST: **2,431ms** for those 27,234 rows. Prod runs this RPC about **2.5× slower** than TEST — 7,981ms vs 3,171ms on the same Carrabba's call, recorded back in the 8/13 diagnosis — which puts a mid-size dataset near **6s against an 8s statement-timeout ceiling**. It doesn't need anything unusual to fail; it needs a busy moment.

The good news is that `countNonEmptyRows` **throws** rather than swallowing the error into `0`. That means this is *not* the Rubio's/BareBurger cache-poisoning class — no "Diffuse 0%" was ever cached from it. The bad news is the throw propagated straight out of the route, so the whole metric strip 500s and shows nothing.

`computeSignalStatsRaw` now catches a statement timeout on the exact path (57014, or the message PostgREST surfaces, since it reports one and not the other depending on path) and falls back to the sampled path already used above the cap, flagged `sampled: true` so the existing "Sampled" chip discloses it. Non-timeout errors still throw — only timeouts degrade, so a permissions or schema fault stays loud. **A labelled estimate beats a 500.**

Three tests pin it: timeout degrades and is flagged, a non-timeout error still throws, and the healthy exact path is untouched and *not* flagged as sampled. Suite 1660 green.

Note this is a different fix from the sampling work: stratified blocks (sql/188) only help above the cap, where the sampled path already runs. This dataset is below it, so the exact path is what needed a safety net.

## Sentry issue 2 of 3: entity counts never sampled for collections (Aug 15)

`entityFilter.computeEntityCounts: canceling statement due to statement timeout | 57014` from `GET /api/cron/entity-discovery` — **12 events, the most frequent production error in the digest.**

The sampled path was gated on `singleDataset && total > ENTITY_SAMPLE_CAP`, with the assumption written into the comment: *"Multi-member collections stay on the live path (many small member datasets, not 1M-row ones)."* Sentry disproved it. A collection whose members **sum** above the cap took the exact `count_entity_terms` path and blew the statement timeout.

Two things made it worse than a plain failure. The error is logged-and-swallowed (`if (countsErr) void logError(...)`, then the empty map returns), so a failed run produced **empty counts rather than an error** — entities silently showing zero mentions, which reads as a real measurement. And it ran on a **cron**, so nobody was watching it fail; it accumulated 12 events over six days.

Fixed by dropping the `singleDataset` gate: anything above the cap samples now. Members split `ENTITY_SAMPLE_CAP` proportionally through `allocateSampleShares` — the allocator the bulk-row path already uses for exactly this — and each member's counts scale by **its own** row total before summing, so a large member can't distort a small one's share. `sampledEntityTermCounts` gained a per-member `cap` parameter (defaulting to the old behaviour) to make that split possible.

⏭ Left in place deliberately: the logged-and-swallowed empty-count path. It's documented as best-effort so it "never breaks its caller", which is a defensible choice for a cron — but an empty count is indistinguishable from a measured zero, which is the same class of problem as the metric strip's "0 comments" and the "95% CI: 0–0%". Worth a separate decision rather than a drive-by change.

Suite 1660 green, tsc clean, no lint delta.

**Issue 3 of 3 not yet investigated:** `org-snapshot hop 0: 1/9 orgs failed` (`GET /api/cron/org-snapshot`, 1 event, 7d ago) — one org out of nine, a week old, lowest frequency of the three.

## Sentry issue 3 of 3: the backup alert couldn't tell you what failed (Aug 15)

`org-snapshot hop 0: 1/9 orgs failed` (`GET /api/cron/org-snapshot`, 1 event, 7 days ago). One org's nightly backup didn't complete.

**The finding isn't the failure, it's that the failure was undiagnosable.** Per-org causes are captured into `results[].error` and printed with `console.error`, but the Sentry event carried only the aggregate — `{ hop, orgs_failed }`. So the alert says one of nine orgs has no backup and gives you no way to learn which one or why. A week on, Vercel's runtime logs have rotated, and **there is no table recording snapshot runs** — results live only in the HTTP response and the console. So this specific failure is now unrecoverable: we know a backup was missed on ~2026-08-08 and cannot say whose.

For a mechanism whose whole purpose is disaster recovery — the one with `orgRestore.test.ts` and a DR drill behind it — that is the wrong shape of blind spot.

Fixed forward: the event now carries a `failures` array of `{ org_id, error }` (truncated to 200 chars). Deliberately **org_id, not org_name** — the uuid is enough to identify the org, and a customer's name doesn't need to go to a third-party processor (SECURITY.md §7). The next occurrence will name itself.

⏭ **Not built, needs a decision:** there is no durable record of backup runs at all. "Did every org back up last night?" is currently answerable only via Sentry (which fires only on failure) or console logs (which rotate). A small `org_snapshot_runs` table — org, day, key, bytes, status — would make the backup story auditable rather than inferential, which matters for the DD posture the repo is otherwise careful about. Flagging rather than building, since it's a new table and a schema decision.

## Two owner findings: a stray browser spinner, and Dimensions has never worked for collections (Aug 16)

**1. The pending nav pills showed a non-Lottie spinner.** Mine, from yesterday. I styled the disabled pills `cursor: 'wait'`, and Chrome renders that as **its own blue spinning cursor** — so hovering a pending tab produced a second loading indicator that isn't ours. The bespoke pulsing dot was the same mistake in smaller form: `components/ui/LottieLoader` is the ONE loader in this codebase (`feedback_lottie_loader`), and I'd introduced two alternatives to it in a single commit while ostensibly improving loading affordances.

Now a `LottieLoader size={14}` in the pill, `cursor: 'default'`, and the orphaned `.tm-nav-pending` keyframe removed from `globals.css` rather than left behind. Swept the analyze surfaces for other `cursor: wait` — none.

**2. Dimensions has never worked for collections.** Owner's hypothesis, confirmed: the Dimensions tab on a collection reports *"No taggable text found in Review"* while the header above it says 29,638 comments.

The cause is structural. **A collection holds zero rows of its own** — every row lives in its member datasets:

| collection | rows on itself | rows on members |
|---|---|---|
| Carrabba's | **0** | 56,117 |
| Capital Grille | **0** | 6,500 |
| Fleming's | **0** | 8,654 |
| Darden Demo | **0** | 15,154 |

And the taxonomy route reads `dataset_rows_flat … .eq('dataset_id', datasetId)` (`route.ts:51`) — the *collection's* id. It finds nothing, classification tags nothing, the rollup is empty, `attempted` flips true, and the UI honestly reports no taggable text. The message is correct; the query is asking the wrong dataset.

Its sibling `/theme-counts` resolves `collection_members` and fans out across them, which is exactly why Themes works on a collection and Dimensions doesn't. Neither `lib/taxonomyClassify.ts` nor `lib/taxonomyRollup.ts` mentions collections at all.

**Not a regression — a gap that predates this week, and not a small one.** Closing it means member resolution in four places: the route's row read, the classify write path (`_tx` has to be embedded into *member* rows), the rollup read, and the `tax_*` aggregate RPCs, which each take a single `p_dataset_id`. The fan-out pattern already exists in `theme-counts`/`runPool`, so it's tractable — but it touches the taxonomy **write** path, so it wants its own change with its own verification rather than being tacked onto a UI fix. Flagged, not built.

### Follow-up: heartbeat dot AND Lottie, with a gotcha (Aug 16)

Owner clarified the crossed wire: keep **both**. "lottie only kicks in on a hover over so we need teh pulsing dot" — the dot is the always-on, glanceable signal; the Lottie is the on-demand detail when you point at a specific view. I'd removed the dot entirely on the previous pass, reading "use the standard LOTTIE" as *replace*, when it meant *for the spinner*.

The dot got a real heartbeat: `tm-heartbeat` beats twice (scale 1.55, then 1.45) then rests, over 1.5s, rather than a sine pulse — the difference between reading as *alive* and reading as a status light. Bumped 5px → 7px with a soft amber halo (`box-shadow: 0 0 0 3px`).

⭐ **The gotcha worth remembering: Chrome fires no mouse events on a `disabled` button.** The pill was `disabled`, so `onMouseEnter` would never have fired and the Lottie would never have appeared — the feature would have looked implemented and done nothing. Now `aria-disabled="true"` plus a no-op `onClick`: still inert to clicks and still announced as disabled to assistive tech, but hover works.

⚠️ **Not visually verified.** The dev-server session had expired to `/login`, and minting a cookie is off-limits — `_mint_test_cookie.mjs` resets the owner's TEST password and locks them out (`feedback_cookie_mint_kills_owner_session`). Verified statically: the branch renders the dot when not hovered and the Lottie when hovered, the keyframe exists, tsc clean, suite 1660 green. **The owner should eyeball the two states on a cold load.**

### Dimensions now works for collections — built + verified (Aug 16)

Closed the gap flagged above. WHY it took a fan-out in five places rather than one: a collection dataset holds **zero rows of its own**, so *every* taxonomy path — not just the one read that produced the visible symptom — was querying an empty dataset.

New `lib/collectionScope.ts` (`resolveScopeMembers` / `resolveMemberDatasetIds`) does the `datasets → collections → collection_members` walk `/theme-counts` has always done, and the taxonomy paths route through it:

- **Write** (the consequential one): `classifyDatasetKeyword` + `classifyPendingRows` embed `_tx` into the **member** rows via `apply_taxonomy_verdicts` per member. Nothing is written to the row-less collection.
- **Read**: `computeTaxonomyRollup` pages each member and folds every page into ONE accumulator; the overall ★ is n-weighted across members; the two denominators sum. The stored rollup lands on the **collection's** `dataset_state` — that's what the Dimensions GET and `taxonomy_primary_field` read.
- **Drill-down**: `taxonomy_drill_rows` per member, counts added, comment pages **interleaved** so the first member can't fill the page and hide the second brand.
- **Compare**: `tax_crosstab`/`tax_axis_crosstab` fanned out and summed (pure counts). `tax_group_stats` deliberately not — median/stddev can't be merged from per-member aggregates, and nothing asks it for a collection.

⭐ **The gotcha worth remembering: `dataset_id IN (…)` is NOT a free generalisation of `.eq(dataset_id)`.** My first pass widened the classifier's keyset page to the member set in one query. It passed twice, then hit `canceling statement due to statement timeout` on a **15K-row** collection — the planner drops `idx_drf_id_keyset` (sql/165, built for the `=` predicate) and falls back to something quadratic. Now each member is paged with the original `.eq` shape and the pages are k-way merged in JS. `dataset_rows_flat.id` is one sequence for the whole table, so the cursor stays a single global id and the route's client contract is unchanged.

`_collection_label` ("Source Dataset" — the headline comparison for a collection) is synthetic: the rows route stamps it at read time, it is never stored on a member's rows, so grouping by it in SQL yielded one `(blank)` bucket. Each fan-out call already *is* one member, so the label is stamped onto its rows instead.

**Verified** on *Darden Demo - CG and Flemings Collection* (2 members, 15,154 rows, TEST) with `scripts/_verify_collection_dimensions.mts` — 25 checks, exits non-zero on failure. It un-tags rows on both members and re-classifies through the collection to prove the write fans out, then asserts the collection rollup equals the sum of the members' own rollups (11,122 classified · 9,009 with signal, both exact). Browser-QC'd all three views: Overview renders the 8 axes + Severity (was the empty state), Clouds and the drill-down reconcile to the same counts (steak 3,438 everywhere), and Compare now reads Flemings 17,764 vs Capital Grille 11,883 = 29,647.

**Two pre-existing bugs found along the way, NOT fixed** (both need a prod migration, neither is a collections issue):

1. `dataset_rows_with_text_count(uuid, text[])` — the multifield overload sql/117 was supposed to create — **is not in the database**; only the single-field `(uuid, text)` form is. So `rowsWithText` is `undefined` for *every* dataset and the Dimensions header silently falls back to `classifiedRows`.
2. `dataset_rows_pending_field_taxonomy` **misses rows that have no `_tx` key at all**: `NOT ((data->'_tx'->'f') ? key)` is `NULL`, not `true`, when `_tx` is absent. So the `pendingOnly` auto-classify path (`autoEnableDimensions`/`autoTagEmotion`) no-ops on a never-classified dataset — the full classify is what actually does the work. A `COALESCE(…, '{}'::jsonb)` fixes it.

### sql/189 — the two pre-existing taxonomy bugs, fixed (Aug 16)

Owner said fix both. Neither is a collections bug; both were found while building the fan-out. **Root cause of both: sql/117's effects are absent from prod.** Its drops never took (the sql/114 scalar `dataset_rows_with_text_count(uuid, text)` and the 3-arg `dataset_rows_pending_field_taxonomy(uuid, text, int)` are both still there), and the multifield PENDING signature exists only because sql/151 happened to re-create it. So the one thing 117 uniquely provided — the multifield text count — simply never existed.

⭐ **Corrected during the prod pre-flight, and the correction is the more useful fact:** I'd written that 117 "was never applied". It *is* in `schema_migrations` — but with `applied_by='backfill'` at the same timestamp as every other pre-147 filename, because sql/147 created the ledger and bulk-recorded the back catalogue as assumed-applied. So the entry proves nothing, and whether 117 never ran or ran and was reverted isn't recoverable. **Below sql/147, trust `pg_proc`, not the ledger.** Post-147 rows are written by `apply-migration.ts` at real apply time with the file's sha256 and are trustworthy.

**Bug 1: `dataset_rows_with_text_count(uuid, text[])` was missing.** Every caller passes `p_fields`, so it 404'd with PGRST202 and each caller took its "leave it undefined" branch. `rowsWithText` was therefore undefined on **every dataset**, and the Dimensions header rendered `classifiedRows` while labelling it "rows with text". Self-heals on the next GET after the migration — no re-classify.

**Bug 2: the pending-rows RPC never saw a row with no `_tx`.** `NOT ((data -> '_tx' -> 'f') ? key)` is NULL, not true, when `_tx` is absent — jsonb `?` is STRICT, and `WHERE NULL` drops the row. A row could only be "pending" if it *already* had a `_tx` block missing that one key. Since a never-classified row and every freshly-synced review have no `_tx` at all, the auto-classify safety net was a no-op on precisely the rows it exists to serve: **synced reviews have been invisible to Dimensions until someone ran a manual re-classify**, and the automatic post-mining path (`autoEnableDimensions`/`autoTagEmotion`) reported "done" having done nothing. The manual "Enable Dimensions" button was unaffected — it pages rows directly and never consults this RPC, which is why the feature looked fine.

⭐ **A third bug fell out of writing the migration, and it's the serious one: both functions were `GRANT`ed to `anon`.** They are SECURITY DEFINER over raw tenant rows, so they bypass RLS, and PostgREST publishes anything `anon` can execute as a public RPC endpoint — with a key that ships in every browser bundle. Proved on TEST with nothing but the anon key and another org's dataset id: the count function returned a live row count, and the pending function returned a **full raw row — review text, author name, location**. sql/189 revokes both to service_role only.

⚠️ **It is a class, not an instance: 54 of the 86 SECURITY DEFINER functions in `public` are anon-executable, 30 of them read `dataset_rows_flat`** — including a write (`apply_taxonomy_verdicts`), destructive ops (`archive_dataset`, `restore_dataset`), a cross-org mutation (`transfer_recording_org`), and raw-row readers (`get_rows_by_filters`, `search_dataset_rows`, `taxonomy_drill_rows`). Cause is Postgres granting EXECUTE to PUBLIC by default; only migrations that explicitly REVOKE (sql/180 is the model) are safe. **Deliberately NOT swept in this migration** — revoking `authenticated` as well as `anon` needs an audit of which routes use the cookie-auth client vs the service-role client first. Written up in SECURITY.md §2 as open. The app makes zero browser-side `.rpc(` calls, so the sweep should be safe once that check is done.

⭐ **What the verification caught that I'd have otherwise mis-read as a regression:** after the fix, two rows on Flemings showed as pending that I hadn't touched. Not a bug — **emoji-only comments**. The JS classifier strips surrogate pairs (`CONTROL_CHARS`), so "👍🤑" reads as empty and the full classifier writes no block; the SQL text test strips only `[[:space:][:cntrl:]]` and counts it as text. With the NULL fixed they finally surface, get a tagless block (which is exactly why `classifyPendingRows` refuses to skip empties), and converge on the first drain. Both harnesses are now baseline-relative rather than asserting an absolute zero, so they don't false-fail on it. Visible effect: the Darden collection's `classifiedRows` moved 11,122 → 11,126.

Verified with `scripts/_verify_sql189.mts` (14 checks, exits non-zero) — including that anon now gets a 401 on both, that an *empty* row with no `_tx` still stays out of the queue (the fix must not resurrect the un-clearable nudge), and that the multifield count is a UNION not a sum. `_verify_collection_dimensions.mts` re-run green, tsc clean, suite 1661 green.

**✅ APPLIED TO PROD 2026-08-16**, owner-authorised, together with sql/190. Ledger + snapshot committed alongside. No code shipped — the fix is entirely in the database, so it takes effect without a deploy.

### sql/190 — the SECURITY DEFINER sweep (Aug 16)

Owner said do the sweep. **77 functions locked to `service_role`.** This closes the class sql/189 exposed: Postgres grants EXECUTE to PUBLIC on every new function, Supabase's `anon`/`authenticated` inherit it, PostgREST publishes anything `anon` can execute, and SECURITY DEFINER means RLS never applies. 48 of our 85 were reachable that way — with a key that ships in every browser bundle.

**The audit is the interesting part, because two things could have taken the whole app down.**

⭐ **RLS policy predicates.** A function called inside a policy's `USING`/`WITH CHECK` runs as the *querying* role, not the definer — so revoking EXECUTE from `authenticated` on one would make every policy using it **error**, locking every logged-in user out of everything. A `pg_policy` scan found exactly three: `is_platform_admin` (42 policies), `current_org_id` (31), `current_client_id` (1). Excluded and left byte-for-byte alone. I also checked their bodies for indirect calls — all three are self-contained (`auth.uid()` + a `users`/`organizations` read), so excluding them exposes nothing.

⭐ **Non-service-role callers.** Every server-side `.rpc(` call but two uses `createServiceRoleClient()`; the exceptions are `get_study_response_stats_for_user` and `study_stats_for_ids`, both on the cookie-auth client in `app/dashboard/page.tsx`. They keep `authenticated`. I also scanned for SECURITY INVOKER or trigger functions calling a target (that would run as the caller's role) — one hit, `set_brand_collection_id → find_or_create_brand_collection`, insulated because the caller is itself SECURITY DEFINER.

⭐ **And keeping `authenticated` surfaced a third leak.** `study_stats_for_ids` is SECURITY DEFINER over `responses` and took arbitrary study ids with **no filter whatsoever** — so any logged-in user of any tenant could read another org's response counts, NPS split, sentiment breakdown and last-response time by collecting study UUIDs. The comment right above its caller even claims "the RPC is a SECURITY DEFINER wrapper that filters rows to the caller's org" — true of its sibling, false of it. It now has the same org gate. **The lesson generalises: keeping `authenticated` is only safe if the function scopes to the caller itself, because `authenticated` is every tenant, not this one.**

The lockdown is a catalog-driven `DO` loop rather than 43 hand-typed signatures — a typo in a hand-written signature is the one failure mode that silently leaves a hole open — and it re-asserts grants on already-locked functions so the end state is deterministic regardless of history.

**Verified** with `scripts/_verify_sql190.mts` against a **throwaway org + user + study** seeded and torn down in-run (never the owner's account — resetting that password locks them out of TEST). It proves all three properties at once: anon gets 401 on raw-row readers, the write, `archive_dataset`, `transfer_recording_org` and the email oracle; a real logged-in session still reads its own rows (so policies still evaluate) and still cannot see another org's; and `study_stats_for_ids` returns the owner's study but not a foreign one, including from a mixed id list. `test:rls` (4), `test:egress` (27), `test:auth-flows` (6), both taxonomy harnesses, tsc and the 1661-test suite all green after.

⭐ **A harness bug nearly gave me a false pass:** the seed's `responses` insert was failing on a NOT NULL column and I wasn't checking the error, so "does the org filter still ALLOW the owner?" was passing vacuously on an empty array. Every seed insert is now error-checked and there's an explicit `seed: the study really has 2 responses` assertion before the checks that depend on it. **An assertion that only tests `Array.isArray` passes on `[]` — which is exactly what a broken filter returns.**

✅ **Browser QC done** (owner logged in after the first pass found the session expired). `/dashboard` — the surface that depends on the two RPCs keeping `authenticated` — renders **real** per-study stats: BareBurger 181 responses (99%) / 46% + / 3.1 avg / last response Jul 4; Outback 5 responses (80%) / 3.2 avg. If either grant had broken, every card would read 0 responses and 0.0 avg. The collection's Dimensions Overview and Compare both still render (service-role paths), and Compare still reads Flemings 17,764 vs Capital Grille 11,883. **No permission-denied / PGRST / 401 anywhere in the console** on either page — as expected, since the app makes no browser-side RPC calls. Also visible: the Dimensions header now reads **"11,126 rows with text"**, which is sql/189's `rowsWithText` finally being populated instead of falling back to `classifiedRows`.

**✅ APPLIED TO PROD 2026-08-16**, after 189.

⭐ **The apply itself had a scare worth recording: `npm run migrate` for 190 died on a `502 Bad gateway` from `api.supabase.com`** (Cloudflare reporting the host errored — transient, on their side). The danger is that a 502 is ambiguous: the request may never have reached the database, or it may have executed with the response lost. **Do not blind-retry a migration after one — check the catalog first.** Here the DDL *had* executed (0 anon-executable functions, `study_stats_for_ids` already carried the org filter) but the ledger row and the snapshot refresh — both of which happen *after* the query in `apply-migration.ts` — had not. Re-running was safe only because the migration is idempotent by construction (REVOKE/GRANT + CREATE OR REPLACE), and it completed the ledger + snapshot. **Idempotency is what made this recoverable; write migrations that way.**

Prod verified after: 0 anon-executable SECURITY DEFINER functions outside the 3 RLS helpers, the 3 helpers still `anon`+`authenticated`, both dashboard RPCs `anon=false`/`authenticated=true`, every function still service_role-callable, all 111 policies intact — plus a live anon probe against production of nine of the worst offenders (raw-row readers, the write, `archive_dataset`, `transfer_recording_org`, the email oracle): **all 401**.

⚠️ **One live behaviour change to expect on prod, by design:** the pending-rows fix means reviewSync's auto-classify will now actually classify freshly-synced reviews on the next sync of any already-classified dataset (it had been a silent no-op). That is the point of the fix, but it is the first time that path has done real work.

### sql/191 — the stratified-sampling conversion, SQL half (Aug 16)

**Why.** Hash-order sampling picks the `cap` rows with the smallest `hash(id||dataset_id)`. It is uniformly random and perfectly deterministic — and uncorrelated with *physical* order, so the 50,000 sampled rows sit scattered across a ~922MB heap. Cost is therefore decided by buffer-cache residency rather than by row count, which is why identical queries varied 15–24s all session and why the same 5,000 rows took 28ms on one dataset and 1,895ms on another. It does not flatten on its own, so it is the blocker for the 1M-row target. Measured on identical rows: hash 2,296ms vs 50 stratified contiguous blocks 41ms; at 1M, 36.6s vs 4.8s, staying flat as the dataset grows.

**Why all at once.** The two samples select *different rows*. If bulk rows served one while the count RPCs walked the other, the rows the client holds and the numbers the server reports would describe different samples — a disagreement nothing in the product could detect. sql/188 converted `sample_dataset_rows` alone and flagged exactly this; sql/191 converts the remaining 19.

⭐ **The method mattered more than the SQL.** Nineteen near-identical function bodies is precisely where a hand-typed signature slips through and silently samples the wrong rows, so I **generated** them from `pg_get_functiondef` with a transformation that asserts on shape at every step. Only the sample walk and the cursor payload change; every aggregate CTE reading from `page` is carried through byte-identically, which is what makes a 19-function diff reviewable at all. The assertions earned their keep twice: they caught a false positive of my own (a bare `" AS h"` guard also matches `" AS hit"` in `sampled_signal_counts`) and the one genuinely non-uniform function, `sampled_filtered_rows` — walk CTE named `scan`, plus the hash used as an *ordering* key in two further places. That one is hand-written, with `row_index` as the equivalent order.

⭐ **Found and fixed a flaw in sql/188 rather than replicating it nineteen times.** sql/188 applied the cursor *inside* the per-block LATERAL, so a block straddling a page boundary could hand out a fresh `per_block` rows on every page — with a 50K cap and 5K pages that over-weights ~10 of the 50 blocks, defeating the stratification the whole design exists for. sql/191 takes the per-block LIMIT from the **block start** and applies the cursor outside, making the sampled set "the first per_block rows of each block" — a fixed set, independent of how it is paged. `sample_dataset_rows_blocks` is re-created with the same fix, because a bulk sampler and a count RPC disagreeing at page boundaries is the exact hazard the all-at-once rule exists to prevent.

⭐ **The number that decides whether this is shippable is representativeness, not speed.** Against exact ground truth on Outback GuestLens (128,619 rows), scaled sample vs real counts on a categorical field: FL 32,120 exact / 31,980 estimated (0.4% off), worst of the top five 2.2%. Paging is sound (50,000 rows, 10 pages, zero duplicates, strict row_index order), deterministic across runs, and — the thing the sql/188 flaw broke — the sampled set is byte-identical at page size 5000 and 997.

One detail noted so it is not later mistaken for a paging bug: |S| = blocks × (cap/blocks + 1) = **cap + blocks** (50,050 at the defaults). The +1 guards truncation, callers cap, so the overshoot is inert.

**What changed**:
- `sql/191_stratified_sampling_conversion.sql` — 20 functions: 18 generated twins, `sampled_filtered_rows_blocks` hand-written, `sample_dataset_rows_blocks` re-created with the boundary fix. All carry the sql/190 service_role-only lockdown.
- `scripts/_verify_sql191.mts` (untracked) — paging soundness, determinism, page-size independence, block weighting, and representativeness vs exact counts.

**⚠️ TEST only, and a zero behaviour change on its own** — nothing calls these yet. The TS pagers are the next commit, and **the numbers move when that ships**, not now.

### sql/191 — the TS half, and what measuring actually showed (Aug 16)

**Why.** The SQL twins are inert until something calls them. This is the commit where the sample actually changes: one shared pager plus five bespoke ones move from the `(hash, id)` cursor pair to a single `row_index` cursor, and every `sampled_*` RPC name gains its `_blocks` suffix.

**What changed**: `pageSample` in `lib/sampledAggregate.ts` (which alone covers 14 of the 19 twins — the aggregate five, the taxonomy five, the theme-extras four), then `sampledSignalCounts`, `sampledFilterOptions`, `anaReportContext`, `entityFilter` and `bulkRowSample`. `SAMPLE_BLOCKS` lives beside `SIGNAL_SAMPLE_CAP` in `lib/sampledSignalCounts.ts`, since it is the same kind of platform-wide sampling constant.

⭐ **Cache invalidation was a real trap, and the existing key would have hidden it.** The signal-stats cache is keyed on (theme-model hash, row count) and the theme-counts cache on a request hash plus row count. **Neither notices a change of sampling scheme**, so every cached entry would have survived the conversion and kept serving numbers computed over rows that are no longer in the sample — silently, and exactly on the big datasets where sampling applies. Both caches already carry a version discriminator for precisely this, so `STATS_MODEL_VERSION` 2→3 and `THEME_COUNTS_VERSION` 1→2. 26 unit tests went red on the cursor contract and 4 more on the version bumps; they were pinning the contract, which is what they are for.

⭐⭐ **Then I measured, and the headline claim did not survive first contact.** The migration is justified by "hash 2,296ms vs 50 stratified blocks 41ms". My first honest measurement said the new walk was *slower*: 62,486 buffers versus the hash walk's 8,883 for one 5,000-row page. Two compounding causes, both mine or inherited:

1. **Read amplification I introduced.** Fixing sql/188's page-boundary flaw meant taking the per-block LIMIT from the block start — but with no bound on how many blocks a page considers, every page read `per_block` rows from *all 50* blocks and then discarded ~90% at the outer LIMIT. Bounding the blocks to what a page can actually consume took it to 20,646.
2. **The primitive cost more than the thing it enabled.** Isolating the pieces: the stratified read itself is **~800 buffers for 7,000 rows** — the win the design promises — while `dataset_sample_blocks` alone was **11,190 buffers**, because it decided "is this dataset under the cap?" with a `count(*)` over the whole dataset. It was costing 13× what it set up, and `count(*)` **grows with dataset size**, which defeats the flatness that is the entire point. The count was only ever used as a boolean, so it is now an index probe bounded at cap+1 rows.

After both: 10,381 buffers and 327ms, versus hash's 8,386 and 335ms.

⚠️ **And that is the honest headline: at 128,619 rows on a warm cache, this is a wash, not 55×.** I cannot validate the claim on TEST, because after a few runs everything is buffer-resident and hash order stops being penalised — which is the very effect sql/188 documented (the same 5,000 rows took 28ms on one dataset and 1,895ms on another purely from cache residency). The directional evidence is real but thin: on the genuinely cold first run, the block walk did **0 disk reads** against hash's **1,169**. The claim is specifically about cold cache at 1M rows, and the 1M fixture was deliberately dropped on 2026-08-15.

**So the conversion is complete and correct, and deliberately NOT applied to prod.** Correctness is verified — paging sound, deterministic, page-size independent, blocks now perfectly even at 1000 rows each, and scaled counts within 2.2% of exact ground truth (FL 32,120 exact vs 31,977 estimated). What is missing is the performance evidence that justifies moving every number in the product, and that needs `bash scripts/_seed_scale_test.sh 1000000` and a cold-cache comparison at 1M. Shipping before that would be trading a known cost — every sampled figure moves once, every deck number with it — for an unproven benefit.

### sql/191 measured at 200k / 500k / 600k / 1M — the claim holds, and my "wash" was wrong (Aug 16)

**Why.** I had built the whole conversion and then reported that at 128K rows it was a wash, so it shouldn't ship. Owner asked for the staged measurement. Staged was the right call — but the first thing it produced was the discovery that **my earlier measurement method was invalid**, which means the "wash" conclusion was too.

⭐ **Retraction: the single-page `EXPLAIN (ANALYZE)` comparison I based "it's a wash" on does not measure what I thought.** Running the identical call two ways, back to back at 1M: inlined `SELECT jsonb_array_length(sample_dataset_rows(...) -> 'rows')` reported **3,749 ms**, the same thing behind a `MATERIALIZED` CTE reported **302 ms** — and in an earlier run the ordering was reversed. Those readings are dominated by cache order and by whether the planner inlines the `LANGUAGE sql` body, not by the sampler. Every "one 5,000-row page" number I quoted earlier — including "10,381 buffers / 327 ms vs hash 8,386 / 335 ms" — is unreliable and should be ignored.

**The sound measurement is a sequential walk**: evict once, then page the full 50K in one session, so both samplers face identical conditions and each page does genuinely new work.

| | hash | blocks | |
|---|---|---|---|
| full 50K walk @ 600k | 45,655 ms | 12,226 ms | **3.7×** |
| full 50K walk @ 1M | 44,057 ms | 11,154 ms | **3.9×** |
| per page @ 1M (run 1) | 4,700 ms | 1,130 ms | 4.2× |
| per page @ 1M (run 2) | 4,031 ms | 1,071 ms | 3.8× |

**So the migration is justified: ~4× on the real workload at 1M**, reproducible across two dataset sizes and two runs. Not the 55× the sql/188 header quotes for an isolated 5,000-row read, but that figure was always about one read in isolation; ~4× end-to-end on the thing the product actually does is the number that matters.

⭐ **Two hypotheses tested and rejected along the way, which is how the mechanism got pinned down.** First: that hash degrades with dataset size (sql/188's framing — "cost tracks dataset size"). It does not — hash is flat at 600k and 1M, and so is blocks. Second: that hash's `(hash, id) > (last_hash, last_id)` keyset makes the walk quadratic in page count, each page rescanning what earlier pages returned. Also no — **per-page timings are flat across all 10 pages for both samplers** (hash 4,788/4,681/4,646/… ms). What is left is a constant per-page factor, which is exactly sql/188's original claim: 5,000 rows scattered across the heap cost ~4× what 5,000 contiguous rows cost. The mechanism was right; I simply could not see it through a broken measurement.

**What changed in the code as a result of measuring**: nothing further — the two fixes made earlier (bounding blocks per page, and replacing `dataset_sample_blocks`'s whole-dataset `count(*)` with a probe bounded at cap+1) are both still load-bearing, and the walk numbers above are with them in place.

**Fixture**: seeded 200k → 500k → 1M on TEST via `scripts/_seed_scale_test.sh`, then dropped again (it costs ~4.4 KB/row; the DB hit 3,893 MB at 1M). Note the seeder dies with a statement timeout on its 100K-row batches somewhere past 600k — re-running it resumes, which is how it got to 1M. Measurement harness kept at `scripts/_perf_sampling_stages.sh`.

⏭ **Still not applied to prod.** The performance case is now made; what remains is the owner's call on when every sampled figure moves, since that is a one-way step for any deck already exported.

### The scale-fixture drop loop never terminates (Aug 16)

Cleaning up after the sql/191 measurement, `_seed_scale_test.sh drop` correctly deleted all 1M rows and then **spun forever**, never reaching its own final step (deleting the `datasets`/`dataset_state` rows and running `VACUUM`).

The loop counts deleted rows with `psql -t -A ... RETURNING 1 | wc -l`. **psql emits a trailing blank line, so `wc -l` reports `1` when ZERO rows were deleted** — and the exit test is `[ "$n" = "0" ]`, which therefore never fires. Verified directly: with the table already empty, that pipeline returns `1`.

This is the second time this exact function has failed in this exact way. The script already carries a comment explaining that the 2026-08-15 run "deleted all 1M rows but left the datasets / dataset_state rows behind while still exiting 0" — that was diagnosed as a `set -e` interaction and fixed accordingly, but the underlying miscount was never the `set -e`; it was always `wc -l`. Counter is now `grep -c '^1$'`, which returns a true 0.

Cleanup finished by hand: fixture rows 0, `datasets`/`dataset_state` rows gone, `VACUUM ANALYZE` run. TEST is back to 454,673 rows and 2,272 MB, against 2,257 MB before the experiment and 3,893 MB at the 1M peak.

### org_snapshot_runs — a durable answer to "which tenant has no backup?" (Aug 16)

**Why.** The nightly per-tenant snapshot cron reported its outcome to exactly three places, none of them durable: the HTTP response body (gone the moment the cron returns), `console.error` (gone when Vercel rotates logs), and a Sentry event carrying an aggregate count. On 2026-08-08 that produced an alert reading "1/9 orgs failed" which sat unresolved for a week — by the time anyone looked, the logs had rotated and **there was no way to say which org had no backup**. The cron's own source comments say exactly this. A backup system that cannot answer "which tenants are unprotected, and why" after the fact is not really a backup system.

**What changed**: `sql/192` adds `org_snapshot_runs`, one row per (`org_id`, `snapshot_day`), upserted through `record_org_snapshot_run` as the resumable cron hops across invocations — `attempts` counts the touches rather than the table accumulating a row per hop. `lib/orgSnapshotRuns.ts` wraps it; `/admin/health` grows a Backups card.

⭐ **Status is four-valued on purpose, because "failed" would hide the dangerous case.** An `incomplete` snapshot committed a manifest but silently dropped a table that failed to read — it looks like a backup and isn't one. It gets its own status, its own `fetch_errors` payload, and red styling, so it can never read as green. `partial` (out of time mid-org, no manifest yet) is genuinely not a failure and is distinguished from both.

⭐ **The instrumentation is derived, not sprinkled.** There are eight `results.push` sites across the resume path, the main loop, the hop cap and two catch blocks. Rather than instrument each — where a future ninth path would silently skip the ledger — the recording loop reads the same `results` array the HTTP response is built from. One place, and it cannot drift from what the response claims.

⭐ **`missing` is counted separately from `failed`, and that is the whole lesson of 2026-08-08.** An org the cron never reached leaves no row, no log line and no Sentry event. It cannot be inferred from an absence of bad news, so the gap query enumerates the fleet and reports orgs with no row at all as their own category.

Recording is best-effort and never throws: bookkeeping must not turn a good backup into a failed cron run, nor mask a real backup error behind a write error. That design was immediately confirmed by the existing cron test — its mock service had no `.rpc`, the recorder threw, and the cron still completed successfully; the only symptom was an unexpected `logError`, which is what caught the gap.

**Verified** with `scripts/_verify_sql192.mts` against TEST: upsert collapses 3 hops to 1 row with `attempts=3`, a later `partial` cannot erase the pointer to the last good manifest, `incomplete` survives as its own status, the gap query flags bad statuses *and* orgs with no row, and the multi-tenancy invariant holds (RLS on, anon reads nothing, anon writes 401). `test:rls` 4, `test:egress` 27, suite 1,664 green. Three new cron tests assert the ledger itself.

**⚠️ TEST only** — prod apply pending, like sql/191.

### Statistics findings: stacked cards → dense table (Aug 16)

**Why.** Owner-approved 2026-07-15 and carried since. At 100+ findings the card list wasted roughly 80% of its vertical space, the prose line repeated the badge and the title, and — the real problem — the effect size was buried mid-sentence, so a list explicitly headed "sorted by effect size" gave the reader no scannable column to check the ordering against.

**What changed**: `components/analyze/StatsModule.tsx` — the findings list is now a table: `# · type · relationship · strength chip · effect (right-aligned, labelled) · significance · n`. It reuses the table styling already in the module (the logistic-coefficients table), so it doesn't introduce a second visual language.

⭐ **The columns needed values the type didn't carry.** `AutoFinding` held `magnitude` (a sort key, normalised across finding types) plus a prose `detail` string with the real numbers inside it. Rather than parse numbers back out of prose — brittle, and it would silently break when the wording changes — `AutoFinding` now carries `effect`, `effectLabel`, `n` and `sub` **populated at the same push sites from the same computed values** the prose already quoted. Nothing is recomputed and no sort, filter or threshold moved; `detail` is untouched because the AI narrative and the deterministic summary both read it.

Group effects keep their "highest / lowest" detail as a muted second line inside the relationship cell rather than behind an expander, so nothing is hidden. Signed `r` is shown rather than `|r|`, so direction is visible without reading the badge.

Zero lint delta (36 warnings before and after — all pre-existing `react-hooks/*` in that file). tsc clean, suite 1,664 green.

**⚠️ Browser QC NOT done** — the dev-server session had expired to `/login` again and minting a cookie is off-limits. Needs an eyeball on the Carrabba's GSS 113-findings view, checking both finding types render (correlation with `r`, group effect with `η²`/`d` plus its second line).

### Charts calc-sweep: already done · hierarchy field type: foundation (Aug 16)

**The Charts item needed no work — it was built the same day it was deferred.** The 2026-07-14 sweep commit `70f7da62` deferred "plain Count/% bar + no-split Distribution ignore active filters", judging it to need "an async refactor of the instant-render path… a UX change (adds loading states to the hottest charts)". The very next commit, `0bca84cb` the same day, implemented it — its body names the charts exactly: *"Filter-awareness for summary-driven charts (Count/% bar, no-split Distribution, treemap, bubbles, waterfall)… Whole tab now agrees under a filter."* The feared async refactor never happened and wasn't needed: the client already holds the filtered rows, so `recomputeFilteredSummaries` is synchronous and adds no loading state, and `renderChart(…, enrichedAnalytics, …)` means every chart receives it. Covered by `tests/unit/filteredSummaries.test.ts` (3, green). **The memory recorded the deferral and was never updated when it was fixed** — corrected now, and worth the reflex: re-read the code before rebuilding anything marked "deferred".

Also discharged two stale live-constraints from the same era, both verified directly against prod rather than trusted from the log: **sql/182 IS applied** (in the ledger, `drf_numeric_ok`/`drf_to_numeric` present, `group_numeric_stats` tolerant) — so the "until sql/182 is on prod the live chart stays broken" warning is obsolete — and **sql/183 is applied** too (`outlet_action_plans` column + `merge_outlet_action_plan` RPC).

**Hierarchy field type — foundation built.** `lib/hierarchy.ts` plus `SchemaFieldConfig.hierarchyLevel`. A dataset designates existing columns as levels (Region 1 → District 2 → Store 3) and the tree is *derived from those columns' values*: no org-structure table to hand-maintain, nothing to drift as rows sync. The level is a **marker on an ordinary categorical field**, not a new `AnaFieldType`, so the column keeps behaving normally everywhere else.

⭐ **Two properties the roll-ups stand or fall on, both tested.** Nodes are keyed by full **path**, never by value — "Downtown" under East and "Downtown" under West are different districts, and a name-keyed tree would silently merge them and corrupt every number below. And **no row is ever dropped**: a blank at any level buckets as `(unassigned)` instead of vanishing, so leaf counts sum to the dataset total and a roll-up always reconciles with the flat numbers. 17 tests.

⭐ **I reintroduced the control-byte bug within an hour of banning it.** The path separator went in as a raw U+001E, and `file` immediately reported `lib/hierarchy.ts` as binary — the exact class I swept out of nine files this morning and wrote an ENGINEERING.md rule about. Caught only because I checked the new file rather than assuming. It is now written as the escape sequence.

⏭ **Next for hierarchy**: the Schema-tab UI to assign levels, and rolling the existing outlet snapshot up each rung (Network → Region → District → Outlet) with breadcrumb nav — `rowsUnder` exists precisely so the SAME snapshot is computed over a node's rows with no per-level metric invented.

### Browser QC on the Stats findings table — and what only looking could catch (Aug 16)

**Why.** The table shipped with `tsc`, 1,681 tests and a zero lint delta all green. On the Carrabba's GSS view it rendered correctly — and with the **Effect column pushed off the right edge**. That single column is the entire justification for the change: without it, a list headed "sorted by effect size" still gives the reader nothing to check the ordering against. Every automated gate passed a version that failed at its own purpose.

The cause was an assumption I never checked: the module's container is `maxWidth: 860`, so I designed seven columns for 860px. The Stats tab actually has a fixed field-list sidebar on the left and the analysis-type panel on the right, leaving the centre column **~560px**. Seven columns never fit.

**What changed**:
- Type column is the icon alone with the full label as a tooltip — "CORRELATION"/"GROUP EFFECT" spent ~90px repeating what the glyph already says.
- `n` folded into the Effect cell as a muted second line instead of its own column. It reads better there anyway, sitting directly under the value it qualifies.
- Column widths set `1%`/`100%` so Relationship absorbs the slack; padding 12 → 8.
- Group-effect sub-line compacted from `highest X (5.0) · lowest Y (1.5)` to `▲ X 5.0  ▼ Y 1.6` — the long form wrapped to four lines in a ~200px cell and made every group-effect row taller than the card it replaced.

Verified in the browser: six columns all visible, effect descending (0.87 · 0.76 · 0.76 · 0.76 · 0.69 · 0.67 · 0.66), `n` under each value, both finding types labelled correctly (`r` and `η²`).

⭐ **The lesson is narrow and worth keeping: a layout constant is not a layout.** `maxWidth: 860` told me what the container permits, not what the column actually gets after two fixed sidebars take their share. No test can see that, and I had already written "browser QC not done" on the commit — the gap was real, not hypothetical.

### The control-byte rule extended to prose — because that's where it kept recurring (Aug 16)

**Why.** Closing the session, the memory files got a `file(1)` pass. Three were
classified **binary**: the open work queue, `project_charts_calc_sweep`, and —
for the second time — the memory that *documents this exact bug*. Every one of
them was clean prose whose only offence was **describing** a control byte, which
pastes a real one.

That makes four occurrences in a day: the nine-file source sweep this morning,
`lib/hierarchy.ts` (raw U+001E path separator, written within an hour of banning
it), the three memory files, and then the bullet I added to warn about it, which
itself contained a NUL. The rule as written only said "never write a raw control
byte into **source**" — so I kept obeying it in code and breaking it in prose.

A binary memory file is worse than a binary source file: recall greps it, gets
nothing, and reads that as "no such memory."

**What changed** in `docs/ENGINEERING.md` §"Never write a raw control byte":
- Scope is now **every file authored by hand or by script** — source, specs,
  devlogs, and commit messages. (Raw bytes in a commit message are rejected by
  tooling outright; write the message to a file and `git commit -F`.)
- The regression sweep gained `':(exclude)node_modules/**'`. It was reporting
  `lottie-web/player/js/modules/full_worker.js` on every run — a genuine binary,
  and a false positive that would eventually train me to ignore the output.
- Noted, not acted on: **312 `lottie-web` files are still tracked** from the
  2026-04-01 install commit even though `node_modules/` is gitignored (the
  2026-04-09 cleanup missed them). `lottie-web` is a normal `package.json`
  dependency, so the tracked copy is redundant — but untracking 312 files is a
  decision, not a drive-by.

Sweep is clean across the repo, and all memory files now read as UTF-8 text.
