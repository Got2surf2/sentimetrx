# CONVERGENCE_UX.md

**Status:** Design exploration (not committed UX). Pairs with `docs/CONVERGENCE.md` § 3 architecture.
**Drafted:** 2026-05-20
**Owner:** Sanjay
**Pre-build status:** No screens built yet. This doc captures the UX choices for setting up + running a town hall under the new `agent + conversation + town_hall` model, so that when Phase 5 implementation starts, the picker, editor, and dashboard land with intent rather than ad-hoc.

---

## 1. Purpose + scope

The architectural decision in `docs/CONVERGENCE.md` makes town halls a thin layer over an existing agent. That's clean structurally but introduces UX questions today's PulseIQ doesn't have to answer — most importantly, **what does it look like to point a town hall at an agent that's also serving 1:1 chats?**

This doc covers:
- The setup flow for creating a town hall
- The editor surface for configuring it
- The live dashboard view while it's running
- The agent-indirection footgun (the biggest new UX risk)
- Status lifecycle, distribution, end-state behavior

This doc explicitly does NOT cover:
- The agent editor itself (existing surface; minor warning-banner change is the only convergence-related update)
- The 1:1 chat widget (`/b/[guid]` — unchanged)
- Survey / dataset analysis surfaces (different domain)
- Specific visual design — copy, colors, spacing. That's a separate pass once layout is validated.

## 2. The new mental model, as a user sees it

Three concepts under the convergence; the UI should make all three visible and learnable:

```
Agent       = "the thing that talks" — voice, KB, guardrails, topics
              Lives at:  /agents/[id]/edit  (today: /bots/[id]/edit)

Conversation = "one person talking to an agent"
              Lives at:  participant-facing widget /b/[guid] or /th/[slug]
                         Plus a per-conversation viewer in admin

Town hall   = "a named cohort wrapped around many conversations on one agent"
              Lives at:  /town-halls list + /town-halls/[id] editor / dashboard
              Public URL: /th/[slug]
```

User-facing labels (per CLAUDE.md): agents stay "agents," town halls stay "PulseIQ." Internal nav uses the labels users know. Within this doc, "town hall" is the architectural term; production UI says "PulseIQ."

## 3. Setup flow — quick-create + tabbed editor

Two-stage. The quick-create form gets you to a working draft fast; the editor is where you actually configure.

### 3.1 Quick-create (`/town-halls/new`)

Minimal form, one screen. Four fields:

```
┌─────────────────────────────────────────────────┐
│  New PulseIQ town hall                         │
├─────────────────────────────────────────────────┤
│                                                 │
│  Which agent should run this?                  │
│  ┌────────────────────────────────────────┐    │
│  │ ▾ Sarina  (Vindman campaign)           │    │
│  └────────────────────────────────────────┘    │
│  This agent will answer participants. You can  │
│  edit the agent itself separately — changes    │
│  affect every conversation on it.              │
│                                                 │
│  ─── or ──── + Create a new agent first        │
│                                                 │
│  Name (internal)                                │
│  ┌────────────────────────────────────────┐    │
│  │ Vindman June town hall                 │    │
│  └────────────────────────────────────────┘    │
│                                                 │
│  Public URL                                     │
│  ┌────────────────────────────────────────┐    │
│  │ /th/  vindman-june                     │    │
│  └────────────────────────────────────────┘    │
│                                                 │
│  Schedule                                       │
│  ◉ Run continuously until I end it             │
│  ○ Scheduled window: [start] → [end]           │
│                                                 │
│              [ Cancel ]  [ Create draft ]      │
└─────────────────────────────────────────────────┘
```

On submit: creates a `pulseiq_sessions` row in `status = 'draft'`, copies the agent's topics into `pulseiq_topics` as `source = 'seed'`, redirects to the editor at `/town-halls/[id]`.

If the user has no agents: replace the picker with a "Create your first agent" CTA that deep-links to the agent creator and returns here after.

### 3.2 The editor — six tabs

Layout pattern matches the existing `/bots/[id]/edit` style (which the user already knows). Tab order is the order a first-time user is likely to need them:

```
┌─────────────────────────────────────────────────────────────┐
│  Vindman June town hall          ●Draft   [ Go live → ]    │
│  PulseIQ • Agent: Sarina • /th/vindman-june                │
├─────────────────────────────────────────────────────────────┤
│  [Overview] [Topics] [Cohort] [Distribute] [Team] [Live]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   ...tab content...                                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Status badge in header is the at-a-glance state. Primary action ("Go live", "Pause", "End", "View report") shifts with status. Agent name is a deep link back to the agent's own editor.

## 4. Tab walkthrough

### 4.1 Overview

The basics, plus the agent indirection. This tab is where the new model is most visible.

- Internal name, public slug (editable until first participant joins; locked after)
- Public-facing intro text (what participants see when they land — defaults to the agent's standard intro, with an override option)
- Schedule (always-on vs. window)
- Linked agent + the warning banner (see § 5)
- "Clone from previous town hall" affordance — copy topics + cohort config from a past town hall on the same agent. Most useful for periodic re-runs.

### 4.2 Topics

The most complex tab because it has three sources of topics, each with different edit semantics:

```
┌─────────────────────────────────────────────────────────────┐
│  Topics                                                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Seed topics (from agent Sarina)                            │
│  ────────────────────────────────                           │
│  These come from the agent. Edit the agent to change the    │
│  wording. You can hide a topic from this town hall, but     │
│  edits propagate everywhere the agent is used.              │
│                                                             │
│  ☑ Florida First Agenda           Target: 50  [ Hide ]      │
│  ☑ Education priorities           Target: 50  [ Hide ]      │
│  ☑ Healthcare access              Target: 30  [ Hide ]      │
│  ☐ Economic policy                Target: 50  [ Unhide ]    │
│                                                             │
│  Custom topics (this town hall only)                        │
│  ─────────────────────────────────                          │
│  Add topics that only exist for this town hall. These       │
│  don't affect the agent or other town halls.                │
│                                                             │
│  • Hurricane response readiness   Target: 40  [Edit][Delete]│
│  + Add custom topic                                         │
│                                                             │
│  Discovered topics                                          │
│  ──────────────────                                         │
│  Themes the AI surfaces from participant responses while    │
│  the town hall is running. Promote one to add it to the     │
│  active topic pool. (Will populate after launch.)           │
│                                                             │
│  [ empty until town hall is active and cohort cron runs ]   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

Three sections, each visually distinct. Source provenance is unmissable.

Coverage target per topic. Default = `(expected_participants × 0.6)` rounded, but always editable. (Open question: do we even ask users to set expected_participants, or default to "no target, just rank by under-coverage"? See § 11.)

Discovered topics section: read-only until the town hall has been live for a while AND organic discovery is on. Each discovered theme has the AI's label, a count of responses that contributed, a sentiment summary, and a `[ Promote to active pool ]` button. Demote = hide. Edit-label = optional.

### 4.3 Cohort settings

Sensible defaults; advanced disclosure for power users.

```
┌─────────────────────────────────────────────────────────────┐
│  Cohort                                                     │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Organic theme discovery                                    │
│  ────────────────────────                                   │
│  ◉ On — AI looks for emerging themes and surfaces them      │
│         in Topics → Discovered                              │
│  ○ Off — only seed + custom topics                          │
│                                                             │
│  ──────────────────────────────────────                     │
│  ▸ Advanced settings                                        │
│  ──────────────────────────────────────                     │
│                                                             │
│  (expanded:)                                                │
│  • Discovery cadence: every [10] new participants           │
│  • Max discovered themes: [8]                               │
│  • Coverage balancing:                                      │
│     ◉ Always prefer the most under-covered topic            │
│     ○ Weighted — recent topics get a small bonus            │
│  • Auto-promote discovered themes when N participants       │
│    mention them: [ off / 3 / 5 / 10 ]                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

90% of users never open Advanced. The defaults are the right answer for the Vindman use case.

### 4.4 Distribute

How participants get in. Pattern matches today's bot share modal — we already have most of this UI; just point it at the town hall slug instead of the bot slug.

- **Public URL:** `https://app.sentimetrx.com/th/vindman-june` + [Copy] [Open]
- **QR code:** download PNG, print-ready size by default
- **Embed snippet:** iframe code for the campaign site
- **Email invite list (optional):** upload CSV of `email, name` to generate personalized URLs that prefill `participant_id`. (Open question: do we ship this in v1 or defer? See § 11.)
- **Preview as participant:** opens the public URL in a new tab.

### 4.5 Team

Who on the team can see the dashboard while it's live. Defaults to the org's admins. Inviteable users are filtered to existing org members — no external invites from this surface.

This is the simplest tab. May not need to be a separate tab if it's just one list. Could move into Overview if v1 stays minimal.

### 4.6 Live (dashboard)

Same view today's PulseIQ has, rebuilt against the new schema. Probably tabs-within-tab:

- **Now** — participants active in the last 5 min, recent turns, topic coverage progress bars, discovered themes ticker.
- **Coverage** — per-topic response counts vs. target.
- **Themes** — sentiment breakdown per topic; click to drill into representative responses.
- **Participants** — list view, optional drill-in to a single conversation.
- **Export** — CSV of turns, PDF/PPTX summary (Phase 2 polish, not v1).

When the town hall is in `draft` or `ended` status, this tab shows the historical view or a "not yet started" placeholder.

## 5. The agent-indirection warning (the big new footgun)

The architectural decision lets one agent serve 1:1 chats AND power one-or-more town halls AND have historical town halls — all at once. Editing the agent affects all of them immediately, except the historical ones (whose conversations are already recorded).

This is a feature. But without a clear warning, users will edit Sarina's voice and not realize they just changed how a live Vindman town hall behaves.

### 5.1 Where the warning lives

**In the agent editor (`/agents/[id]/edit`):**

```
┌─────────────────────────────────────────────────────────────┐
│  ⚠  Sarina is currently in use                              │
│                                                             │
│  • 1 active town hall  →  Vindman June town hall            │
│  • ~247 individual chats in the last 7 days                 │
│                                                             │
│  Changes you save here apply immediately to all of them.    │
│  (Historical town halls and finished chats are not          │
│  affected — those conversations are already recorded.)      │
│                                                             │
│  [ Got it ]                                                 │
└─────────────────────────────────────────────────────────────┘
```

Banner appears at the top of the agent editor whenever there's at least one active town hall OR > 10 chats in the last 7 days. Dismissable per session but reappears on next visit. The "Vindman June town hall" line is a deep link to the town hall editor.

### 5.2 Where the warning does NOT need to appear

- The town hall editor — the user is already in town-hall context; they know the agent is wired in.
- Editing town-hall-specific config (cohort settings, custom topics, distribution) — these don't touch the agent.
- Editing a *custom* topic in the town hall — it lives only here, agent unaffected.

The warning is specifically about agent-level edits affecting live town halls.

### 5.3 Edge: editing a topic on the agent that's already a seed topic in a town hall

When the agent's topic list is edited:
- Adding a new topic: it becomes available as a seed topic in *future* town halls. Existing town halls don't auto-import — the topic pool was snapshotted at town hall creation. (Decision: keep snapshot semantics. Otherwise live town halls' topic lists change underneath the moderator, which is worse than the alternative.)
- Removing a topic: existing town halls keep their copy (because they were snapshotted). It just won't show up in *new* town halls.
- Editing a topic's wording: existing town halls keep their snapshotted wording. Future town halls get the new wording.

Snapshot semantics keep things predictable. The Topics tab should make it visible when a seed topic has been changed on the agent since the town hall was created (a small "agent version of this topic has changed — review" badge), so moderators can opt into the update.

## 6. Status lifecycle UI

Five states; transitions need real handling, not just label changes.

```
draft ──[Go live]──▶ active ──[Pause]──▶ paused
                       │                    │
                       │       ┌────────────┘
                       │       │
                       ▼       ▼
                     ended (terminal — read-only thereafter)
```

**Transitions:**

| From → To | Trigger | UI behavior |
|---|---|---|
| draft → active | "Go live" button in header | Validation pass first (slug unique, ≥1 active topic, agent has KB or topics, schedule resolves). If fail, show specific errors; if pass, status flips, public URL goes live, dashboard tab activates. |
| active → paused | "Pause" button | Participants visiting the URL see a "town hall is paused" message (configurable copy). In-flight chats receive a final assistant turn explaining the pause. Dashboard keeps showing historical state. |
| paused → active | "Resume" button | URL goes live again. No re-validation needed unless slug/agent/topics changed during the pause (in which case re-validate). |
| any → ended | "End town hall" button (confirmation modal: "This cannot be undone") | URL becomes read-only — visitors see a "this town hall has ended" page with optional follow-up CTA. Dashboard remains accessible as a historical view. Editor goes read-only. |

**Status badge in header** is always visible. Color codes: gray for draft, green for active, amber for paused, slate for ended.

**Validation errors at promote-to-live** should be specific and actionable. Bad:

> "Town hall is not ready to go live."

Good:

> "Cannot go live yet:
> • Slug `vindman-june` is already in use by another town hall
> • Topics list is empty — add at least one seed or custom topic
> • Agent Sarina has no knowledge base content"

## 7. Distribution + participant entry

Public URL pattern: `/th/[slug]` — kept for backward compatibility, but in the new model the slug resolves a `pulseiq_sessions` row, not a `townhall_sessions` row.

**Participant identification:** open question (§ 11) but the architectural seam is `conversations.participant_id`. Three modes:

- **Anonymous** (default) — `participant_id` = an opaque random session id; participants are tracked but not linked to anyone external. Matches today's PulseIQ.
- **Named, prompted** — first screen asks for name + optional email; `participant_id` = a stable hash. Lightweight personalization without invites.
- **Pre-issued URLs** — each participant gets a unique URL with `participant_id` baked in (e.g. `/th/vindman-june?p=abc123`). Requires the email invite list flow.

V1 should at minimum support anonymous + named-prompted. Pre-issued is a follow-up.

## 8. End-state + historical access

When a town hall ends:
- Public URL goes read-only with a customizable closing screen ("Thank you for participating. Stay tuned for the report.").
- Dashboard remains accessible to the team. Live indicators (active participants, recent turns) disappear; cumulative stats remain.
- Topics, themes, sentiment breakdowns become a frozen historical view.
- Export (CSV/PDF/PPTX) is the natural last action.

Ended town halls should NOT be deleted on a timer. They're the artifact of the engagement; the customer paid for that data. Archival happens manually or on org-level retention rules (out of scope for v1).

## 9. Mobile + responsive

The editor is admin-side — desktop-primary. Mobile-friendly is nice but not required for v1.

The participant-facing widget (`/th/[slug]` participant view) is mobile-first by definition — most participants land via QR code from a postcard. This is unchanged from today's PulseIQ widget; the convergence doesn't touch it.

## 10. What changes from today's PulseIQ UI

| Today | Convergence |
|---|---|
| Town hall = a self-contained record with inline agent config | Town hall = a thin record pointing at a separate agent |
| No "pick an agent" step | New required step in creation |
| No agent-indirection warning | Required warning on the agent editor when active town halls exist |
| Topics live in `townhall_themes` (one source) | Topics in three sections: seed (from agent), custom, discovered |
| Snapshot semantics implicit | Snapshot semantics explicit (badges when agent drifts) |
| Dashboard reads from `townhall_*` tables | Dashboard reads from unified schema; can in principle show analytics across multiple town halls on the same agent |
| Cohort settings buried in config JSON | Surfaced in a Cohort tab with sensible defaults |

## 11. Open questions

Need a decision before Phase 5 implementation; not before Phase 2 / 3 (which are storage + lib work and don't depend on UX choices).

1. **Pre-issued URLs in v1?** — Distribution tab § 4.4. Pre-issued personalized URLs require CSV upload + email integration + per-participant URL generation. Probably not a v1 must-have if Vindman is fine with anonymous + named-prompted, but worth confirming. **Vindman context needed:** is the campaign distributing personalized URLs to a known supporter list, or sharing one link?
2. **Real-time moderator tools?** — Live dashboard § 4.6. Today's PulseIQ dashboard is view-only. Does the campaign team need: ability to manually promote a discovered theme mid-event? Kick a disruptive participant? Post a moderator announcement to all active conversations? Each is a real feature with real complexity. **Lean: ship v1 view-only + manual theme promotion (it's cheap). Defer kick + announcement to v1.1 unless explicitly asked.**
3. **Branding override?** — Overview tab § 4.1. Does the town hall inherit the agent's visual branding, or can it have its own (logo, colors, intro screen, closing screen)? Today's PulseIQ has its own; if we strip that, existing PulseIQ users might miss it. **Lean: inherit by default with an "override branding for this town hall" toggle in Overview.** Cheap to support, preserves existing flexibility.
4. **Coverage targets — required or optional?** — Topics tab § 4.2. Asking users to set per-topic targets up front is friction. Alternative: no targets, just rank by under-coverage relative to other topics in the pool. **Lean: optional. Default = no target; "balance evenly by topic." Power users can set explicit targets per topic if they care.**
5. **Where does Team access live?** — § 4.5. As a separate tab feels heavy if it's one list. Could fold into Overview as an "Access" subsection. **Lean: fold into Overview unless team management grows beyond a simple list.**

## 12. References

- `docs/CONVERGENCE.md` — the architectural decision this UX flows from.
- `docs/TOWNHALL.md` — current PulseIQ spec; will be rewritten during Phase 5 to reflect the convergence.
- `docs/BOTS.md` — current Agents spec; minimal change (the warning banner is the only UX-visible delta).
- Memory: `[[pulseiq-agents-convergence]]` — original architectural question.
- Memory: `[[open-work-queue]]` — current state of work.

## 13. Changelog

- **2026-05-20** — Document drafted. Captures UX exploration for the town hall setup flow + editor + dashboard under the new `agent + conversation + town_hall` architecture. Five open questions flagged for resolution before Phase 5.
