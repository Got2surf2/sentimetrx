# Spec drift report — 2026-W39 (week ending Sep 20)

**Generated**: 2026-09-21T06:00:00Z
**Repository**: Got2surf2/sentimetrx
**Script**: scripts/spec-drift.ts (map: scripts/specMap.ts)
**Companion to**: 2026-W39.md (governance report, same PR)

---

> sentimetrx@0.1.0 spec-drift
> tsx scripts/spec-drift.ts --since 7 days ago

# Spec drift report

**Date**: 2026-09-21
**Range**: `c93c05e..HEAD` — 30 commits

## Summary

| Status | Count | Specs |
|--------|-------|-------|
| ⚠️ Drift | 10 | `docs/USAGE_ACCOUNTING.md`, `docs/DATA_SOURCES.md`, `docs/SEARCH.md`, `docs/SOCIAL.md`, `docs/CAMPAIGNS.md`, `docs/SURVEYS.md`, `docs/BOTS.md`, `docs/TOWNHALL.md`, `docs/MCO_AGENT.md`, `docs/RECORDINGS.md` |
| ✅ Updated in range | 4 | `docs/SECURITY.md`, `docs/ENGINEERING.md`, `docs/TESTING.md`, `docs/ANALYTICS.md` |
| 💤 Clean (no code touched) | 3 | `docs/DATABASE.md`, `docs/db/schema.sql`, `docs/TAXONOMY.md` |

## Top-level specs

- ⚠️ `SPEC.md` (inventory doc) — module specs drifted, so this likely needs a sweep too.
- ⚠️ `FEATURES.md` (inventory doc) — module specs drifted, so this likely needs a sweep too.

## Drift detail

### ⚠️ `docs/USAGE_ACCOUNTING.md`

3 commits touched code mapped to this spec; the spec itself was not edited.

- `cbc92bc` 2026-09-21 Sanjay Patel — Post-push alert cleanup: usage-link range encoded, devalue override 5.8.1→5.9.2, Tailwind 4 held as a project
  - `app/admin/usage/UsageClient.tsx`
  - `app/admin/usage/[type]/[id]/UsageDetailClient.tsx`
- `f898d98` 2026-09-14 Sanjay Patel — CodeQL high backlog: fixed-point HTML strip + correct entity order (lib/htmlStrip), crypto session ids (lib/clientId), linear regexes, scheme-checked hrefs
  - `app/admin/usage/UsageClient.tsx`
- `822eea2` 2026-09-14 Sanjay Patel — Server code logs through lib/log: 189 console.* calls migrated, no-console is an ESLint error in app/api + lib
  - `lib/usageLog.ts`

### ⚠️ `docs/DATA_SOURCES.md`

4 commits touched code mapped to this spec; the spec itself was not edited.

- `2454908` 2026-09-21 Sanjay Patel — Dependabot #39 by hand: dev-dependency group + lib/hardNavigate for 14 deliberate full page loads
  - `components/analyze/SubstackWizard.tsx`
- `f898d98` 2026-09-14 Sanjay Patel — CodeQL high backlog: fixed-point HTML strip + correct entity order (lib/htmlStrip), crypto session ids (lib/clientId), linear regexes, scheme-checked hrefs
  - `lib/regulations.ts`
  - `lib/substack.ts`
- `f9ec7b9` 2026-09-14 Sanjay Patel — CodeQL first-run triage: substack SSRF → safeFetch, path-segment hardening, least-privilege workflow token, prototype/ excluded
  - `lib/reddit.ts`
  - `lib/substack.ts`
- `822eea2` 2026-09-14 Sanjay Patel — Server code logs through lib/log: 189 console.* calls migrated, no-console is an ESLint error in app/api + lib
  - `app/api/cron/review-sync/route.ts`
  - `app/api/reddit-sources/[sourceId]/sync/route.ts`
  - `app/api/reddit-sources/search/route.ts`
  - `app/api/regulations-sources/download-comments/route.ts`
  - `lib/dataforseo.ts`
  - `lib/redditSync.ts`
  - …2 more

### ⚠️ `docs/SEARCH.md`

1 commit touched code mapped to this spec; the spec itself was not edited.

- `4cdf8e1` 2026-09-14 Sanjay Patel — One resource gate (lib/auth/gate.ts) + single-tenant prompt guard (lib/aiOrgGuard.ts) + egress write-path tests
  - `app/api/datasets/[datasetId]/search/route.ts`

### ⚠️ `docs/SOCIAL.md`

2 commits touched code mapped to this spec; the spec itself was not edited.

- `f9ec7b9` 2026-09-14 Sanjay Patel — CodeQL first-run triage: substack SSRF → safeFetch, path-segment hardening, least-privilege workflow token, prototype/ excluded
  - `app/api/social/webhook/route.ts`
- `822eea2` 2026-09-14 Sanjay Patel — Server code logs through lib/log: 189 console.* calls migrated, no-console is an ESLint error in app/api + lib
  - `app/api/cron/social-sync/route.ts`
  - `app/api/cron/social-token-refresh/route.ts`
  - `app/api/social/callback/route.ts`
  - `app/api/social/comments/[id]/ai-reply/route.ts`
  - `app/api/social/comments/[id]/delete/route.ts`
  - `app/api/social/comments/[id]/dm/route.ts`
  - …5 more

### ⚠️ `docs/CAMPAIGNS.md`

3 commits touched code mapped to this spec; the spec itself was not edited.

- `2454908` 2026-09-21 Sanjay Patel — Dependabot #39 by hand: dev-dependency group + lib/hardNavigate for 14 deliberate full page loads
  - `app/campaigns/CampaignDashboardClient.tsx`
  - `app/campaigns/[id]/CampaignDetailClient.tsx`
- `f898d98` 2026-09-14 Sanjay Patel — CodeQL high backlog: fixed-point HTML strip + correct entity order (lib/htmlStrip), crypto session ids (lib/clientId), linear regexes, scheme-checked hrefs
  - `app/api/campaigns/[id]/respondents/route.ts`
  - `app/campaigns/[id]/CampaignDetailClient.tsx`
- `822eea2` 2026-09-14 Sanjay Patel — Server code logs through lib/log: 189 console.* calls migrated, no-console is an ESLint error in app/api + lib
  - `app/api/campaigns/[id]/send/route.ts`
  - `app/api/campaigns/webhooks/resend/route.ts`

### ⚠️ `docs/SURVEYS.md`

4 commits touched code mapped to this spec; the spec itself was not edited.

- `2454908` 2026-09-21 Sanjay Patel — Dependabot #39 by hand: dev-dependency group + lib/hardNavigate for 14 deliberate full page loads
  - `app/dashboard/DashboardClient.tsx`
- `f898d98` 2026-09-14 Sanjay Patel — CodeQL high backlog: fixed-point HTML strip + correct entity order (lib/htmlStrip), crypto session ids (lib/clientId), linear regexes, scheme-checked hrefs
  - `components/survey/useSurveyEngine.ts`
- `822eea2` 2026-09-14 Sanjay Patel — Server code logs through lib/log: 189 console.* calls migrated, no-console is an ESLint error in app/api + lib
  - `app/api/ai/study-suggest/route.ts`
  - `app/api/clarify/route.ts`
  - `app/api/deflect/route.ts`
  - `app/api/respond/route.ts`
  - `app/api/translate-responses/route.ts`
  - `app/api/translate/route.ts`
- `4655d1e` 2026-09-14 Sanjay Patel — Break the two runtime import cycles: lazy serviceAlerts in recordCreditError; pickBrandColor to its own leaf
  - `components/survey/SurveyWidget.tsx`
  - `components/survey/brandColor.ts`
  - `components/survey/useSurveyEngine.ts`

### ⚠️ `docs/BOTS.md`

4 commits touched code mapped to this spec; the spec itself was not edited.

- `2454908` 2026-09-21 Sanjay Patel — Dependabot #39 by hand: dev-dependency group + lib/hardNavigate for 14 deliberate full page loads
  - `app/bots/BotsClient.tsx`
- `f898d98` 2026-09-14 Sanjay Patel — CodeQL high backlog: fixed-point HTML strip + correct entity order (lib/htmlStrip), crypto session ids (lib/clientId), linear regexes, scheme-checked hrefs
  - `app/api/bots/fetch-url/route.ts`
  - `app/api/bots/research/route.ts`
  - `app/bots/[id]/conversations/ConversationsClient.tsx`
  - `components/ui/ChatBot.tsx`
- `822eea2` 2026-09-14 Sanjay Patel — Server code logs through lib/log: 189 console.* calls migrated, no-console is an ESLint error in app/api + lib
  - `app/api/bot-chat/route.ts`
  - `app/api/bots/[id]/analyze/route.ts`
  - `app/api/bots/[id]/chat/route.ts`
  - `app/api/bots/[id]/questions/[questionId]/answer/route.ts`
  - `app/api/bots/[id]/readout/pdf/route.ts`
  - `app/api/bots/[id]/study/pdf/route.ts`
  - …6 more
- `4cdf8e1` 2026-09-14 Sanjay Patel — One resource gate (lib/auth/gate.ts) + single-tenant prompt guard (lib/aiOrgGuard.ts) + egress write-path tests
  - `app/api/bots/[id]/conversations/[sessionId]/route.ts`
  - `app/api/bots/[id]/knowledge/[chunkId]/route.ts`

### ⚠️ `docs/TOWNHALL.md`

4 commits touched code mapped to this spec; the spec itself was not edited.

- `2454908` 2026-09-21 Sanjay Patel — Dependabot #39 by hand: dev-dependency group + lib/hardNavigate for 14 deliberate full page loads
  - `app/pulseiq/TownHallListClient.tsx`
- `f898d98` 2026-09-14 Sanjay Patel — CodeQL high backlog: fixed-point HTML strip + correct entity order (lib/htmlStrip), crypto session ids (lib/clientId), linear regexes, scheme-checked hrefs
  - `app/api/townhall/sessions/route.ts`
- `822eea2` 2026-09-14 Sanjay Patel — Server code logs through lib/log: 189 console.* calls migrated, no-console is an ESLint error in app/api + lib
  - `app/api/cron/townhall-theme-detection/route.ts`
  - `app/api/townhall/chat/route.ts`
  - `app/api/townhall/responses/route.ts`
  - `app/api/townhall/simulate/route.ts`
  - `lib/cohortThemeAggregator.ts`
- `4cdf8e1` 2026-09-14 Sanjay Patel — One resource gate (lib/auth/gate.ts) + single-tenant prompt guard (lib/aiOrgGuard.ts) + egress write-path tests
  - `app/api/townhall/sessions/[id]/route.ts`

### ⚠️ `docs/MCO_AGENT.md`

1 commit touched code mapped to this spec; the spec itself was not edited.

- `f898d98` 2026-09-14 Sanjay Patel — CodeQL high backlog: fixed-point HTML strip + correct entity order (lib/htmlStrip), crypto session ids (lib/clientId), linear regexes, scheme-checked hrefs
  - `app/demo/mco/components/ChatPane.tsx`

### ⚠️ `docs/RECORDINGS.md`

2 commits touched code mapped to this spec; the spec itself was not edited.

- `2454908` 2026-09-21 Sanjay Patel — Dependabot #39 by hand: dev-dependency group + lib/hardNavigate for 14 deliberate full page loads
  - `app/recordings/[id]/report/ReportClient.tsx`
- `822eea2` 2026-09-14 Sanjay Patel — Server code logs through lib/log: 189 console.* calls migrated, no-console is an ESLint error in app/api + lib
  - `app/api/recordings/[id]/analyze/route.ts`
  - `app/api/recordings/[id]/reanalyze/route.ts`
  - `app/api/recordings/[id]/report/pdf/route.ts`
  - `app/api/recordings/[id]/report/send/route.ts`
  - `app/api/recordings/[id]/route.ts`
  - `lib/recordings/analyze.ts`
  - …3 more

## Updated in range

- `docs/SECURITY.md` — 5 edits alongside 3 code commits.
- `docs/ENGINEERING.md` — 10 edits alongside 8 code commits.
- `docs/TESTING.md` — 7 edits alongside 20 code commits.
- `docs/ANALYTICS.md` — 1 edit alongside 6 code commits.

---
*Map source: `scripts/specMap.ts`. Edit there to refine which paths belong to which spec.*
