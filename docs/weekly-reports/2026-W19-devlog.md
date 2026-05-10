# Dev Log — 2026-W19 (May 4–10, 2026)

Editorial log of what got worked on this week and **why**. Companion to the weekly governance audit. Append-only — entries reflect intent at time of writing, not later edits.

## 2026-05-09 (Sat) — AI governance controls + audit-driven fixes

- **Stood up the weekly governance audit routine.** Why: Sentimetrx is developed primarily with Claude — we need recurring evidence of AI-generated code being reviewed. Built around `/audit-codebase`, `/security-check`, `/security-audit` slash commands installed at `.claude/commands/`. Routine runs Monday 4am ET, opens a PR for human review (the merge is the governance signal). First test-run scored **55.0 / 100** — baseline established.
- **Fixed CRITICAL XSS the audit flagged in `useSurveyEngine.ts`.** Why: 6 `innerHTML` sites in the customer-facing survey embed mixed AI/study-creator content into HTML. Wrapped with DOMPurify (`isomorphic-dompurify`).
- **Fixed related XSS in `public/clara-widget.js` + `nora-widget.js`.** Why: caught while sweeping for the same class of bug. Auto-linker in `fmt()` allowed attribute-injection via URLs containing `"`. Surgical fix (extend escape pass), no DOMPurify on customer-facing widget.
- **Bumped `eslint-config-next` 14.2.5 → 15.5.18.** Why: closes 6 of 8 `npm audit` findings. Stayed within 15.x to keep ESLint 8 compatibility — 16.x requires ESLint 9 (separate project).
- **Made `npm run lint` actually work.** Why: pre-existing — no `.eslintrc` ever existed. Added one. **3 real `react-hooks/rules-of-hooks` bugs surfaced** (`RegulationsDownloadBanner`, `TextMineModule`'s `CompareTab`, `WordCloud`) where hooks were called after early returns — fixed each. Audit-driven cleanup paid for itself.
- **Decision: not pushing the above commits yet.** Why: still pre-customer; no point spending money on production push cycles until launch.

## 2026-05-09 (Sat) — Pre-customer security sprint (commits before today's session)

- **8-sprint security sweep ahead of customer onboarding.** Why: bringing the codebase to a defensible posture before any production traffic. Sprints covered: cross-tenant route gating, auth hardening, account takeover, webhook signing, share-page iframe, cron auth, mass-assignment, formatHtml XSS, SSRF + PostgREST `.or()` hardening, CSRF middleware, RLS migration, requireAdmin sweep, secrets-in-headers, server-only checks, materialized-view RLS, rate limits, magic-link strict-check, function `search_path` pinning, xlsx dependency swap, SSR bump, CORS note.
- **Generated full-codebase security review report** (`docs/security-review-2026-05-09.md`) — kicked off the sprint sequence.

## 2026-05-08 (Fri) — Foundational testing + load infrastructure

- **Foundational test suite + CI wired up.** Why: prerequisite for the SOC 2 / "use of funds" investor narrative. Tests now run in CI on every push.
- **RLS isolation test** + **assert every public table has RLS enabled.** Why: cross-tenant leak is the single highest-risk class of bug for a multi-tenant SaaS. These tests fail loudly if a new table ships without RLS.
- **Town Hall load simulator (k6 + Playwright hybrid).** Why: need confidence Town Hall holds up under typical event traffic before customer events. Hybrid because k6 is fast for raw HTTP load, Playwright simulates real browser behavior including chat flow.
- **Town Hall: prompt-cached static system prompts.** Why: the static portions of the system prompt re-cost tokens on every turn. Caching them cuts per-turn cost meaningfully for high-volume sessions.
- **Town Hall chat: rate-limit per `participant_id`, IP as backstop.** Why: `participant_id` is the right identity unit (one human per id); IP is fallback for shared-IP scenarios.
- **Engineering Reality Check deck.** Why: investor narrative — "what got built, with the math behind it" — to back the use-of-funds slide.

## 2026-05-07 (Thu) — Admin sweep + Town Hall + decks

- **Phase E admin sweep**: admins can now read/edit/delete other-org bots, conversations, town halls, datasets, studies. Org filter on `/bots`, `/analyze`, `/townhall`. Why: support ops were blocked without cross-org visibility.
- **Standardized cross-org transfer**: active-only targets, audit log. Why: prior transfer flow was inconsistent and untraced.
- **Bot share links: rich Open Graph unfurl with bot name + branded card.** Why: shared bot links in Slack/Twitter looked unbranded — bad first impression for prospects.
- **Bot editor: TopNav consistency + sticky save/cancel + dirty gate.** Why: bot editor was an outlier UI-wise; users could navigate away with unsaved changes.
- **Migrated legacy bots (Nora, Clara, Datanautix Assistant) to dynamic pipeline.** Why: legacy bots ran on a separate code path — maintenance burden.
- **Auth: switch routes to cookie-only auth.** Why: hitting Supabase rate limits on bearer-token verification.
- **Password reset: route through `/auth/callback` so user lands on reset form.** Why: reset emails were dropping users on a generic logged-in page instead of the reset form.
- **Performance**: P1-P5 — collapsed N+1 queries, memoized TextMine filtered-row chain, lazy-loaded TextMine modal, ISR on `/b/<slug>`, pushed bot session-count dedup into Postgres.
- **Security**: S1-S2 — public-endpoint rate limiting moved to Postgres, validate Phase E `?org=` filter as UUID.
- **Multiple investor decks added/updated**: architecture deck + AI-at-the-Center hub-and-spoke diagram, /admin/decks one-click download page, roll-up deck (Before/After Sentimetrx, competitive landscape, origin story), insights deck quote validation.
- **Sentry error tracking + admin/health card.** Why: needed visibility into prod errors before any customer launch.

## 2026-05-06 (Wed) — TextMine depth + admin tooling + RLS migration

- **RLS migration**: enabled RLS on every public table + auth-client policies. Why: foundational. Some tables had `USING(true)` policies which caused a leak — those were dropped. Materialized view (`study_response_stats`) was handled via `REVOKE` rather than RLS (MV semantics).
- **Spec docs**: BOTS.md, USAGE_ACCOUNTING.md, DATA_SOURCES.md, SEARCH.md, SOCIAL.md. Why: build-from-scratch reference for each module — useful for onboarding, due diligence, and as a forcing function to surface inconsistencies.
- **TextMine deep work**: Insights tabs, modal calculations, theme/word % canonical formula, drill-down on insight values, opinion miner per-occurrence negation, AFINN negation valence-shifter, smart-bucket time-series, frequency-by-week chart on OpinionPopover.
- **Trending words / PulseIQ live strip + dataset top-words modal.** Why: makes TextMine's signal visible without requiring users to open each modal.
- **AI Usage and Cost Estimator** surfaced on admin panel + cog menu. Why: cost transparency for ops.
- **Per-user login tracking** for engagement / churn signals. Why: foundation for retention reporting.
- **Admin user transfer between orgs** + **disable-user-login flow.** Why: ops capabilities for support handoffs.

## 2026-05-05 (Mon) — TextMine search + week start

- **Full-text search across TextMine datasets** + **AI re-ranking layer**. Why: keyword search alone returned poor results on multi-concern queries; AI re-rank with `ts_rank`-ordered pre-filter is the right hybrid.
- **Search moved to dataset header modal** — available from all tabs. Why: prior placement was tab-specific.
- **Dropped dual-write to `dataset_rows`; flat is the only source of truth.** Why: cleanup from the prior dual-write migration; reduces a class of inconsistency bugs.
- **Deterministic per-dataset sampling on rows-endpoint.** Why: reproducible analytics — same dataset always returns the same sample.

---

## How to use this file

- **Append, don't rewrite.** Editorial entries reflect intent at time of writing.
- **Group by date (newest first).** Each entry: 1-2 sentences with the **why**.
- **The Monday 4am governance routine reads this file** for the week's narrative summary; falls back to git log if the file isn't present.
