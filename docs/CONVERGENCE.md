# CONVERGENCE.md

**Status:** Decided (architecture), Pending (implementation)
**Decided:** 2026-05-20
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

The only things genuinely unique to PulseIQ are (a) cross-participant theme discovery, (b) coverage balancing across the cohort when picking the next probe topic, and (c) the live cohort dashboard. These are **layered features on top of a conversational primitive**, not a different product.

## 2. Decision

**One primitive — `agent` — with two modes: single-respondent and cohort.**

PulseIQ becomes `agent.cohort = true`, not a separate route, not a separate table, not a separate codebase. Bots become the substrate; PulseIQ becomes a thin wrapper that adds:

1. Cross-participant theme aggregation (cron, sees many sessions)
2. Coverage-balancing logic when probing (the agent prefers under-covered topics across the cohort)
3. A cohort dashboard view

Everything else — focuses/themes, KB, guardrails, voice, deflection, persona extraction, language detection, sentiment + theme tagging on turns — is the same machinery either way.

The acceptance test for the convergence is the **Vindman client journey**:

- **Now (live as of 2026-05-20)**: Sarina (1:1 agent) is live for Vindman supporters via postcard QR + web widget.
- **June**: the Vindman town hall ships with **Sarina as the core interaction agent**, in `cohort: true` mode — same voice, same KB, same guardrails, same focus topics. Plus cohort aggregation + dashboard.

This is not a hypothetical. The customer has explicitly said Sarina is the foundation for the June town hall. The convergence isn't "what if we wanted to share"; it's "the customer is asking for one agent in two modes and we either build that or we don't."

If the convergence is done right, the June town hall is **literally the Sarina row with `cohort = true`**. Every Sarina config refinement that happens between now and June flows automatically to the town hall mode. If it's not done, the June town hall is a manual copy-paste of Sarina's config into PulseIQ's parallel schema — and every Sarina change between now and June has to be made in two places, with the risk of drift.

## 3. Architecture

### 3.1 The primitive

```
agent = {
  id, org_id, slug, name,
  voice / personality,
  knowledge_base (text or RAG-backed),
  topics (array — what we today call `focuses` or `themes`),
  guardrails (array),
  deflection_rules,
  language_config,
  cohort: boolean,         // false = 1:1; true = town-hall-mode
  cohort_config: jsonb,    // when cohort=true: coverage targets, organic-theme on/off, etc.
}
```

This replaces both `bots` and `townhall_sessions`/`townhall_themes` as the configuration surface.

### 3.2 The conversation model

One unified table:

```sql
conversation_turns (
  id uuid primary key,
  org_id uuid not null,                  -- multi-tenancy invariant
  agent_id uuid not null references agents(id),
  session_id text not null,              -- bot session OR town hall venue session
  participant_id text null,              -- null = single-respondent; populated = cohort
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

`participant_id NULL` = today's bot session. `participant_id` populated = today's PulseIQ. The same SELECT queries work for both; cohort aggregation just `GROUP BY topic_slug` across all participants for an `agent_id`.

The `source` enum is the union of today's two vocabularies. `silence_probe` (bots-side) and `standby` (PulseIQ-side) stay as distinct values because they encode different *policies* (template nudge vs. await organic topic), even though they share the same detection signal.

### 3.3 Layered features

| Feature | Today lives in | After convergence |
|---|---|---|
| Content safety | `lib/contentGuard.ts` | Unchanged, shared |
| Sentiment scoring | `lib/contentGuard.ts` | Unchanged, shared |
| Persona extraction | `lib/personaExtractor.ts` | Wired into both modes (PulseIQ gets it for free) |
| RAG / KB | bots route inline | Lifted to `lib/agentRag.ts`, available in both modes |
| Deflection | duplicated | Extracted to `lib/deflectionRouter.ts` |
| Info-only message detection | `lib/botProbeGuards.ts` | Generalized; both modes use it |
| Engagement signals (silence / trajectory / curt / consecutive-skip) | partially in bots, mostly inline in PulseIQ | Extracted to `lib/engagementSignals.ts`; both modes use them; policy (probe vs. standby) per-mode |
| Language-switch detection | PulseIQ route inline | Extracted to `lib/languageSwitch.ts`; both modes use it |
| Topic/focus tagging on turns | `lib/focusClassifier.ts` (bots) | Generalized to `lib/topicTagger.ts` |
| Cohort theme aggregation | `lib/townhallThemeDetection.ts` + cron | Renamed `lib/cohortThemeAggregator.ts`; gated by `agent.cohort = true` |
| Coverage balancing | inline in PulseIQ chat route | Lifted to a `pickNextTopic(agent, sessionState)` helper; trivial when `cohort=false`, real logic when `cohort=true` |
| Cohort dashboard view | `/admin/townhall/...` pages | Rebuilt against `conversation_turns` with `agent.cohort = true` filter |

### 3.4 Analysis surface

Today analysis is fragmented across three places:

- `/analyze/[id]` — for survey/dataset rows
- per-bot session viewer + per-bot insights
- PulseIQ-specific dashboards + theme view

After convergence, conversational agent analysis is **one surface**: `/agents/[id]/analyze`, taking an `agent_id` and showing sentiment distribution, topic coverage, persona breakdown, sentiment-per-topic, and (when `agent.cohort = true`) cohort comparisons + organic-theme discovery. Dataset analysis (the survey side) is a separate domain and stays where it is.

## 4. Sequencing plan

The convergence is greenfield — there are no live customers on either Agents or PulseIQ today; all activity is in pilot / sales-cycle. That means no dual-write window, no backfill, no careful cutover. Just rewrite the schema and routes, point at the new table, drop the old ones.

| Phase | Window | Work | Risk gate |
|---|---|---|---|
| 0. Decide + write this doc | 2026-05-20 | This document | None — DONE |
| 1. Sarina ships on current bots | 2026-05-20 (DONE) | Sarina live for Vindman supporters via postcard QR + web widget. No convergence work touched her path. | None remaining — she's out. |
| 2. Cheap-wins `lib/` extraction | 2026-05-21 onward | Pull deflection, engagement signals, language switch, persona, topic tagging into shared modules. Both routes still write to their old tables. | Internal-only; both routes keep working unchanged. Sarina's runtime behavior must not regress — diff her responses on a fixed prompt set before and after each extraction. |
| 3. Unified `conversation_turns` schema | ~1 week after Phase 2 | Create new table; refactor both routes to write to it. Refactor analysis surfaces to read from it. Drop `bot_conversation_turns` and `townhall_turns`. | Sarina is now live and has real session data. Backfill `conversation_turns` from `bot_conversation_turns` before dropping the old table. RLS + org-scoped policy on `conversation_turns` from day one. |
| 4. Route consolidation | ~3 days after Phase 3 | Collapse `/api/townhall/[guid]/chat` into `/api/bots/[id]/chat` (or rename both to `/api/agents/[id]/chat`) with a `cohort: true` mode. | Sarina's public URL `/b/sarina` must keep working — don't break the share link printed on postcards. |
| 5. Cohort aggregation as layered feature | ~3 days after Phase 4 | Move theme-detection cron to read from `conversation_turns` filtered by `agent.cohort = true`. Move coverage-balancing into the unified probe-picking helper. | Internal. |
| 6. Vindman town hall ships as Sarina-with-cohort | June (TBD date) | First customer-facing launch on the new substrate. The town hall agent IS the Sarina row with `cohort = true`. | This is the acceptance test. Issues surface here, with the same client who's already running Sarina — they'll know immediately if voice/KB/guardrails diverge from what they're seeing on the 1:1 widget. |

Total engineering window (Phases 2–5): ~2 weeks of focused work, starting 2026-05-21.

## 5. What stays the same vs. what changes

**Stays the same:**
- Sarina's public widget URL (`/b/sarina`) — backed by the new substrate, but the URL doesn't break.
- The Sarina bot config (voice, KB, guardrails, focuses) — migrated 1:1 to the new `agents` row.
- All `lib/` modules that are already shared.
- Survey / dataset analysis (`/analyze/[id]`) — unrelated domain, no changes.
- Org / multi-tenancy invariants — `conversation_turns.org_id` is required, RLS enabled, org-scoped SELECT policy from day one. Service-role queries pair `id` with `org_id`.

**Changes:**
- `bots` table → `agents` table (rename + add `cohort` + `cohort_config` columns).
- `bot_conversation_turns` + `townhall_turns` → `conversation_turns` (one table).
- `townhall_sessions` → absorbed into the agent's runtime state; sessions are tracked per `(agent_id, session_id, participant_id)` tuple.
- `townhall_themes` → either folded into `agents.topics` (if seed) or stored as `agents.topics` entries with `source = 'detected'` (if organic).
- `/api/townhall/[guid]/chat` → gone; URL `/th/[guid]` redirects to `/b/[guid]` with `cohort: true` agent.
- Cohort dashboard pages → rebuilt against unified schema.
- All internal references to "bot" and "town_hall" / "PulseIQ" in code paths become "agent" + a mode flag.

**User-facing naming convention** (per CLAUDE.md) does NOT change. Agents stay "agents" in the UI; cohort-mode agents stay "PulseIQ" in the UI. Internal code uses `agent` + `cohort: true|false`. The product still has two surface labels for users; the *implementation* under both is one substrate.

## 6. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Phase 2 lib extractions regress Sarina's live behavior | Medium | Maintain a fixed prompt set (e.g. 10–20 representative supporter messages) and diff Sarina's responses before/after each extraction PR. Any meaningful divergence blocks the merge. |
| Vindman town hall scope creeps before June | Medium | Lock the town hall scope to "Sarina-config + cohort dashboard" — no new PulseIQ-specific features added during the convergence. |
| `bots.focuses` and `townhall_themes` semantics differ enough that merging them surfaces hidden bugs | Medium | Don't merge structurally — `agents.topics` is a new column with a normalized shape; both old columns map into it via migration. Backfill is one-time, not ongoing dual-write. |
| Dashboard rebuild eats more time than estimated | Medium | Phase 6 (town hall launch) ships with the analysis surface that exists, even if it's a minimum-viable view. Polish iterates after launch. |
| A future customer needs a non-converged PulseIQ feature we removed | Low | Document any PulseIQ behavior we drop during the convergence in this doc's "Removed" section (currently empty). If a customer asks for it back, it's a real product decision, not an accidental regression. |
| Multi-tenancy / RLS regression during the schema swap | Low but high-impact | `conversation_turns` gets RLS + org-scoped SELECT policy in the same migration that creates it. `npm run test:rls` runs before drop of old tables. Service-role queries are audited to pair `agent_id` with `org_id`. |

## 7. Open questions

These are decisions to make during Phase 0 / Phase 3, not before:

1. **Table naming** — `agents` vs. keep `bots`? Internal code today is heavy on `bot_*`. Renaming everywhere is mechanical but noisy in the diff. Lean: rename for clarity, since this is the moment.
2. **Public URL** — keep `/b/[guid]` for both single + cohort modes, or introduce `/a/[guid]` for "agent"? Lean: keep `/b/` to avoid breaking existing share links; introduce `/th/[guid]` redirect to the same handler.
3. **Cohort-mode opt-in surface** — a checkbox in the agent editor, or a separate "promote to cohort agent" action? Lean: checkbox is simpler; promote-flow is over-engineering for a v1.
4. **Sarina session data preservation** — Sarina is now live and accumulating real supporter sessions in `bot_conversation_turns`. Decision: backfill `conversation_turns` from `bot_conversation_turns` before dropping the old table. Run as a one-time `INSERT INTO conversation_turns SELECT ...` migration during Phase 3. Verify row counts match before drop.
5. **Coverage-balancing default** — when `cohort: true`, what's the default coverage target per topic? PulseIQ today uses `response_target` per theme. Lean: keep the same default, expose it in `cohort_config`.

## 8. What this doc does NOT cover

- The Anchors spec (structured data points captured per session) — see `[[anchors-spec]]` memory. Anchors is **gated on customer pull** and orthogonal to convergence. If/when Anchors gets built, build it as a single feature on the unified primitive, not separately per surface.
- Bot deployment contexts (source / medium / campaign / lang as hidden fields) — see `[[bot-deployment-contexts]]` memory. Also unbuilt, also orthogonal, also build-once on the unified primitive if/when.
- Survey / dataset domain — different domain entirely; not part of this convergence.
- Analytics PPTX export, search, social, campaigns — unrelated.

## 9. References

- Memory: `[[pulseiq-agents-convergence]]` — original architectural question + investigation to-do.
- Memory: `[[open-work-queue]]` — this convergence is the next session's main thread.
- Spec: `docs/BOTS.md` — current Agents implementation.
- Spec: `docs/TOWNHALL.md` — current PulseIQ implementation.
- Spec: `CLAUDE.md` — multi-tenancy invariants that apply throughout the convergence.
- Investigation reports (2026-05-20): route-handler diff + `lib/` overlap map, summarized in this doc's § 1.

## 10. Changelog

- **2026-05-20** — Document created. Architecture decision made.
- **2026-05-20** — Sarina launched live for Vindman supporters. Phase 1 complete. Convergence window opens 2026-05-21.
- **2026-05-20** — Confirmed: Sarina is the foundation for the June Vindman town hall. The town hall agent will literally be the Sarina row with `cohort = true`.
