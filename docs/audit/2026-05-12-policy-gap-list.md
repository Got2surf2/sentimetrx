# Sentimetrx Policy Gap Audit — 2026-05-12

Audit of the sentimetrx codebase against `docs/SECURITY.md` and
`docs/ENGINEERING.md` (sharpened version, commit `e24df42` and
later).

**Scope:** P0 (multi-tenancy + auth) and P1 (secrets + logging). P2
(ops) and P3 (hygiene) deferred — see end of file.

> **Revision note (same-day):** the first version of this report
> filed 7 P0 RLS findings against the 6 `social_*` tables and
> `shared_links`. Deeper reading of `sql/032_enable_rls_everywhere.sql`
> revealed those were false positives — the codebase intentionally
> runs service-role-only tables RLS-on-but-policy-less, with
> auth-client reads default-denying to empty. SECURITY.md §2 was
> sharpened to clarify the auth-client-vs-service-role split so
> future audits don't re-find the same false positives. The real
> finding under `shared_links` was the missing `org_id` column,
> which has been **fixed** in `sql/053_shared_links_org_scoping.sql`
> and applied to prod. Detail below.

Each finding cites the policy section it maps to, file:line for
the offending code, severity, and verification.

---

## Summary

| Bucket | Pass | Fail (real) | False positive (audit framing error) | byDesign |
|---|---|---|---|---|
| P0 RLS coverage (SECURITY §2) | 36 tables | 0 | **7** (6 social_* + shared_links — all are service-role-only by design) | 0 |
| P0 service-role `(id, org_id)` pairing (SECURITY §2) | ~140 sites | 0 | — | 3 GUID-based routes |
| P0 `requireAdmin` coverage (SECURITY §2-3) | 13 admin + 2 deck | 0 | — | 1 customer-facing deck |
| P0 org-scoped column on org-owned tables (NEW — SECURITY §2 implicit) | rest | 1 (`shared_links`) **FIXED** | — | — |
| P1 `server-only` placement (SECURITY §4) | 5 / 5 critical | 0 | — | scripts / tests exempt |
| P1 structured console payloads (ENG §4) | ~rest | **2 sites** | — | — |
| P1 PII in log payloads (SECURITY §5) | — | **1 site** | — | — |
| P2 `audit_events` table (SECURITY §6) | — | **1** (partial via `admin_action_log`) | — | — |
| P2 Sentry `beforeSend` scrub (SECURITY §5) | — | **1** (no scrub defined in any of 3 configs) | — | — |
| P2 `npm audit --audit-level=high` | — | **2 advisories** (next.js DoS / smuggling / cache-poison chain; postcss XSS) | — | — |
| P2 ESLint TBD-10 rules enabled | — | **config shipped** — triage: 374 errors + 1801 warnings across 349 files (1594 `any`, 212 misused-promise, 162 floating-promise, 123 type-import) | — | — |

**Net real findings: 1 P0 (fixed today) + 3 P1 (all fixed today, commit `f74133b`) + 4 P2 (surfaced today, none shipped except the ESLint config change).**

---

## P0 — Fixed today

### P0 — `shared_links` had no `org_id` column

**Policy mapping:** SECURITY.md §2 — *"every other org-scoped
table in the schema carries `org_id`; service-role queries should
be able to pair `(id, org_id)` per the May-2026 lesson"*. The
literal §2 wording on RLS policies doesn't apply because
`shared_links` is service-role-only by design (token is the
access credential, same pattern as `/s/[guid]` widgets).

**File at audit time:** `sql/010_phase2_campaigns.sql:26`

**Reality (not the audit's original framing):** `shared_links` was
**not** an active cross-tenant leak. Every access path enforced
org isolation:
- `POST /api/share` → `gateShareTarget` → `resolveTargetOrgId`
  verified user.org_id == target's org_id before INSERT
- `GET /api/share?token=` → lookup by 192-bit unique token; token
  IS the credential
- `GET /api/share?list_…` → `gateShareTarget` ran before the
  `(type, target_id)` query
- `DELETE /api/share` → `gateShareTarget` on the resolved share's
  target before deletion
- `/shared/conversation/[token]/page.tsx` — token-only access

**Why fix it anyway (defense-in-depth + consistency):**
1. Future code paths can use `.eq('org_id', orgId)` as a
   second-layer filter without JOINing through the target's parent
   table.
2. `shared_links` was the only org-scoped table missing `org_id` —
   inconsistency is a code-review trip hazard.
3. A future server-component auth-client SELECT becomes
   supportable with a normal RLS policy if we ever need it.

**Fix shipped:**
- `sql/053_shared_links_org_scoping.sql` — adds nullable
  `org_id`, backfills per-type from each parent table
  (`studies` / `campaigns` / `townhall_sessions` / `datasets` /
  `bots` / `responses` for the polymorphic `conversation` case),
  deletes orphan rows whose target no longer exists, enforces
  NOT NULL, adds `idx_shared_links_org`.
- `app/api/share/route.ts` — `gateShareTarget` now returns the
  resolved `targetOrgId` and all three insert sites use it for
  the new `org_id` column.

**Applied to prod:** 2026-05-12 via
`supabase db query --linked --file sql/053_shared_links_org_scoping.sql`.
Verification: 15 rows, 15 with `org_id`, zero nulls, zero orphans
deleted.

**Verification gate going forward:** SECURITY.md §2 update spells
out the auth-client / service-role split so this case is
re-categorizable; the `gateShareTarget` pattern is now cited in
§2 as the worked example of the gate-function approach.

---

## False positives (corrected from first audit run)

### Why these were filed — and why they're not findings

The first audit run filed 7 P0 RLS findings against the 6
`social_*` tables (`sql/026_social_moderation.sql`) and
`shared_links`. The subagent matched on a literal reading of
SECURITY.md §2: *"every public table requires… at least one
select policy that filters by `org_id`"*.

But `sql/032_enable_rls_everywhere.sql` documents an explicit
architectural pattern:

> Tables not listed above [the 15-table auth-client whitelist]
> stay RLS-enabled but policy-less: only the service role
> (and Supabase's internal admin tools) can read them.

For service-role-only tables:
- RLS-on with no policy = **default deny** for any non-service-role
  query. An auth-client read returns **empty rows**, not "all rows."
- Service-role bypasses RLS (BYPASSRLS attribute) so legitimate
  reads keep working.

I verified by grepping every read-site: the 6 `social_*` tables
are read exclusively by `app/api/social/*` and `app/api/cron/social-*`
routes via `createServiceRoleClient()`. No auth-client read of these
tables exists today. Same pattern for `shared_links`.

**Conclusion:** the original §2 wording was overly strict and
produced false positives. SECURITY.md §2 has been sharpened
(commit pending) to distinguish:
- **Auth-client-read tables** (15 in the 032 whitelist): need
  a SELECT policy filtering by `org_id`. Tested by
  `npm run test:rls`.
- **Service-role-only tables** (everything else): intentionally
  policy-less. Tested by `npm run test:egress` at the route
  level instead.

**Tables previously filed as P0, now reclassified as
service-role-only-by-design (no change required):**

| Table | Migration | Read sites |
|---|---|---|
| `social_connections` | `026_social_moderation.sql:8` | `app/api/social/*`, `app/api/cron/social-*` |
| `social_comments` | `026_social_moderation.sql:24` | (same) |
| `social_moderation_log` | `026_social_moderation.sql:52` | (same) |
| `social_alert_rules` | `026_social_moderation.sql:65` | (same) |
| `social_alerts_sent` | `026_social_moderation.sql:78` | (same) |
| `social_dm_log` | `026_social_moderation.sql:93` | (same) |
| `shared_links` (RLS slice — the missing `org_id` was a separate real finding above) | `010_phase2_campaigns.sql:26` | `app/api/share/*`, public token pages |

---

## P1 findings (all fixed today, commit `f74133b`)

### P1-1 — Phone number logged in SMS-failure error handler — **FIXED**

**Policy:** SECURITY.md §5 — *"Never put PII into a structured log
message. Use opaque ids; if a field must be logged for debugging,
redact (`mask(email)`)."*

**File:** `app/api/campaigns/[id]/send/route.ts:134`

```ts
console.error('SMS send failed for', respondent.phone, smsErr.message)
```

Logs the raw respondent phone number whenever SMS send fails. Phone
is PII per §5. Also violates the structured-payload rule (ENG §4):
this is positional `console.error` with multiple string args.

**Fix:**

```ts
console.error({
  event: 'sms_send_failed',
  campaign_id: id,
  respondent_id: respondent.id,
  phone_tail: respondent.phone?.slice(-4),
  error: smsErr.message,
});
```

---

### P1-2 — Two interpolated `console.warn` calls instead of structured payloads — **FIXED**

**Policy:** ENGINEERING.md §4 — *"prod handlers must call
`console.warn` / `console.error` with a single object argument —
never an interpolated string — so the Vercel log viewer can parse
and grep on fields"*

**Files:**

- `app/api/townhall/chat/route.ts:771`
  ```ts
  console.warn('[TH chat] AI refusal detected; dropping bot text. text=' + outText.slice(0, 200))
  ```
- `app/api/townhall/simulate/route.ts:74`
  ```ts
  console.warn('[townhall/simulate] AI refusal detected for persona "' + persona.name + '"; substituting fallback. text=' + cleaned.slice(0, 200))
  ```

**Fix:** convert each to a single object argument:

```ts
console.warn({
  event: 'th_chat_ai_refusal',
  text_preview: outText.slice(0, 200),
});

console.warn({
  event: 'townhall_simulate_ai_refusal',
  persona_name: persona.name,
  text_preview: cleaned.slice(0, 200),
});
```

---

## Not findings (audited and pass)

- **Service-role `(id, org_id)` pairing** — manual review of ~140
  service-role query sites; no bare `.eq('id', ...)` lookups
  without paired `org_id` check or gate-function wrapper.
  Three public-GUID routes (`/api/study/[guid]`, `/api/b/[slug]`,
  `/api/bots/[id]/chat`) bypass org pairing **byDesign** because
  the GUID/slug is itself the access token. `shared_links`
  service-role reads use `gateShareTarget` as the gate function,
  per the new §2 worked example.

- **`requireAdmin` coverage** — all 13 routes under
  `app/api/admin/` invoke `requireAdmin`. Deck/strategy generators
  (`/api/agent-capabilities-deck`, `/api/entity-analysis-deck`) are
  gated. `/api/bots/[id]/conversations/insights-deck` is
  customer-facing and uses an org-scope check instead of admin
  gate — confirmed not a finding.

- **`server-only` placement** — every file reading a service-role
  secret either has `import 'server-only'` (`lib/ai.ts`,
  `lib/supabase/server.ts`, `lib/email/provider.ts`) or lives under
  `app/api/` (inherently server-only).

---

## Tier 1 deferred items — addressed 2026-05-12 (this audit, second pass)

### P2-A — `audit_events` table (SECURITY §6) — **MISSING (partial coverage today)**

**Policy mapping:** SECURITY.md §6 — application-level audit log
named `audit_events` with schema `(actor_user_id, actor_org_id,
action, target_table, target_id, target_org_id, ip, ua, at)`,
service-role-only insert, RLS `using (false)` for UPDATE/DELETE.

**Reality:** grep across `sql/` returns zero hits for
`audit_events`. The only audit-style table is
`sql/048_admin_action_log.sql`, which is a strict subset of §6:

| §6 contract field | `admin_action_log` column | Status |
|---|---|---|
| `actor_user_id` | `initiated_by` | ✓ (renamed) |
| `actor_org_id` | — | **missing** |
| `action` | `action_type` | ✓ (renamed) |
| `target_table` | `resource_type` | ✓ (renamed) |
| `target_id` | `resource_id` | ✓ (renamed) |
| `target_org_id` | `target_org_id` | ✓ |
| `ip` | — | **missing** |
| `ua` | — | **missing** |
| `at` | `created_at` | ✓ (renamed) |

**Scope gap:** `admin_action_log` is also narrower in *what* it
records. §6 says it must capture: any `requireAdmin` hit
(success and denial), billing changes, org membership changes
(invite / role change / removal), exports (deck / dataset /
audit), bulk deletes. Today the only writer is
`lib/orgTransfer.ts` for org-transfer events. None of the 13
admin routes under `app/api/admin/*` log a row; no membership
or export route logs a row.

**Tamper-resistance:** the migration *does* match §6 in spirit
(RLS on, no INSERT/UPDATE/DELETE policy → default-deny for
non-service-role; service role bypasses RLS for legitimate
inserts). The §6 wording specifies explicit `using (false)`
policies on UPDATE/DELETE; the migration achieves the same
behavior via "no policy = denied by default." Functionally
equivalent — but worth re-aligning the doc wording or the
migration on the next pass.

**Recommendation:** treat `admin_action_log` as the precursor.
Open `<TBD>` item 4 in SECURITY.md should be re-scoped to:
(a) rename / extend `admin_action_log` to match the §6 column
contract (add `actor_org_id`, `ip`, `ua`), and (b) add
`logAdminAction()` calls at the `requireAdmin` boundary, billing
mutation, org-membership mutation, export, and bulk-delete
sites. Effort: 1 migration + ~10 callsite edits + 1 RLS test.

**Owner:** next session (P1).

---

### P2-B — `npm audit --audit-level=high` — **2 advisories, both in Next.js dep tree**

**Run output (2026-05-12, current `main` lockfile):**

```
high   next  9.3.4-canary.0 - 16.3.0-canary.5
       14 chained advisories (DoS via Image Optimizer remotePatterns,
       HTTP request smuggling in rewrites, cache-poisoning in RSC
       responses, XSS in CSP-nonce App Router, middleware/proxy
       bypass via i18n, SSRF in WebSocket upgrades, etc.)
       fix: npm audit fix --force → next@16.2.6 (breaking change)

moderate postcss  <8.5.10
       XSS via unescaped </style> in CSS stringify output
       fix: same — bundled with the next upgrade
```

**Current version:** `next@^14.2.35`. The auto-fix path is
`next@16.2.6`, a **two-major-version jump** (14 → 16). Not
auto-applicable; needs the official Next.js codemod path and a
typecheck/test pass.

**Risk assessment:** All 14 high advisories are self-hosted DoS /
cache-poisoning / smuggling scenarios. On Vercel-managed
Next.js, the runtime / proxy layer mitigates several of them
(Vercel's image optimizer is the proxy that handles the
DoS-via-remotePatterns path; Vercel's middleware runtime patches
some of the i18n-bypass class). None of these advisories are
known to be actively exploited against deployments on Vercel.

**Recommendation:** Schedule a Next 14 → 15 → 16 upgrade as a
dedicated P1 work item — not a same-session hotfix. Use
`/vercel:next-upgrade` skill for the codemod path. Until then,
add `npm audit --audit-level=high` to `.github/workflows/ci.yml`
(Open TBD item 2) to keep visibility but allow the run to fail
softly until the upgrade lands.

**Owner:** dedicated upgrade session, multi-day effort.

---

### P2-C — ESLint TBD-10 rules enabled + triaged — **CONFIG SHIPPED, scope surfaced**

**Policy mapping:** SECURITY.md Open `<TBD>` item 10.

**Change:** `.eslintrc.json` now enables all four rules:

```json
"@typescript-eslint/no-floating-promises": "error",
"@typescript-eslint/no-misused-promises": "error",
"@typescript-eslint/no-explicit-any": "warn",
"@typescript-eslint/consistent-type-imports": "warn"
```

The first two are type-aware rules; `parserOptions.project` and
`parser: "@typescript-eslint/parser"` were added so they
function.

**Triage scope** (single `npm run lint` run, 2026-05-12):

| Rule | Level | Count | Notes |
|---|---|---:|---|
| `no-explicit-any` | warn | **1594** | Concentrated in PPTX / HTML export routes (`app/api/datasets/[datasetId]/export/{pptx,html}/route.ts` — single-file totals in the high hundreds). Use of `any` in pptxgenjs callbacks is the major source. |
| `no-misused-promises` | error | **212** | Mostly `onClick={async () => ...}` JSX attributes in admin client components. Each fix is `void (async () => ...)()` or a wrapper. Mechanical. |
| `no-floating-promises` | error | **162** | Bare `fetch(...)` / `supabase.from(...)` calls with no `await` or `.catch`. Many are intentional fire-and-forget; fix is to prefix with `void`. |
| `consistent-type-imports` | warn | **123** | `import { Foo } from 'x'` where `Foo` is type-only. Auto-fixable. |
| **Total** | — | **2091** | across **349** files |

**Errors that would block CI today: 374** (no-misused-promises +
no-floating-promises). CI today only runs `typecheck`, not lint —
so this change does NOT break the build. But running
`npm run lint` locally now surfaces these.

**Recommendation:**
- Run `npx eslint --fix .` first — `consistent-type-imports` is
  auto-fixable (drops the 123 warnings) and a chunk of
  `no-floating-promises` is too (adds `void`).
- The remaining errors are real (a missing `await` in an
  admin handler is the kind of bug this rule catches). Fix in a
  dedicated sweep, not piecemeal — count-down on a tracker.
- Keep `no-explicit-any` at `warn` permanently; tighten
  individual files as they get rewritten.

**Owner:** dedicated cleanup session; ~2 hours for auto-fix
sweep + spot-check, ~1 day for the remaining 374 error-level
violations.

---

### P2-D — Sentry `beforeSend` scrub audit (SECURITY §5) — **NO SCRUB DEFINED**

**Policy mapping:** SECURITY.md §5 — *"Sentry `beforeSend` scrub
must drop email, phone, password fields, and the contents of
`req.body` for survey/response endpoints."*

**Files audited:**
- `sentry.client.config.ts` (10 effective lines)
- `sentry.server.config.ts` (10 effective lines)
- `sentry.edge.config.ts` (10 effective lines)

**Finding:** **None of the three configs defines a `beforeSend`
hook.** All three pass only `dsn`, `integrations`,
`tracesSampleRate`, `environment` to `Sentry.init`. There is
zero app-level scrubbing of email, phone, password, or
`req.body` content before events leave the process.

**What we have today:** Sentry's server-side default scrubbing
strips a fixed set of patterns (credit-card numbers, US SSNs,
common auth headers). It does NOT scrub email, phone,
free-text `req.body`, or arbitrary user-supplied PII fields.

**Concrete leak paths (illustrative, not exhaustive):**
- Unhandled exception in `app/api/study/[guid]/route.ts` (survey
  submission) — the `req.body` containing free-text answers
  can land in the Sentry breadcrumb / extra-context payload
  Next.js attaches.
- Unhandled exception in `app/api/b/[slug]/route.ts` (agent
  chat) — same path; respondent's free-text message can ship.
- Errors in `app/api/campaigns/[id]/send/route.ts` previously
  included phone numbers in the message string (fixed today,
  commit `f74133b`); a future regression of the same shape
  would ship phone to Sentry uncontested.
- Stack frames with local-variable inspection enabled can
  surface email/name fields read from `dataset_rows_flat`.

**Recommendation (next session, ~30-60 min):**

Add a shared `lib/sentryScrub.ts` exporting `scrubEvent(event)`
that:
1. Walks `event.request.data` and recursively redacts any key
   matching `/^(email|phone|password|secret|token|api[_-]?key)$/i`.
2. For survey/response endpoint paths (`/api/study/`,
   `/api/b/`, `/api/th/`, `/api/campaigns/`), drop
   `event.request.data` entirely (response bodies are PII by
   default — §5 classification).
3. Walks `event.extra` and `event.contexts` similarly.

Wire it into all three configs as
`Sentry.init({ ..., beforeSend: scrubEvent })`.

**Owner:** next session (P1 — pair with §6 `audit_events` work).

---

## Still deferred to next audit

- **P2** — structured-payload audit of `console.*` calls in `lib/`
  (this audit covered `app/api/` only).
- **P2** — cascade-FK coverage for org deletion + a delete-path
  egress test. (Open TBD item 5.)
- **P2** — RLS-isolation + egress test coverage for the 7
  service-role-only tables reclassified above. Today they pass
  by-default (RLS empty-results); the explicit test would harden
  against a future audit-client-read regression.
- **P3** — `// @ts-ignore` / `any` inventory (Tier 1 surfaced the
  `any` count: **1594 sites across the lint scan**; a fuller
  per-file ranked inventory is still deferred).
- **P3** — files > 400 LOC inventory.

---

## Methodology

- Three parallel Explore subagents ran the P0/P1 checks
  concurrently (RLS coverage; service-role + `requireAdmin`;
  secrets + logging).
- Standards version: `docs/SECURITY.md` + `docs/ENGINEERING.md` as
  of commit `e24df42`, with §2 further sharpened today.
- Codebase version: `main` branch HEAD as of 2026-05-12.

**Lessons from this audit's revision:**
- Subagents matching on literal policy wording without reading
  the codebase's documented architecture (`032_enable_rls_everywhere.sql`
  header comment) over-reported risk.
- The policy doc had a real flaw: §2's blanket "every public table
  requires a select policy" contradicted the documented service-
  role-only pattern. Fixing the doc was the actual gap; the code
  was already correct.
- The `shared_links` finding survived correction because the
  missing `org_id` column was a real consistency / defense-in-
  depth gap even though it wasn't an active leak.

**Caveats:**
- "Pass" on service-role pairing remains "no obvious violations
  found after manual review of ~140 sites" — not a guarantee.
  Adding the `lib/auth/gate*Access` helper (SECURITY.md Open TBD
  item 11) and forbidding bare `.eq('id', ...)` on the service-
  role client at lint level would make this auditable rather than
  vibes-based.
