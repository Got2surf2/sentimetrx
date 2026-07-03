# Sentimetrx — CAIQ-Lite (Cloud Security Alliance)

_Last reviewed: 2026-07-02_

This is a self-assessment using the Cloud Security Alliance Consensus
Assessments Initiative Questionnaire — Lite (CAIQ-Lite) format, mapped
to CCM (Cloud Controls Matrix) v4 control domains.

Answers reflect the platform as it exists at pilot scale. Items marked
**Roadmap** are controls that are either partially implemented or
formally scheduled and are not represented as live. Items marked
**Compensating** are addressed by an alternative control that is in
place today.

For internal-policy detail see `docs/SECURITY.md`. For data-flow
detail see `docs/DATA_FLOW.md`. For the buyer-facing summary see
`docs/SECURITY_OVERVIEW.md`.

---

## A&A — Audit & Assurance

| # | Question | Answer | Notes |
|---|---|---|---|
| A&A-01 | Do you produce SOC 2 / ISO 27001 / equivalent third-party audit reports? | **No (Roadmap)** | SOC 2 Type I targeted 2026 H2, gated on first paying customer |
| A&A-02 | Do you perform internal security audits? | **Yes** | Documented internal reviews in `docs/audit/` and `docs/security-review-2026-05-09.md` |
| A&A-03 | Will you allow customer-led security audits? | **Yes** | On reasonable notice, scoped to the customer's tenant; subject to NDA |
| A&A-04 | Do you maintain an inventory of compliance obligations? | **Yes** | Section 12 of `docs/SECURITY.md` |

## AIS — Application & Interface Security

| # | Question | Answer | Notes |
|---|---|---|---|
| AIS-01 | Are applications designed and developed using secure coding standards? | **Yes** | TypeScript strict mode; ESLint enforced in CI; documented multi-tenancy invariants (CLAUDE.md + `docs/SECURITY.md`); AI-assisted review + weekly governance audit (solo-operator today — see CCC-02) |
| AIS-02 | Is input validation performed on untrusted input? | **Yes** | Server-side validation on all API routes; AI inputs additionally pass through `lib/guardrails.ts` |
| AIS-03 | Are APIs authenticated? | **Yes** | Session-cookie + CSRF for first-party UI; opaque high-entropy IDs for embed widgets; service-role for internal jobs only |
| AIS-04 | Do you separate production and non-production environments? | **Yes** | Vercel Production vs Preview; separate environment-variable scopes |
| AIS-05 | Are output encoding / sanitization controls used to prevent injection (XSS, etc.)? | **Yes** | React's default escaping plus `isomorphic-dompurify` for AI-rendered HTML on the rich-render surfaces. Coverage expansion to remaining `dangerouslySetInnerHTML` callsites is on the hardening track. |

## BC — Business Continuity & Operational Resilience

| # | Question | Answer | Notes |
|---|---|---|---|
| BC-01 | Do you have a documented BC / DR plan? | **Yes** | Section 11 of `docs/SECURITY.md` |
| BC-02 | What is the RPO? | **24 hours** | Supabase daily backups |
| BC-03 | What is the RTO? | **2–4 hours (target)** | Restore path to a dedicated scratch project; schema-level restore exercised 2026-07-02 |
| BC-04 | Are DR drills performed and documented? | **Roadmap** | Dedicated scratch project stood up 2026-07-02 and a schema-level restore exercised; first full data-restore drill (row counts + invariants confirmed) scheduled, quarterly cadence thereafter, logged in `docs/weekly-reports/` |
| BC-05 | Is application rollback supported? | **Yes** | Instant via Vercel deployment history |

## CCC — Change Control & Configuration Management

| # | Question | Answer | Notes |
|---|---|---|---|
| CCC-01 | Is there a documented change-management process? | **Yes** | Git-based: CI (typecheck + tests) on every push; deploys to production from `main`; spec/devlog drift gates at commit time |
| CCC-02 | Are changes to production reviewed before deployment? | **Compensating** | Solo-operator model today: commits land on `main` directly (no second human reviewer exists). Compensating controls: CI on every push, required status checks on `main` via branch protection (typecheck+tests, multi-tenant isolation; enabled 2026-07-03, admin bypass documented), force-push/deletion blocked, AI-assisted code review, weekly automated governance audit, and full commit-level traceability. Mandatory PR review begins with the first additional engineer |
| CCC-03 | Are configuration changes logged? | **Yes** | Git history for code and Vercel deployment log for runtime configuration |
| CCC-04 | Are database schema changes versioned? | **Yes** | Numbered `sql/NNN_*.sql` migration files in the repo |
| CCC-05 | Are deployments traceable to source commits? | **Yes** | Vercel records the source commit for every deployment |

## CEK — Cryptography, Encryption & Key Management

| # | Question | Answer | Notes |
|---|---|---|---|
| CEK-01 | Is customer data encrypted at rest? | **Yes** | AES-256 at the database and object-storage layer |
| CEK-02 | Is customer data encrypted in transit? | **Yes** | TLS 1.2+ (TLS 1.3 preferred) end to end |
| CEK-03 | Who manages the encryption keys? | **Provider-managed** | Supabase / AWS KMS. Application-layer encryption is additionally applied to customer-supplied AI provider keys (AES-256-GCM envelope, key held in Vercel environment configuration) |
| CEK-04 | Is there a documented key-rotation policy? | **Yes** | Section 4 of `docs/SECURITY.md`: 90 days for high-sensitivity keys, 180 days for vendor API keys, immediate on suspected compromise |
| CEK-05 | Are TLS certificates managed automatically? | **Yes** | Vercel-managed Let's Encrypt + ACME |

## DCS — Datacenter Security

| # | Question | Answer | Notes |
|---|---|---|---|
| DCS-01 | Where is data hosted? | **United States** | Vercel `iad1`; Supabase `us-east-1` (AWS) |
| DCS-02 | Is physical security inherited from a major IaaS provider? | **Yes** | AWS SOC 2 + ISO 27001 controls inherited; documented at https://aws.amazon.com/compliance |
| DCS-03 | Is multi-region replication available? | **Roadmap** | Single-region today; cross-region replication on the post-first-customer engineering track |

## DSP — Data Security & Privacy Lifecycle Management

| # | Question | Answer | Notes |
|---|---|---|---|
| DSP-01 | Is data classified by sensitivity? | **Yes** | Section 5 of `docs/SECURITY.md` |
| DSP-02 | Is tenant data segregated? | **Yes** | Row-Level Security at Postgres + service-role org_id pairing at the application layer; covered by dedicated cross-tenant egress tests |
| DSP-03 | Is data ever used for purposes other than service delivery? | **No** | Not used for analytics-vendor enrichment, not used for AI training, not sold |
| DSP-04 | Is customer data used to train AI models? | **No** | Not by Sentimetrx; not by Anthropic per their commercial API terms |
| DSP-04a | What is the retention policy at the AI subprocessor? | **30-day default; ZDR in progress** | Anthropic retains API inputs and outputs for up to 30 days for trust & safety / abuse monitoring per their standard API terms, then deletes (UserSafety classifier results may persist as labels). Zero Data Retention is an enterprise contractual upgrade; request is in progress with Anthropic Sales |
| DSP-05 | Do you support data export / portability? | **Yes** | CSV / JSON / PPTX export from the UI; `pg_dump` available on contract termination |
| DSP-06 | Do you support data-subject erasure requests (GDPR / CCPA)? | **Yes** | Per Section 7 of `docs/SECURITY.md`: identifying-field redaction with row-content preservation as anonymized org property |
| DSP-07 | What is the data-deletion timeline on contract termination? | **≤30 days** | Export delivered within 14 days; production purge within 30 days; backups age out within retention window |
| DSP-08 | Is data shared with any subprocessors? | **Yes (listed)** | Subprocessor inventory in `docs/SECURITY_OVERVIEW.md` §2 and `docs/DATA_FLOW.md` §4 |
| DSP-09 | Are subprocessors contractually bound to equivalent protections? | **Roadmap** | Standard vendor ToS today; formal DPAs requested with each subprocessor at first paying customer |

## GRC — Governance, Risk, and Compliance

| # | Question | Answer | Notes |
|---|---|---|---|
| GRC-01 | Is there a documented information-security policy? | **Yes** | `docs/SECURITY.md` |
| GRC-02 | Is the policy reviewed at least annually? | **Yes** | Last reviewed 2026-05-15 |
| GRC-03 | Is there a designated security owner? | **Yes** | The Datanautix principal today; documented in the access roster |
| GRC-04 | Is there a documented risk-management process? | **Yes** | Section 1 of `docs/SECURITY.md` (threat model + out-of-scope acknowledgements) |

## HRS — Human Resources Security

| # | Question | Answer | Notes |
|---|---|---|---|
| HRS-01 | Are background checks performed on personnel with production access? | **N/A at pilot scale** | Solo founder today; required for every additional operator before prod credentials are issued |
| HRS-02 | Are personnel trained on security awareness? | **Yes** | Owner-led; formal annual training program scheduled with first hire |
| HRS-03 | Is there an acceptable-use policy? | **Yes** | Captured in the operator-onboarding checklist (`docs/SECURITY.md` §4) |
| HRS-04 | Is access revoked promptly on separation? | **Yes** | Immediate revocation as part of the access-roster review cadence |

## IAM — Identity & Access Management

| # | Question | Answer | Notes |
|---|---|---|---|
| IAM-01 | Is access to customer data restricted to authorized personnel? | **Yes** | Production credentials limited to a named access roster; reviewed quarterly |
| IAM-02 | Is the principle of least privilege enforced? | **Yes** | Three application roles (`platform_admin`, `owner`, `member`); admin-org gate distinct from per-org admin |
| IAM-03 | Are user identities uniquely identifiable? | **Yes** | One identity per user in Supabase Auth |
| IAM-04 | Is MFA available for customer-facing accounts? | **Roadmap** | Supabase Auth supports it; enforcement policy ratification pending; available on request |
| IAM-05 | Is MFA enforced for personnel with production access? | **Roadmap** | Supabase, Vercel, GitHub, AWS — MFA enforced at the account level on the provider side today; formal Sentimetrx policy ratification pending |
| IAM-06 | Is SSO supported for customer-facing accounts? | **Roadmap** | Not yet implemented. Auth today is Supabase email magic-link (+ password for invite acceptance); no SSO/SAML/SCIM flow is wired in the app. Supabase Auth supports the underlying providers; SSO is on the roadmap, not available on request today |
| IAM-07 | Are privileged actions logged? | **Yes (core actions)** | `admin_action_log` table (org lifecycle changes, AI-key changes, snapshot restores, cross-org transfers); append-only; 2-year retention; coverage expansion on the hardening track |
| IAM-08 | Are sessions invalidated on logout / timeout? | **Yes** | Supabase-managed session lifetimes; `HttpOnly` + `Secure` + `SameSite=Lax` cookies |

## IVS — Infrastructure & Virtualization Security

| # | Question | Answer | Notes |
|---|---|---|---|
| IVS-01 | Is the production environment network-segregated from non-production? | **Yes** | Separate Supabase projects / Vercel project scopes possible; separate env-var scopes today |
| IVS-02 | Are firewall / network controls in place? | **Inherited** | Provider-managed at Vercel and AWS |
| IVS-03 | Is anti-DDoS protection in place? | **Inherited** | Vercel-managed |
| IVS-04 | Is hardening applied to compute? | **Inherited** | Vercel Fluid Compute managed runtime |

## IPY — Interoperability & Portability

| # | Question | Answer | Notes |
|---|---|---|---|
| IPY-01 | Can customer data be exported in a standard format? | **Yes** | CSV, JSON, and PPTX export from the UI |
| IPY-02 | Are APIs documented? | **Internal** | Internal API surface documented in `docs/`; public API not exposed at pilot scale |
| IPY-03 | Are open standards used where possible? | **Yes** | HTTP / JSON / Postgres / OAuth2 (PKCE, via Supabase Auth). SAML is roadmap, not yet implemented — see IAM-06 |

## LOG — Logging & Monitoring

| # | Question | Answer | Notes |
|---|---|---|---|
| LOG-01 | Are security-relevant events logged? | **Yes** | `admin_action_log` for application actions; Supabase Postgres logs as database fallback |
| LOG-02 | Are logs retained per policy? | **Yes** | 2 years for `admin_action_log`; Supabase log retention per Supabase plan |
| LOG-03 | Are logs protected from tampering? | **Yes** | `admin_action_log` is append-only at the RLS-policy level — only the service role can insert; no policy permits update or delete from the auth client |
| LOG-04 | Is application-error monitoring in place? | **Yes** | Sentry, with a PII-scrubbing handler (`lib/sentryScrub.ts`, unit-tested) wired into the client, server, and edge configs; the application-layer rule remains that PII is not passed to `console.*` or to `throw` messages |

## SEF — Security Incident Management, E-Discovery, Forensics

| # | Question | Answer | Notes |
|---|---|---|---|
| SEF-01 | Is there a documented incident-response plan? | **Yes** | Section 10 of `docs/SECURITY.md` |
| SEF-02 | Are SEV levels defined? | **Yes** | SEV-1 / SEV-2 / SEV-3, with response time targets |
| SEF-03 | Is there a customer-notification SLA on confirmed breach? | **Yes** | ≤24 hours for SEV-1 cross-tenant exposure |
| SEF-04 | Are post-mortems produced? | **Yes** | Required for SEV-1 within 5 business days, SEV-2 within 10 business days |
| SEF-05 | Is there a vulnerability-disclosure address? | **Roadmap** | Public `security@` address will be published with the public marketing site; today, report to the Datanautix principal named in the executed agreement |

## STA — Supply Chain Management, Transparency, & Accountability

| # | Question | Answer | Notes |
|---|---|---|---|
| STA-01 | Are subprocessors inventoried and disclosed? | **Yes** | `docs/SECURITY_OVERVIEW.md` §2 and `docs/DATA_FLOW.md` §4 |
| STA-02 | Are subprocessor changes communicated to customers? | **Yes** | Material changes communicated with 30-day notice |
| STA-03 | Are dependency artifacts reviewed? | **Yes** | Lockfile-pinned; new dependencies reviewed at PR time |
| STA-04 | Is there automated dependency scanning? | **Roadmap** | Dependabot + `npm audit` gate on the hardening track |

## TVM — Threat & Vulnerability Management

| # | Question | Answer | Notes |
|---|---|---|---|
| TVM-01 | Is vulnerability scanning performed? | **Yes (manual)** | Quarterly dependency-graph review by the principal; automated scanning on roadmap |
| TVM-02 | Is penetration testing performed? | **Yes (internal)** | Most recent internal review: `docs/security-review-2026-05-09.md`. External pen test scheduled for post-first-paying-customer window |
| TVM-03 | Is there a remediation SLA for findings? | **Yes** | Critical: 7 days. High: 30 days. Medium: 90 days. Low: best-effort |
| TVM-04 | Are AI-specific threats addressed? | **Yes** | Single-org-per-prompt invariant; narrow tool surface; prompt-injection pattern detection in `lib/guardrails.ts`; output sanitization on rich-render surfaces |

---

## Summary scoring (self-assessed)

| Domain | Implemented | Partial / Roadmap |
|---|---|---|
| A&A | 3 | 1 |
| AIS | 5 | 0 |
| BC | 4 | 1 |
| CCC | 5 | 0 |
| CEK | 5 | 0 |
| DCS | 2 | 1 |
| DSP | 8 | 2 |
| GRC | 4 | 0 |
| HRS | 3 | 1 (N/A at pilot scale) |
| IAM | 6 | 2 |
| IVS | 4 | 0 |
| IPY | 3 | 0 |
| LOG | 4 | 0 |
| SEF | 4 | 1 |
| STA | 3 | 1 |
| TVM | 4 | 0 |

**Total: 67 implemented, 10 roadmap / partial.**

The roadmap items are: third-party SOC 2 audit, multi-region
replication, formal subprocessor DPAs, MFA enforcement policy
ratification, automated dependency scanning, public `security@`
address, the first full DR restore drill, and Zero Data Retention
with Anthropic (default API retention is 30 days for trust & safety,
then deletion; ZDR is an enterprise contractual upgrade in progress).

All roadmap items are tracked in the internal Open Items log in
`docs/SECURITY.md` and are gated on first paying customer or earlier
where a specific customer requires acceleration.
