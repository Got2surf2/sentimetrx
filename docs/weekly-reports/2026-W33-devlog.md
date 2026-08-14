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
