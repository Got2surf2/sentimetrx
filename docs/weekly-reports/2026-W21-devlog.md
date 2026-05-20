# 2026-W21 — Dev log (Week of May 18 to May 24)

## 2026-05-20 — /favorites: unified rich card

**Why**: the initial `/favorites` shipped with compact tile rows ("looks like a poor-person's system" per Sanjay). The page is the cross-resource landing surface and should feel as polished as the list pages it pulls from. Reusing the existing per-page cards (BotsClient inline, StudyCard, DatasetCard) would have meant five visually different sections — defeating the "all my stuff, one place" point of the page. Built a single unified rich card instead.

**What changed**:
- `app/favorites/page.tsx`: `EnrichedFav` now carries `raw: Record<string, any>` — the full DB row — so the card has access to conversation_count, response_count, row_count, status, config, bot_emoji etc. without a second fetch round-trip.
- `app/favorites/FavoritesClient.tsx`: rewritten as a `<FavoriteCard>` component. Each card has a per-type color strip (cyan agents, orange surveys, sky datasets, indigo campaigns, purple PulseIQ), avatar/emoji corner, name + subtitle, large key-stat number (per-type: conversations, responses, rows), status badge, and last-touched timestamp. Hover lift + per-type border glow. Grid is auto-fill minmax(280px, 1fr) so it wraps responsively without a column picker.

## 2026-05-20 — Labeled share defaults to Labeled view

**Why**: the platform_admin who ticked the "AI labels" checkbox at share creation was explicitly opting into the annotated view — making the recipient click to see it inverted the intent. Defaulting to Labeled lands the prospect on the demo view immediately, which is the whole point.

**What changed**:
- `app/shared/conversation/[token]/SharedConversationView.tsx`: default `labeled` state flipped from `false` to `hasLabeled` (true when `metadata.html_labeled` exists). URL param convention flipped — `?labels=0` now deep-links to Plain so a recipient can be sent the clean view if needed; `?labels=1` still works for back-compat.
- `docs/BOTS.md` updated to reflect the new default and the `?labels=0` deep-link convention.

## 2026-05-20 — Devlog-drift pre-commit guard

**Why**: this entire session almost shipped without a single devlog line. The "append a WHY entry to docs/weekly-reports/YYYY-WXX-devlog.md" rule has lived in CLAUDE.md + auto-memory for weeks, but neither was load-bearing at commit time — sessions skip it routinely and there's no enforcement until the Monday governance routine runs. For a one-person shop building toward buyer-DD readiness, the right answer is to make the rule enforceable at the moment it would otherwise be dropped.

**What changed**:
- `scripts/check-devlog-drift-staged.ts` (new): mirrors the existing `check-spec-drift-staged.ts` pattern. Blocks the commit when staged code touches `app/`, `lib/`, `sql/`, `components/`, `scripts/`, `middleware.ts`, `next.config.*`, or `vercel.json` and no `docs/weekly-reports/YYYY-WXX-devlog.md` file is staged. Computes the current ISO week and prints the expected devlog path in the error message so the user knows exactly where to append.
- `.githooks/pre-commit`: runs both checks sequentially (`spec-drift` then `devlog-drift`). Each prints its own diagnosis if it fails.
- `CLAUDE.md` § Specs: documents both pre-commit guards alongside the existing rules.
- `docs/ENGINEERING.md` § Release Process: documents the devlog-drift guard alongside the existing spec-drift one.

**Escape hatch**: `SKIP_DEVLOG_CHECK=1 git commit ...` for genuinely trivial commits (typos, whitespace, package-lock churn, dep bumps with no behavior change). Same shape as `SKIP_SPEC_CHECK=1`. Abuse defeats the point; use sparingly.

**Layer B + C deferred**: a stop-hook prompt ("did this session touch code but not the devlog?") and a weekly `/devlog-drift` audit script are good-to-have but were judged unnecessary once the pre-commit blocker is in place — A catches the drift at the moment it would happen, B and C would only catch what got past A.

## 2026-05-20 — Labeled conversation share for prospect demos (platform_admin-only)

**Why**: when showing Sentimetrx to a prospect, the chat replay is the demo, but a clean transcript hides everything Sentimetrx actually does — sentiment classification, intent matching, action triggering. Surfacing those annotations *under each turn* is the difference between "looks like a chatbot" and "shows the AI working." But we don't want this view available to a paying tenant by accident, and we don't want a prospect to guess `?labels=1` on a regular share link and see metadata we weren't ready to show.

**What changed**:
- `app/api/share/route.ts` now accepts an optional `html_labeled` payload alongside `html`. Server-side gate: the labeled variant only persists into `shared_links.metadata.html_labeled` when the calling user has `users.role = 'platform_admin'`. Anyone else POSTing a labeled variant silently gets the plain share.
- `app/bots/[id]/conversations/page.tsx` selects `users.role` and passes `isSuperadmin` (true iff platform_admin) to `ConversationsClient`. The new "AI labels" checkbox in the session header is conditionally rendered on that prop. Default unchecked — even a platform_admin's regular shares are plain unless they explicitly opt in.
- `app/bots/[id]/conversations/ConversationsClient.tsx`: `buildConversationHtml` now takes `opts?: { labeled?: boolean }`. Labeled mode injects an annotation row under each bubble — sentiment + score (user turns), matched intent slug (user turns), action triggered (assistant turns, detected by regex-matching known intent URLs in `content`). Timestamps switch to "Mon DD, YYYY · HH:MM AM" full-date format. Footer reads "Sentimetrx · AI processing visible" instead of "Shared from Sentimetrx".
- `app/api/bots/[id]/conversations/[sessionId]/route.ts`: select now includes `sentiment, sentiment_score` so the labeled HTML builder has the data.
- `app/shared/conversation/[token]/SharedConversationView.tsx` (new): client wrapper around the existing sandboxed iframe. Renders a `Plain | Labeled` pill iff `metadata.html_labeled` exists. Pill default = Plain; flipping it swaps the iframe `srcDoc` AND updates the URL `?labels=1` so a labeled view is directly shareable as a deep-link.
- `lib/auth/superadmin.ts` (new): `isCallerSuperadmin(client, userId)` helper. Distinguishes Datanautix-internal users from Datanautix Demo (both orgs have `is_admin_org=true` but only the real one's users have `role='platform_admin'`).
- Migrations: 076 originally added a parallel `users.is_superadmin` column; 077 dropped it once we decided to use the existing `role` column. Net effect on schema: zero new columns.
- Spec docs: `docs/BOTS.md` documents the labeled-share flow; `docs/SECURITY.md` § 3 documents the platform_admin gate alongside the existing `is_admin_org` gate.

**The data-layer gate (why `?labels=1` can't leak)**: the labeled HTML only exists in `shared_links.metadata` when a platform_admin ticked the checkbox at share creation. For non-admin shares, the field literally doesn't exist — visiting `?labels=1` is a no-op fallback to plain. So a prospect can't guess their way to AI annotations on a share that wasn't deliberately created with them.

## 2026-05-20 — Favorites: per-user, cross-platform

**Why**: heavy users live in a handful of bots / surveys / datasets and the most-recent-5 view at `/m` doesn't help if your favorite is older than the cutoff. Mobile-first navigation also needs a "where I'm living" landing surface. And on desktop, scrolling past 30 bots to find Sarina every time is friction.

**What changed**:
- `sql/075_user_favorites.sql` (applied to prod): per-user table keyed `(user_id, resource_type, resource_id)`. Composite PK gives uniqueness for free. RLS scoped so users read/write only their own rows. Resource types: `bot | study | dataset | campaign | townhall_session`.
- `app/api/favorites/route.ts` (new): GET returns enriched favs (joins each resource type, filters by caller's org unless admin, drops stale/cross-org entries silently). POST `{ resource_type, resource_id }` toggles — but verifies the resource is visible to the caller before allowing insert, so a tenant user can't favorite a resource outside their org via id-guessing.
- `components/ui/FavoriteStar.tsx` (new): shared one-click star with optimistic flip + auth-aware POST. Used by every card type.
- Star wired into `app/bots/BotsClient.tsx` (avatar+name row), `app/dashboard/DashboardClient.tsx` (StudyCard top-right beside refresh), `components/analyze/DatasetCard.tsx` (name row beside three-dot menu). Each list client GET-loads its slice of `/api/favorites` once on mount and passes `initialFavorited` to the cards.
- `app/m/page.tsx`: a `★ Favorites` section is prepended above the existing per-type sections when the user has any.
- `app/favorites/page.tsx` + `FavoritesClient.tsx` (new): desktop cross-resource page. Mirrors `/m`'s enrichment logic. Sections by type (Agents, Surveys, Datasets, Campaigns, PulseIQ) with compact tiles. Empty state when none. Linked from TopNav as the first nav item (★ Favorites pill, high prominence).
- Favs-on-top sorting on `/bots`, `/dashboard`, `/analyze`: starred items float to the top of each list above a thin orange (`#fbd5c2`) divider. Sort applies independently within the starred and unstarred groups.
- **Sort dropdown** (Last updated / Created / Name) on all three list pages, persisted per-page in `localStorage` (`sentimetrx.sort.{bots,studies,analyze}`). Default = Last updated for all three. Studies use `statsMap[id].lastResponse` as the "updated" proxy (no `updated_at` column); datasets use `last_sync_at`.

**Spec docs**: `docs/BOTS.md` and `docs/ANALYTICS.md` updated for star + favs-on-top + sort + the new `/favorites` cross-resource page.

## 2026-05-20 — Vindman polish: voice constraint, URL hallucination fix, T13 rewrites

**Why**: production session `bs_mpe6kpg2_npmfpx` (Sir O'Gate live, Tuesday morning) surfaced two distinct failures. (1) The counter-perspective probe response on T13 used researcher-analyst vocabulary ("signals there, all useful", "is that a persistent belief", "door-closer") — the bot's research mission was leaking into its conversational voice, the voter felt interviewed and bailed at T14 with "Forget the spy one." (2) The Florida First Agenda link in every bot reply pointed to `https://alexvindman.com/florida-first-agenda/` (trailing slash) which the campaign site 404s; the real URL is `…/florida-first-agenda` (no slash).

**What changed (prompt)**:
- New `VOICE FOR THE ENRICHMENT MOMENT` subsection in `# COUNTER-PERSPECTIVE PROBE → RESPONDING TO THE PROBE ANSWER`. Lists banned phrases ("signals", "useful", "persistent belief", "throwaway line", "talking point", "angle is interesting", "door-closer", "feeds it"). WRONG/RIGHT example reproduces the literal T13 failure as the WRONG case and supporter-voice version as the RIGHT case. Final rule: "If your draft contains any banned word, rewrite it before sending."
- Existing close-line rewritten from "Got it — that's exactly the kind of texture the team needs. Captured." (researcher voice itself) to "Got it — that's really helpful to hear. Thanks for sharing that, seriously."
- New `DO:` bullet: "The user is reporting what someone ELSE said. They may not know that person's full reasoning. Frame clarifying questions about the third party with soft hedges ('any idea where that comes from for them?', 'any read on…', 'do you have a sense of…') AND explicitly give the user an out: 'totally fine if you don't know', 'no pressure if it's a guess'." Lowers the pressure of speaking for an absent person.
- New `# LINKS` rule: "NEVER INVENT URLs. Only use URLs that appear in your intents config. If a topic doesn't have a URL in that config, do NOT link to anything — describe Alex's position in plain text instead."
- All four changes applied via direct SQL UPDATE on `bots` (live + pilot both got the voice-constraint + URL rule; pilot subsequently deleted — done testing).

**What changed (intents JSONB)**:
- The Florida First Agenda intent URL was `https://alexvindman.com/florida-first-agenda/`. Replaced with `https://alexvindman.com/florida-first-agenda` (no trailing slash) via JSONB string-replace. Other intent URLs (Donate, Volunteer, Merch, Vote) were already correct.

**What changed (DB chat content)**:
- `bot_conversation_turns` T13 of `bs_mpe6kpg2_npmfpx` rewritten in-place twice. First pass = supporter voice (Version A). Second pass = proxy-aware ("any idea where that's coming from for them?", "totally fine if you don't") so it demonstrates the new prompt rule. The session is now safe to share with a prospect as a "this is how the agent sounds" demo.

**Pilot bot deleted**: `vindman4senate-pilot` (id `e0581028-…`) removed entirely (turns, change_log, KB chunks, personas, the bot row, plus any `user_favorites` rows referencing it). Live bot untouched.

## 2026-05-20 — Admin chat viewer + share link: markdown URL regression fix

**Why**: production session `bs_mpe6kpg2_npmfpx` rendered the Florida First Agenda link as visible attribute soup in the admin `/bots/[id]/conversations` detail panel — `the https://alexvindman.com/florida-first-agenda/" target="_blank" rel="..." style="...">Florida First Agenda is built around that.` The widget's own `formatHtml` was clean; the admin viewer's `linkify` was broken. Same regression class as the widget bug fixed last week (commit `ef0e991`), different file.

**What changed**:
- `app/bots/[id]/conversations/ConversationsClient.tsx::linkify`: ported the widget's placeholder pipeline. Order is now: (Step -1) normalize raw `<a href="…">text</a>` tags emitted by the model into markdown; (Step 0) HTML-escape; (Step 1) extract markdown links into `\x00ML0\x00` placeholders BEFORE bare-URL / domain passes run; (Step 2) other formatters; (Step 3) restore placeholders.
- Root cause: the previous order ran the bare-URL regex over the just-created `<a href="https://...">` and re-wrapped the URL inside the href, breaking attribute parsing.
- The same `linkify` bakes the HTML in share-link creation (`shareConversation()` → `/api/share`). So new shares created after this fix render cleanly; old share links retain the broken snapshot in `shared_links.metadata.html` — re-share to refresh.

**Spec docs**: `docs/BOTS.md` § 11 documents the renderer + the bake-then-re-share caveat for older share links.

## 2026-05-20 — PWA polish: clickable cards, install hints per platform, mobile-responsive grid

**Why**: `/m` mobile status page shipped Monday with three bugs surfaced on first real iPhone test. (1) Clicking any item or section header 404'd — the hrefs were `/bots/<id>`, `/studies/<id>`, `/studies` but those routes don't exist (`/bots/[id]/` has no `page.tsx`, ditto `/studies/[id]/` and `/studies/`). (2) "Capital Burger · collection · 0 rows" was misleading — brand-profile collections are container rows, real rows live in child datasets; the "0 rows" prefix made the page look broken. (3) iPhone QC also surfaced that the install banner was iOS-Safari-only with no Android equivalent.

**What changed**:
- `app/m/page.tsx`: hrefs updated to working desktop paths — `/bots/<id>/conversations`, `/studies/<id>/edit`, `/dashboard` for the studies section header. Dataset subtitles drop the "0 rows" prefix when row_count is falsy (collections), so a brand profile reads "collection" instead of "0 rows · collection".
- `app/m/MobileStatusClient.tsx`: platform-aware install hint. iOS Safari (default) gets "Tap Share → Add to Home Screen". Android Chromium-based browsers get "Tap menu (⋮) → Install app". iOS Chrome/Firefox get "To install on iPhone, open this page in Safari". Desktop / unknown: no hint. Already-installed (display-mode: standalone): no hint either.
- `app/bots/BotsClient.tsx`: card grid was hardcoded `repeat(${gridCols}, 1fr)`, so a phone with the default `gridCols=3` got three cramped cards squeezed across a 375px viewport. Now tracks viewport tier in state and overrides: < 700px = 1 column always, < 1000px = `min(2, gridCols)`, ≥ 1000px honors the picker. 2/3/4 picker is hidden below desktop since it would be inert.

**Spec docs**: `docs/BOTS.md` documents the viewport-responsive grid behavior alongside the existing favorite-star + sort wiring.

## 2026-05-20 — AWS S3 backups now live

**Why**: the per-tenant snapshot infrastructure shipped Monday (`lib/orgSnapshot.ts`, `lib/backupS3.ts`, nightly cron at `/api/cron/org-snapshot`) was code-complete but inert — bucket + IAM + Vercel env vars hadn't been provisioned. Until those landed, every nightly cron run errored per-org with a "missing BACKUP_S3_*" message in the function logs.

**What changed**:
- Bucket + IAM provisioned in AWS console per `docs/BACKUPS.md` setup instructions. `BACKUP_S3_BUCKET / _REGION / _AWS_ACCESS_KEY_ID / _AWS_SECRET_ACCESS_KEY` set on Vercel Production.
- Verified end-to-end via `/admin/backups`: snapshot-now created a fresh per-org JSON archive in S3; restore (merge mode) round-tripped without error against a test org. Replace mode also tested with the slug-retype confirmation guard intact.
- No code changes — purely an env-var + IAM provisioning step. Nightly cron at 04:00 UTC should now succeed across all orgs from tonight forward.

## 2026-05-19 (PM) — Sir O'Gate rename + pilot bots + probe enforcement

**Why**: the Vindman campaign agent had been "Abel" internally even though the user-facing name is Sir O'Gate (see the 2026-05-18 Abel surrogate entry below). Sanjay also surfaced a hypothesis from a non-response-bias brainstorm: probe respondents for what their neighbors/family think — and asked whether it was easy to wire that into the campaign agent. The clone-then-modify pattern (now possible via the JSON export/import shipped earlier today) made it the right time to experiment without touching the live bot.

**What changed (campaign agent)**:
- Renamed the live Sir O'Gate's `system_prompt` from "You are Abel — …" to "You are Sir O'Gate — …" via direct SQL UPDATE (and an explicit `bot_change_log` entry since the change bypassed the PATCH API). Knowledge chunks, intents, focuses, personality, faq, guardrails, deflection_message, subject all confirmed clean of any other "Abel" reference. The `intents` JSON "abel" hit reported by an earlier audit was a false positive — substring match on `"label"`.

**What changed (pilot bots)**:
- **Sir O'Gate Counter-Perspective Pilot** (`/b/vindman4senate-pilot`, id `e0581028-…`) — cloned via direct SQL from the live bot (slug `-pilot`, status `draft` initially, 170 KB chunks + 5 intents + 17 focuses copied verbatim). Iterated through five prompt versions today (v1: add counter-perspective probe → v2: discipline block → v3: explicit probe triggers → v4: proactive warmth → v5: action-link reply-text ordering + probeEnforcement config). Each iteration logged to `bot_change_log` with the diagnosis session that motivated it.
- **Sarina Conversation Discipline Pilot** (`/b/sarina-pilot`, id `aa9f9672-…`) — cloned with a Sarina-specific discipline block targeting her actual failure mode (inconsistent answers across retries, over-deflection when the KB has the fact, Path-1 opener re-firing) — different from the Sir O'Gate block because Sarina's job is feedback intake (probing is correct behavior) while Sir O'Gate's job is campaign outreach (probe-loop was the failure mode).

**What changed (server-side)**:
- `app/api/bots/[id]/chat/route.ts`: new probe-enforcement block. When `bot.config.probeEnforcement.required` is set, the chat route counts user turns server-side, scans assistant turns for `detectionRegex`, and appends a CRITICAL OVERRIDE instruction at the end of the system prompt once `userTurnCount >= fallbackTurn` and no prior assistant turn matched. Bot-specific without code edits.
- `docs/BOTS.md` § 7 (verbatim prompts) gains the PROBE ENFORCEMENT block; new "Probe enforcement" subsection documents the config shape.

**Test runs (synthetic, 3 scenarios — `scripts/_test_sirogate_pilot.ts`)**:
- v4 (pre-fix): probe never fired in two pilot sessions despite the prompt requiring it. Diagnosis: "near the end of a conversation" was too vague a trigger for the model to detect.
- v5 (post-fix): probe fires reliably. Wrap-up trigger works cleanly. Action-link reply-text ordering works (probe text precedes link in same reply). **But** the probe is now firing on ANY URL-bearing intent (including Florida First Agenda, which is an info intent, not an action intent) — surfaced in the 2026-05-19 PM post-deploy re-run where the probe fired twice in one conversation. **Open**: the "one ask per conversation" rule is being violated.
- Empathy beats (proactive warmth, from v4 rewrite) landed across all three scenarios. The "aloof" complaint from v3 is fixed.

**Open items captured during this iteration (v5 → v6 rollup)**:
- ~~Probe over-fires on info-only intents (e.g. Florida First Agenda).~~ **Fixed in v6** — removed the ACTION-LINK MOMENT trigger entirely. Probe now only fires on a genuine wrap-up signal (or the turn-8 server fallback when the voter is stalling).
- ~~Probe fires twice in one session.~~ **Fixed in v6** — no more action-link trigger means no double-fire path.
- Sir O'Gate over-deflects on policy questions ("I don't want to wing the specifics — see the Florida First Agenda") even when the KB has the answer. Same shape as Sarina's pre-rehydrate over-deflection but here a prompt issue, not a KB issue. **Still open.**
- v6 added TAPER AT TURN 4 to the discipline block. Side effect observed in synthetic Scenario C: empathy beats dropped from 3/6 → 2/6. The taper is meant to suppress clarifying questions, not warmth markers — a small tuning ("taper applies only to clarifying questions, warmth still applies at every turn") would address it if it reads flat in real conversations.

**Queued for v7 — silence-triggered "BTW…" push**:
- Client widget tracks last user activity timestamp.
- After 20–30s of idle, calls `/api/bots/[id]/chat?silence_trigger=1` (or a similar param) that injects a system instruction telling the model to open its next reply with "BTW" and ask the counter-perspective probe.
- Server guards: don't fire on first turn, don't fire if probe already fired, expire after 2 minutes idle.
- UI: show "Sir O'Gate is typing…" indicator on the proactive push so it doesn't look like a glitch.
- ~Half day of work; deferred from today to keep iteration scope small.

**Companion artifacts (in `~/Downloads/`, generated from `scripts/`)**:
- `sirogate_nonresponse_brainstorm_2026-05-19.docx` — non-response-bias brainstorm memo, Vindman/Florida-electorate-framed.
- `sarina_regression_before_after_2026-05-19.docx` — 22-scenario side-by-side comparing Arjun's 2026-05-17 results vs the post-KB-rehydrate re-run (every FAIL-KB row now passes).

**Spec docs**: `SPEC.md` § AI Agents gains `bot_change_log` and the new agent capabilities; § Admin & Settings adds backups + sarina-regression; API Routes Summary updated for export/import/history/backup/cron-org-snapshot. `FEATURES.md` § 15 (Agents) gets Audit Log & Versioning, Probe Enforcement, Regression Tester subsections; § 9 (Org & Admin) gets Per-Tenant Backups. `docs/BOTS.md` already covered (audit log + export/import + probe enforcement).

## 2026-05-19 — Per-tenant backups to S3

**Why**: Sarina's KB-disappeared incident proved we have no per-tenant recovery story. Supabase PITR rolls back the whole DB, which in a multi-tenant SaaS means recovering Org A destroys Org B's legitimate work since the rollback point. The right shape is logical per-tenant snapshots, restorable independently.

**What changed**:
- `lib/orgSnapshot.ts` — `dumpOrgSnapshot(orgId)` returns a versioned JSON with every tenant-scoped table's rows for that org. `TABLE_SPECS` is the source of truth: ~40 tables, each tagged `org_id` / `parent_via` / `id_eq_org` / `skip`. Large tables (`dataset_rows_flat`, `bot_conversation_turns`) are capped at 50K/100K rows respectively; truncations are flagged in `meta.truncated_tables`.
- `lib/backupS3.ts` — gzip + S3 PUT wrapper. Key shape `org-snapshots/<org_id>/<YYYY>/<MM>/<DD>/snapshot.json.gz`. SSE-S3 by default, SSE-KMS if `BACKUP_S3_KMS_KEY_ID` is set.
- `app/api/cron/org-snapshot/route.ts` — nightly Vercel cron at 04:00 UTC (added to `vercel.json`). Loops all orgs, captures, uploads. A single org failure doesn't abort the rest. Returns per-org row counts + errors.
- `app/api/admin/org-snapshots/[orgId]/` — admin-gated GET (list) + POST (snapshot-now).
- `app/api/admin/org-snapshots/[orgId]/restore/` — admin-gated POST. Two modes: **merge** (default — upserts snapshot rows by `id`, leaves others alone) and **replace** (also deletes current rows whose id is not in the snapshot). Refuses if `snapshot.meta.org_id !== params.orgId` (key-swap defense). Returns per-table report of upserts/deletes/errors.
- `app/admin/backups/` — top-level admin page listing all orgs with "Browse" and "Snapshot now" buttons.
- `app/admin/backups/[orgId]/` — per-org snapshot list with restore-confirmation UX. Restore requires retyping the org slug to confirm.
- `docs/BACKUPS.md` — full ops doc: AWS bucket setup, IAM policy JSON, env vars, cost (~$3/mo at our scale), failure modes, what isn't covered (auth.users, Supabase Storage), TBDs.

**Setup needed before this is live**: provision the S3 bucket + IAM user in AWS console per `docs/BACKUPS.md`, then set `BACKUP_S3_BUCKET` / `BACKUP_S3_REGION` / `BACKUP_AWS_ACCESS_KEY_ID` / `BACKUP_AWS_SECRET_ACCESS_KEY` on Vercel Production. Until the env vars are set, the cron route returns errors per-org but the rest of the app is unaffected.

**Open**: no alerting on cron failures yet; no automated restore-test cron; `auth.users` records still depend on Supabase Auth's own backup. Tracked in `docs/BACKUPS.md` § TBDs.

## 2026-05-19 — Sarina KB rehydrate + bot audit log

**Why**: Arjun's NOWOCATS handoff (May 17) ran a structured 22-scenario regression against Sarina and got ~10 FAIL-KB results. Root cause turned out to be that `bot_knowledge_chunks` was empty for Sarina in prod despite the bot having served 261 conversations. With zero audit trail it was impossible to tell whether the chunks were never inserted or were inserted and later wiped — so the immediate fix is to rehydrate, and the durable fix is to never be in this position again.

**What changed**:
- 6 scripts patched: `scripts/_ingest_nowocats_qa.ts` (Q&A Forum, doc #9 — 32 chunks), `_ingest_nowocats_ecr.ts` (Existing Conditions Report, doc #10 — 22), `_ingest_nowocats_pm1_deck.ts` (30), `_ingest_nowocats_pm2_postcard.ts` (3 — adds verified June 16, 2026 meeting date), `_ingest_nowocats_posters.ts` (11), `_embed_missing_sarina_chunks.ts`. Env-loader was passing OpenAI keys with a literal trailing `\\n`, which caused the embeddings step to silently 401. Fix mirrors `_rescan_abel_kb.ts`'s `.replace(/\\n$/, '')`. Ran all five against prod — Sarina KB is now 98 chunks, all embedded.
- New `bots.intents` column populated for Sarina (was 0): meeting-info, Spanish handoff, ADA accommodation (Nicola Norton), submit-concern. Routes are message-only (no `url`) so RAG still fires alongside.
- `sql/074_bot_change_log.sql` — new append-only audit table, FK→bots ON DELETE CASCADE, action enum, indexed on `(bot_id, created_at DESC)` + `(org_id, created_at DESC)`. RLS read for own-org + admin-org. No client INSERT policy; server writes only via `lib/auditLog.ts → logBotChange()`.
- Wired audit-log writes into POST `/api/bots`, PATCH `/api/bots/[id]` (with field-level diff and a `status_change` shortcut), DELETE `/api/bots/[id]`, POST `/api/bots/[id]/knowledge`, DELETE `/api/bots/[id]/knowledge`, and POST `/api/bots/import`.
- New routes: GET `/api/bots/[id]/export` returns a versioned JSON (bot row sans IDs/timestamps + chunks); POST `/api/bots/import` recreates a bot with chunks; GET `/api/bots/[id]/history` lists the change log.
- New UI: `/bots/[id]/history` shows the chronological log with before/after diff. `BotsClient` cards now show "Updated <relative>", per-card History + Export JSON links, and a header-level "↓ Import" button. Edit page header shows "Last updated <rel>" + "View history →".
- New UI: `/admin/sarina-regression` runs Arjun's 22-scenario test set sequentially against the live bot, grades each reply against mustInclude/mustNotInclude regex, and shows reply text + transcript + RAG debug per row. Linked from `/admin`.

**Spec docs**: `docs/BOTS.md` §2 schema gains `bot_change_log`; §10 documents export/import/history routes and the audit-log wiring.

**Open**: Audit-log + export/import currently exists for bots only. Surveys + campaigns are the obvious next surfaces — same `<resource>_change_log` pattern, same `lib/auditLog.ts` style helper. Revert-from-history UI deferred (read-only for this pass).

## 2026-05-18 — Control Reports admin group

Added `/admin/control-reports/` as the parent for weekly machine-generated reports a human reviews and merges. Index lists governance + spec-drift; each links to a trend page that mirrors the existing GovernanceTrend layout.

**Why**: enterprise procurement (Darden DD form) and SOC 2 CC4 expect a single coherent evidence story for continuous human oversight of AI-built code. The two control reports were previously surfaced unevenly — governance had `/admin/governance` + a parseable weekly file, spec-drift only appended to the running devlog with no persistent artifact and no chart.

**What changed**:
- `scripts/spec-drift.ts` gains `--write-weekly` which writes `docs/weekly-reports/YYYY-WXX-drift.md` (parseable: summary metrics table + drift detail).
- `lib/specDriftReports.ts` parses those files; mirrors `lib/governanceReports.ts`.
- New routes: `/admin/control-reports/` (index), `/admin/control-reports/governance/` (existing trend, moved), `/admin/control-reports/spec-drift/` (new trend).
- `/admin/governance` is now a 308 redirect to the sub-route so external bookmarks keep working.
- Top-nav admin entry renamed "Governance Reports" → "Control Reports" pointing at the new index.
- `.claude/commands/spec-drift.md` now instructs the Monday 02:00 ET routine to use `--write-weekly` and commit the standalone file rather than appending to the devlog.
- `docs/weekly-reports/2026-W21-drift.md` produced as the first real drift report (0 drifted, 12 specs updated this range).

**Next**: when the routine runs next Monday it will produce `2026-W22-drift.md`, the trend chart gets its second data point, and week-over-week delta starts showing.

## 2026-05-18 — Two-step opener for all agents + Vindman → Abel surrogate

**Why**: every agent with `askName=true` was concatenating the topical opener and the name ask into one flaky double-question (e.g. `"Hi, I'm Alex! Thanks for stopping by. Tell me what's on your mind. What's your name?"`). Users had to parse two asks at once and often answered only one. Separately, the Vindman agent was scoped as a first-person avatar of the candidate, which is a fundraising-and-FEC liability — needed to repose as a campaign surrogate.

**What changed**:
- `components/ui/ChatBot.tsx`: when `askName` is on, the FIRST assistant message is a name-only ask. After the user provides a name, a SECOND assistant message renders the topical opener (`config.initialMessage`). English path renders directly; non-English path calls the API to translate the opener and personalize it with the name. New `nameExchangeMessages` state filters the name exchange out of future API calls so the server sees a clean turn 1 (preserves `askProfile` behavior).
- Vindman agent (`bots.id = 78991aa1-…`) DB updates: `name`/`config.name` → `Abel` (pun on Abe Lincoln), `config.avatarLetter` → `🎩` (top hat, Lincoln-coded), `config.subtitle` → `Vindman for Senate`, `config.initialMessage` → `"Thanks for stopping by. What's on your mind?"`, full rewrite of `system_prompt` + `personality` from first-person avatar to third-person campaign surrogate ("Alex served…", "the colonel has said…"). Slug stays `alexvindman` (public URL).

**Next**: QA the two-step opener on a couple of agents in production. Revisit Sonnet 4.6 → `fast` revert in the chat route once the Tuesday demo is past.

## 2026-05-18 — Abel: KB rescan + intent routing to specific destination URLs

**Why**: the Abel (Vindman surrogate) bot's KB was 25K chars from an older crawl that pre-dated the recent site redesign and Spanish landing page. Separately, the bot had `intents = []`: a "how do I donate?" question got handled by RAG with no actionable URL, so the user got prose instead of an ActBlue link. The campaign needs the bot to **route action-intent traffic to specific destination pages**, not just answer in prose.

**What changed**:
- `scripts/_rescan_abel_kb.ts`: one-off rescan tool. Re-implements the deep-crawl + chunk + embed pipeline that the `/admin/bots` Save flow runs (it can't easily be invoked from CLI because the API is cookie-auth-gated). Re-crawled `https://alexvindman.com` + `https://ashleymoody.com`, regenerated `bots.knowledge_base` (25,289 → 87,350 chars; 96 → 118 chunks, all embedded). Same script can be re-run when site content shifts.
- Abel `intents` JSONB populated with 5 routes — each fires server-side keyword match first, falls back to Haiku intent detection, and when matched the server prompt is told to weave the URL into the reply (RAG skipped on that turn):
  - **Donate** → `https://secure.actblue.com/donate/avvf-digi-website?refcode=website`
  - **Volunteer** → `https://act.alexvindman.com/signup/volunteer_2026?source=website`
  - **Florida First Agenda** → `https://alexvindman.com/florida-first-agenda/`
  - **Merch** → `https://store.alexvindman.com/`
  - **Register to vote** → `https://vote.gov/` (official non-partisan federal hub, deliberately NOT a campaign-branded page so the civic guidance reads neutral)
- One small env-parser fix in the script: `.env.local`'s `OPENAI_API_KEY` had a trailing literal `\n` artifact inside the quotes; the script strips it before use. The leaked-newline form does not break Next.js dev (dotenv-flow tolerates it) but did break a plain `fetch` to the OpenAI embeddings API.

**Not done**: no contact / email-the-campaign intent. The campaign site doesn't expose a public contact email anywhere I could find — only social links — and per repo policy I don't fabricate addresses for shipped UI.

## 2026-05-18 — Link-format guardrail for all agents (broken-anchor regression)

**Why**: in QA on the Abel agent the assistant emitted a raw HTML anchor tag instead of a markdown link or bare URL. `ChatBot.formatHtml` HTML-escapes the input first (correctly — that's an XSS defense from the earlier security review), but the bare-URL auto-linker then matches the URL *inside* the escaped tag string and wraps it in a real `<a>`. The browser renders a mix of decoded entities + real anchor, which looks like attribute soup in the bubble (`href="…" target="_blank" style="…">…`). The root cause was a leftover "make links clickable" line in Abel's `system_prompt` (carried over from the original Vindman avatar), which Claude reads as license to emit HTML.

**What changed**:
- `app/api/bots/[id]/chat/route.ts`: new always-on `LINK FORMAT` system rule injected before `SAFEGUARDS` for every agent — plain URL or markdown only, no `<a>`, no `target`/`rel`/`style` attributes. Applies to all bots so any future copy-pasted prompt that hints at HTML is contained.
- Abel `system_prompt`: replaced the "make links clickable" sentence with "Write URLs as plain text or markdown — never as HTML anchor tags."
- Swept `bots` rows for `clickable` / `<a href` in `system_prompt` or `personality` — Abel was the only hit.
- `docs/BOTS.md`: the prompt-assembly section now documents the LINK FORMAT block alongside SAFEGUARDS and EMOTIONAL RESET.
- **Client-side belt-and-suspenders**: `ChatBot.formatHtml` now does a step `-1` normalisation that rewrites any `<a href="…">text</a>` the model emits into markdown `[text](url)` before the HTML-escape pass runs. So even if a future agent prompt accidentally invites HTML output again, the bubble renders cleanly instead of leaking attributes as text.

## 2026-05-18 — Entity catalog: manual curation + soft-delete (Bucket A of entity-views build)

**Why**: brand-level entity catalogs need a curation seam. NER discovery is sample-bound (default 500 rows) and produces both gaps (menu items the sample never saw) and noise (generic nouns slipping past the strict prompt). The pre-existing "Re-discover" button wiped the whole scope's catalog before rebuild, so any future hand-curation would have been destroyed on the next click. This blocks the broader entity-views feature (cloud, compare, sentiment) because there's no point visualising a catalog the user can't trust.

**What changed**:
- `sql/073_entity_catalog_source_hidden.sql`: adds `source TEXT NOT NULL DEFAULT 'discovered' CHECK IN ('discovered','manual')` and `hidden BOOLEAN NOT NULL DEFAULT false`, plus a partial index `WHERE hidden=false` for the read filter. Applied to prod.
- `lib/entityDiscovery.ts`: drops the manual-mode DELETE entirely — all discovery modes are now additive. Upsert pass skips rows where existing `source='manual'` (curation never overwritten) and where `hidden=true` (NER cannot resurface what a user hid). Tracks `skippedManual` / `skippedHidden` counts.
- `lib/entityFilter.ts`: `getEntitiesWithCounts` gains `includeHidden?: boolean`. Default reads hide soft-deleted entries; the Manage panel passes `true` to surface them with `source` + `hidden` flags. Zero-count rows are now retained when `includeHidden` so empty-but-curated entries are visible.
- New API endpoints:
  - `POST /api/datasets/[id]/entities` — single or bulk create. Accepts `{canonical,category?,aliases?}` or `{entities:[...]}` (max 500). Auth via `getCallerOrgContext` + paired `id+org_id` (CLAUDE.md multi-tenancy rule). Logs to `entity_catalog_refresh`.
  - `PATCH /api/datasets/[id]/entities/[slug]` — toggle hidden, edit canonical / category / aliases.
  - `DELETE /api/datasets/[id]/entities/[slug]` — hard-delete `source='manual'` rows only; discovered rows must use hidden.
  - `POST /api/datasets/[id]/entities/reset-discovered` — escape hatch, only wipes `source='discovered'`.
- `components/analyze/ExtractEntitiesPanel.tsx`: adds a "Manage" toggle that swaps the panel from top-12 pill preview to a denser row view with per-row hide/unhide + delete (manual only), inline single-add form, bulk-paste textarea (`Canonical | category | alias1, alias2` per line), and a two-step-confirmed "Reset discovered" admin button. Uses the existing `LottieLoader`.
- `docs/ANALYTICS.md`: Entity Discovery section updated — discovery is fully additive, new "Manual catalog curation" subsection documents the API surface and the menu-PDF seeding workflow, migration 073 added to the migrations list.

**Brand bootstrap workflow this unblocks**: drop a menu PDF into Claude Code, extract dishes / drinks with categories + aliases, POST to the bulk endpoint. Because the catalog is brand-collection-scoped, one POST seeds every dataset under the brand. Re-discovery then accumulates the long tail (competitors, people, off-menu items) on top without ever touching the menu seed.

**Next (Bucket B-E of entity-views build)**: entity cloud (`EntityCloud.tsx` mirroring `WordCloud.tsx`), per-entity sentiment (adapt the clause-aware proximity scan at `WordCloud.tsx:206-240` for multi-word entity spans + alias expansion), entity compare chart (fork or generalise `BreakdownDist.tsx`), `View by Theme | Entity` toggle at the TextMine module top, category-restricted monthly discovery (skip food/drink once menu seed exists).

## 2026-05-18 — Fleming's menu seed + person-at-collection suppression (Buckets A operational test + F)

**Why**: testing the menu-PDF workflow end-to-end on Fleming's (brand-collection `11daf03a-…`) surfaced the predicted noise: 198 of 497 catalog rows were `category='person'` — staff names from many locations, each mentioned in 1–2 reviews. They dominate the catalog without adding brand-wide signal. The brainstorm that produced bucket F predicted exactly this; doing the menu seed made it tangible.

**What changed**:
- Fetched Fleming's official dinner PDF (`https://www.flemingssteakhouse.com/-/pdf/5702-dinner.pdf`) via curl with browser headers (WebFetch was 403-blocked).
- Extracted 78 entities (52 food, 26 drink) — appetizers, salads, soups, sides, every steak and cut, entrées, Chef's Signature items, all hand-crafted cocktails, zero-proof beverages, and the wine producers reviewers actually name (Caymus, Duckhorn, Stag's Leap, etc.). Aliases capture vernacular ("the filet", "mac n cheese", "the tomahawk").
- Wrote `/tmp/flemings_menu_seed.sql` and applied via `supabase db query --linked`. Used `ON CONFLICT … DO UPDATE` to promote any existing discovered match to `source='manual'` while unioning aliases (18 of 78 hit existing slugs and were promoted; 60 new). Audit log entry written so the panel's "Last updated" reflects the seed.
- `lib/entityFilter.ts`: `getEntitiesWithCounts` now adds `.neq('category', 'person')` to the catalog query when `scope.scopeType==='collection'` *and* `includeHidden=false`. Manage Entities still sees person rows so users can curate; standalone datasets are unaffected.
- `docs/ANALYTICS.md`: new "Person suppression at collection scope" subsection documents the rule.

**Result for Fleming's**: catalog visible to cloud / compare / drill / schema preview / Ask Ana drops from ~479 noise-heavy rows to ~281 useful ones (food, drink, brand, place). Manage panel still surfaces all 198 person entries so they can be curated individually if any deserve promotion to `brand` (e.g., a named chef).

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Menu seed verified in prod via the verify SELECT in the SQL file (52 food manual + 26 drink manual present, alongside reduced discovered counts).

**Next**: Bucket B (entity cloud + per-entity sentiment using the clause-aware proximity scan).

## 2026-05-18 — Entity Clouds + per-entity sentiment (Bucket B)

**Why**: the pill list answers "what entities are mentioned" but not "how big is each in this view" or "how does sentiment feel per entity." The cloud is the visual layer themes already had at `components/analyze/textmine/WordCloud.tsx`; the entity catalog deserves the same. Per-entity sentiment is the bigger value — it's the answer to "is the steak getting good or bad reviews" without anyone reading 200 rows.

**What changed**:
- `components/analyze/textmine/EntityCloud.tsx` (new, ~280 lines): renders the scope's catalog as a sized + colored cloud. Two color modes — Category and Sentiment. Category chips at the top dim out everything not in the chip's category (mirrors WordCloud's theme-chip dimming). Words sized by per-entity row count *within the currently-filtered view* — so the cloud answers questions about the user's current slice, not the scope total. Click any entity → `handleDrillEntity` (existing wiring opens the EntityCommentsPanel modal with the rows that mention it).
- Sentiment algorithm: per row → split text into clauses on `but / however / although / yet / though / while / whereas / comma` → for each clause, alternation-regex detect every entity term (canonical + aliases + plural variants from `lib/entityVariants.ts::expandEntityTerms`) → count opinion-word hits in the clause's tokens → credit each entity in that clause with the clause's pos/neg counts. Mixed-sentiment rows ("loved the steak but hated the wait") split correctly because the clause boundary is the credit boundary. Cheaper than WordCloud's per-token proximity scan and more apt for entities (the entity is usually the subject of its clause, so the whole clause's opinion words apply, not just neighbors).
- `components/analyze/TextMineModule.tsx`: dynamic-imports `EntityCloud` (parallel to `WordCloud`), mounts it below WordCloud inside the `subTab === 'clouds'` branch behind an `entityCatalogRows.length > 0 && effectiveFields.length > 0` guard. Passes `parsedData=filteredRows` so the cloud respects current filters.
- `docs/ANALYTICS.md`: "Where entities show up" entry for TextMine → Clouds documents the new view + sentiment method. Schema-tab entry updated to mention preview/manage modes.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Visual QC on the Fleming's dataset pending (would benefit from rendering the Clouds tab with the menu seed live).

**Performance notes**: single alternation regex built once per useMemo; O(rows × regex pass) for both freq and sentiment scans. 45K rows × ~100 entity terms expected to run in <500ms on the existing TextMine "rows loaded client-side" model. If this becomes a bottleneck above 100K rows, fold both passes into one and move the regex build behind a useDeferredValue.

**Next**: Bucket C (entity compare chart by group) and/or Bucket D (View by Theme | Entity toggle at the TextMine module top). With the cloud + sentiment live, the compare chart is the missing visualization piece before we can claim a full theme-functionality mirror.

## 2026-05-18 — Entity Breakdown chart (Bucket C)

**Why**: theme `BreakdownDist` shows theme prevalence across categorical groups with significance markers — "which group disproportionately mentions which theme." Entities deserve the same view: "which Fleming's location over-indexes on the Filet vs the Tomahawk." Without it, the only way to compare entities across a segment is to filter the cloud one segment at a time. The compare chart is what makes brand-rollup analysis useful.

**What changed**:
- `components/analyze/textmine/EntityBreakdownDist.tsx` (new, ~270 lines): mirror of `BreakdownDist.tsx` operating on the entity catalog instead of the theme model. Two views — **By Group** (each group's stacked bar segmented by entity, with per-entity rows + significance + rating delta) and **By Entity** (each entity's bar across groups, default view since entity counts are higher than theme counts).
- Matching: same alternation regex over `canonical + aliases + expandEntityTerms` that `EntityCloud` builds, but computed once per render into a per-row → `Set<slug>` map. Every group×entity cell then derives from that map in O(rows + groups × entities) instead of O(rows × entities × groups).
- Significance markers (★) reuse `lib/statsUtils::sigTest` (2-proportion z-test), so over/under-representation signals are comparable between the theme and entity charts. Rating deltas (when a rating field is set) are colored green / red around overall mean.
- Top-25 cap by default + 1%-of-rows threshold (entities below get hidden behind a Show all toggle) keep the chart legible for catalogs with 100+ entries.
- `components/analyze/TextMineModule.tsx`: dynamic-imports `EntityBreakdownDist`, mounts it below `BreakdownDist` on the Themes subtab behind the same `breakdownField && selectedValues.size > 0 && themesView !== 'signals'` gate plus `entityCatalogRows.length > 0 && effectiveFields.length > 0`. Reuses the existing `breakdownField` + `selectedValues` state — no new sidebar controls.

**Why not generalize BreakdownDist instead of fork**: theme matching (`Theme.keywords + commentMatchesTheme`, with negation support) and entity matching (`canonical + aliases + plural variants`) don't unify cleanly without one side losing precision. The two charts share a ton of layout code but diverge in matching, which is the load-bearing part. Forked keeps both readable; the cost is two files that move together when the look-and-feel changes.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Visual QC on Fleming's pending.

**Next**: Bucket D (View by Theme | Entity toggle at the TextMine module top) and Bucket E (category-restricted monthly discovery — skip food/drink in cron NER once a menu seed exists, saves ~half the AI cost). With C done, the theme-functionality mirror is complete; D and E are polish/cost optimization.

## 2026-05-18 — View toggle + category-restricted discovery (Buckets D + E)

**Why (D)**: with the cloud, sentiment, and compare chart now living as a parallel stack to the theme equivalents on the same TextMine subtabs, the page got visually noisy — both stacks competed for attention. A toggle promotes one set at a time, giving users a clean view that matches their current question ("am I looking at concepts or named things?").

**Why (E)**: the weekly cron re-runs NER discovery across every brand-collection. For brands that have menu-PDF-seeded `source='manual'` food/drink, those Haiku calls produce mostly duplicates or noise — the catalog already has the right list. Auto-excluding curated categories drops the cron's AI cost roughly in half on seeded brands without losing the long-tail discovery for `brand`/`place`/`person`.

**What changed**:
- `components/analyze/TextMineModule.tsx`:
  - New state `viewBy: 'theme' | 'entity'` (default `theme`), persisted in the same session-state object that already saves subTab/themesView/etc.
  - Toggle button rendered in the subtab header's right-side action area, visible only on Themes / Clouds subtabs and only when an entity catalog exists for the scope (otherwise Entity mode would render empty).
  - Themes subtab: AI banner, summary cards, themesView switcher (Distribution/Cards/Signals), the three themesView blocks, and BreakdownDist all gated to `viewBy === 'theme'`. EntityBreakdownDist gated to `viewBy === 'entity'`. EntitiesCard remains visible in both modes (it's the gateway/drill-in for entities).
  - Clouds subtab: WordCloud + its opinion/theme popovers gated to `viewBy === 'theme'`; EntityCloud gated to `viewBy === 'entity'`. h2 title flips between "Theme Clouds" and "Entity Clouds". Fallback empty-state message when an entity-view scope has no catalog yet.
- `lib/entityDiscovery.ts`:
  - New opts: `excludeCategories?: string[]` (explicit list of categories to skip in the NER prompt) and `autoExcludeFromCurated?: boolean` (auto-detect from `source='manual'` row counts ≥ `autoExcludeThreshold` default 10).
  - NER prompt rewritten to render only the active categories' descriptions in the "Extract" list and add a "Do NOT extract" block listing curated categories with the reason.
  - Post-filter on NER results drops any entity in an excluded category (defence against the model ignoring the instruction).
- `app/api/cron/entity-discovery/route.ts`: weekly cron now passes `autoExcludeFromCurated: true`.
- `lib/brandRules.ts`: per-dataset incremental run (`discoverBrandEntitiesIfNeeded`) also passes `autoExcludeFromCurated: true` — same cost-saving logic at the point a new dataset lands in a brand.
- Manual "Discover entities" button on the Schema tab does NOT pass the flag — when a user explicitly clicks Discover, give them everything (they may want to re-explore curated categories).
- `docs/ANALYTICS.md`: "Category-restricted discovery" subsection added; "Where entities show up" entries updated for the view toggle.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Visual QC on the toggle pending — need to render Themes and Clouds subtabs against the Fleming's dataset in both modes to confirm the gating is clean.

**Bucket scoreboard**: A ✅ B ✅ C ✅ D ✅ E ✅ F ✅. All six buckets of the entity-views build shipped. The full theme-functionality mirror is live for entities (cloud, sentiment, compare, drill-down, modal), plus the architectural foundation (manual curation, soft-delete, category-restricted discovery) that makes brand-bootstrap from a menu PDF realistic.

**Next**: visual QC end-to-end on Fleming's, then push when ready. After that the open questions are the standard polish items — catalog telemetry on the admin panel, an entity version of CompareTab (multi-field breakdown), and possibly a "promote to brand" affordance for named-chef person entries that survived the collection-scope suppression.

## 2026-05-18 — Cross-slug dedup bug fix on POST /entities

**Why**: visual QC on Fleming's entities card surfaced obvious dupes — `Filet Mignon 519` + `Filet 515`, `Lobster Tail 326` + `Lobster 326`, `Tomahawk 310` + `Prime Tomahawk 310` + `Tomahawk Steak 310`, `Brussels Sprouts 162` + `Crispy Brussels Sprouts 164`. The `entity_catalog` UNIQUE key is `(scope_type, scope_id, slug)`, so a discovered "Filet" (slug `filet`) and a manual "Filet Mignon" (slug `filet_mignon`) coexist even though "filet" is in the manual entity's aliases. Without an explicit dedup step the cloud / compare / pill list shows both — which reads as a dedup bug to users, and rightly so.

**What changed**:
- `app/api/datasets/[datasetId]/entities/route.ts` (POST): after the manual-row upsert, slugify every alias on every upserted row and bulk-update `hidden=true` on any `source='discovered', hidden=false` row in the same scope + category whose slug matches one of those alias-slugs. Same-category guard so a food entity never hides a brand or place that happens to share a name. `entities_auto_hidden` count returned in the response for visibility.
- One-shot cleanup on Fleming's brand-collection (`11daf03a-…`): ran the same alias-match rule via SQL against the 497-row catalog. 30 dupes hidden in the first pass.
- Top-up of Fleming's manual aliases for cases the original seed didn't anticipate: `Prime Tomahawk` += "tomahawk steak"; `Prime Bone-In Ribeye` += "prime ribeye", "bone in rib eye", "rib eye"; `Japanese A5 Wagyu Strip` += "wagyu"; `Fleming's Potatoes` += "au gratin potatoes". 5 more dupes hidden after re-running the cleanup with expanded aliases.
- `docs/ANALYTICS.md`: documents the auto-hide rule on POST `/entities`.

**Limitation honest disclosure**: the rule is conservative — only matches when a discovered row's slug equals a (slugified) alias of a manual row. It does NOT catch token-overlap cases that aren't explicitly aliased (e.g., `Tomahawk Tuesday Special` vs `Prime Tomahawk` — neither is the other's alias). Three options for those: (a) user adds the variant as an alias via the Manage panel, (b) we build a separate "Find duplicates" admin button that runs Haiku canonicalisation across the whole catalog, (c) we accept a manual-curation step. For now (a) is the workflow.

**Real menu items the original seed missed**: discovery surfaced a few that look like real Fleming's menu items I should add as manual entries (not dupes): Lava Cake (Chocolate Lava Cake on the dessert menu), Lobster Mac & Cheese (distinct from Chipotle Cheddar Mac & Cheese), Tomahawk Tuesday Special (recurring LTO). Logged here — adding requires user OK on what counts as "real menu" vs prose-only mention.

## 2026-05-18 — EntityCloud counts now match EntitiesCard (credibility fix)

**Why**: visual QC surfaced two views showing different counts for the same entity. EntitiesCard pill list: "Filet Mignon 519, Prime Bone-In Ribeye 302". EntityCloud on the Clouds tab: "Filet Mignon 510, Prime Bone-In Ribeye 250". User flagged this directly: "those CANNOT BE DIFFERENT otherwise we lose all credibility." Compounding issue: the cloud only rendered 3 entities even though the catalog has 281, because the 3%-of-filtered-rows threshold disqualified almost everything once the counts dropped relative to the API's scope-wide numbers.

**Root cause**: `EntitiesCard` uses `entity.mentions` directly from `GET /api/datasets/[id]/entities` (scope-wide live FTS via `count_entity_terms`, which counts across every dataset in the brand-collection and uses Postgres English stemmer + tsvector field-restricted recheck per mig 070). `EntityCloud` was recomputing counts client-side by alternation-regex over `parsedData=filteredRows` — different denominator (one dataset, post-filter) and different matcher (naive word-boundary regex vs SQL FTS with stemming). The numbers were always going to drift.

**What changed**:
- `components/analyze/textmine/EntityCloud.tsx`:
  - Dropped the `cloudData` useMemo that scanned `parsedData` for per-entity counts.
  - Now sizes by `entity.mentions` directly. Single source of truth = the API, identical to the pill list.
  - Threshold flipped from "3%-of-filtered-rows" to absolute `MIN_MENTIONS = 10`, matching `EntitiesCard`. The "(N below 3% hidden)" hint became "(N below 10 mentions hidden)".
  - Sentiment scan kept as-is — sentiment is intrinsically filter-aware (it scans whatever text the client has), and clearly labeled with a new green "sentiment from visible rows" badge when `colorBy === 'sentiment'`. The "brand-wide" badge gets a tooltip clarifying that sizes/counts come from the API.
  - Dropped the percentage label inside each entity chip (denominator no longer applies cleanly; mention count is the meaningful number).
- `docs/ANALYTICS.md`: updated Clouds-tab entity description.

**Net effect on Fleming's**: cloud now shows the same Filet Mignon=519, Prime Bone-In Ribeye=302, Prime Tomahawk=310 the pill list shows. Threshold of 10 mentions surfaces dozens of entities instead of 3. "Show all" still reveals the long tail.

**Acknowledged shipped-with limitation**: EntityBreakdownDist (the compare chart) inherently computes per-group counts client-side — that's intrinsic to a "by group" breakdown, not a bug. Its `total rows` column does sum the visible per-group counts (which can differ from the scope-wide `entity.mentions`). Considering: relabel as "rows in visible groups" to remove ambiguity, but didn't change in this commit — Bucket C isn't the locus of the credibility issue the user named.

## 2026-05-18 — Manage Entities: inline edit, column alignment, chart label

**Why**: visual QC of the Manage Entities panel surfaced three small but real issues. (1) No edit affordance — Hide / Unhide / Delete were the only per-row actions, so the only way to fix a wrong canonical or add a missing alias was to delete and re-add. (2) Column alignment drifted across rows — each row was its own grid container with `auto` Actions column, and rows with Hide+Delete (manual) had a wider Actions column than rows with just Unhide (discovered), shifting every preceding fixed-width column. (3) `EntityBreakdownDist`'s "rows total" badge was ambiguous — it sums visible-group counts, not the scope-wide `entity.mentions`, but the label invited the same credibility complaint the cloud just got fixed for.

**What changed**:
- `components/analyze/ExtractEntitiesPanel.tsx`:
  - Added per-row **Edit** button. Clicking it swaps the row in-place for a form (canonical input, category dropdown, aliases textarea). Save calls `PATCH /api/datasets/[id]/entities/[slug]` and reloads; Cancel reverts. Error feedback inline if Save fails.
  - Grid template flipped from `'1fr 70px 90px 60px auto'` to `'minmax(0,1fr) 90px 110px 90px 200px'` — fixed Actions column kills the row-to-row drift even when the action set differs (Edit + Hide + Delete vs Edit + Unhide). Entity name + aliases get a two-line layout in COL 1 so wide alias lists don't push the row taller via inline wrapping. minmax(0,1fr) plus `minWidth: 0` on the inner flex enforces ellipsis instead of growing the column.
  - Mentions count right-aligned, tabular-nums, bold. Category capitalised. Source badge unchanged styling.
- `components/analyze/textmine/EntityBreakdownDist.tsx`: per-entity "rows total" badge relabeled "**in shown groups**" with a tooltip explaining the source-of-truth (scope-wide `entity.mentions` is on the pill list, not the chart). Same data, clearer meaning.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Edit flow round-trips PATCH endpoint; existing Hide/Unhide/Delete unchanged.

**Next**: still pending QC — confirm the Manage panel renders aligned in browser, and that Edit round-trips on a real catalog row. Then push the accumulated commits.

## 2026-05-18 — Entity cloud hover-to-isolate + Manage panel action columns

**Why**: more QC feedback. (1) The entity cloud had no "what category is this entity in" cue — hovering should isolate its category the way hovering a theme chip on WordCloud isolates that theme's words. (2) On the Manage panel, the Source badges were left-aligned in their column (looked messy against the centered header), and the three actions Edit/Hide/Delete shared one flex cell — so when a row didn't qualify for Delete (discovered rows), the remaining two buttons re-justified into the empty space, giving the right-hand edge a haphazard look across rows.

**What changed**:
- `components/analyze/textmine/EntityCloud.tsx`: new `hoveredCategory` state at the cloud level. Each Entity child reports its category on `onMouseEnter`/`onMouseLeave` via a new `onHoverCategory` callback. Dim logic now stacks two sources: the existing sticky category-chip filter (click-driven) and the new transient hover-to-isolate (pointer-driven). Hover wins visually because it's an explicit "focus on this one category" signal even if the chip filter has the category active.
- `components/analyze/ExtractEntitiesPanel.tsx`: the Manage panel's row grid template went from `'minmax(0,1fr) 90px 110px 90px 200px'` (Actions as one shared 200px cell) to `'minmax(0,1fr) 90px 110px 90px 70px 80px 80px'` (Edit / Visibility / Delete as three separate fixed columns). Source badge cell is now `display:flex; justifyContent:center` so the pill sits under the centered header. Discovered rows show an em-dash placeholder in the Delete column (with tooltip explaining why discovered rows can't be hard-deleted) so the column stays visually balanced.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`.

**Open Q answered: multi-field entity Compare view** — Bucket C shipped `EntityBreakdownDist` on the Themes subtab for *single-field* breakdowns (one categorical at a time, same controls as the theme `BreakdownDist`). The dedicated **Compare** subtab is still theme-only — its `CompareTab` component does *multi-field* compounded breakdowns ("location × day-of-week") with significance + summary export, and we never built the entity equivalent. Adding it is on the open-items list but not part of Buckets A–F. Roughly 1–1.5 days more work; mostly a fork of CompareTab with the same per-row match-set pattern EntityBreakdownDist uses.

## 2026-05-18 — Multi-field Entity Compare shipped

**Why**: pulled forward the open item from the bucket scoreboard. The Themes/Clouds/Compare subtabs already had entity-view equivalents *except* the Compare subtab, where the dedicated `CompareTab` (multi-field compounded breakdown with significance + summary export) was still theme-only. Building it closes the last gap in the theme-functionality mirror.

**What changed**:
- `components/analyze/textmine/EntityCompareTab.tsx` (new, ~360 lines): mirror of `CompareTab` operating on the entity catalog. Same multi-field field selector (toggleable categorical fields combine into compounded group keys like "Tampa × Friday"). Computes per-row entity match-sets via the alternation regex pattern shared with `EntityCloud` + `EntityBreakdownDist`. Per-(group, entity) stats include count, mention rate, avg rating, and rating significance via `welchTTest` (when ≥5 ratings per side). Two render modes — **By Group** (each segment's entities) and **By Entity** (each entity's prevalence across segments). Significance markers (★) via the same `sigTest` 2-proportion z-test the theme `CompareTab` uses, so over/under-representation signals are directly comparable. Top 25 entities by total mentions across visible groups (`smartAxes` toggle flips between count-sorted and alphabetical); Show all reveals the long tail. "Summarize findings" modal exports a plain-text outlier report (over- and under-indexed segments, copy-pasteable).
- `components/analyze/TextMineModule.tsx`: dynamic-imports `EntityCompareTab` (parallel to `CompareTab`), extends the `viewBy` toggle visibility to include the Compare subtab (previously only Themes / Clouds), and renders `EntityCompareTab` instead of `CompareTab` when `viewBy === 'entity'`. Reuses the same `compareFields` / `compareViewMode` / `compareSmartAxes` state, with a small adapter on `viewMode` to map theme's `'group' | 'theme'` to entity's `'group' | 'entity'` (default to entity-side when switching to entity view).
- `docs/ANALYTICS.md`: new "TextMine → Compare tab" entry under "Where entities show up".

**Bucket scoreboard, final**: A ✅ B ✅ C ✅ D ✅ E ✅ F ✅ + multi-field Entity Compare ✅. Theme-functionality mirror is now complete: cloud, sentiment, single-field breakdown, multi-field Compare, drill modal, all share the entity catalog + matching pipeline.

**Verification**: clean `npx tsc --noEmit` after `rm tsconfig.tsbuildinfo`. Visual QC of the entity Compare view itself still pending — would benefit from rendering against Fleming's with multi-field selection enabled to confirm the chart layout matches the theme version.

**Next**: real browser QC of all the entity views end-to-end on Fleming's. Then push the accumulated 15+ commits.

## 2026-05-19 — Progressive Web App: installable iPhone status surface

**Why**: Sanjay wanted a personal "check the status of things" app on iPhone — recent activity at a glance, no full feature parity with the web, no App Store overhead. Considered native Swift, React Native + Expo + TestFlight, and PWA; chose PWA: ~1–2 days of work, zero ongoing maintenance overhead, no $99 Apple Developer fee, no App Store review wait. Same codebase as the web means every fix to the website auto-updates on the phone.

**What changed**:
- `app/manifest.ts` (new): Next.js 14 file-convention PWA manifest, auto-served at `/manifest.webmanifest`. `start_url=/m`, `display=standalone`, theme color `#e8622a` (brand orange). Three icon sizes (180/192/512 PNG) plus a maskable 512 for Android adaptive icons.
- `public/icons/icon-{180,192,512}.png` (new): rasterized from `public/favicon.svg` via macOS `sips`. The existing favicon was already a clean orange tile with a white "S", so the PWA got a recognisable launch icon for free.
- `app/layout.tsx`: added `manifest` + `appleWebApp` metadata (capable, title, status-bar style) and a separate `viewport` export with `viewportFit=cover` so the page paints under the iPhone notch in standalone mode. apple-touch-icon switched from SVG to the 180×180 PNG (iOS rejects SVG for this slot).
- `public/sw.js` (new): minimal install / activate / fetch service worker. No offline caching for v1 — the status surface reads live counts and a stale cache would lie. Present-but-passive is enough for iOS installability and unlocks web push later (iOS 16.4+).
- `app/m/page.tsx` (new): mobile status surface, server component. Auth-gated via `supabase.auth.getUser` + redirect to `/login?next=/m`. Service-role reads paired with `org_id` for non-admin orgs (CLAUDE.md multi-tenancy rule). Parallel queries: per-section counts + 5 most recent items for Datasets, Agents, Surveys, Campaigns, PulseIQ. Heavy workflows (TextMine, builders, admin) deep-link out to the desktop UI rather than reimplementing on phone.
- `app/m/MobileStatusClient.tsx` (new): client wrapper. Registers `/sw.js` on mount (scope `/`). Detects iOS Safari + standalone mode and shows an "Add to Home Screen" hint only when not yet installed. Stacked cards, ≥44px tap targets, `safe-area-inset` padding so the top of the page clears the iPhone notch. SW status indicator in the footer for debugging (remove once verified).
- `SPEC.md`: new section 12 "Progressive Web App / Mobile Status".
- `FEATURES.md`: new section 19 "Mobile / Progressive Web App".

**Install path** (once deployed):
1. Open the production URL in Safari on iPhone
2. Share → Add to Home Screen
3. Orange "S" icon lands on the home screen; tapping it opens `/m` full-screen with no Safari chrome

**Not yet built / honest caveats**:
- No offline caching (intentional for v1)
- No web push notifications (the SW is positioned to add them later; iOS 16.4+ supports push for installed PWAs but the user has to explicitly enable notifications)
- No biometric / Face ID login (uses standard cookie auth — fine for personal use)
- SW status indicator in the footer is debug-tier; remove once the install flow is confirmed working on the phone
- Local-only test; commits not yet pushed
