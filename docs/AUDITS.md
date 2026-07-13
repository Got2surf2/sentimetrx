# AUDITS.md — Audit Registry

One row per audit/review the project has run, so no session re-runs an audit
that already exists (or trusts one that has gone stale). **Rule for every
session (any model): when you run a new audit or sweep, register it here in
the same commit as its findings doc; when you re-run one, update its row.**
"Fresh-run rule" still applies to governance questions (banked 2026-07-08:
an "audit-ready?" answer must come from a FRESH tool run, never a prior row
of this table — this registry prevents *duplicate scoping*, not stale
answers).

| Audit | Last run | Scope | Findings live in | Re-run when |
|---|---|---|---|---|
| **Performance architecture review** | 2026-07-13 | Multi-M total rows, 1M+ single datasets, concurrency, QR-TV bursts; all 41 dataset routes classified O(1)/O(50K)/O(N); measured on a 1.03M TEST dataset | `docs/PERFORMANCE_REVIEW.md` (bottleneck map §0, briefs §7) | Its own re-run policy (footer): sampling-RPC changes, compute resize, first real 500K dataset |
| **Route-scaling classification** (subset of above) | 2026-07-13 | Every `app/api/datasets/*` + collection path: how DB cost scales with dataset size | `docs/PERFORMANCE_REVIEW.md` §2 | A new dataset-reading route ships (classify it at review time, don't re-sweep) |
| **Filters-compliance sweep** | DONE 2026-07-13 (Brief F) | Every consumer of `SerializedFilters`/`applyFilters` + surfaces that silently ignore filters | `docs/PERFORMANCE_REVIEW.md` §7 Brief F results table | A new filter consumer ships, or filter semantics change |
| **Capacity model** (provider envelope + k6) | 2026-07-04 | Vercel/Supabase/Anthropic/OpenAI/Resend/Deepgram limits read live; 4 k6 load scenarios | `docs/CAPACITY.md` | Plan/tier change, compute resize, k6 numbers move >2×, dataset crosses 50K real rows |
| **Efficiency audit** (multi-agent) | 2026-07-04 | 94 agents over hot paths; 33 confirmed findings; fix-pass same day | `docs/CAPACITY.md` §6 (retired/open lists) | Superseded by the 2026-07-13 perf review for scale items; don't re-run as-was |
| **Dataset first-open efficiency audit** | 2026-07-11 | Every fetch/compute on dataset open + tab nav; produced sql/162-163 sampling stack | `docs/weekly-reports/2026-W28/W29` devlogs; outcomes folded into CAPACITY §6 + PERFORMANCE_REVIEW §2 | Only if first-open feels slow again after architectural change |
| **Security audit — service-role org-pairing** | 2026-05 (CRITICALs) → W29 MEDIUMs 2026-07-13 | Cross-tenant leak class: bare `.eq('id',x)` service-role reads; RLS coverage; gate tests | `docs/SECURITY.md`; weekly governance reports | Weekly governance cadence (Monday cron) + any new service-role query pattern |
| **Weekly governance audit** (/audit-codebase) | Weekly, Mon 04:00 ET cron | 7-category codebase health score (W19 baseline 55) | `docs/weekly-reports/YYYY-WXX.md` (+ PR) | Automatic — never run manually to "check"; read the latest report |
| **Spec-drift audit** | Weekly (Mon 02:00 ET) + per-commit hook | Which docs/*.md drifted from code | Weekly drift PR; `scripts/spec-drift.ts` | Automatic; run FRESH for any "audit-ready?" question (banked rule) |
| **npm audit** | 2026-07-13 (0 vulnerabilities) | Dependency CVEs (postcss + exceljs/uuid overrides) | W29 devlog entry; overrides in `package.json` | CI/dependabot signal or before a release claim |
| **Respondent-visible chrome audit** | 2026-06 (banked as standing rule) | Every respondent-visible string on public widgets | Feedback memory `audit_respondent_visible_chrome` (rule, not point-in-time findings) | Any new respondent-facing surface — apply the rule, not a re-sweep |
| **Admin page breadcrumb/nav inventory** | 2026-07-12 | All 98 pages: dead-end check → 27 fixed | W29 devlog + queue memory | New top-level pages ship without SubHeader |
| **Audio→Q&A failure-mode review** | 2026-05-28 | Town Hall extraction failure modes (panel-as-audience, over-extraction, invented taxonomy) | Memory `project_audio_qa_failure_modes` + `docs/TOWNHALL.md` mitigations | Before productizing recordings ingestion further |

Not listed: one-off dataset QCs, deck number reconciliations, and incident
diagnoses — those live in the weekly devlog as point-in-time records.
