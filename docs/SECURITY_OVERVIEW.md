# Sentimetrx — Security Overview (Buyer-Facing)

_Last reviewed: 2026-05-16_

This is a sanitized, buyer-facing summary of how Sentimetrx protects
customer data. The full internal policy lives in `docs/SECURITY.md` and
is available on request under NDA. Anything not stated here as
implemented should be assumed to be in scope for the post-pilot
hardening track and is tracked in our internal Open Items log.

---

## 1. Vendor

- **Product:** Sentimetrx — guest-feedback analytics for multi-brand
  hospitality operators.
- **Operator:** Datanautix LLC, United States.
- **Stage:** Pilot deployments with named-account customers. SOC 2
  Type I is on a 2026 H2 path, gated on first paying customer.
- **Primary contact:** the Datanautix principal listed in the executed
  agreement. A dedicated `security@` disclosure address will be
  published with the public marketing site.

## 2. Hosting & data residency

| Layer | Provider | Region | Notes |
|---|---|---|---|
| Application compute | Vercel (Fluid Compute) | US (primarily `iad1`) | No execution outside the US |
| Database | Supabase Postgres | AWS `us-east-1` | All tenant data |
| Object storage | Supabase Storage / AWS S3 | `us-east-1` | Uploaded files & generated artifacts |
| Transactional email | Resend | US | Only if customer enables outbound surveys |
| Error monitoring | Sentry | US | Operational metadata only |
| Search-data enrichment | DataForSEO | US | Public review fetch; no customer PII |

All data in transit is protected by TLS 1.2+ (enforced by Vercel and
Supabase). Data at rest is encrypted with AES-256 (Supabase managed
keys; AWS-managed keys for S3 objects).

## 3. Tenant isolation

Every customer organization (`org_id`) is a hard tenancy boundary.
Isolation is enforced at two independent layers, both audited by
automated tests on every change:

1. **Database (Row-Level Security).** Every customer-scoped table has
   Postgres RLS enabled with a policy that filters by `org_id`. A
   user authenticated as Org A cannot read or write Org B rows even
   if a bug in the application layer were to omit a filter.
2. **Application (service-role pairing).** Server-side queries that
   run as the service-role identity must pair the row identifier with
   the caller's `org_id` on every read and write. This is enforced by
   convention plus a dedicated cross-tenant egress test suite, and
   reviewed on every pull request.

Routes that span multiple organizations (admin tooling, internal
exports) are wrapped in an explicit `requireAdmin` gate from the
first commit. URL obscurity is not a defense.

## 4. Authentication

- **End-user identity** is managed by Supabase Auth: email + password
  or magic-link. Sessions use `HttpOnly`, `Secure`, `SameSite=Lax`
  cookies. CSRF protection is enforced by application middleware on
  every cookie-authed mutating route.
- **SSO**: Google Workspace / SAML SSO is available at customer
  request and can be configured as a hard requirement for the
  customer's tenant.
- **Embeddable widgets** (public-facing survey, agent, and PulseIQ
  pages) authenticate via opaque 122-bit identifiers bound to the
  owning organization. No cookies, no inferable IDs.
- **Internal access**: production credentials are limited to the
  Datanautix principal today. Each additional operator joins a
  formal access roster, reviewed quarterly, with rotation on
  separation.

## 5. PII & data classification

| Class | Examples | Treatment |
|---|---|---|
| Auth identity | email, password hash | Supabase-managed; never logged; never sent to AI |
| Customer-volunteered profile | name, phone, role | Org-scoped; opaque IDs in URLs and logs |
| Guest feedback content | survey/agent responses, review text | Org-scoped; sent to AI only inside single-org prompts |
| Uploaded datasets | customer-provided rows | Same treatment as feedback content |
| AI-derived analyses | themes, sentiment, summaries | Inherits sensitivity of inputs |
| Operational metadata | timestamps, IPs, user-agent | Permitted in logs and Sentry |

**Out of scope for this product:** payment card data (PCI), protected
health information (PHI), employee HR records, and customer
financial systems. Sentimetrx neither requests nor stores any of
these.

## 6. AI safety

- **Single-tenant prompts.** No prompt sent to a model includes rows
  from more than one `org_id`. This is the load-bearing invariant of
  our AI design.
- **Guardrails.** All free-text inputs to the AI layer run through a
  pre-check that handles length, profanity, URL injection, and
  known prompt-injection patterns.
- **Narrow tool surface.** The AI cannot make arbitrary database
  queries or arbitrary outbound HTTP calls. Tools are defined per
  feature with a fixed schema.
- **No model training on customer data.** Sentimetrx does not train
  or fine-tune any model on customer data. Anthropic's commercial
  API terms state that customer inputs are not used to train
  Anthropic's foundation models.
- **Anthropic retention.** Per Anthropic's standard API terms,
  inputs and outputs are retained for up to 30 days for trust &
  safety / abuse monitoring and then deleted (UserSafety classifier
  results may persist as labels). Zero Data Retention is available
  as an enterprise contractual upgrade and is in progress with
  Anthropic Sales.
- **Output sanitization.** AI output rendered as HTML is sanitized
  with `isomorphic-dompurify` on the surfaces that render rich
  content; raw model output is never injected unsanitized into
  customer-facing pages.

## 7. Audit logging

- An append-only `admin_action_log` table records administrative
  actions: privileged route access, org membership changes,
  exports, and bulk deletes. Writes occur only via the service-role
  identity; the database has no `INSERT/UPDATE/DELETE` policy for
  the auth client.
- Each row includes actor, organization, action, resource, timestamp,
  and selected metadata.
- **Retention: 2 years**, aligning with SOC 2 CC4 evidence retention
  guidance.
- Customer security teams may request a redacted extract scoped to
  their organization.

## 8. Data retention & deletion

- **Organization deletion** cascades through tenant-scoped tables
  (dataset rows, survey responses, agent conversations, AI outputs,
  audit log rows tagged to that org).
- **User-level deletion** within an org removes the user's identity;
  rows the user created belong to the organization and are retained
  unless the org also requests their deletion. For data-subject
  erasure requests, identifying fields are redacted in place and
  row content is preserved as anonymized organization property.
- **Soft-delete tombstones** (90 days) apply to derived/aggregate
  rows and to per-row user-erasure requests on dataset content;
  hard-delete applies on full-org deletion.
- **Backups** are retained 7 days during pilot and will be extended
  to 30 days at first paying customer.

## 9. Vulnerability management

- TypeScript strict mode + ESLint (`next/core-web-vitals`) enforced
  at build time.
- Dependency lockfile committed; new dependencies reviewed on PR.
- Quarterly dependency-graph review by the principal today; an
  automated layer (Dependabot + `npm audit` gate) is on the
  hardening roadmap.
- **Penetration testing.** Internal security reviews are documented
  in `docs/audit/`. An external pen test is scheduled for the
  post-first-paying-customer window. Customers requiring an external
  pen test report ahead of that window can be scoped into a paid
  engagement.

## 10. Incident response

| Severity | Definition | Response |
|---|---|---|
| SEV-1 | Cross-tenant data exposure, confirmed data loss, prod down >5 min | Page immediately; customer notification ≤24 h; post-mortem ≤5 business days |
| SEV-2 | Single-customer impact, no cross-tenant breach | Same-day response; post-mortem ≤10 business days |
| SEV-3 | Workaround exists; internal-only impact | Normal sprint |

Post-mortems are written for every SEV-1 and SEV-2 incident and
shared with affected customers' named security contacts.

## 11. Business continuity

- **RPO:** 24 h (Supabase daily backups).
- **RTO:** 2–4 h to restore from backup.
- **Disaster-recovery drill cadence:** quarterly restore to a scratch
  database; row counts and key invariants confirmed; result logged.
- **Application rollback** is instant via Vercel deployment history.

## 12. Compliance posture

| Framework | Status |
|---|---|
| SOC 2 Type I | Targeted **2026 H2**, gated on first paying customer |
| SOC 2 Type II | Aspirational, ~12 months after Type I |
| GDPR / CCPA | Posture defined; formal DPIA at first EU customer signal |
| HIPAA | **Not in scope** — no PHI handled |
| PCI DSS | **Not in scope** — no card data handled |

## 13. Customer-facing artifacts

Available on request, under NDA where appropriate:

- This overview
- Filled CAIQ-Lite questionnaire (`docs/CAIQ_LITE.md`)
- Data-flow diagram (`docs/DATA_FLOW.md`)
- Subprocessor list (Section 2 of this document)
- Internal security policy (`docs/SECURITY.md`)
- Internal engineering policy (`docs/ENGINEERING.md`)
- Most recent internal security review
- External pen test summary (once executed)

## 14. Contact

For security questions, vendor-assessment follow-ups, or to report a
vulnerability, contact the Datanautix principal named in the executed
agreement. A public `security@` disclosure address will be published
alongside the public marketing site.
