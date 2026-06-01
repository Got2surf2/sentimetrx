# Sentimetrx — Security Policy & Posture

> **Update (2026-06-01).** `getUserContext` previously selected a non-existent `users.is_admin` column (admin status lives in `users.role` / `organizations.is_admin_org`), which made the query error and bounce authenticated pages to `/login`; it now derives `isAdmin` from `org.is_admin_org`. Feature visibility remains the org∩user intersection in `effectiveFeatures` (`lib/resolveOrg.ts`), now with Analytics as the parent gate for its sub-features (googleReviews / reddit / substack / recordings).

The security disciplines this codebase is held to, the controls that
enforce them, and the answers we'd give a buyer's technical-DD reviewer
or a SOC2 auditor. Linked from `CLAUDE.md` (operational) — this doc is
the **policy**; CLAUDE.md is the **playbook**.

Items marked `<TBD: …>` are policy decisions the human owner must make
before they can be ratified. Track decisions in
`docs/weekly-reports/YYYY-WXX-devlog.md` with a SECURITY tag.

Each section ends with a **How we verify** line stating the concrete
check (test path, CI step, manual cadence) that audits it. If the
verification is `<TBD>`, the standard is aspirational, not measurable.

Last reviewed: 2026-05-15.

---

## 1. Threat model summary

Sentimetrx stores user-submitted survey/feedback data, AI-generated
analyses, and platform-uploaded datasets on behalf of customer
organizations. Each `org_id` is a tenancy boundary.

Primary threats we defend against, in priority order:

1. **Cross-tenant data leak** — a user from Org A reads or modifies
   Org B's rows. *Highest impact*. Mitigated by RLS + paired
   `(id, org_id)` service-role queries + dedicated egress tests.
2. **Unauthenticated access to internal routes** — admin-only,
   strategy, decks, exports. Mitigated by `requireAdmin` wrappers
   from day one of the route's existence.
3. **AI prompt injection / data exfiltration via LLM** — a user
   submits a prompt that tricks Claude into surfacing another
   tenant's data or violating a content rule. Mitigated by
   `lib/guardrails.ts` + scoped tool definitions + no cross-org
   data in any single prompt.
4. **Secret leakage** — keys committed, leaked via logs, or pushed
   to Sentry. Mitigated by `.gitignore` (covers `.env`,
   `.env.local`, `.env.*.local`, `*.pem`, `*.key`, `*.p12`,
   `*.pfx`). **Sentry `beforeSend` scrubbing IS implemented** —
   `lib/sentryScrub.ts` is wired into all three Sentry configs
   (`sentry.{server,client,edge}.config.ts`) and strips
   `request.{data,body,cookies}`, auth/cookie headers, and known
   PII key names anywhere in `extra` / `contexts` / `tags`. Also
   drops the Microsoft Office content-script false-positive
   ("Object Not Found Matching Id…"). Open `<TBD>` item 1 is
   closed by commit 2026-05-25.
5. **Supply-chain compromise** — a malicious npm dependency.
   Mitigated today by manual lockfile review on every PR.
   **Gap:** no automated `npm audit` or Dependabot gate in CI —
   tracked as Open `<TBD>` item 2.

**How we verify:** quarterly review against this list; any new
threat that takes a CRITICAL finding gets added with its own
mitigation row.

Out of scope for now (acknowledged gaps):

- Sophisticated DDoS — Vercel/Supabase absorb the small-pilot
  blast radius; commercial WAF is a future item.
- Insider threat from people with prod access — relies on the
  access roster (§4) + quarterly audit log review cadence (§6).
  At pilot scale the roster has one entry (solo founder).
- Physical security of the laptops used to access prod — relies
  on FileVault (macOS) on owner devices. Confirmed for the
  founder's laptop as of 2026-05-12; any future operator gets
  full-disk-encryption confirmation as a precondition for
  receiving prod credentials.

---

## 2. Multi-tenancy invariants

These have been the source of every CRITICAL security finding to date.
The CLAUDE.md "Multi-tenancy invariants" section is the canonical
shortlist for Claude; here is the longer policy:

- **Every new `public` table requires:**
  1. `enable row level security` — non-negotiable. The blanket
     `sql/032_enable_rls_everywhere.sql` loop covers every public
     table; a new table created after 032 must add its own
     `alter table … enable row level security` line.
  2. **A select policy filtering by `org_id` IF the table is read
     via the Supabase auth client (user JWT).** Tables that are
     read only via the service role intentionally stay
     RLS-on-but-policy-less per 032's documented pattern — RLS
     blocks any accidental auth-client read to empty results,
     service-role bypasses RLS for legitimate writes. **Decide
     which category your table belongs to and stick to that
     pattern**; mixing them silently is the bug shape that
     produces "table has RLS but no policy" false-positive
     findings.
  3. A case in `tests/integration/rls-isolation.test.ts` proving
     Org A cannot read Org B's row for that table — for both
     categories. Service-role-only tables: assert the auth-client
     read returns empty for the wrong org.
  4. A case in `tests/integration/cross-org-egress.test.ts` (or
     a route-specific egress file — see below) covering the route
     handlers that read that table. **This is the load-bearing
     check for service-role-only tables** — RLS does not cover
     service-role paths, so service-role tables need explicit
     route-level egress coverage.

- **Service-role queries must pair `id` with `org_id`.** A bare
  `id` lookup with the service-role client is a cross-tenant leak.
  Either:
  - Inline the explicit filter: `service.from(t).eq('id', x).eq('org_id', orgId)`, **or**
  - **Use a gate function that resolves and verifies the target's
    org before the service-role lookup.** Example pattern:
    `app/api/share/route.ts` uses `gateShareTarget(service, userId,
    type, targetId)` which calls `resolveTargetOrgId` against the
    target's parent table (studies / campaigns / townhall_sessions
    / datasets / bots / responses) and returns `{ ok: true,
    targetOrgId }` only if the user's org matches. Service-role
    queries downstream of that gate are safe by construction —
    the gate is the single source of the audited policy.
  - Open `<TBD>` item 11 below tracks extracting a generalized
    `gate*Access` helper to `lib/auth/`. The trigger has been
    met — four separate gate definitions exist today
    (`gateShareTarget` in `app/api/share/route.ts`, two
    duplicated `gateBotAccess` functions under
    `app/api/bots/[id]/...`, and gating in
    `app/api/townhall/sessions/[id]/route.ts`).

- **Internal-only routes (`/admin/*`, deck generators, strategy
  endpoints) wrap with `requireAdmin` (`lib/auth/requireAdmin.ts`)
  from the first commit.** URL obscurity is not a defense.

- **Export routes are a high-leak surface — gate every one.** A deck/
  HTML/CSV export fetches a tenant resource by id via the service role
  and returns its full contents, so a missing `org_id` check leaks an
  entire org's dataset or town hall. A June-2026 sweep found this class
  unguarded on `datasets/[datasetId]/export/{html,pptx,signals-pptx}`
  and `townhall/sessions/[id]/export/{pptx,route}` (all now gated via
  `getCallerOrgContext`); `datasets/export/html/share` was the correct
  reference. Covered by `tests/integration/export-org-gate.test.ts`.

- **New surface = new test.** Before merge:
  - `npm run test:rls` must pass for table-level RLS coverage
  - `npm run test:egress` must pass for the cross-org-egress suite
  - For dataset or campaign routes specifically:
    `npm run test:dataset-egress` and `npm run test:campaign-egress`

Reference: the May-2026 CRITICAL findings (six of them, same root
cause — service-role lookup without `org_id`) are documented in
`docs/security-review-2026-05-09.md` (the CRITICAL table; all six
marked ✅ patched). Read it before writing a service-role query.
(Note: `docs/AUDIT_2026_Q1.md` is the *question-bank* audit and
is unrelated to security findings.)

**How we verify:** the four `npm run test:*` suites above are the
gate. CI runs `npm test` (unit + integration with mocks); the
env-gated `test:rls` / `test:egress` / `test:auth-flows` suites
run locally against the linked prod project until a dedicated
test project exists.

---

## 3. Authentication & authorization

- **Identity:** Supabase Auth (email + password and magic links).
  Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`.
- **Authorization model:**
  - Identity table: `users` (sql/001_schema.sql). Each user has
    `users.org_id` (org membership) and a `users.role` enum
    constrained to `'platform_admin' | 'owner' | 'member'`.
  - Regular user (`role='member'`): scoped to their `org_id` via RLS.
  - Org owner (`role='owner'`): same scope, adds invite/billing
    routes.
  - Platform admin (`role='platform_admin'`): the SQL
    helper `is_platform_admin()` (sql/001_schema.sql:170) reads
    this and is OR'd into table policies to grant cross-org reads.
  - Admin-org gate: `organizations.is_admin_org=true` marks an
    internal-tenant org; `lib/auth/requireAdmin.ts` allows the
    request when the caller's org has this flag set, and returns
    404 (not 401) on miss so internal routes don't leak existence.
    This is the gate used by all `/admin/*`, deck, strategy, and
    internal-export routes today; it is distinct from the
    `platform_admin` role, though in practice the admin-org's
    members hold that role.
  - **Superadmin gate (per-user):** Datanautix-internal product
    surfaces (e.g. "include AI labels in this conversation share")
    gate on `users.role = 'platform_admin'` — the same role surfaced
    by the existing `is_platform_admin()` SQL helper. Distinct from
    `organizations.is_admin_org` because Datanautix Demo also carries
    `is_admin_org=true` but its users should NOT inherit Datanautix-
    internal capabilities. The helper lives at
    `lib/auth/superadmin.ts` → `isCallerSuperadmin(client, userId)`,
    gated write-side in `/api/share` so a tampered client payload
    can't sneak in a labeled share variant from a non-platform_admin
    user. (Migration 076 originally added a parallel `is_superadmin`
    column; 077 dropped it in favor of the existing `role` column.)
  - There is no `org_members` table — membership is a column on
    `users`, not a separate join table.
- **MFA:** not enforced today. **Proposed default (pending owner
  ratification):** required for platform admins, optional for org
  admins, off for regular users until first paying customer.
  Tracked as Open `<TBD>` item 8.
- **Session policy:**
  - Idle timeout: Supabase default (1 hour access token, 7 day
    refresh).
  - **Proposed for platform admins:** 30-minute access token,
    24-hour refresh. Tracked as Open `<TBD>` item 8.
- **CSRF protection:** `middleware.ts` enforces a same-site or
  CSRF-token check on cookie-authed mutating routes. Webhooks /
  cron / embed widgets are explicitly bypassed (each documented
  inline in the middleware). Embed-route exemptions are limited
  to public, no-cookie, wildcard-CORS endpoints:
  `/api/bots/[id]/chat`, the sibling intent extractor
  `/api/bots/[id]/ui-hints`, and the canvas-demo data routes
  under `/api/mco/*` (parking + places). All of these are
  cookie-free public read paths; CSRF doesn't apply.
- **API auth for embeddable widgets** — survey at `/s/[guid]`,
  agent at `/b/[slug]`, PulseIQ at `/th/[sessionId]`. The route
  param name varies but each one is an opaque, high-entropy
  identifier (≥122-bit) checked for org binding on every
  request. No cookie auth.

**How we verify:** `npm run test:auth-flows` exercises real
Supabase auth round-trips; CSRF bypasses are reviewed inline in
`middleware.ts` PRs. MFA / session-policy enforcement, once
ratified, will need its own test.

---

## 4. Secrets management

- **Storage:** Vercel Project Environment Variables (Production /
  Preview / Development) are the source of truth.
- **Local development:** `.env.local` (gitignored). Devs pull
  baseline values via `vercel env pull .env.local`.
- **Never committed:** `.env`, `.env.local`, `.env.*.local`,
  `*.pem`, `*.key`, `*.p12`, `*.pfx`. `.gitignore` enforces these
  patterns. **Gap:** `.env.production` and other non-`.local`
  variants are not currently covered; tighten to `.env*` when
  convenient (low risk today because Vercel env is the source of
  truth and `.env.production` is not used locally). CI does not
  re-check — Open `<TBD>` item 9 tracks adding `gitleaks` as a
  pre-push hook + CI step.
- **Rotation cadence (ratified default, last reviewed
  2026-05-12):**
  - Supabase service-role key: **90 days**
  - Anthropic API key: **90 days**
  - Resend API key: **180 days**
  - DataForSEO key: **180 days**
  - AWS S3 access keys: **90 days**
  - Any suspected-leaked key: **immediately**

  Rotation lands in the next devlog entry with a SECURITY tag.
- **Access roster:** solo founder is sole holder of all prod
  credentials as of 2026-05-12. When the first additional
  operator joins, populate the access roster table here (name,
  service, role, date-of-grant) and review quarterly.
- **Secret usage hygiene:**
  - Server-only secrets (anything starting `SUPABASE_SERVICE_ROLE`,
    `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `AWS_SECRET_ACCESS_KEY`)
    are read inside files under `app/api/`, `lib/` with the
    `server-only` import, or `instrumentation.ts`. They must never
    appear in any module reachable from a client component.
  - The `server-only` npm package is a load-time guard; preserve it
    on critical modules.

**How we verify:** `.gitignore` patterns are reviewed quarterly;
`server-only` placement is reviewed at PR time for any new file
that reads a service-role secret. Rotation events go into the
weekly devlog with a SECURITY tag.

---

## 5. PII / sensitive data classification

| Field type | Examples | Classification | Handling |
|---|---|---|---|
| **Auth identity** | email, password hash | PII / Auth | Supabase-managed. Never logged. Never sent to Claude. |
| **User-volunteered profile** | name, phone, company role | PII | Stored in `users` / `org_members`. Org-scoped. Log redaction is **not yet enforced at a logger boundary** — there is no logger module today (Open `<TBD>` item 12). Handlers using `console.warn/error` must pass an opaque id, not the field. |
| **Survey / agent responses** | free-text answers | PII (assumed) | Stored in `dataset_rows_flat`. Org-scoped. Sent to Claude in scoped prompts. **Opt-in surface:** assumed yes for pilot orgs (each onboarded with explicit knowledge that responses are AI-analyzed); Open `<TBD>` item 6 tracks adding an explicit org-level toggle before the first paying customer. |
| **Uploaded datasets** | customer CRM exports, etc. | Variable (assume PII) | Same as above. Schemas tracked in `mergeSchemaStats`. |
| **AI-generated analysis** | deck content, strategy outputs | Derived | Treated as same sensitivity as inputs that produced it. |
| **Operational metadata** | timestamps, IPs, user-agent | Low | OK in logs and Sentry. |

Rules:

- **Never put PII in URL paths or query strings.** GUIDs only.
- **Never put PII into a structured log message.** Use opaque ids;
  if a field must be logged for debugging, redact (`mask(email)`).
- **Sentry `beforeSend` scrub** drops email, phone, password
  fields, and the contents of `req.body` / `req.cookies` for
  survey/response endpoints. **Current state:** implemented in
  `lib/sentryScrub.ts` and wired into all three Sentry configs
  (`sentry.{server,client,edge}.config.ts`). Behaviour:
  `request.{data,body,cookies}` → `[redacted]`, auth/cookie
  headers → `[redacted]`, PII key names (email, phone, password,
  token, secret, …) replaced at any depth in `extra` / `contexts`
  / `tags`, and `user` reduced to `{id}` only. Free-text strings
  in breadcrumbs / query strings are pattern-scrubbed for emails
  and phone numbers as a defense-in-depth pass.
- **Claude prompts** must never include rows from more than one
  `org_id`. Scoped tool definitions only.

**How we verify:** spot-checks of prod logs + Sentry events at
each quarterly audit. The single-org-prompt rule is reviewer-
enforced today; Open `<TBD>` item 7 tracks the unit-test rule.

---

## 6. Audit logging

A buyer's CC6/CC7 question: "Show me logs of admin actions and
cross-org access attempts."

- **Application-level audit log:** `admin_action_log` table
  (sql/048_admin_action_log.sql). Columns: `id, created_at,
  action_type, resource_type, resource_id, resource_name,
  target_org_id, target_org_name, initiated_by,
  initiated_by_email, metadata`. RLS is enabled; SELECT is
  restricted to `is_platform_admin()`; INSERT/UPDATE/DELETE have
  no policy and are denied for the auth client, so only the
  service role (`lib/orgTransfer.ts` and similar helpers) writes
  — append-only at the database level.
- **Admin actions that MUST log:**
  - Any `requireAdmin` route hit (success and denial)
  - Billing changes
  - Org membership changes (invite, role change, removal)
  - Exports (deck, dataset, audit)
  - Bulk deletes
- **Retention:** **2 years** (ratified default, last reviewed
  2026-05-12 — aligns with SOC2 CC4 evidence retention).
- **Tamper resistance:** `admin_action_log` has no INSERT /
  UPDATE / DELETE policy, so the auth client cannot write or
  modify rows; only the service role (which bypasses RLS) can
  insert. Effectively append-only.
- **Database-level audit:** Supabase Postgres logs are the
  fallback. Reviewed **quarterly** (ratified cadence).

---

## 7. Data retention & deletion (GDPR / CCPA posture)

- **Right-to-be-forgotten:** when an org is deleted, we cascade
  delete all of its `dataset_rows_flat`, survey responses, agent
  conversations, AI outputs, and audit log rows tagged to that
  org. Open `<TBD>` item 5 tracks (a) auditing the cascade FK
  coverage with a `grep "references orgs" sql/` evidence row in
  the next devlog and (b) adding a delete-path egress test.
- **User-level deletion within an org:** removing a user from an
  org does NOT delete the rows they created — those belong to the
  org. For a GDPR data-subject "erase me" request where the user
  is the data subject, the policy is: redact the user's
  identifying fields (email, name, IP) in place; preserve the
  row-level content as anonymized org property. Legal review
  before the first EU customer signs.
- **Soft-delete vs hard-delete (ratified default, last reviewed
  2026-05-12):**
  - User-identifying rows (`users`, `org_members`): **hard-delete**
  - Derived/aggregate rows (`audit_events`, AI outputs):
    **soft-delete with 90-day tombstone**, then hard-delete
  - Dataset content rows (`dataset_rows_flat`): **hard-delete on
    org deletion**, soft-delete (90-day) on per-row user request
- **Backup retention:** Supabase Pro daily backups, **7-day**
  retention (pilot acceptance). Extend to 30 days when the first
  paying customer signs.
- **Data residency:** Supabase us-east today. **Policy:** EU
  customer onboarding requires (a) a separate Supabase project
  in eu-west and (b) a tenant-routing layer; treat as a
  pre-contract engineering item, not an ad-hoc migration.

**How we verify:** annual delete-path drill — pick a test org,
trigger the delete, confirm zero rows tagged to that org across
all listed tables. Drill logged in the weekly devlog.

---

## 8. Third-party / AI integration safety

External services we send data to (full inventory — review
quarterly):

| Service | Data sent | Auth | DPA status |
|---|---|---|---|
| Anthropic Claude | scoped prompts + AI tool inputs | API key | Standard ToS today; request DPA at first paying customer |
| Supabase | all primary data | service-role + RLS | Standard ToS today; request DPA at first paying customer |
| Vercel | application code + runtime traffic | OIDC + token | Standard ToS today; request DPA at first paying customer |
| Resend | transactional email payloads | API key | Standard ToS today; request DPA at first paying customer |
| DataForSEO | search queries (no PII) | API key | Not required (no PII sent) |
| AWS S3 | file uploads | IAM creds | Yes (AWS DPA) |
| Sentry | error traces (PII-scrubbed) | DSN | Standard ToS today; request DPA at first paying customer |

**AI-specific guardrails:**

- `lib/guardrails.ts` runs an input pre-check on free-text fed
  into Claude (length, profanity, URL injection, role-prompt
  patterns).
- Tool definitions are narrow — Claude cannot make arbitrary DB
  queries or arbitrary HTTP calls.
- **Prompt budget:** no single Claude prompt may include rows
  from more than one `org_id`. Enforced by reviewer today;
  Open `<TBD>` item 7 tracks a `lib/ai.ts` wrapper that asserts
  the row set has a single `org_id` before dispatch, with a unit
  test.
- **Model output sanitization:** every surface that renders
  AI- or user-derived HTML routes through `isomorphic-dompurify`
  first — the survey engine (`components/survey/useSurveyEngine.ts`)
  plus, as of 2026-06-01, the three `dangerouslySetInnerHTML`
  callsites that previously did not:
  `app/bots/[id]/conversations/ConversationsClient.tsx`,
  `components/ui/ChatBot.tsx`, and
  `app/campaigns/[id]/CampaignDetailClient.tsx` (3 email-preview
  renders). Open `<TBD>` item 14 is now closed. URLs are stripped
  from any surface that doesn't explicitly need them.

**How we verify:** `lib/guardrails.ts` has unit coverage in
`tests/unit/`; output sanitization is exercised by component
tests on any surface that renders Claude HTML. Cross-org prompt
leak is reviewer-enforced until the wrapper assert lands.

---

## 9. Vulnerability management

- **Dependencies:**
  - Lockfile (`package-lock.json`) committed; PR review checks
    new entries and license obligations.
  - Open `<TBD>` item 2: enable Dependabot weekly + add
    `npm audit --audit-level=high` as a CI step. CI today runs
    only `npm run typecheck` + `npm test` (see
    `.github/workflows/ci.yml`).
- **Static analysis:**
  - ESLint (`next/core-web-vitals`) + TypeScript strict mode.
  - `.eslintrc.json` enables `no-floating-promises`,
    `no-misused-promises`, `no-explicit-any`, and
    `consistent-type-imports` — all at **`warn`** (not `error`).
    The first two were set to `error` on 2026-05-12 but downgraded
    after 374 pre-existing violations broke the Vercel deploy
    (`next build` runs ESLint). Open `<TBD>` item 10 now tracks
    fixing the 374 violations and promoting the rules back to
    `error`.
  - Open `<TBD>` item 2 (continued): add CodeQL on push for
    OWASP Top 10 pattern detection.
- **Penetration testing:** **annual** external pen test (ratified
  cadence) + after any security-relevant architecture change.
  First external pen test: scheduled for **post first paying
  customer**. Most recent internal review:
  `docs/security-review-2026-05-09.md`.
- **Bug bounty / responsible disclosure:** publish
  `security@sentimetrx.com` (or whichever domain is final) once a
  public marketing site exists. Open `<TBD>` item 7.

**How we verify:** quarterly dep-graph review (manual today);
Dependabot becomes the automated layer once item 2 lands. Pen
test report is filed in `docs/audit/` with the report date in
the filename.

---

## 10. Incident response

SEV definitions:

| SEV | Definition | Response time |
|---|---|---|
| **SEV-1** | Customer data exposed cross-tenant; data loss; prod down >5 min | Page immediately, status page, post-mortem within 5 business days |
| **SEV-2** | Single-customer impact, no cross-tenant breach; degraded perf | Same-day, post-mortem within 10 business days |
| **SEV-3** | Bug with workaround, internal-only impact | Track in normal sprint |

**On-call:** solo-founder coverage today. **Escalation policy
when a second operator joins:** primary on a 7-day rotation,
secondary on call for SEV-1 escalation, owner always reachable.
Open `<TBD>` item 9.

**Post-mortem template:** Open `<TBD>` item 9 — add
`docs/postmortems/TEMPLATE.md` and `docs/postmortems/README.md`
explaining the per-incident naming convention
(`YYYY-MM-DD-short-slug.md`).

**Status page:** stand up a public status page (Vercel-hosted
`/status` route, or hosted via Better Stack / Statuspage) at the
first paying customer. Open `<TBD>` item 9.

**How we verify:** every SEV-1 produces a post-mortem at the
template path within 5 business days, linked from the weekly
devlog. Quarterly review counts unfiled post-mortems.

---

## 11. Backup & disaster recovery

- **Database:** Supabase daily backups. **RPO:** 24h.
  **RTO:** ~2-4h to restore from backup. Validated by quarterly
  restore drill (Open `<TBD>` item 13).
- **Object storage:** S3 versioning is the recommended baseline
  for any bucket holding customer data. Open `<TBD>` item 13:
  confirm versioning state on every existing bucket, then enable
  cross-region replication on the largest. Treat as a
  pre-customer engineering item.
- **Application:** Vercel rollback is instant via the deployment
  history. Each push is a separate deploy; instant rollback to
  the previous deployment via `vercel rollback`.
- **DR test cadence:** **quarterly** restore drill — pick a
  backup, restore to a scratch DB, confirm row count + key
  invariants. Drill logged in the weekly devlog.

**How we verify:** drill log entries in `docs/weekly-reports/`;
any quarter with zero entries triggers the next governance
routine.

---

## 12. Compliance posture

Where we are vs. common frameworks (none formally certified yet):

| Framework | Status |
|---|---|
| SOC 2 Type I | **Targeted Q3 2026**, gated on first paying customer signing |
| SOC 2 Type II | Aspirational, ~12 months after Type I |
| GDPR | Posture defined here; formal DPIA at first EU customer signal |
| CCPA | Same as GDPR. |
| HIPAA | Not in scope — no PHI handling. State explicitly to customers. |
| PCI DSS | Not in scope — no card data; payments will route via Stripe-hosted checkout when payments ship |

**Customer-facing artifacts available on request:**
- `docs/SECURITY_OVERVIEW.md` — sanitized buyer-facing summary
- `docs/DATA_FLOW.md` — actors, subprocessors, AI inference flow
- `docs/CAIQ_LITE.md` — filled CAIQ-Lite self-assessment
- This document (internal policy — under NDA)
- `docs/AUDIT_FRAMEWORK.md`
- `docs/AUDIT_2026_Q1.md`
- `docs/security-review-2026-05-09.md`
- Subprocessor list (Section 8)
- Pen test summary (post first paying customer)

---

## 13. Things buyers will ask (cheat sheet)

Map of common DD questions → where in this codebase the answer lives:

- "How is tenant isolation enforced?" → Section 2 + `tests/rls-isolation` + `tests/cross-org-egress`
- "Who has prod access?" → Section 4 access roster `<TBD>`
- "What PII do you store?" → Section 5 classification table
- "Show me your audit log." → Section 6 + `admin_action_log` table (sql/048_admin_action_log.sql)
- "What happens if a customer asks to be deleted?" → Section 7
- "List your subprocessors." → Section 8 table
- "How do you handle vulnerabilities in deps?" → Section 9
- "Walk me through your most recent incident." → Section 10 + most recent post-mortem `<TBD>`
- "How long does it take to restore from backup?" → Section 11
- "Are you SOC2 certified?" → Section 12 (honest answer)
- "How do you protect against prompt injection?" → Section 8 AI guardrails

---

## Open `<TBD>` items as of 2026-05-15

Renumbered to match in-line references above. Each item is a
concrete decision the human owner needs to ratify or a piece of
plumbing that needs to ship.

1. *(closed 2026-05-25 — `lib/sentryScrub.ts` wired into all three
   Sentry configs; see §5. Unit test in
   `tests/unit/sentryScrub.test.ts`. Also drops the Microsoft
   Office "Object Not Found Matching Id…" false positive.)*
2. **Enable Dependabot weekly + `npm audit --audit-level=high`
   + CodeQL** in `.github/workflows/ci.yml`. Effort: 1 PR.
3. *(retired — rotation cadence ratified in §4)*
4. *(retired 2026-05-15 — `admin_action_log` already exists,
   matches §6 contract; see sql/048_admin_action_log.sql)*
5. **Add a delete-path test** to the egress suite, then confirm
   cascade-FK coverage by grep + dry-run delete in a scratch DB.
6. **Add an explicit org-level "AI may analyze our responses"
   toggle** before the first paying customer. Default: opt-in
   at onboarding.
7. **Add `lib/ai.ts` wrapper** that asserts single-`org_id` in
   the row set before any Claude call, with a unit test. Also
   publish `security@<final-domain>` disclosure address.
8. **Ratify MFA + session policy** for platform admins
   (proposed defaults are in §3).
9. **Incident-response plumbing:** post-mortem template,
   on-call rotation policy, public status page. Bundle for the
   first paying customer.
10. **Tighten ESLint config:** all four rules
    (`no-floating-promises`, `no-misused-promises`,
    `no-explicit-any`, `consistent-type-imports`) are currently
    enabled at `warn`. **Remaining work:** fix the 374
    `no-floating-promises` / `no-misused-promises` violations
    (and the 1801 `any` warnings), then promote the two
    promise rules back to `error` so `next build` enforces them.
    Initial attempt on 2026-05-12 set them to `error`
    immediately and broke production — sequence matters: fix
    first, then enforce.
11. **Extract a generalized `gate*Access` helper** to
    `lib/auth/gate.ts`. The trigger is met: four parallel
    definitions exist today —
    `gateShareTarget` in `app/api/share/route.ts`,
    `gateBotAccess` in
    `app/api/bots/[id]/conversations/[sessionId]/route.ts`,
    a second `gateBotAccess` in
    `app/api/bots/[id]/knowledge/[chunkId]/route.ts`, and
    gating logic in `app/api/townhall/sessions/[id]/route.ts`.
    Collapse to one helper that takes `(service, userId,
    resourceType, resourceId)` and returns the verified
    `{ targetOrgId }` or a typed denial.
12. **Introduce a structured logger** (`lib/log.ts`, pino or
    similar) and migrate prod handlers off bare `console.*`.
    Until then, handlers must pass a structured object —
    `console.warn({ event, request_id, org_id, ... })` — and
    never include PII fields.
13. **Quarterly DR restore drill** + S3 versioning audit on
    every bucket holding customer data.
14. **✅ CLOSED (2026-06-01).** All three `dangerouslySetInnerHTML`
    callsites now `DOMPurify.sanitize(...)` before render, matching
    the survey-engine pattern: `ConversationsClient.tsx` (agent
    conversation turns via `linkify`), `ChatBot.tsx` (chat messages
    via `formatHtml`), and `CampaignDetailClient.tsx` (the 3
    email-preview renders).
