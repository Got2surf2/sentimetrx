# Sentimetrx Policy Gap Audit — 2026-05-12

Audit of the sentimetrx codebase against `docs/SECURITY.md` and
`docs/ENGINEERING.md` (sharpened version, commit `e24df42`).

**Scope:** P0 (multi-tenancy + auth) and P1 (secrets + logging). P2
(ops) and P3 (hygiene) deferred — see end of file.

Each finding cites the policy section it violates, file:line for
the offending code, severity, and a suggested fix.

---

## Summary

| Bucket | Pass | Fail | byDesign / out-of-scope |
|---|---|---|---|
| P0 RLS coverage (SECURITY §2) | 36 tables | **7 tables** | 0 |
| P0 service-role `(id, org_id)` pairing (SECURITY §2) | ~140 sites | 0 | 3 GUID-based routes |
| P0 `requireAdmin` coverage (SECURITY §2-3) | 13 admin + 2 deck | 0 | 1 customer-facing deck |
| P1 `server-only` placement (SECURITY §4) | 5 / 5 critical | 0 | scripts / tests exempt |
| P1 structured console payloads (ENG §4) | ~rest | **2 sites** | — |
| P1 PII in log payloads (SECURITY §5) | — | **1 site** | — |

**Totals: 7 P0 findings, 3 P1 findings.**

---

## P0 findings

### P0-1 — Social moderation suite (6 tables) missing RLS + org-scoped SELECT policy

**Policy:** SECURITY.md §2 — *"every new public table requires
`enable row level security` + at least one `select` policy that
filters by `org_id`"*

**Tables affected** (all defined in `sql/026_social_moderation.sql`):

| Table | Line |
|---|---|
| `social_connections` | 8 |
| `social_comments` | 24 |
| `social_moderation_log` | 52 |
| `social_alert_rules` | 65 |
| `social_alerts_sent` | 78 |
| `social_dm_log` | 93 |

All six have an `org_id` column but the migration ends without
enabling RLS or creating a policy. The later blanket
`sql/032_enable_rls_everywhere.sql` enables RLS on every table but
only creates SELECT policies for 15 named tables — none of the
`social_*` tables are in that whitelist.

**Result:** RLS is on, no policy exists. Auth-client reads silently
return zero rows; service-role reads bypass the gap entirely, so
nothing surfaces the misconfiguration in production. This is the
same shape as the May-2026 CRITICAL pattern: a quiet failure mode
that doesn't fire alarms until a code path tries an auth-client
query.

**Fix:** add a new migration `sql/NNN_social_rls.sql` that creates
`for select using (org_id = (select org_id from users where id =
auth.uid()))` policies for each of the 6 tables. Mirror the pattern
in `sql/008_campaigns.sql` / `sql/011_townhall.sql`.

**Test gate:** `npm run test:rls` must add coverage for these 6
tables before the fix can be considered shipped. The egress suite
(`tests/integration/cross-org-egress.test.ts`) should also add
route-level coverage for any handler that reads these tables.

---

### P0-2 — `shared_links` has no `org_id` column AND no RLS

**Policy:** SECURITY.md §2 — both halves (RLS + org-scoped policy)

**File:** `sql/010_phase2_campaigns.sql:26`

The `shared_links` table stores `target_id` pointing at a study,
campaign, townhall, conversation, or analytics record — but the
table itself has no `org_id` column. Any authenticated user can
`select * from shared_links` and enumerate every share link across
every tenant. Two violations stacked: (a) no RLS, (b) no `org_id`
to scope by.

**Severity:** P0 — enables direct cross-tenant enumeration of share
links + the GUIDs they expose.

**Fix:** add an `org_id` column (backfill from each `target_id`'s
parent table), enable RLS, add a `for select using (org_id = ...)`
policy. Single migration. Then add `shared_links` to the
`npm run test:rls` matrix.

---

## P1 findings

### P1-1 — Phone number logged in SMS-failure error handler

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

### P1-2 — Two interpolated `console.warn` calls instead of structured payloads

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
  without paired `org_id` check. Three public-GUID routes
  (`/api/study/[guid]`, `/api/b/[slug]`, `/api/bots/[id]/chat`)
  bypass org pairing **byDesign** because the GUID/slug is itself
  the access token (122-bit-entropy + org-binding enforced
  separately).

- **`requireAdmin` coverage** — all 13 routes under `app/api/admin/`
  invoke `requireAdmin`. Deck/strategy generators
  (`/api/agent-capabilities-deck`, `/api/entity-analysis-deck`) are
  gated. `/api/bots/[id]/conversations/insights-deck` is
  customer-facing and uses an org-scope check instead of admin
  gate — confirmed not a finding.

- **`server-only` placement** — every file reading a service-role
  secret either has `import 'server-only'` (`lib/ai.ts`,
  `lib/supabase/server.ts`, `lib/email/provider.ts`) or lives under
  `app/api/` (inherently server-only).

---

## Deferred to next audit

Not run in this session — bundle into a P2/P3 follow-up:

- **P2** — does `audit_events` exist matching SECURITY.md §6
  schema? (Open TBD item 4.)
- **P2** — Sentry `beforeSend` scrub end-to-end audit against §5
  field list. (Open TBD item 1.)
- **P2** — ESLint config: enable the `@typescript-eslint/*` rules
  listed in SECURITY.md Open TBD item 10.
- **P2** — structured-payload audit of `console.*` calls in `lib/`
  (this audit covered `app/api/` only).
- **P2** — cascade-FK coverage for org deletion + a delete-path
  egress test. (Open TBD item 5.)
- **P3** — `// @ts-ignore` / `any` inventory.
- **P3** — files > 400 LOC inventory.
- **P3** — `npm audit --audit-level=high` result.

---

## Methodology

- Three parallel Explore subagents ran the P0/P1 checks
  concurrently (RLS coverage; service-role + `requireAdmin`;
  secrets + logging).
- Standards version: `docs/SECURITY.md` + `docs/ENGINEERING.md` as
  of commit `e24df42` (sharpened earlier today).
- Codebase version: `main` branch HEAD as of 2026-05-12.
- No code modifications during the audit.

**Caveats:**
- "Pass" on service-role pairing is "no obvious violations found
  after manual review of ~140 sites" — not a guarantee. Adding the
  `lib/auth/gate*Access` helper (SECURITY.md Open TBD item 11) and
  forbidding bare `.eq('id', ...)` on the service-role client at
  lint level would make this auditable rather than vibes-based.
- The 6 social_* RLS findings are silent failures today — RLS
  blocks auth-client reads with empty results rather than throwing,
  so no telemetry signals the gap. Treat the test:rls suite
  expansion as the load-bearing remediation.
