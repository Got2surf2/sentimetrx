# HELP_AGENT.md — In-product AI help agent (design & scope)

**Status:** MVP BUILT (local, unpushed) 2026-07-18. All §12 decisions signed off
2026-07-16; all seven MVP items in §10 implemented and verified against the TEST
project. Not yet deployed — the Help agent must be seeded on prod and sql/184
migrated on push (see §13). Owner browser-QC of the widget is the remaining check.

**One-liner:** an always-available assistant that answers "how do I…" and
"what is…" questions about Sentimetrx itself — grounded strictly in curated,
user-facing help content — so users can navigate a functionally rich, complex
product without a human.

**Naming & icon (owner, 2026-07-16; icon updated 2026-07-24):** the widget users
see is labelled **Help** and wears a **compass icon (🧭)** — a wayfinding cue that
fits Sherpa's guide-you-there role *and* stays on the Datanautix nautical brand.
(It first shipped as a lifesaver / life-ring 🛟; the owner switched it to a compass
on 2026-07-24 as the better metaphor for "find your way around.") The assistant's
persona name is **Sherpa** (chosen over "Guru": Sherpa fits the navigation metaphor
and stays humble, matching the honest "here's where to go / I'm not certain"
behaviour the anti-hallucination design depends on). So: **label = Help, persona =
Sherpa, icon = 🧭.**

**The two assistants are a clean, symmetric split (owner, 2026-07-16).** Sentimetrx
has two AI helpers that live in different places and refer to each other:
- **Ask Ana** — embedded *inside a dataset* (Advanced Analytics). Answers about the
  user's **data** ("what did respondents say about parking?").
- **Help / Sherpa (🧭)** — a **global** launcher on every page. Answers about **using
  the product** ("how do I export a deck?").

The referral is **bidirectional**: ask Help a *data* question → it points you to
**Ask Ana**; ask Ask Ana a *how-to / navigation* question → it points you to
**Help**. Each stays strictly in its lane. (Implementation note: the Help side is
the system-prompt scope in §7; the Ask-Ana side needs a small how-to/navigation
intent detector that emits the "open Help (🧭)" redirect — a minor addition to the
Ask-Ana path, tracked in §10.)

---

## 1. Goal & non-goals

**Goal (MVP):** a global help widget on every authenticated page that answers
product questions with grounded, cited answers, aware of which screen the user
is on, and honest when it doesn't know.

**Non-goals (explicitly out of MVP):**
- Not a replacement for human support / onboarding calls.
- Not a customer-facing brand agent (that's the existing `/b/[slug]` agents).
- Not answering about the user's *data* ("what did my respondents say?") — that's
  Ask-Ana / TextMine. The help agent answers about *the product*.
- No write actions in MVP (no "change this setting for me"). Deep-link navigation
  is a v2 stretch, not MVP.

**The #1 design constraint (non-negotiable):** a help agent that *confidently
invents a feature that does not exist* is worse than no help agent. Every
decision below is biased toward grounding and honest "I'm not sure" over
coverage. See §7.

---

## 2. What we reuse (≈90% of the plumbing already exists)

All verified against current code. The help agent is **an internal agent running
on the existing chat engine** — not a new engine.

| Capability | Reuse | Notes |
|---|---|---|
| Chat engine | `lib/chatCore.ts` → `handleChatTurn(ctx, body)` (line 216) | `ctx.agent` is the **structural** `ChatAgent` interface (line 61) — "the DB `agents` row arrives as `any` and structurally satisfies this." The help agent is just another agent record. |
| Tool loop | `lib/agentTools.ts` → `buildAgentTools`, `makeToolExecutor`, `runAgentToolLoop` (`MAX_TOOL_ROUNDS = 3`) | Gives an *active* `search_knowledge` re-query tool — **but only for `super`-tier agents** (the `toolLoop` knob is super-only). MVP runs `standard` tier, so the tool loop is OFF and grounding comes from always-on RAG injection (row below). `fetch_page` also only appears with `training_urls` hosts — OFF for MVP (§7). |
| KB ingest | `lib/botKnowledge/ingest.ts` → `ingestKnowledgeText(service, bot, text, opts)`; `chunkText`, `extractDocumentText`, `documentVision`, `recrawlAgentPages`, `crawlQueue` | Chunks land in `agent_knowledge_chunks`, scoped by `bot_id`. Retrieval RPCs: `search_knowledge_semantic` (semantic + confidence) + `search_knowledge_chunks` (keyword fallback), both keyed by `p_bot_id`; near-dup via `match_agent_knowledge_embedding`. |
| Retrieval (always-on) | `handleChatTurn`'s `runRetrieval` (line 888) | Embed → semantic RPC → keyword fallback → confidence normalization, injected into the system prompt **every turn regardless of tier**. This is what grounds a `standard` help agent — no tool loop required. |
| Widget | `components/ui/ChatBot.tsx` (~1011 lines) | Streaming SSE chat UI, POSTs to `config.apiEndpoint`. Currently **bot-scoped** (several effects regex the `/api/bots/[id]/chat` URL); we extract a trimmed global variant (§6). |
| Context-aware UI cards | `lib/uiHints.ts` (411 lines) + `/api/bots/[id]/ui-hints` | Seed for v2 "take me there". **Reuse the *pattern* only** — the decoupled sibling route + injected-classifier + validated-JSON extractor. The hint *types and prompt are MCO-airport-specific* and get replaced. Sibling route keeps chat latency untouched (`docs/MCO_AGENT.md` §15). |
| Anti-hallucination pattern | Official-Links-Directory + link-integrity guardrail (Spacy fix, `reference_agent_kb_link_hallucination`) | We adapt this into a **feature-integrity** guardrail (§7). |

**What is genuinely NEW:** (1) a curated user-facing help KB, (2) a global widget
mount, (3) a page-context channel, (4) platform-billed cost path, (5) the
feature-integrity guardrail. Everything else is configuration + reuse.

---

## 3. The help agent record — one shared, platform-owned agent

**Decision:** create **one** internal `agents` row in a platform/internal org,
not a per-customer agent. Rationale:

- The product is the same for everyone; the KB is product-wide, not per-tenant.
  Retrieval is scoped by `p_bot_id`, so a single fixed help-agent id gives every
  user the same curated corpus.
- Per-org context that *does* vary (which features a customer has enabled, which
  screen they're on) is injected **per turn** as context, not baked into the KB
  (§5).
- One KB to author and maintain, one agent to tune.

Implications:
- The help agent lives outside any customer's tenant, so **its LLM cost is
  platform-borne** and it does NOT touch a customer's BYOK key or usage quota. It
  uses the platform key. This resolves the owner's "platform-keyed LLM
  cost/question" open item: **the platform eats it; the customer is never billed
  for asking for help.** (Cost control lives in per-IP/per-user rate limits on the
  help route, §8.)
- **The AI-off gate keys on the *agent's* org, not the customer's.** `handleChatTurn`
  returns an "unavailable" reply when the agent's `org.ai_key_mode === 'off'`
  (chatCore:332). Since the help agent sits in the internal org, we set that org to
  `ai_key_mode = 'platform'` — and a customer having their *own* AI turned off does
  **not** disable help. Help works everywhere.
- **Tier = `standard` for MVP.** There is no `model` column — model lives in
  `capability_config.model`; tier is the `capability` enum (`standard` | `super`).
  Standard (Sonnet, RAG injection on) is cheap and sufficient; it also sidesteps
  the super-only `assertSuperTurnAllowed` quota gate entirely. Promote to `super`
  only if v2 wants the active `search_knowledge`/`fetch_page` tool loop.

---

## 4. Knowledge base strategy — **the key decision**

The agent must KNOW the product. Three options:

| Option | What | Pro | Con |
|---|---|---|---|
| **A. Auto-ingest specs** | Point the crawler/`documentText` at `docs/*.md` (SPEC, ANALYTICS, BOTS…) | Zero authoring; always "current" | Specs are **engineer-facing** — leak internals, table names (`townhall_*`, `agent_knowledge_chunks`), unshipped/`<TBD>` items, and jargon. High hallucination + confusion risk. **Rejected as primary.** |
| **B. Authored help articles** | Hand-write ~15–25 user-facing articles keyed to top tasks | Tight grounding, right voice, no leaks | Authoring effort; must be maintained as features ship |
| **C. Hybrid** | Authored articles as the corpus **+** a curated allow-list of user-safe doc sections | Coverage + control | More moving parts |

**Recommendation: B for MVP, evolve toward C.** Start with authored articles only
— they are the entire reason grounding is tractable here. Add curated doc
sections later *only* if we find real coverage gaps (measured via §9 feedback),
never by bulk-ingesting `docs/`.

**MVP article set (draft — one KB chunk-source each, ~150–400 words, task-shaped):**
1. What is Sentimetrx? (surveys, agents, PulseIQ, Town Hall, TextMine, Statistics)
2. How do I create a survey? / share it?
3. How do I create an agent? What's a Super Agent?
4. How do I filter results in TextMine?
5. What are themes / entities / dimensions? How do I edit them (Schema tab)?
6. How do I read the Statistics tab? (charts, key drivers, Likert)
7. How do I export a report / deck?
8. What is PulseIQ vs Town Hall?
9. How do I add data sources (Google reviews, Reddit, Substack)?
10. How do I invite a teammate / manage my org?
11. Billing & usage — where do I see what I've used?
12. Privacy & data — where does my data live? (link to /privacy)
… plus a "closest match / contact support" fallback article.

Articles are authored as Markdown, ingested via the existing `ingest.ts` path
(one KB source per article), so re-ingest on edit is a solved problem. Author to
the **UI labels**, not slugs (Schema tab, not `/settings`).

---

## 5. Page-context awareness

**Why it's cheap here:** `components/nav/TopNav.tsx` is rendered per-page and
already receives `orgName`, `features` (surveys/analyze/campaigns/bots/…), and
`currentPage` ('analytics' | 'edit' | 'bots' | …). Mounting the widget in TopNav
(§6) means page-context is **already in scope** — no new plumbing to know where
the user is.

**Model:** on each turn the widget sends a small context block; the help route
injects it into the system prompt as a neutral context section:

```
body.pageContext = {
  currentPage: 'analytics',        // TopNav's currentPage
  route: '/analyze/abc/statistics',// pathname (tab-level)
  features: { analyze: true, surveys: true, … } // enabled features
}
```

Injected as: *"The user is currently on the Statistics tab of a dataset. Their
org has these features enabled: surveys, analyze. Prefer answers relevant to this
screen; do not describe features their org does not have."* This makes "how do I
do this?" answer for the screen they're on, and prevents recommending a disabled
feature. It is also the exact seed uiHints needs for v2 deep-linking.

---

## 6. Widget placement & route

**Mount:** inside `components/nav/TopNav.tsx` as a floating "?" launcher (bottom-
right FAB + slide-over panel). Reasons:
- TopNav renders on essentially every authenticated page → "global" for free.
- It already holds org/features/currentPage → page-context for free (§5).
- **Not** root layout: `app/layout.tsx` also wraps the public respondent widgets
  (`/s`, `/b`, `/pi`), login, and share surfaces — the help agent must not appear
  there. (A few full-screen analyze tabs render their own chrome without TopNav;
  acceptable gap for MVP, revisit if needed.)

**Widget component:** extract a trimmed `HelpWidget.tsx` from `ChatBot.tsx`
patterns (streaming reader, message list, 16px input per the iOS-zoom rule in
CLAUDE.md). Do **not** fork all 1011 lines — lift only the stream-consume +
message-render core. Guard behind auth (only signed-in users).

**Route:** new **`/api/help/chat`** — a thin, dedicated handler, NOT a reuse of
`/api/bots/[id]/chat`. This is **required, not just tidy**: the existing bots chat
route is deliberately **public + unauthenticated + CORS-`*`** (it serves the
embeddable respondent widgets) and carries an explicit security note *against*
adding cookie auth. The help widget is the opposite — signed-in only, needs the
user's session for page/org context, must never be world-callable. So it gets its
own authed route. It:
1. Loads the fixed platform help-agent record (structural `ChatAgent`).
2. Applies a **per-user + per-IP rate limit** (`lib/rateLimit.ts`) — the only
   cost control, since there's no customer quota gate.
3. Injects `pageContext` (§5) + the grounding system rules (§7).
4. Calls `handleChatTurn({ agent, service, ip, emit }, body)` — verbatim reuse.
5. Streams back via the same SSE shape the widget already understands.

Keeping it separate keeps the help agent off customer quota/BYOK and keeps the
customer chat route unpolluted.

---

## 7. Grounding & anti-hallucination (the load-bearing section)

Layered defenses, cheapest first:

1. **Curated KB, not specs (§4).** The single biggest lever — the model can only
   retrieve things that are true and shippable.
2. **Tool loop OFF in MVP (standard tier).** Grounding is the always-on RAG
   injection, not an active tool — the model answers from retrieved chunks in the
   prompt and cannot wander. No `fetch_page` (no `training_urls`) → no arbitrary/
   guessed URLs. (v2: promote to `super` to enable active `search_knowledge`
   re-query, and optionally allow-list exactly `docs.sentimetrx.ai` /
   `www.sentimetrx.ai` for `fetch_page`, reusing the host-allowlist in
   `agentTools.ts`.)
3. **System-prompt grounding rules (hard):**
   - Only describe features that appear in retrieved help content.
   - If unsure a feature exists: say so plainly and offer the closest real thing +
     a link to the relevant help article or support — never assert.
   - Never invent UI labels, menu paths, prices, URLs, or emails (mirrors CLAUDE.md
     content rules).
   - Refer to features by their **UI labels**, not internal slugs/table names.
4. **Feature-integrity guardrail (adapted from the Spacy link fix,
   `reference_agent_kb_link_hallucination`).** Post-generation check: any product
   noun/link the reply asserts must trace to a KB chunk or an allow-listed
   canonical feature list; unverifiable claims get softened to "I'm not certain
   that exists." Reuse the guardrail scaffolding rather than build new.
5. **Honest fallback path.** When retrieval confidence is low, the answer is the
   "closest doc + contact support" article, not a confident guess.

Note: the KB negative-sentiment holdout in `runRetrieval`/`search_knowledge`
(built for brand agents) is a no-op here because help articles carry no negative
sentiment tags — leave it, it does nothing harmful.

---

## 8. Cost, rate-limiting, security

- **Cost:** platform-keyed, standard-tier model, RAG on, tools minimal. Typical
  turn = 1 embed + 1 model call. Bounded by MAX_TOOL_ROUNDS=3 only if tools are
  enabled (they're off in MVP). Standard tier = **Sonnet 4.6** ($3/1M in · $15/1M
  out); a turn is ~3K input (grounding prompt + 5 RAG chunks + short history) +
  ~250 output tokens, plus one small question embedding → **≈ 1–2¢ per question**
  (~$10–20 / 1,000). Platform-paid; the customer is never billed. If volume grows,
  prompt-cache the fixed grounding prefix and sharpen articles flagged by 👎.
- **Rate limit:** per-authenticated-user and per-IP on `/api/help/chat`
  (`lib/rateLimit.ts`) — the sole abuse/cost guard, since there's no per-org quota.
- **Auth:** widget + route require a signed-in session. The help agent is internal
  but exposes no tenant data (KB is product docs), so cross-tenant leakage risk is
  low — but the route must still not accept a customer `agent_id` or echo any
  org-scoped data. It only ever loads the one fixed help-agent id server-side.
- **Multi-tenancy invariant:** the help agent's KB table rows (`agent_knowledge_chunks`
  under the internal org) already sit behind RLS; the route uses service-role with
  the **fixed internal bot_id**, never a user-supplied id — no `.eq('id', userInput)`
  surface, so no cross-tenant vector (per CLAUDE.md service-role rule).

---

## 9. Feedback loop (build in from MVP, cheap)

Thumbs up/down on each answer, stored with the (redacted) question + whether
retrieval was confident. This is the KB-gap detector: repeated thumbs-down or
low-confidence questions are the authoring backlog for the next article. Without
it we're guessing at coverage. One small table + one endpoint.

---

## 10. MVP vs v2

**MVP — BUILT 2026-07-18 (local, verified on TEST):**
- [x] One platform help-agent `agents` record + curated help KB (21 articles) —
      `lib/helpAgent.ts` + `scripts/seed-help-agent.mts` (seeded TEST, 98 chunks)
- [x] `/api/help/chat` route reusing `handleChatTurn` (§6) — authed, same-origin
- [x] `HelpWidget.tsx` global 🧭 launcher mounted in TopNav (§6)
- [x] Page-context injection (§5) — `formatHelpPageContext` (route + section + features)
- [x] Grounding rules (seeded system prompt) + feature-integrity scrub
      (`scrubHelpReply`) + honest fallback (§7) — verified: fabrication bait declined
- [x] Per-user/IP rate limit (§8)
- [x] Thumbs feedback (§9) — `sql/184 help_feedback` + `/api/help/feedback` + widget UI
- [x] **Ask-Ana → Help redirect** — prompt-scope on `app/api/ask-ana`: a product
      how-to question points the user to the 🧭 Help button instead of answering from
      data. The reverse (Help → Ask-Ana) is the Help system-prompt scope (§7).
      Symmetric split complete.

**Post-MVP follow-ups — SHIPPED 2026-07-19 (owner asks):**
- ✅ **In-app deep-linking ("take me there", lightweight).** Sherpa links to a
  **curated navigation map** of top-level destinations (`HELP_NAV_MAP` in
  `lib/helpAgent.ts`) as markdown links, e.g. `[Advanced Analytics](/analyze)`.
  The widget renders them clickable and navigates **client-side** (Next router).
  Feature-integrity: `scrubHelpReply` strips any in-app link outside the allow-list
  (blocks invented routes / guessed ids), keeping external-link + email scrubbing.
  This is the pragmatic version of the uiHints "take me there" below — no action
  cards yet, just grounded links.
- ✅ **Conversation continuity across navigation.** The chat + open state persist
  in `sessionStorage` (`help_widget_state_v1`), so navigating between pages (which
  remounts TopNav and would otherwise reset the widget) keeps Sherpa's conversation
  intact — following a link no longer loses context.

**v2 (still deferred):**
- "Take me there" **action cards** — uiHints returns a deep-link/CTA card the
  widget renders; optional element-highlight. Reuses `lib/uiHints.ts` sibling-route
  pattern so chat latency is untouched. (Superset of the shipped link version above.)
- Proactive nudges (first-visit to a complex tab, or on silence) — reuse the
  `trigger: 'silence'` fast-path already in `handleChatTurn` (line 239).
- Curated doc-section ingest (Option C) driven by measured gaps (§9).
- Answer shaping per enabled feature set (hide disabled-feature steps).

---

## 11. Effort estimate

Code is small because it's mostly reuse. The long pole is **authoring the KB**,
not engineering.

| Piece | Est. |
|---|---|
| Seed the platform help agent record + KB ingest wiring | ~0.5 day |
| Author ~15–25 help articles | ~1–1.5 days (owner or Claude-drafted, owner-reviewed) |
| `/api/help/chat` route (thin reuse) | ~0.5 day |
| `HelpWidget.tsx` + TopNav mount + page-context | ~1 day |
| Grounding rules + feature-integrity guardrail | ~0.5 day |
| Thumbs feedback table + endpoint | ~0.25 day |
| **MVP total** | **~3–4 focused days** (KB authoring dominates) |

---

## 12. Decisions of record — **ALL SIGNED OFF 2026-07-16** (owner)

Every decision landed on the recommended default. These are settled; build to them.

1. ✅ **KB strategy: authored articles only for MVP** — evolve to hybrid only via
   measured gaps (§9). Auto-ingest specs rejected (leaks internals).
2. ✅ **Article authoring: Claude drafts the ~15–25 articles from the specs +
   real UI labels; owner reviews/edits before ingest.**
3. ✅ **Tier / tools: `standard` tier, tool loop OFF in MVP** — grounded by
   always-on RAG injection. Promote to `super` (active `search_knowledge` +
   allow-listed `fetch_page`) only if MVP recall proves too static (v2).
4. ✅ **Scope: product how-to only** — data questions ("what did respondents say")
   get a one-line redirect to Ask-Ana / TextMine. No straddling.
5. ✅ **Mount gap accepted** — mount in TopNav; the few full-screen tabs without
   TopNav have no widget in MVP; revisit only if it matters.
6. ✅ **v2 "take me there" deferred** — ship answer-only MVP; revisit the uiHints
   action layer after MVP proves useful.

**Build order (unblocked):** seed the platform help-agent record + KB wiring →
Claude drafts articles → owner reviews → ingest → `/api/help/chat` (authed) →
`HelpWidget` extracted from `ChatBot.tsx`, mounted in `TopNav`, page-context wired
→ grounding rules + feature-integrity guardrail + honest fallback → thumbs
feedback. ~3–4 focused days; KB authoring is the long pole.

---

## 13. Go-live steps (on push / deploy)

Everything is verified on TEST. To ship to production:

1. **Migrate the feedback table:** `npm run migrate sql/184_help_feedback.sql`
   (records the ledger + refreshes `docs/db/schema.sql` — commit the refreshed
   snapshot with the push).
2. **Seed the prod Help agent + KB:**
   `node --conditions=react-server --import tsx scripts/seed-help-agent.mts --prod`
   (idempotent; creates the `help-guide` agent in the prod admin org and ingests
   the 21 articles). Re-run any time the articles or grounding prompt change.
3. **Confirm the home org's AI is on** — the Help agent's org must be `ai_key_mode`
   `platform` (not `off`), or every turn returns "unavailable" (chatCore gate).
4. **Post-deploy:** re-run `npm run test:rls` + `npm run test:egress` (new
   `help_feedback` table) and browser-QC the 🧭 widget on `www.sentimetrx.ai`.

Note: the Help agent is a **data-only seed**, not code — a deploy alone won't
create it; step 2 must run against prod once (and again whenever the KB changes).
