# COMPLIANCE.md — Trigger-Mapped Readiness Checklist

Compliance obligations organized by the **business event that makes each one
real**, so nothing lives only as a scattered `<TBD>`. This is the tracking
layer; the substance lives in `docs/SECURITY.md` (internal truth),
`docs/SECURITY_OVERVIEW.md` + `docs/CAIQ_LITE.md` (buyer-facing), and
`docs/BACKUPS.md`. When an item completes, mark it here AND update the
source doc in the same commit.

**How to use:** when one of the trigger events below happens (or is about to),
work that trigger's table top to bottom. Nothing here is optional once its
trigger fires; before the trigger, it is deliberate, documented deferral —
not an oversight.

_Last reviewed: 2026-07-03._

---

## T0 — Already triggered: members of the public submit PII today

Public widgets (surveys `/s`, agents `/b`, PulseIQ `/pi`) collect free-text
feedback and optional demographics from the public with no login.

| Item | Status | Where |
|---|---|---|
| Public privacy notice, linked from every respondent-facing surface | ✅ **DONE 2026-07-03** — `/privacy` page; links in survey widget, agent chat, PulseIQ chat chrome | `app/privacy/page.tsx` |
| No tracking/advertising cookies on public widgets | ✅ True by design (localStorage session id only; no analytics scripts) — re-verify if any analytics tool is ever added | Privacy page claim |
| Org-level right-to-be-forgotten (hard delete, fail-closed, incl. Storage + auth) | ✅ Built 2026-07-02 | SECURITY.md § 7; `lib/orgDelete.ts` |
| Content-safety + rate limiting on all public write endpoints | ✅ Standing invariant | SECURITY.md § 2 |
| Terms of service for the public app / customers | ❌ Not written — acceptable while all customers are direct-relationship pilots; becomes T1 work | — |

## T1 — First paying customer signs

| Item | Status | Where |
|---|---|---|
| DPAs with core subprocessors (Anthropic, Supabase, Vercel, Resend, Sentry) | ❌ Standard ToS today; only AWS has a DPA | SECURITY.md § 8 table |
| Extend Supabase backup retention 7 → 30 days | ❌ Documented intent | SECURITY.md § 7 |
| Run the first full DR data-restore drill (scratch project ready) | ❌ Never run | BACKUPS.md; open-work queue |
| MSA / ToS template for customer contracts | ❌ | — |
| Anthropic zero-data-retention (ZDR) — requested, confirm status | ⏳ Requested | SECURITY.md § 8 |

## T2 — First EU customer signal (prospect, not signature)

| Item | Status | Where |
|---|---|---|
| DPIA (data protection impact assessment) | ❌ Explicitly deferred to this trigger | SECURITY_OVERVIEW.md compliance table |
| Legal review of the data-subject redaction policy (redact identifying fields, keep anonymized content) | ❌ "Legal review before the first EU customer signs" | SECURITY.md § 7 |
| EU data residency: separate eu-west database project + tenant routing | ❌ Documented as pre-contract engineering, not started | SECURITY.md § 7 |
| SCCs — ride along with the T1 DPAs | ❌ | — |

## T3 — First enterprise or government deal

| Item | Status | Where |
|---|---|---|
| SSO (SAML / OIDC) + SCIM provisioning | ❌ **Not implemented** — auth is Supabase magic-link + password on invite; docs honestly say roadmap (fixed 2026-07-02) | SECURITY_OVERVIEW.md; CAIQ IAM-06 |
| OpenAI DPA + confirmed audio/text retention terms (**hard gate**: receives meeting audio via Whisper) | ❌ Flagged, not obtained | SECURITY.md § 8 gov note |
| Deepgram DPA + confirmed audio retention terms (**hard gate**: receives meeting audio) | ❌ Flagged, not obtained | SECURITY.md § 8 gov note |
| Independent penetration test | ❌ Internal audits only to date | AUDIT_FRAMEWORK.md |
| SOC 2 roadmap decision (Type I scoping) | ❌ Posture-only today | CAIQ_LITE.md |

## T4 — First individual data-subject request received

| Item | Status | Where |
|---|---|---|
| DSR intake path (who receives it, response SLA) | ⏳ Interim: `info@datanautix.com` (published on `/privacy`), routed manually | Privacy page |
| Per-respondent redaction tooling (find + redact one participant's rows across `dataset_rows_flat` blobs, turns, personas) | ❌ Manual SQL today — acceptable at pilot volume, build at first real request | SECURITY.md § 7 policy |
| Delete-path egress test (prove a deleted org's data is truly unreadable) | ❌ `<TBD>` item 5 | SECURITY.md § 7 |
| Annual delete-path drill (documented cadence, never yet run) | ❌ | SECURITY.md § 7 |

---

## Standing facts the checklist relies on

- **Controller/processor split:** for respondent data, the customer org is
  the controller; Datanautix is the processor. The `/privacy` page states
  this and routes data-subject requests accordingly.
- **Data residency:** all data in the United States (Supabase us-east,
  Vercel, AWS). Stated on `/privacy`.
- **Meeting audio is the most sensitive flow** — identifiable voices to
  OpenAI/Deepgram with unconfirmed retention. Treat every T3 row touching
  audio as blocking for gov work.
- **S3 org snapshots are not runtime-deletable** (ransomware posture — no
  `s3:DeleteObject`); purging a deleted org's snapshots is a documented
  break-glass manual step.
