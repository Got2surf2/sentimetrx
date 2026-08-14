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
