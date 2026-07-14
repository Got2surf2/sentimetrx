# Agents — Capability Review & Super-Agent Tier Spec

> **Status (2026-07-14): Phase 0 (§2 D1–D4 quality floor) SHIPPED. §7 owner
> decisions RESOLVED. Phase 1 (tier-split MVP — §5) SHIPPED: `agents.capability`
> + `capability_config` (sql/175, TEST-applied), `lib/agentCapability.ts` knob
> resolver wired into chatCore, editor toggle + super-model dropdown, super-turn
> abuse-backstop quota. All local/unpushed. Phase 2 (super KB/retrieval) is in
> flight — P2a (multi-query retrieval), P2b (near-dup + chunk budget), P2c
> (PDF/DOCX ingestion), P2d (resumable 300-page crawl, sql/176), P2e (weekly
> hash-diff re-crawl cron, sql/177) SHIPPED; P2f (liveContext adapter registry)
> is the last unit. Phase 3 (§3.2) stays gated.**
> Written 2026-07-14 (Fable review session) on the owner mandate: *"we are
> running into situations where a much more sophisticated and informed bot is
> necessary — should we have regular agents and then super agents (more
> expensive) that can do much heavier lifting and absorb much larger
> knowledge bases?"*
> §1–§2 are a point-in-time audit of the shipped system (registered in
> `docs/AUDITS.md`). File:line references are as of commit `2c7fef12`.

## 0. Executive summary

Today's agent is a **deflection-hardened FAQ concierge**, not an expert: the
engine deliberately caps output at 400 tokens / 40–160 words, reads only the
last 8 messages verbatim, injects at most 5 knowledge chunks per turn, and
builds its knowledge base from a 30-page crawl that strips every hyperlink.
Those caps are the product of the platform's original use case (short public
Q&A widgets) — they are config problems, not architecture problems. The
engine (`lib/chatCore.handleChatTurn`) is sound and already carries the
plumbing a tier split needs: a tier→model map with per-model rates, a
`modelOverride` escape hatch, per-org AI-key modes, prompt caching with a
stable/volatile boundary, per-resource usage logging, and `org_features`
monthly quotas.

**Recommendation in one line:** fix four knowledge-quality defects for ALL
agents first (§2 — one of them silently suppresses the entire KB on a
fallback path), then ship the super tier as a **config-driven knob set on
the one shared engine** (§3) — not a second engine, not a fork.

## 1. What an agent is today (measured, not assumed)

### 1.1 The engine and its caps

One engine serves 1:1 agents and PulseIQ town halls: `lib/chatCore.ts`
`handleChatTurn` (~2,040 lines), called from `app/api/bots/[id]/chat/route.ts`
and `app/api/townhall/chat/route.ts`.

| Dimension | Today | Where |
|---|---|---|
| Main-reply model | Sonnet 4.6 via hardcoded `tier:'advanced'` (advanced ≡ standard in `TIER_DEFAULT_MODEL`; a comment records this was a 2026-05-16 demo bump from Haiku that was never reverted) | `chatCore.ts:1690`, `usageRates.ts:43-47` |
| Output budget | `maxTokens: 400` **and** a "HARD LIMIT" verbosity rule of 40–160 words injected every turn | `chatCore.ts:1691`, `:1356-1371` |
| Conversation memory | Last 8 messages verbatim; older turns compressed to a 2–3-sentence Haiku summary cached on the conversation | `chatCore.ts:287-384` |
| Knowledge per turn | Top-**5** chunks (hardcoded `p_limit`), ≤1,500 chars each ≈ ~2K tokens | `chatCore.ts:815` |
| User input cap | 1,200 chars | `chatCore.ts:401` |
| Per-agent model/tier knob | **None** — no `config.model`, no `config.tier`, nothing | verified absent |
| Streaming | None — single JSON response; 30s in-code call timeout | routes + `chatCore.ts:1692` |
| Auxiliary calls | All Haiku (`fast`): history summary, deflection, intent, topic classify, translation, persona/demographic extraction | `chatCore.ts` passim |

Prompt assembly is ordered and cache-aware: the stable per-agent prefix
(persona → system_prompt → deployment context → factual-accuracy →
guardrails) sits above an Anthropic `cache_control` boundary
(`chatCore.ts:800`); RAG chunks, history, and per-turn instructions are
volatile below it. This matters for the tier design: **growing the stable
prefix is nearly free after turn 1** (cache reads are 10% of input rate).

### 1.2 How the knowledge base gets built

All ingestion funnels raw text into `POST /api/bots/[id]/knowledge`, which
splits on markdown headings into ≤1,500-char chunks, embeds each via OpenAI
`text-embedding-3-small` (1536-dim, pgvector HNSW), and tags
sentiment/opponent via Haiku.

| Source | Caps | Weaknesses |
|---|---|---|
| Website deep-crawl (`deep-crawl/route.ts`) | 30 pages, 30KB/page, 10s/page, 120s total, same-host BFS | **Strips every `href`** (only each page's own URL survives as a `Source:` line); no `sitemap.xml` seeding; repeated nav/header/footer boilerplate ingested per page; no JS rendering |
| Research/SERP (`research/route.ts`) | 10 pages via DataForSEO | Same tag-stripping |
| Single URL (`fetch-url/route.ts`) | 50KB | Driven manually from `training_urls`; **no scheduled re-crawl** — KBs go stale silently |
| Manual chunks, answer-a-question loop | — | The Q&A loop is the only path with embedding-based near-dup detection (sql/135) |
| Documents (PDF/DOCX) | **Not supported** as a KB source at all (the vision `readDocument` pipeline exists but only for recordings) | |

There is **no chunk-count cap and no near-duplicate dedup** on the main
ingest path (exact-string match only), so re-crawls accumulate drift copies.

### 1.3 How retrieval works

Hybrid scoring in SQL: `4·cosine + 2·ts_rank_cd + 1·content_trgm +
1.5·title_trgm`, top-5, `confidence = rank/8.5`. Confidence < 0.05 skips
injection entirely; > 0.85 switches to "answer using ONLY this" framing.
Negative-sentiment chunks are held out and can trigger deflect/pivot. It is
single-query, single-shot: no query rewriting, no second retrieval pass, no
re-ranking.

**The July 2026 Spacy incident is the canonical failure of this whole
section**: a 326-chunk KB where only 81 chunks were substantive (the rest
nav boilerplate with hrefs stripped), top-5 retrieval that couldn't reliably
surface the one links chunk, and an empty system_prompt — so the model
invented an entire domain. The manual fix (clean re-crawl + an Official
Links Directory in the system prompt + a link-integrity guardrail) is
exactly what §2-D4 automates for every website-sourced agent.

### 1.4 What already exists to build a tier on

- `tier: fast|standard|advanced` → model map, single-sourced in
  `lib/usageRates.ts`, with a weekly model-health cron; `modelOverride`
  machinery already used by the recordings module; **Opus 4.8 is already in
  the RATES table** ($5/$25 per 1M in/out vs Sonnet's $3/$15).
- Per-org AI-key modes (`off|platform|byo`) with encrypted key storage.
- `usage_logs` per resource_id → per-agent cost rollups already work.
- `org_features` / `user_features` monthly quotas metered against
  `usage_logs` → the gating mechanism for a paid tier exists.
- The D16 resumable-browser-loop pattern (taxonomy classify, imports) → the
  shape for an uncapped crawl.

## 2. Defects to fix for ALL agents first (the quality floor)

These are bugs/design gaps that degrade today's product. Shipping a paid
"smarter" tier while these exist would monetize fixing defects — raise the
floor first.

- **D1 — Fallback retrieval silently suppresses the whole KB.** When the
  semantic RPC errors, the code falls back to `search_knowledge_chunks`,
  which returns no `confidence` column → `topConfidence` reads 0 → below
  the 0.05 floor → **all knowledge injection is skipped**, including the
  legacy free-text fallback (`chatCore.ts:826-860`, `sql/023`). Fix: return
  a rank-derived confidence from the keyword RPC (PGRST202-safe fallback in
  code), or treat missing confidence as "medium".
- **D2 — Edited chunks keep stale embeddings.** `PATCH /knowledge/[chunkId]`
  refreshes the tsvector (trigger) but never regenerates `embedding` — the
  semantic score keeps matching the OLD text forever. Fix: re-embed on
  content PATCH (blocking, one chunk, cheap).
- **D3 — Every editor save is a non-atomic KB wipe.** Save = DELETE all
  chunks then re-POST, inside a swallowed try/catch
  (`EditAgentClient.tsx:436-476`); a mid-save failure leaves the agent with
  zero/partial knowledge, and every save re-embeds the entire KB. Fix:
  diff-based upsert (content-hash), or at minimum insert-new-then-delete-old.
- **D4 — Crawl quality (the Spacy class).** In `deep-crawl`: (a) preserve
  in-body links as `[label](url)` instead of stripping them; (b) seed the
  page list from `sitemap.xml` (fall back to BFS); (c) strip repeated
  nav/header/footer blocks (frequency-based: a line appearing on >⅓ of
  pages is chrome); (d) **auto-attach at build time** a generated Official
  Links Directory to `system_prompt` and the standing link-integrity rule to
  `guardrails` for every website-sourced agent; (e) optional post-build
  link-lint (drop any URL that doesn't 200). Items (a)–(d) were already
  scoped in the open-work queue after the Spacy incident; this spec is now
  their home.

## 3. The tier design: Agents vs Super Agents

**Principle: one engine, capability by config.** A super agent is a set of
raised knobs on `chatCore` + a heavier ingestion pipeline — never a second
code path (the PulseIQ convergence taught this lesson; see CONVERGENCE.md).

Add `agents.capability text NOT NULL DEFAULT 'standard'`
(`standard | super`; CHECK constraint), plus a `capability_config` JSONB for
per-knob overrides. `chatCore` resolves knobs from a single
`CAPABILITY_DEFAULTS` table so every value below is one constant, not
scattered literals. User-facing name (owner, 2026-07-14): **"Super Agents"**
(the internal `capability` value is `super` regardless).

### 3.1 Knob table

| Knob | Standard (today) | Super | Notes |
|---|---|---|---|
| Main model | Sonnet 4.6 | **Per-agent choice** (owner, 2026-07-14): an editor dropdown writes `capability_config.model`; default is Opus 4.8, Sonnet 4.6 available for cost-sensitive super agents. Resolved through the existing `modelOverride` (rates already present). | one line per `usageRates.ts` doctrine; Phase 1 adds the dropdown + `capability_config.model` override |
| `maxTokens` | 400 | 1,200 | |
| Verbosity rule | 40–160 words | 120–400 words, and drop the "HARD LIMIT" framing | Chat UX still wants turns, not essays — length is NOT the main lever; knowledge depth is |
| RAG chunks/turn | 5 | 12 | ~4.5K tokens of KB context; volatile-block cost, see §4 |
| History window | 8 verbatim + summary | 24 verbatim + summary | |
| Input cap | 1,200 chars | 4,000 chars | super users paste documents/questions |
| Retrieval | single-query | multi-query: embed the raw query + one Haiku query-rewrite; union, re-rank by score, take top-12 | biggest quality lever after D4 |
| KB size | ~30 pages, no docs | sitemap-driven resumable crawl (300+ pages), PDF/DOCX ingestion via the existing `readDocument` vision pipeline, per-agent chunk budget (e.g. 5,000) | crawl runs as a D16a browser-driven loop (the taxonomy-classify pattern) — serverless 120s cannot do 300 pages in one shot |
| KB freshness | manual only | weekly re-crawl cron of `training_urls` with content-hash diffing (only changed pages re-chunk/re-embed) — **SHIPPED P2e**: `/api/cron/agent-recrawl` (Mon 07:00 UTC), per-page sha256 in `agent_kb_page_hashes` (sql/177), `lib/botKnowledge/recrawl.ts` | **super-tier only** (owner, 2026-07-14): auto-refresh is a paid differentiator; standard agents stay manual-refresh |
| Live data | hand-wired (`config.liveContext==='wildfire'`, MCO bot-id gate) | small adapter registry: `liveContext: [{source, params}]` resolved from a typed adapter map; wildfire + MCO become the first two adapters | super-only knob |
| Turn metering | none (rate-limit only) | `org_features` monthly quota on super-turn count | billing hook |

### 3.2 Explicitly deferred (Phase 3, gated on demand)

**In-turn tool use + streaming.** The real "heavy lifting" differentiator —
letting the model fetch an official page live, run a second KB lookup, or
query structured data mid-turn — requires a tool-use loop in `chatCore` and
**streaming responses** (multi-step turns exceed acceptable blocking
latency; today's path is a single JSON response with a 30s timeout). This
is an architectural change to the one engine both products share. Do not
build it until a real customer scenario demands it; §6 assigns it its own
model tier.

## 4. Economics (arithmetic from `lib/usageRates.ts` RATES only)

Per-turn marginal cost, main call (auxiliary Haiku calls add ~$0.001–0.002):

| | Input (approx) | Output | Cost/turn |
|---|---|---|---|
| Standard today (Sonnet, ~3–5K in mostly cached prefix, 400 out) | ~$0.01 | ~$0.006 | **~$0.02** |
| Super on Sonnet (12 chunks + 24-turn history ≈ ~10K in, 1,200 out) | ~$0.03 | ~$0.018 | **~$0.05** |
| Super on Opus 4.8 (same shape) | ~$0.05 | ~$0.03 | **~$0.08–0.10** |

So a super turn is roughly **3–5× a standard turn** — meaningful but not
prohibitive; prompt caching keeps the bigger stable prefix cheap. One-time
costs: a 300-page crawl ≈ 300 embeddings ≈ cents; weekly re-crawl with
hash-diffing keeps refresh near-zero. Pricing (owner, 2026-07-14):
**per-agent monthly fee** — a flat fee per super agent with unlimited turns.
The `org_features` quota is wired as an **abuse backstop** (a high per-org
super-turn ceiling), not a hard per-turn meter; `usage_logs` per resource
still records true cost for margin visibility.

## 5. Build plan

Global rules for every phase: TEST-first for any SQL, PGRST202 fallback for
new/changed RPC signatures, verify against a real agent KB (Spacy on prod is
the reference case — read-only), no push without the owner's word.

- **Phase 0 — quality floor (all agents).** D1–D4 from §2. No schema
  change except none; D4(d) writes to existing `system_prompt`/`guardrails`
  columns. Verification: re-run the Spacy-style link-integrity check
  (`scripts/_spacy_kb_verify.mts` pattern) against a freshly crawled test
  agent; D1 unit test = semantic RPC error → knowledge still injected.
- **Phase 1 — tier split MVP. ✅ SHIPPED 2026-07-14.** `agents.capability`
  (`standard|super`, CHECK) + `capability_config` jsonb (sql/175, TEST-applied)
  → `CAPABILITY_DEFAULTS`/`resolveCapability` in `lib/agentCapability.ts`, wired
  into chatCore (model/maxTokens/verbosity/chunks/history/input knobs; standard
  values are byte-identical to the old hardcoded ones). Editor toggle + a
  per-agent super-model dropdown (`capability_config.model`, Opus 4.8 default /
  Sonnet 4.6). Abuse-backstop quota = `assertSuperTurnAllowed` in
  `lib/featureFlags` (default unlimited; blocks only when an `org_features`
  `super_agent_turn` ceiling is set); super turns log as `event_type='chat_super'`
  so their cost is visible in `/admin/usage`. Verified: `agentCapability`/
  `superTurnBackstop` unit tests + live-TEST `scripts/_verify_super_agent.mts`
  (CHECK constraint, round-trip, twin knobs). Per §7 owner decisions.
- **Phase 2 — super KB + retrieval.** Sitemap-seeded resumable crawl
  (browser-driven loop, D16a), `[label](url)` preservation + boilerplate
  strip (shared with Phase 0 D4), PDF/DOCX ingestion, chunk budget +
  near-dup dedup (reuse sql/135's embedding match), weekly re-crawl cron,
  multi-query retrieval, live-context adapter registry. Verification: crawl
  a real 100+-page site on TEST; retrieval A/B on a fixed question set.
- **Phase 3 — tool loop + streaming (GATED, not scheduled).** Owner
  greenlights only on a concrete customer need.

## 6. Who builds it — model-tier recommendation

- **Phase 0–2: Opus**, executed as briefs the way the perf-review §7 queue
  ran (that pattern shipped 7 briefs in 2 days with zero rework). Every item
  above is well-specified, follows an existing in-repo pattern (D16a loop,
  config knobs, RPC tweak with fallback, cron sweep), and has a mechanical
  verification bar. Nothing in Phases 0–2 requires novel architecture.
- **Phase 3: Fable** — the tool-use loop + streaming rework touches the
  single shared engine both product lines depend on, changes its latency
  and failure model, and involves real design tradeoffs (tool budget per
  turn, partial-response UX, guardrail interaction with streamed output).
  That is the one piece worth Fable budget — when it's greenlit, not before.
- This spec itself was the Fable deliverable; no further Fable session is
  needed to start Phase 0.

## 7. Owner decisions (resolved 2026-07-14)

1. **User-facing tier name → "Super Agents"** (internal `capability='super'`).
2. **Super-tier model → per-agent choice** — an editor dropdown writing
   `capability_config.model`; default Opus 4.8, Sonnet 4.6 available.
3. **Pricing → per-agent monthly flat fee**, unlimited turns; the
   `org_features` quota is an abuse backstop only (not a per-turn meter).
4. **Weekly KB re-crawl → super-tier only** (paid differentiator; standard
   agents stay manual-refresh).

These four unblock **Phase 1** (tier-split MVP) and **Phase 2** (super KB +
retrieval), both on Opus per §6.

**Still open (does NOT block Phases 1–2):**

5. **Phase 3 gate** — the in-turn tool-loop + streaming build stays deferred
   until a concrete customer scenario demands live fetch / mid-turn lookup
   (§3.2). Revisit when such a need is named; it's the one Fable-tier item.

## Cross-references

`docs/BOTS.md` (module spec — §6 chat, §8 RAG), `docs/CONVERGENCE.md` (one-
engine doctrine), `docs/ARCHITECTURE.md` D16 (no-queue substitutes),
`docs/USAGE_ACCOUNTING.md` (rates/metering), `docs/AUDITS.md` (this review's
registry row). The Spacy incident post-mortem lives in the 2026-W29 devlog
and the `reference_agent_kb_link_hallucination` memory.
