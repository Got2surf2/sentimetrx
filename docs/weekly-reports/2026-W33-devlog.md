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

Verified: 27 new tests (15 pure collocation, 6 component render, 4 word-modal path, 2 theme-modal path — the last two covering the drill-down count matching its chip, the dual highlight, and the theme header holding steady), full suite 1634 green, typecheck + per-file lint clean. Real-data QC harness kept untracked at `scripts/_verify_context.ts`. Not yet browser-QC'd by the owner.

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
