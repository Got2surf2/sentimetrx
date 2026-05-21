# CONVERGENCE.md

**Status:** Decided (architecture), Pending (implementation)
**Decided:** 2026-05-20
**Revised:** 2026-05-20 — model sharpened from `cohort: true|false` flag on agent to a separate `town_halls` concept that wraps a collection of conversations.
**Owner:** Sanjay
**Sarina launch:** Live as of 2026-05-20 — convergence window opens now
**First implementation window:** 2026-05-21 → pre-June-Vindman-town-hall

Architectural decision record for converging Agents (bots) and PulseIQ (town_hall) onto a single conversational substrate. This doc supersedes any prior implicit "we'll keep them separate" assumption.

---

## 1. Context

Today Sentimetrx ships two parallel implementations of conversational AI:

- **Agents** (`bots` table, `/api/bots/[id]/chat`, widget at `/b/[guid]`) — participant-led 1:1 chat. Has KB / RAG, focuses, guardrails, deflection, persona extraction, silence-triggered probe, info-only message skip.
- **PulseIQ** (`town_hall_*` tables, `/api/townhall/[guid]/chat`, widget at `/th/[guid]`) — cohort agent. Has themes, dynamic turn-budgeting, multi-language switch detection, standby mode, organic theme aggregation across participants, cohort dashboard.

The two systems were built at different times for what felt like different use cases. They have drifted into parallel implementations of overlapping capabilities. Two investigation streams (see `[[pulseiq-agents-convergence]]` memory, 2026-05-20) confirmed the overlap is substantial:

- Both share `lib/ai.ts`, `lib/rateLimit.ts`, `lib/contentGuard.ts`, `lib/guardrails.ts`, `lib/usageLog.ts`, Supabase clients.
- Both perform: content safety check, sentiment scoring, deflection (regex + AI), turn insert, usage logging — using the same primitives or trivially-different call shapes.
- Both want the same analysis output: sentiment per turn, topic coverage, persona signals, content flags.
- Schema overlap (`bot_conversation_turns` vs `townhall_turns`) is structural, not semantic — the columns differ in shape, not intent.

The only things genuinely unique to PulseIQ are (a) cross-participant theme discovery, (b) coverage balancing across the cohort when picking the next probe topic, and (c) the live cohort dashboard. **These are layered features over a collection of conversations**, not properties of the agent itself.

## 2. Decision

**A chat is one conversation. A town hall is a collection of conversations on the same agent, plus an analysis layer over the collection, plus a framework for injecting topics discovered by that analysis back into the collection.**

Three concepts, three tables, one set of conversation mechanics:

1. **Agent** — voice, knowledge base, guardrails, topics, deflection rules, language config. Nothing else. An agent has no notion of whether it's running in 1:1 or cohort mode; it just answers turns. *(Today's `bots` table.)*
2. **Conversation** — one participant talking to an agent over a session. Has turns. Lives independently of any town hall. *(Today this is `bot_conversation_turns` rows keyed by `session_id`; in PulseIQ it's `townhall_turns` rows keyed by `(session_id, participant_id)`.)*
3. **Town hall** — a named collection of conversations on the same agent, plus cohort config (coverage targets, organic-theme on/off), plus an analysis layer (theme aggregation cron, dashboard view). A conversation can belong to zero or one town halls. *(Today this is `townhall_sessions` + `townhall_themes`.)*

Under this model:
- The agent stays clean. No cohort flag, no cohort config, no mode switch. Voice/KB/guardrails/topics — that's it.
- The same agent can serve 1:1 chats AND be the agent for one or more town halls, simultaneously. Sarina serves individual Vindman supporters via the postcard QR; in June, a `town_hall` row points at Sarina and opens her up to cohort analysis for the town hall participants.
- An agent can have multiple town halls over its lifetime (March town hall, September town hall) — they're independent records, each with their own start/end times, cohort config, and aggregated themes.
- A conversation that wasn't originally part of a town hall can be added to one retroactively (e.g. analyze Sarina's individual chats from May as a cohort post-hoc).

The acceptance test for the convergence is the **Vindman client journey**:

- **Now (live as of 2026-05-20)**: Sarina (1:1 agent) is live for Vindman supporters via postcard QR + web widget. No town hall record exists yet; she's just an agent answering individual conversations.
- **June**: a `town_hall` row is created pointing at Sarina. Vindman supporters joining through the town hall surface have their conversations registered to that town hall. Theme aggregation runs across those conversations. Coverage-balanced topic injection feeds discovered themes back into the town hall's topic pool. Cohort dashboard shows the live view to the campaign team.

This is not a hypothetical. The customer has explicitly said Sarina is the foundation for the June town hall. The convergence isn't "what if we wanted to share"; it's "the customer is asking for one agent that runs as both a chat and a town hall, and we either build that or we don't."

If the convergence is done right, the June town hall reuses Sarina's config verbatim — voice, KB, guardrails, topics — and adds a `town_hall` row over the top. Every Sarina config refinement between now and June flows automatically. If it's not done, the June town hall is a manual copy-paste of Sarina's config into PulseIQ's parallel schema, with the inevitable drift that creates.

## 3. Architecture

### 3.1 The agent

```
agent = {
  id, org_id, slug, name,
  voice / personality,
  knowledge_base (text or RAG-backed),
  topics (array),
  guardrails (array),
  deflection_rules,
  language_config
}
```

Stateless across conversations. Knows nothing about cohorts. Just answers turns. Replaces today's `bots` table.

### 3.2 The conversation

One unified table replaces both `bot_conversation_turns` and `townhall_turns`:

```sql
conversations (
  id uuid primary key,
  org_id uuid not null,
  agent_id uuid not null references agents(id),
  session_id text not null,              -- public conversation identifier
  participant_id text null,              -- optional; identifies a participant within a town hall
  language text default 'en',
  started_at timestamptz default now(),
  ended_at timestamptz null,
  unique (agent_id, session_id, participant_id)
)

conversation_turns (
  id uuid primary key,
  org_id uuid not null,                  -- multi-tenancy invariant (RLS enforced)
  conversation_id uuid not null references conversations(id),
  turn_number int not null,
  role text not null check (role in ('assistant', 'user')),
  content text not null,
  content_en text null,                  -- english translation when source is non-en
  language text default 'en',
  source text not null,                  -- 'normal', 'silence_probe', 'standby', 'deflect',
                                         -- 'language_switch', 'guide', 'clarifier', 'detected_theme'
  topic_slug text null,                  -- which topic/focus/theme this turn addressed
  sentiment text null,
  sentiment_score numeric null,
  content_flags text[] default '{}',     -- 'silence_probe', 'focus:slug', 'intent:label', etc.
  ai_thinking text null,                 -- reasoning trace, optional
  created_at timestamptz default now()
)
```

`participant_id NULL` = a standalone 1:1 chat (today's bot session). `participant_id` populated = a participant in a town hall (today's PulseIQ behavior). The conversation table itself doesn't care which one — that distinction only matters when a town hall record points at the conversation.

The `source` enum is the union of today's two vocabularies. `silence_probe` (bots-side) and `standby` (PulseIQ-side) stay distinct because they encode different *policies* (template nudge vs. await new injected topic), even though they share the same engagement-signal detection.

### 3.3 The town hall

```sql
town_halls (
  id uuid primary key,
  org_id uuid not null,
  agent_id uuid not null references agents(id),
  slug text not null unique,             -- public URL identifier (replaces townhall_sessions.guid)
  name text not null,
  status text default 'active',          -- 'active', 'paused', 'ended'
  started_at timestamptz default now(),
  ended_at timestamptz null,
  cohort_config jsonb default '{}'       -- coverage targets, organic-theme on/off, etc.
)

town_hall_conversations (
  town_hall_id uuid not null references town_halls(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  primary key (town_hall_id, conversation_id)
)

town_hall_topics (
  id uuid primary key,
  town_hall_id uuid not null references town_halls(id) on delete cascade,
  topic_slug text not null,
  label text not null,
  source text not null,                  -- 'seed' (from agent.topics, copied at start)
                                         -- or 'discovered' (organic, injected by cohort cron)
  response_target int null,              -- coverage target for balancing
  response_count int default 0,
  discovered_at timestamptz null,
  unique (town_hall_id, topic_slug)
)
```

A town hall is a named, time-bounded grouping. It points at one agent. It collects conversations via the join table. It maintains its own topic pool — seeded from the agent's topics at start, expanded by the discovery cron as new themes emerge from the participants.

### 3.4 Topic injection — write-back, not interrupt

The "framework to inject new topics into the conversation" works as **write-back**:

1. Cohort aggregation cron runs periodically. It reads `conversation_turns` for the conversations in a town hall, samples recent user content, calls AI to identify themes, dedupes.
2. New themes are inserted as `town_hall_topics` rows with `source = 'discovered'`.
3. When the chat route picks a probe topic for a participant's next turn, it reads from `town_hall_topics` (if the conversation is part of a town hall) in addition to the agent's seed topics. Discovered topics enter the rotation naturally.
4. Conversations not part of a town hall see only the agent's topics — no injection.

This preserves the chat primitive's autonomy. The cohort layer doesn't hijack in-flight conversations to force a transition; it just enriches the topic pool that the conversation engine draws from. Cleaner separation, simpler reasoning about what each layer does.

(PulseIQ today does the more invasive variant — actively interrupting to push a transition mid-conversation. We're choosing not to carry that forward. If we discover we need it, we can layer it on top of write-back later; the inverse is harder.)

### 3.5 Layered features

| Feature | Today lives in | After convergence |
|---|---|---|
| Content safety | `lib/contentGuard.ts` | Unchanged, shared |
| Sentiment scoring | `lib/contentGuard.ts` | Unchanged, shared |
| Persona extraction | `lib/personaExtractor.ts` | Wired into every conversation (PulseIQ participants get it for free) |
| RAG / KB | bots route inline | Lifted to `lib/agentRag.ts`, called for every conversation |
| Deflection | duplicated | Extracted to `lib/deflectionRouter.ts` |
| Info-only message detection | `lib/botProbeGuards.ts` | Generalized; every conversation uses it |
| Engagement signals (silence / trajectory / curt / consecutive-skip) | partially in bots, mostly inline in PulseIQ | Extracted to `lib/engagementSignals.ts`; every conversation runs them; policy (probe vs. standby) depends on whether the conversation is part of a town hall and whether discovered topics are available |
| Language-switch detection | PulseIQ route inline | Extracted to `lib/languageSwitch.ts`; every conversation uses it |
| Topic/focus tagging on turns | `lib/focusClassifier.ts` (bots, assistant-side) + `matchResponseToTopic` (PulseIQ, user-side, inline + AI follow-up) | Stay separate through Phase 2 — see `2026-W21-devlog` Phase 2.5 entry. Real convergence happens after the unified chat handler exists and the NOWOCATS-spec'd user-side bot tagger ships. |
| Cohort theme aggregation | `lib/townhallThemeDetection.ts` + cron | Renamed `lib/cohortThemeAggregator.ts`; reads conversations via the `town_halls` join; writes to `town_hall_topics` |
| Coverage balancing | inline in PulseIQ chat route | Lifted to `pickNextTopic(agent, conversationState, townHallContext?)` — when `townHallContext` is null it returns from `agent.topics`; when present it factors in `town_hall_topics` + response counts |
| Dashboard view | `/admin/townhall/...` pages | Rebuilt to read `town_halls + town_hall_topics + conversations + conversation_turns` |

### 3.6 Analysis surface

Today analysis is fragmented across three places:

- `/analyze/[id]` — for survey/dataset rows
- per-bot session viewer + per-bot insights
- PulseIQ-specific dashboards + theme view

After convergence, conversational analysis is **two surfaces** that share the same underlying data model:

- `/agents/[id]/analyze` — sentiment distribution, topic coverage, persona breakdown across all conversations on the agent. Works for any agent.
- `/town-halls/[id]` — same agent-level analysis filtered to the town hall's conversations, plus cohort-only views: organic theme discovery, coverage progress, live participant counts.

Dataset/survey analysis is a separate domain and stays where it is.

## 4. Sequencing plan

The convergence is greenfield for PulseIQ — no live customers there. Sarina is live, so the bots side carries real session data that must be preserved through Phase 3.

| Phase | Window | Work | Risk gate |
|---|---|---|---|
| 0. Decide + write this doc | 2026-05-20 | This document (revised same day) | DONE |
| 1. Sarina ships on current bots | 2026-05-20 (DONE) | Sarina live for Vindman supporters via postcard QR + web widget. No convergence work touched her path. | DONE |
| 2. Cheap-wins `lib/` extraction | 2026-05-21 (DONE) | Deflection → `lib/deflectionRouter.ts`. Engagement signals → `lib/engagementSignals.ts`. Language switch → `lib/languageSwitch.ts`. Topic tagging investigated, no extraction warranted (see 2026-W21-devlog Phase 2.5 + 2.6 entries). Both routes still write to their old tables. Sarina regression locked at 17/4/1/0; each extraction met-or-beat baseline at 18 PASS / 0 ERROR. | DONE |
| 3. New schema (`agents` + `conversations` + `conversation_turns` + `town_halls` + `town_hall_conversations` + `town_hall_topics`) | 2026-05-21 (CODE COMPLETE LOCAL) | sql/078 created 5 dark tables (RLS day-one). sql/079 renamed `bots` → `agents` family with backward-compat views (security_invoker). `lib/phase3DualWrite.ts` mirrors all 4 write paths (insert/insert/update/delete) behind `DUAL_WRITE_PHASE3`. `lib/phase3Read.ts` (`isPhase3ReadSafe`) gates every reader behind both flags. 10 readers cut (chat ×2 + 8 admin/cron). Code migrated `from('bots'/'bot_*')` → `from('agents'/'agent_*')` at 72 sites. Sarina backfill: 185 conversations + 746 deduped turns. Sarina regression best result 20/2/0/0 with both flags ON. **Tier 5 cleanup (DROP `bot_conversation_turns` + drop views + remove scaffolding) is the remaining work — gated on a prod verification window where dual-write runs on real traffic.** | 25 commits ahead of origin/main, push freeze active. Backfill verified row-for-row pre/post (deduped src = dst). RLS test suite green. Push + verification window required before Tier 5. |
| 4. PulseIQ route absorbs into chat route | ~3 days after Phase 3 | `/api/townhall/[guid]/chat` rewritten to look up the `town_hall` row, find the linked agent, hand off to the same chat handler as bots — passing `townHallContext`. Drop `townhall_turns` (greenfield, no real data). `/th/[guid]` URL kept for backward compat, but it now resolves a `town_halls.slug`. | Sarina's `/b/sarina` keeps working; `/th/[guid]` keeps working. Single chat handler serves both URLs. |
| 5. Cohort layer as a real feature | ~3 days after Phase 4 | Theme-detection cron rewired to operate on `town_hall_conversations`. Write discovered themes to `town_hall_topics`. `pickNextTopic` factors them in. Dashboard rebuilt against the new schema. | Internal. |
| 6. Vindman town hall ships | June (TBD date) | Create the `town_halls` row pointing at Sarina. Open the public URL. First customer-facing launch on the new substrate. | The acceptance test. The same client running Sarina will know immediately if voice/KB/guardrails diverge from the 1:1 widget — because under the hood it IS the same agent. |

Total engineering window (Phases 2–5): ~2 weeks of focused work, starting 2026-05-21.

## 5. What stays the same vs. what changes

**Stays the same:**
- Sarina's public widget URL (`/b/sarina`) — backed by the new substrate, but the URL doesn't break.
- The Sarina config (voice, KB, guardrails, focuses) — migrated 1:1 into the new `agents` row.
- All `lib/` modules that are already shared.
- Survey / dataset analysis (`/analyze/[id]`) — unrelated domain, no changes.
- Org / multi-tenancy invariants — every new table gets `org_id` + RLS + org-scoped SELECT policy from day one. Service-role queries pair `id` with `org_id` per CLAUDE.md.

**Changes:**
- `bots` → `agents` (rename; remove fields that move into `town_halls.cohort_config`).
- `bot_conversation_turns` + `townhall_turns` → `conversation_turns` + a new `conversations` parent table.
- `townhall_sessions` → `town_halls` (cleaner name, narrower scope: it's now a config + cohort layer, not a conversation container).
- `townhall_themes` → split: seed topics live in `agents.topics`; per-town-hall topic pool (seed + discovered) lives in `town_hall_topics`.
- `/api/townhall/[guid]/chat` → folded into the bots chat handler; both URLs (`/b/[guid]` and `/th/[guid]`) hit the same code path; the handler decides whether to apply town-hall context based on whether the slug resolves to a town hall or an agent.
- Cohort dashboard pages → rebuilt against the new schema.

**User-facing naming convention** (per CLAUDE.md) does NOT change. Agents stay "agents" in the UI; town halls stay "PulseIQ" in the UI. Internal code uses `agents` + `town_halls`. The product still has two surface labels for users; the *implementation* under both is one substrate.

## 6. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Phase 2 lib extractions regress Sarina's live behavior | Medium | Maintain a fixed prompt set (10–20 representative supporter messages) and diff Sarina's responses before/after each extraction PR. Any meaningful divergence blocks the merge. |
| Vindman town hall scope creeps before June | Medium | Lock the town hall scope to "Sarina-config + cohort dashboard + write-back topic injection" — no new PulseIQ-specific features added during the convergence. Active mid-conversation interrupts (today's PulseIQ behavior) are explicitly out of scope. |
| `bots.focuses` and `townhall_themes` semantics differ enough that merging surfaces bugs | Medium | They don't merge — they split. `agents.topics` holds the static seed; `town_hall_topics` holds the per-town-hall live pool (seed copy + discovered). Different roles, different rows. |
| Dashboard rebuild eats more time than estimated | Medium | Phase 6 ships with the analysis surface that exists, even if minimum-viable. Polish iterates after launch. |
| A future customer needs a PulseIQ feature we removed (e.g. mid-conversation theme transition) | Low | Documented as out-of-scope in § 6 row 2. If a customer asks for it back, it's a product decision; layering it on top of write-back is straightforward. |
| Multi-tenancy / RLS regression during schema swap | Low but high-impact | Every new table gets RLS + org-scoped SELECT in the same migration that creates it. `npm run test:rls` runs before drop of old tables. Service-role queries audited to pair `conversation_id` (or `town_hall_id`) with `org_id`. |

## 7. Open questions

These are decisions to make during Phase 3, not before:

1. **Table naming** — `agents` vs. keep `bots`? Internal code today is heavy on `bot_*`. Renaming everywhere is mechanical but noisy. **Lean:** rename for clarity. This is the moment.
2. **Public URL** — keep `/b/[guid]` for 1:1 and `/th/[guid]` for town halls (each resolves to the right kind of row), or unify under `/a/[guid]`? **Lean:** keep both `/b/` and `/th/`. Backward compatible, semantically clear, and the unified handler dispatches on which table the slug matches.
3. **Town hall opt-in surface** — promote-an-agent-to-a-town-hall as a single action, or always create town halls as new top-level records pointing at an existing agent? **Lean:** always create new (the latter). A town hall is its own thing; the agent it points at is unchanged.
4. **Sarina session data preservation** — Sarina is now live and accumulating real supporter sessions. Decision: backfill `conversations` + `conversation_turns` from `bot_conversation_turns` before dropping the old table. Run as a one-time migration during Phase 3. Verify row counts match before drop. **Note**: the existing Sarina chats can also be retroactively added to the June town hall via `town_hall_conversations` inserts if the customer wants that historical view — clean side effect of the new model.
5. **Coverage-balancing default** — what's the default `response_target` per topic in a town hall? PulseIQ today defaults to a per-theme target on `townhall_themes.response_target`. **Lean:** keep the same default, expose it in `cohort_config`.

## 8. What this doc does NOT cover

- The Anchors spec (structured data points captured per session) — see `[[anchors-spec]]` memory. Orthogonal to convergence. If/when built, build it once on the conversation primitive; town halls get it for free.
- Bot deployment contexts (source / medium / campaign / lang as hidden fields) — see `[[bot-deployment-contexts]]` memory. Orthogonal; build once on the conversation primitive.
- Survey / dataset domain — different domain entirely.
- Analytics PPTX export, search, social, campaigns — unrelated.

## 9. References

- `docs/CONVERGENCE_UX.md` — UX exploration for setting up + running a town hall under the new model. Pairs with this doc's architectural decisions.
- Memory: `[[pulseiq-agents-convergence]]` — original architectural question + investigation.
- Memory: `[[open-work-queue]]` — current state of work.
- Spec: `docs/BOTS.md` — current Agents implementation.
- Spec: `docs/TOWNHALL.md` — current PulseIQ implementation.
- Spec: `CLAUDE.md` — multi-tenancy invariants that apply throughout.
- Investigation reports (2026-05-20): route-handler diff + `lib/` overlap map, summarized in § 1.

## 10. Changelog

- **2026-05-20** — Document created. Architecture decision made.
- **2026-05-20** — Sarina launched live for Vindman supporters. Phase 1 complete. Convergence window opens 2026-05-21.
- **2026-05-20** — Confirmed: Sarina is the foundation for the June Vindman town hall.
- **2026-05-20 (revision)** — Model sharpened. Dropped the `cohort: true|false` flag on the agent row; introduced `town_halls` as a separate concept that wraps a collection of conversations with cohort config + analysis layer. Same agent can run 1:1 chats and town halls simultaneously. Topic injection is write-back (cohort writes discovered themes into a per-town-hall topic pool) rather than mid-conversation interrupt. Acceptance test restated: June town hall = a `town_halls` row pointing at Sarina, not a flag on Sarina herself.
- **2026-05-21** — Phase 2 closed. Three `lib/` extractions landed (`deflectionRouter`, `engagementSignals`, `languageSwitch`); two sub-phases investigated and confirmed as no-extractions (info-only vs subtle-disengage policies, focusClassifier vs matchResponseToTopic). Sarina regression baseline locked at 17/4/1/0; each landed refactor hit 18 PASS / 0 ERROR against localhost. Full retrospective + Phase 3 entry-point map in `docs/weekly-reports/2026-W21-devlog.md` (Phase 2.6 entry). Phase 3 starts on the next session — first commit will be the new schema migration with RLS from day one.
- **2026-05-21** — Phase 3 code-complete locally across 11 commits (`4af3dc5` through `d61caf2`). Schema introduced, dual-write wired, Sarina backfilled, 10 readers cut behind `isPhase3ReadSafe`, `bots`→`agents` rename applied via backward-compat views, 72 code references migrated. Sarina regression peaked at 20/2/0/0 with both flags ON. **Tier 5 cleanup (drop legacy table + scaffolding) is the remaining Phase 3 work; gated on a prod verification window which requires the push first.** Two product gaps surfaced during close-out and queued as follow-ups: (a) "Question Log" — no structured record of user-asked-but-unanswered questions (spec exists at `docs/BOTS.md` § 9.x); (b) Name capture — only ~12% of sessions match the existing regex heuristics, no AI-based fallback. Both written up in the `open-work-queue` memory.
- **2026-05-21** — Phase 4 commit 1 landed. `app/api/bots/[id]/chat/route.ts` trimmed from 871 → 65 lines; the chat pipeline extracted into `lib/chatCore.ts` exporting `handleChatTurn(ctx, body)` with `ChatCoreContext = { agent, service, ip, townHallContext? }` as the seam. Pure refactor — every return shape preserved (every interior exit was status 200; route preamble keeps the 400/403/404/429 paths). `townHallContext` plumbed but unused; Phase 4 commit 2 wires PulseIQ into the same handler.
- **2026-05-21** — Phase 4 commit 1 verified via Sarina regression against localhost: **17 PASS / 4 PARTIAL / 1 FAIL / 0 ERROR** — exact match with the Phase 2 baseline. Floor was ≥17 PASS / 0 ERROR. The chat-core extraction is behavior-preserving for the live agent path.
- **2026-05-21** — Phase 4 commit 2 landed. `app/api/townhall/chat/route.ts` gained an opt-in delegation branch gated by `TOWNHALL_VIA_AGENT_HANDLER` (env, default OFF). When the flag is ON AND `session_id` resolves to a `town_halls` row (uuid or slug), the route bypasses the legacy 995-line PulseIQ orchestrator and delegates to `handleChatTurn` with `townHallContext = { townHallId, slug }` populated. PulseIQ-specific features (theme assignment, response counter, language switch, auto-end, standby) are NOT carried into the new path — they get rebuilt on the unified substrate in Phase 5. With zero `town_halls` rows in the system today, the new path is dark on the way in; it activates only after Phase 6 creates the first row. New helper `lib/phase4Flags.ts` matches the `phase3Read.ts` env-gating idiom.
- **2026-05-21** — Phase 5 commit 1 landed. Cohort theme aggregator ported from legacy schema to unified substrate. New `lib/cohortThemeAggregator.ts` mirrors `lib/townhallThemeDetection.ts` but reads `town_hall_conversations` → `conversations` → `conversation_turns` (`role='user'`, `content_en` || `content`), dedups against `town_hall_topics`, writes new topics with `source='auto_detected'`, `state='pending'`. Per-topic sentiment is dropped (lives per-turn on `conversation_turns.sentiment` now). The cron at `/api/cron/townhall-theme-detection` now scans BOTH legacy `townhall_sessions` (status='active') AND new `town_halls` (status='live'); both paths coexist until the legacy schema is dropped. Legacy lib + cron block stay intact for transition. Specs updated: TOWNHALL.md § Theme Detection split into legacy + new-substrate subsections; USAGE_ACCOUNTING.md emitter table + cron table reflect the new lib.
- **2026-05-21** — Phase 5 commit 2 landed. `pickNextTopic` extracted from the inline PulseIQ orchestrator into `lib/pickNextTopic.ts` as a pure function `pickNextTopic(topics, state) → { topic, reason, matchedKeyword? }`. Preserves all five legacy selection rules: filter by `discussedTopicIds`, prefer under-target topics, organic preference when `preferOrganic`, smart-probe with current-topic exclusion, default to first available. The legacy route now calls the lib for the pick and keeps only the wrapper logic (standby vs wrap-up when all covered, debug logging, generate-transition). Sets up Phase 5 commit 3 to wire `pickNextTopic` into `handleChatTurn` for the `townHallContext` path.
- **2026-05-21** — Phase 5 commit 3 landed. `handleChatTurn` now gains a townHallContext-aware branch after RAG: fetches `town_hall_topics` (state in active/pending), tallies cohort-wide `response_count` via `town_hall_conversations` → `conversations` → `conversation_turns.topic_id`, builds participant-specific `discussedTopicIds` from this session's prior turns, calls `pickNextTopic`, and pushes a "TOWN HALL TOPIC FOCUS" instruction into systemParts. Chosen `topic_id` carries through to the turn-storage path: `mirrorTurns` extended with optional `topic_id` per turn, plus optional `townHallId` (idempotent upsert into `town_hall_conversations`) and `participantId` (populates `conversations.participant_id`). PulseIQ delegation now passes `participantId` through `TownHallContext`. Sarina regression: **18 PASS / 3 PARTIAL / 1 FAIL / 0 ERROR** — one better than baseline (17/4/1/0); bot path unaffected since all new logic is gated behind `if (ctx.townHallContext)`.
- **2026-05-21** — Phase 5 commit 4 landed. Two refinements to the `handleChatTurn` townHallContext branch: (1) **standby on all-covered** — when `pickNextTopic` returns `{ topic: null, reason: 'all_covered' }`, push a "TOWN HALL STANDBY" instruction into systemParts so the AI closes gracefully instead of answering generically. Custom `cohort_config.standby_message` honored. (2) **Response-count theme-detection trigger** — sum cohort-wide `response_count`, when `(total + 1) % threshold === 0` (threshold from `cohort_config.theme_detection_every_n_responses`, default 20), fire `detectThemesForTownHall` fire-and-forget. Matches legacy PulseIQ trigger semantics so live sessions discover themes faster than the 15-min cron cadence. Town_halls row loaded once at top of branch for both config reads. Sarina regression: 17/4/1/0 — exact baseline match. Bot path unaffected.
- **2026-05-21** — Phase 5 commit 5 landed. `sql/080_phase5_rename_theme_id_to_topic_id.sql` applied to prod. `conversation_turns.theme_id` → `topic_id` to match the convergence's "topic" nomenclature (`town_hall_topics`, `pickNextTopic`, `cohortThemeAggregator`). The original `sql/078` already commented the column as "Reference to town_hall_topics(id)" but named the column `theme_id` — a drift that surfaced during Phase 6 prep when the dual-write path failed with "column ct.topic_id does not exist". Metadata-only rename (no rows had a non-null `theme_id` in prod — new path was dark until today). Phase 6 prep also landed: first `town_halls` row (`slug='sarina-cohort'`, status='live', pointing at Sarina) + 3 seed topics created via `sql/one-off/2026-05-21-sarina-town-hall.sql`. Live exercise confirmed end-to-end through new path: `source: 'agent_handler'`, smart-probe matching (`keyword: school`, `keyword: housing`), topic_id storage, conversations auto-linked via `town_hall_conversations`, distinct participant tracking. The unified handler now runs a real cohort discussion against prod.
- **2026-05-22** — **NOWOCATS is the first town hall on the new substrate** (not Vindman as originally written in § 4 Phase 6). Sarina is the underlying agent. Launch window: early June 2026. To make that launch real, four participant-facing + facilitator-mutating routes had to accept phase-3 town halls (gaps surfaced in the 2026-05-22 PulseIQ feature audit). Shipped:
  - `app/api/townhall/join/[sessionId]` GET + POST — resolves `town_halls` by slug/id (falls back from `townhall_sessions`). POST skips the legacy `townhall_turns` opener insert for phase-3 (chatCore creates the conversation + first turn pair on the participant's first message).
  - `app/api/townhall/live/[sessionId]` GET — phase-3 branch pulls stats from `town_hall_conversations` → `conversations` → `conversation_turns` (role='user'), sentiment from `conversation_turns.sentiment` (precomputed), per-topic counts from `topic_id`. Trending/keyword analytics minimal — full rebuild deferred.
  - `app/api/townhall/themes/[id]` POST — detects `town_hall_topics` id and routes the same `updates` object there (same state vocab; sql/082 extended `town_hall_topics_state_check` to accept the full legacy set `active|pending|detected|paused|parked|completed|rejected|dismissed`).
  - `app/api/townhall/themes/custom` POST — if `session_id` resolves to `town_halls`, inserts into `town_hall_topics` with `source='manual'` instead of `townhall_themes` `source='custom'`.
  - `app/api/townhall/sessions/[id]` PATCH — `handlePhase3Patch` covers status change (with seed-on-activate copying `discussion_guide` → `town_hall_topics`), discussion_guide sync (add/pause/reactivate/update/dismiss), restart (wipe conversations + drop auto_detected), reanalyze (call `detectThemesForTownHall`), delete_participants (cascade through `conversations`). Status map: setup↔draft, active↔live, paused↔paused, ended↔closed. Slug edit + org_id transfer stay legacy-only (low priority — not blocking launch).
  - `app/api/townhall/sessions/[id]` DELETE — phase-3 branch cascades `conversations` (deletes turns via FK), then drops `town_halls` row.
  - `sql/082_town_hall_topics_extend_states.sql` applied to prod — state CHECK accepts the full legacy vocab; adapter still projects `pending→detected`, `rejected→dismissed` on read so the dashboard renders consistently.
- **Known follow-up #5 (RESOLVED, separate commit)**: `/api/townhall/sessions/[id]/analyze` was reading `townhall_sessions/_themes/_turns` only — phase-3 town halls would 404 on dataset sync. Now substrate-aware: detects whether the id/slug resolves to `town_halls`, branches to a phase-3 path that pulls from `town_hall_conversations` → `conversations` → `conversation_turns` (role='user') and pairs each user turn with its preceding assistant turn within the same conversation (mirrors bot-level analyze pairing). Topics resolved from `town_hall_topics`. Same `DatasetRow` shape so Ana receives identical schema regardless of substrate — datasets can be combined for multi-event rollups (e.g. all Vindman events combined in Analytics). Note: `/api/townhall/responses` POST (post-session psycho/demo upsert) still validates against `townhall_turns` only — separate follow-up, not blocking unless NOWOCATS uses post-session questions.
- **Known follow-up #6**: bot-level analyze (`/api/bots/[id]/analyze`) does not surface `town_hall_id` / `town_hall_slug` on emitted rows. Cross-event filtering in Ana requires combining per-event datasets instead of filtering one bot dataset. Fix is a ~20-min join through `town_hall_conversations` + adding two columns to `buildBotSchema`. Not urgent for launch.
- **Phase 6 entry-point reality check**: `TOWNHALL_VIA_AGENT_HANDLER` is OFF in Vercel prod env. The flag has to flip on for the chat path to use the unified handler. Without the flip, `/api/townhall/chat` reads the legacy orchestrator path and the phase-3 chat experience is dark in prod.

- **2026-05-22** — Phase 5 commit 6 landed (MVP — dashboard read adapter). `lib/townHallAdapter.ts` projects new-substrate rows (`town_halls` + `town_hall_topics` + `town_hall_conversations` + `conversations` + `conversation_turns`) into the same JSON shape the existing facilitator surfaces (`/api/townhall/sessions` list + `/api/townhall/sessions/[id]` detail) consume. Both API routes patched: the list endpoint merges adapter output with the legacy townhall_sessions result; the detail endpoint's `gateSessionAccess` now also resolves `town_halls` by id or slug, and the GET handler short-circuits to the adapter when `gate.substrate === 'phase3'`. Status mapping: `draft|live|paused|closed` → `setup|active|paused|ended`. PATCH/DELETE on phase-3 town halls return 405 with a clear message (mutation surfaces stay legacy until a real customer demands them — zero live PulseIQ customers as of 2026-05-22 makes that low-urgency). Heavy keyword/sentiment/time-series analytics deferred — adapter returns empty arrays for those fields so the dashboard client doesn't NPE on `.map`/`.length`. Verified against the live `sarina-cohort` row via `scripts/verify-phase5c6.ts`: list returns 1 row (5 participants, 4 turns), detail returns 3 seed topics + correct status mapping + populated stats. **Phase 5 is now complete.** Tier 5 cleanup (drop legacy tables) remains blocked on push + dual-write window + multi-bot backfill.
