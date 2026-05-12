# Sentimetrx — Security Policy & Posture

The security disciplines this codebase is held to, the controls that
enforce them, and the answers we'd give a buyer's technical-DD reviewer
or a SOC2 auditor. Linked from `CLAUDE.md` (operational) — this doc is
the **policy**; CLAUDE.md is the **playbook**.

Items marked `<TBD: …>` are policy decisions the human owner must make
before they can be ratified. Track decisions in
`docs/weekly-reports/YYYY-WXX-devlog.md` with a SECURITY tag.

Last reviewed: 2026-05-12.

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
   to Sentry. Mitigated by `.gitignore` (covers `.env*`, `*.pem`,
   `*.key`, `*.p12`, `*.pfx`) + Sentry beforeSend scrubbing
   `<TBD: confirm Sentry scrubbing config>`.
5. **Supply-chain compromise** — a malicious npm dependency.
   Mitigated by lockfile review on every PR + `<TBD: enable
   Dependabot + npm audit in CI>`.

Out of scope for now (acknowledged gaps):

- Sophisticated DDoS — Vercel/Supabase absorb the small-pilot
  blast radius; commercial WAF is a future item.
- Insider threat from people with prod access — relies on
  `<TBD: documented access roster>` + audit log review cadence.
- Physical security of the laptops used to access prod — relies
  on FileVault/BitLocker `<TBD: confirm on owner devices>`.

---

## 2. Multi-tenancy invariants

These have been the source of every CRITICAL security finding to date.
The CLAUDE.md "Multi-tenancy invariants" section is the canonical
shortlist for Claude; here is the longer policy:

- **Every new `public` table requires:**
  1. `enable row level security`
  2. At least one `select` policy that filters by `org_id`
  3. A migration test in `tests/rls-isolation` that proves Org A
     cannot read Org B's row for that table
  4. A test in `tests/cross-org-egress` covering the route handlers
     that read that table (RLS tests don't cover service-role paths)

- **Service-role queries must pair `id` with `org_id`.** A bare
  `id` lookup with the service-role client is a cross-tenant leak.
  Use `gate*Access` helpers in `lib/` rather than rolling your own
  filter — every gate function is the SINGLE source of an audited
  policy.

- **Internal-only routes (`/admin/*`, deck generators, strategy
  endpoints) wrap with `requireAdmin` from the first commit.**
  URL obscurity is not a defense.

- **New surface = new test.** `npm run test:rls` must pass before
  the table can be considered shipped; `npm run test:egress`
  before the route can be.

Reference: the May-2026 CRITICAL findings (six of them, same root
cause — service-role lookup without `org_id`) are documented in
`docs/AUDIT_2026_Q1.md`. Read that before writing a service-role
query.

---

## 3. Authentication & authorization

- **Identity:** Supabase Auth (email + password and magic links).
  Session cookies are `HttpOnly`, `Secure`, `SameSite=Lax`.
- **Authorization model:**
  - Regular user: scoped to their `org_id` via RLS.
  - Org admin (`role='admin'` in `org_members`): adds invite/billing
    routes.
  - Platform admin (`is_platform_admin=true` on `users`): adds
    internal-only routes. Guarded by `requireAdmin`.
- **MFA:** `<TBD: not currently enforced. Decide: optional for
  regular users, required for platform admins?>`
- **Session policy:**
  - Idle timeout: Supabase default (1 hour access token, 7 day
    refresh).
  - `<TBD: reduce for platform admins?>`
- **CSRF protection:** `middleware.ts` enforces a same-site or
  CSRF-token check on cookie-authed mutating routes. Webhooks /
  cron / embed widgets are explicitly bypassed (each documented
  inline in the middleware).
- **API auth for embeddable widgets** (`/s/[guid]`, `/b/[guid]`,
  `/th/[guid]`): GUID is opaque + 122-bit-entropy + checked for
  org binding on every request. No cookie auth.

---

## 4. Secrets management

- **Storage:** Vercel Project Environment Variables (Production /
  Preview / Development) are the source of truth.
- **Local development:** `.env.local` (gitignored). Devs pull
  baseline values via `vercel env pull .env.local`.
- **Never committed:** `.env*` files, `*.pem`, `*.key`, `*.p12`,
  `*.pfx`. `.gitignore` enforces this; CI does *not* re-check
  `<TBD: add a pre-commit secret-scan hook (e.g. detect-secrets
  or gitleaks)>`.
- **Rotation cadence:** `<TBD: define. Suggested baseline —
  Supabase service-role key 90d; Anthropic key 90d; Resend key
  90d; AWS S3 access keys 90d; any leaked key immediately.>`
- **Access roster:** `<TBD: who has prod env access in Vercel,
  Supabase, Resend, Anthropic, AWS S3. Document here with
  date-of-grant and review at every quarterly audit.>`
- **Secret usage hygiene:**
  - Server-only secrets (anything starting `SUPABASE_SERVICE_ROLE`,
    `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `AWS_SECRET_ACCESS_KEY`)
    are read inside files under `app/api/`, `lib/` with the
    `server-only` import, or `instrumentation.ts`. They must never
    appear in any module reachable from a client component.
  - The `server-only` npm package is a load-time guard; preserve it
    on critical modules.

---

## 5. PII / sensitive data classification

| Field type | Examples | Classification | Handling |
|---|---|---|---|
| **Auth identity** | email, password hash | PII / Auth | Supabase-managed. Never logged. Never sent to Claude. |
| **User-volunteered profile** | name, phone, company role | PII | Stored in `users` / `org_members`. Org-scoped. Redacted from logs (`<TBD: confirm log redaction>`). |
| **Survey / agent responses** | free-text answers | PII (assumed) | Stored in `dataset_rows_flat`. Org-scoped. Sent to Claude in scoped prompts only when the org has opted in `<TBD: confirm opt-in surface>`. |
| **Uploaded datasets** | customer CRM exports, etc. | Variable (assume PII) | Same as above. Schemas tracked in `mergeSchemaStats`. |
| **AI-generated analysis** | deck content, strategy outputs | Derived | Treated as same sensitivity as inputs that produced it. |
| **Operational metadata** | timestamps, IPs, user-agent | Low | OK in logs and Sentry. |

Rules:

- **Never put PII in URL paths or query strings.** GUIDs only.
- **Never put PII into a structured log message.** Use opaque ids;
  if a field must be logged for debugging, redact (`mask(email)`).
- **Sentry `beforeSend` scrub** must drop email, phone, password
  fields, and the contents of `req.body` for survey/response
  endpoints. `<TBD: audit current Sentry scrub config>`.
- **Claude prompts** must never include rows from more than one
  `org_id`. Scoped tool definitions only.

---

## 6. Audit logging

A buyer's CC6/CC7 question: "Show me logs of admin actions and
cross-org access attempts."

- **Application-level audit log:** `<TBD: confirm exists. If not,
  add a `audit_events` table with (actor_user_id, actor_org_id,
  action, target_table, target_id, target_org_id, ip, ua, at).>`
- **Admin actions that MUST log:**
  - Any `requireAdmin` route hit (success and denial)
  - Billing changes
  - Org membership changes (invite, role change, removal)
  - Exports (deck, dataset, audit)
  - Bulk deletes
- **Retention:** `<TBD: 2 years recommended for SOC2; confirm.>`
- **Tamper resistance:** `<TBD: append-only via row-level policy
  that denies UPDATE/DELETE; or stream to a separate immutable
  store.>`
- **Database-level audit:** Supabase Postgres logs are the
  fallback. Access reviewed `<TBD: cadence>`.

---

## 7. Data retention & deletion (GDPR / CCPA posture)

- **Right-to-be-forgotten:** when an org is deleted, we cascade
  delete all of its `dataset_rows_flat`, survey responses, agent
  conversations, AI outputs, and audit log rows tagged to that
  org. `<TBD: confirm cascade FKs are in place; the egress tests
  do not currently cover delete paths.>`
- **User-level deletion within an org:** removing a user from an
  org does NOT delete the rows they created — those belong to the
  org. `<TBD: confirm with legal counsel for GDPR data-subject
  requests where the user is the data subject.>`
- **Soft-delete vs hard-delete:** `<TBD: define per table.
  Recommended: hard-delete user-identifying rows; soft-delete with
  90-day tombstone for derived/aggregate rows.>`
- **Backup retention:** Supabase Pro daily backups, 7-day retention
  by default. `<TBD: extend to 30 days or confirm pilot
  acceptance.>`
- **Data residency:** `<TBD: customers will ask. Currently
  Supabase us-east. Decide policy for EU customers.>`

---

## 8. Third-party / AI integration safety

External services we send data to (full inventory — review
quarterly):

| Service | Data sent | Auth | DPA on file? |
|---|---|---|---|
| Anthropic Claude | scoped prompts + AI tool inputs | API key | `<TBD>` |
| Supabase | all primary data | service-role + RLS | `<TBD>` |
| Vercel | application code + runtime traffic | OIDC + token | `<TBD>` |
| Resend | transactional email payloads | API key | `<TBD>` |
| DataForSEO | search queries | API key | `<TBD>` |
| AWS S3 | file uploads | IAM creds | yes (AWS DPA) |
| Sentry | error traces (PII-scrubbed) | DSN | `<TBD>` |

**AI-specific guardrails:**

- `lib/guardrails.ts` runs an input pre-check on free-text fed
  into Claude (length, profanity, URL injection, role-prompt
  patterns).
- Tool definitions are narrow — Claude cannot make arbitrary DB
  queries or arbitrary HTTP calls.
- **Prompt budget:** no single Claude prompt may include rows
  from more than one `org_id`. Enforced by review, not yet
  automated `<TBD: add a unit-test rule>`.
- **Model output sanitization:** Claude output is treated as
  untrusted user input — sanitized via DOMPurify before any HTML
  render; URLs are stripped from any surface that doesn't
  explicitly need them.

---

## 9. Vulnerability management

- **Dependencies:**
  - Lockfile (`package-lock.json`) committed; PR review checks
    new entries and license obligations.
  - `<TBD: enable Dependabot weekly + npm audit --audit-level=high
    as a CI step. CI currently only runs typecheck + unit tests.>`
- **Static analysis:**
  - ESLint + TypeScript strict mode.
  - `<TBD: add CodeQL or Snyk Code on push for OWASP Top 10
    pattern detection.>`
- **Penetration testing:** `<TBD: cadence. Recommended: external
  pen test annually + after any security-relevant architecture
  change.>` Most recent: `docs/security-review-2026-05-09.md`
  (internal).
- **Bug bounty / responsible disclosure:** `<TBD: public address
  for vuln reports — `security@<TBD: domain>`. Currently no
  published policy.>`

---

## 10. Incident response

SEV definitions (rough — refine in `<TBD: incident-response
runbook>`):

| SEV | Definition | Response time |
|---|---|---|
| **SEV-1** | Customer data exposed cross-tenant; data loss; prod down >5 min | Page immediately, status page, post-mortem within 5 business days |
| **SEV-2** | Single-customer impact, no cross-tenant breach; degraded perf | Same-day, post-mortem within 10 business days |
| **SEV-3** | Bug with workaround, internal-only impact | Track in normal sprint |

**On-call:** `<TBD: solo founder coverage today. Define
escalation path when the team grows.>`

**Post-mortem template:** `<TBD: create docs/postmortems/TEMPLATE.md;
each incident gets a file dated YYYY-MM-DD.>`

**Status page:** `<TBD: stand up a public status page (e.g.,
Vercel-hosted /status) once the first paying customer signs.>`

---

## 11. Backup & disaster recovery

- **Database:** Supabase daily backups. **RPO:** 24h.
  **RTO:** ~2-4h to restore from backup `<TBD: validate with a
  quarterly restore drill>`.
- **Object storage:** S3 versioning enabled? `<TBD: confirm.>`.
  Cross-region replication? `<TBD>`.
- **Application:** Vercel rollback is instant via the deployment
  history. Each push is a separate deploy; instant rollback to
  the previous deployment via `vercel rollback`.
- **DR test cadence:** `<TBD: quarterly restore drill — pick a
  backup, restore to a scratch DB, confirm row count + key
  invariants.>`

---

## 12. Compliance posture

Where we are vs. common frameworks (none formally certified yet):

| Framework | Status |
|---|---|
| SOC 2 Type I | `<TBD: pursue Q3?>` |
| SOC 2 Type II | Aspirational |
| GDPR | Posture defined here; no formal DPIA. `<TBD>` |
| CCPA | Same as GDPR. |
| HIPAA | Not in scope — no PHI handling. State explicitly to customers. |
| PCI DSS | Not in scope — no card data; payments via `<TBD: Stripe?>`. |

**Customer-facing artifacts available on request:**
- This document
- `docs/AUDIT_FRAMEWORK.md`
- `docs/AUDIT_2026_Q1.md`
- `docs/security-review-2026-05-09.md`
- Subprocessor list (Section 8)
- Pen test summary `<TBD: when available>`

---

## 13. Things buyers will ask (cheat sheet)

Map of common DD questions → where in this codebase the answer lives:

- "How is tenant isolation enforced?" → Section 2 + `tests/rls-isolation` + `tests/cross-org-egress`
- "Who has prod access?" → Section 4 access roster `<TBD>`
- "What PII do you store?" → Section 5 classification table
- "Show me your audit log." → Section 6 + `audit_events` table `<TBD>`
- "What happens if a customer asks to be deleted?" → Section 7
- "List your subprocessors." → Section 8 table
- "How do you handle vulnerabilities in deps?" → Section 9
- "Walk me through your most recent incident." → Section 10 + most recent post-mortem `<TBD>`
- "How long does it take to restore from backup?" → Section 11
- "Are you SOC2 certified?" → Section 12 (honest answer)
- "How do you protect against prompt injection?" → Section 8 AI guardrails

---

## Open `<TBD>` items as of 2026-05-12

A snapshot — clean as the items below get resolved:

1. Enable Dependabot + `npm audit` in CI
2. Document the prod access roster
3. Define key rotation cadence
4. Confirm `audit_events` table exists; if not, add it
5. Confirm GDPR cascade-delete coverage in egress tests
6. Add a unit-test rule enforcing single-org-id in Claude prompts
7. Publish `security@<domain>` disclosure address
8. Define MFA policy for platform admins
9. Stand up post-mortem template + status page (post first paying customer)
10. Schedule first external pen test
