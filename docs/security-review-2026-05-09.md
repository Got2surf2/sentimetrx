# Security review — sentimetrx (entire codebase)

**Date:** 2026-05-09
**Method:** 6 parallel read-only audits + `npm audit`
**Scope:** authn/authz, RLS policy correctness, input validation/injection, secrets/env handling, external integrations/webhooks, dependency CVEs
**Stats:** 440+ TS/TSX files, 171 API routes, all SQL migrations, dependency tree

**Status update (2026-05-09):** Pre-customer sprint items 1, 2, 3, 4, 5, 6, 7 completed — see ✅ markers below. Items #1–14, #16, #17 patched; `next` bumped to 14.2.35; `verify-auth` password oracle removed; ~/Downloads writeFileSync removed from insights-deck.

## Headline

The codebase is in good shape on **secrets handling** (no committed keys, NEXT_PUBLIC vars are clean, service-role key is server-only) and **RLS enablement** (every table has RLS turned on). But there are **~17 critical / high authorization gaps** at the API layer where service-role bypasses RLS without paired `org_id` checks. Multi-tenant isolation is leaking through these gaps.

---

## 🔴 CRITICAL — fix before any paying-customer onboarding

### Cross-tenant data exposure (RLS bypassed at the API layer)
The pattern: service-role client filters by id only, missing the paired `org_id` check. Any authenticated user from any org can read/write the target.

| # | Route | What leaks/breaks |
|---|---|---|
| 1 ✅ | `app/api/share/route.ts` POST/DELETE/GET | Any user can publish a public share link to **any org's** study, campaign, PulseIQ, or conversation; can also revoke any token |
| 2 ✅ | `app/api/datasets/[datasetId]/route.ts` PATCH (line 114) | Cross-org rename / archive / visibility change of any dataset |
| 3 ✅ | `app/api/bots/[id]/knowledge/route.ts` GET | Cross-org read of agent training corpora |
| 4 ✅ | `app/api/bots/[id]/knowledge/[chunkId]/route.ts` PATCH/DELETE | Cross-org tamper / delete of training chunks |
| 5 ✅ | `app/api/townhall/sessions/[id]/route.ts` GET/PATCH/DELETE | Cross-org read/edit/delete of PulseIQ sessions, themes, turns |
| 6 ✅ | `app/api/bots/[id]/conversations/insights-deck/route.ts` | Generates a downloadable PPTX of any agent's private conversations |

**Fix shape:** introduce `gateBotAccess` / `gateDatasetAccess` / `gateSessionAccess` helpers (pattern at `app/api/bots/[id]/conversations/[sessionId]/route.ts` is the model). Treat any `service.from(t).eq('id', x)` without a paired `.eq('org_id', orgId)` as a lint failure.

### Account-takeover paths
| # | Route | Issue |
|---|---|---|
| 7 ✅ | `app/api/invite/register/route.ts` | Invite token is **not bound to email** — leaked invite = account takeover into inviter's org with inviter-chosen role |
| 8 ✅ | `app/api/invite/route.ts` | Admin-org users can issue themselves `owner` invites to **any** org |
| 9 ✅ | `app/api/social/callback/route.ts` | OAuth `state` is unsigned plaintext base64 — attacker can attach their FB pages/tokens to a victim org_id |
| 10 ✅ | `app/api/verify-auth/route.ts` | Unauthenticated, unrate-limited password oracle. Online brute-force endpoint. Likely safe to delete entirely |

### Public deck routes (memory-rule violation)
Existing rule: *"Wrap deck/strategy/internal-export API routes with requireAdmin from day one; URL obscurity is not a defense."* Two routes ship with **no auth at all**:
| # | Route |
|---|---|
| 11 ✅ | `app/api/agent-capabilities-deck/route.ts` |
| 12 ✅ | `app/api/signal-tiers-deck/route.ts` |

### Unsigned webhooks (anyone can spoof events)
| # | Route | Impact |
|---|---|---|
| 13 ✅ | `app/api/campaigns/webhooks/resend/route.ts` | Anyone can mark any respondent as opened/clicked/bounced/unsubscribed |
| 14 ✅ | `app/api/social/webhook/route.ts` | Anyone can inject fake comments tied to victim's social pages, triggering Graph API calls with their tokens |

### Open phishing relay
| # | Route | Issue |
|---|---|---|
| 15 | `app/api/notify/closed-study/route.ts` (note: literal space in path → served at `/api/%20notify/`) | Unauthenticated; caller picks `creatorEmail`, `creatorName`, `studyName`, all interpolated into HTML and sent through Resend from your verified domain |

### Stored XSS in public share page
| # | Location | Issue |
|---|---|---|
| 16 ✅ | `app/shared/conversation/[token]/page.tsx:53` | `link.metadata.html` injected into `<iframe srcDoc={html}>` without sanitization. `srcDoc` inherits same origin, so this runs as sentimetrx.ai with cookies |

Fixed by adding `sandbox="allow-popups allow-popups-to-escape-sandbox"` — disables JS execution and same-origin context for the rendered HTML, while keeping `target="_blank"` links functional.

### Auth foundation defect
| # | Location | Issue |
|---|---|---|
| 17 ✅ | `lib/supabase/server.ts:39-42` | `getAuthUser()` uses `supabase.auth.getSession()` which only **decodes** the cookie JWT — it doesn't verify with Supabase. A revoked/forged cookie is accepted. The fix is `getUser()` (one extra network call per request, but it's the security-correct call) |

---

## 🟠 HIGH — fix this month

- ✅ **Cron auth fails open if `CRON_SECRET` env var is empty/unset** (6 cron routes). Pattern is `if (cronSecret && authHeader !== ...)`. Should be `if (!cronSecret) return 503; if (authHeader !== ...) return 401;` with `crypto.timingSafeEqual`. Especially `cron/campaign-scheduler` (sends real emails). — Fixed via `lib/cronAuth.ts` shared helper across all 7 cron routes.
- ✅ **SSRF in `fetch-url`, `deep-crawl`, `research`** — authed users can submit any URL; server fetches it and returns body. No block on `169.254.169.254` (AWS IMDS), `127.0.0.1`, RFC1918. Add IP-resolution + private-range blocklist; re-validate after redirects. — `lib/safeFetch.ts`: DNS-resolves hostname (rejecting if any record is private/loopback/link-local/multicast IPv4 or IPv6), refuses non-http(s) schemes, manually walks redirects re-validating each hop. Wired into all three routes.
- ✅ **CSRF on every cookie-auth mutating route** — Next.js App Router route handlers have no built-in CSRF protection. All POST/PATCH/DELETE that read JSON bodies are exposable from a malicious origin via `fetch(..., {credentials:'include'})`. Add an Origin/Referer same-origin check in `middleware.ts` (which doesn't exist yet — see below). — `middleware.ts` now enforces Origin/Referer/Sec-Fetch-Site same-origin on POST/PATCH/PUT/DELETE for `/api/*`. Bypasses signed webhooks (Resend, Meta), bearer-token cron routes, OAuth callback, and the public CORS-wildcarded chat endpoints.
- ✅ **No `middleware.ts`** — auth is enforced per-route. The next route someone forgets is the next hole. Combine this with the CSRF fix. — Created. Currently does CSRF gating; auth refresh can be added later as the next layer.
- ✅ **DOM XSS via agent-generated content** — `linkify()` and `formatHtml()` regex-extract URLs but don't escape `"` inside them, allowing attribute breakout. (`ConversationsClient.tsx:563`, `ChatBot.tsx:442`) — `formatHtml` now HTML-escapes input before matching; `linkify` already pre-escaped.
- ✅ **PostgREST `.or()` injection** in townhall search, study responses/analytics — user-controlled `from`/`to`/`q` interpolated into PostgREST mini-grammar. Not classic SQLi but allows breaking out of the OR expression to return unintended rows. — Townhall search now wraps the ILIKE pattern in PostgREST quoted-value syntax (`"…"`), with internal `\` and `"` escaped. Studies responses + analytics validate `from`/`to` against `^\d{4}-\d{2}-\d{2}$` before interpolation.
- ✅ **Mass-assignment** on `app/api/social/alerts/route.ts:63` PATCH — caller can set arbitrary columns (`org_id`, `created_by`, etc.). — Now whitelists `{rule_type, config, channels, enabled}`.
- ✅ **`current_client_id()` legacy mismatch** in `sql/011_townhall.sql:98,101,104` — INSERT/UPDATE policies still use the legacy `clients.id` column instead of `org_id`. — Migration `sql/042_rls_policy_hardening.sql` swaps to `current_org_id()`.
- ✅ **`WITH CHECK (true)` on several INSERT policies** — `bot_turns_service_insert`, `bot_reviews_service_insert`, `townhall_themes_insert`, `org_transfers_service_insert`, `send_log_insert`. Anon can theoretically insert. Should restrict to service role or drop (service role bypasses RLS anyway). — Dropped in migration 042; service role still inserts via RLS bypass.
- ✅ **Admin routes use inline `is_admin_org` check** instead of canonical `requireAdmin` helper — works today but every copy-paste is a chance to forget. Two duplicate `requireAdmin` helpers exist (`lib/auth/requireAdmin.ts` vs `lib/requireAuth.ts`); pick one. — Deleted unused `lib/requireAuth.ts`. Converted 5 admin-only routes (`/api/admin/orgs`, `/api/admin/clients`, `/api/admin/clients/[id]`, `/api/admin/usage`, `/api/admin/content-guard-test`, `/api/admin/users/[id]`) to the canonical helper. Routes that need admin + orgId in the same flow (agent-tester, questions) keep their inline check for now.
- ✅ **Predictable `participant_id`** — `Math.random()` in `townhall/join`. Use `crypto.randomUUID()`. — Switched to `randomUUID()`.

### npm audit (1 critical, 8 high, 3 moderate, 2 low)
- ✅ **CRITICAL: `next@14.2.5`** → bumped to `^14.2.35`.
- **HIGH: `xlsx@0.18.5`** — SheetJS-on-npm is abandoned, prototype-pollution + ReDoS unfixed. Switch to SheetJS CDN tarball or `exceljs`. **High value if users can upload .xlsx files.**
- **HIGH: `eslint-config-next`** → requires major bump to 16.2.6 (devDependency, lower urgency).
- **LOW: `@supabase/ssr`** — cookie-related, requires major bump.

Lockfile is clean (zero non-npmjs resolved URLs). No hardcoded secrets in source. `.gitignore` correct.

---

## 🟡 MEDIUM

- **`META_APP_SECRET` passed in URL query string** to Facebook (`social/callback`, `cron/social-token-refresh`) — lands in proxy/CDN logs. Move to POST body.
- **No `import 'server-only'`** on `lib/supabase/server.ts`, `lib/ai.ts`, `lib/embeddings.ts`, `lib/moderation.ts`, `lib/dataforseo.ts`, `lib/email/provider.ts`. Cheap belt-and-suspenders.
- **Path traversal / content-type spoofing** on org logo upload (`app/api/org/logo/route.ts:32`) — admin can upload `logo.html` with `content-type: text/html` to a public bucket → stored XSS.
- **Open redirect** in `app/api/social/callback/route.ts:47-49` — `siteUrl` built from `x-forwarded-host` when env unset.
- **No zod validation** on any of the 113 routes that read `req.json()` — every route ad-hoc-checks shape.
- **`study_response_stats` materialized view** — `authenticated` can SELECT all rows (cross-org enumeration relies on UUID secrecy).
- **No rate limiting** on share-link creation, log-login, magic-link triggers.
- **Townhall public GET** discloses session config for any status (should require `status === 'active'`).
- **No security headers** (no CSP, X-Frame-Options, HSTS, Referrer-Policy, X-Content-Type-Options).

---

## 🟢 LOW / INFO

- `.env.local` exists locally with **live secrets** (Anthropic, Resend, DataForSEO, Supabase service role, regulations.gov, Vercel OIDC). Properly gitignored, never tracked. Consider periodic rotation since they're sitting on disk.
- Cron secret comparison is not constant-time (string `!==`).
- Magic-link callback over-permissively defaults unknown `type` to `'magiclink'` — should reject.
- `is_platform_admin()` / `current_org_id()` are SECURITY DEFINER without pinned `search_path`.
- `tests/integration/rls-isolation.test.ts` only asserts SELECT isolation on `studies` and "RLS enabled" — does not check `WITH CHECK` correctness, presence of policies, or `USING(true)` accidents.
- `@types/sentiment` is in `dependencies` (should be `devDependencies`).
- No `.nvmrc` / `engines.node` pin; CI on Node 20 (in maintenance) — bump to Node 22 LTS.
- CORS wildcard on `app/api/bots/[id]/chat/route.ts:21` — fine today, fragile if cookie auth is ever added.

---

## Suggested order of operations

**Pre-customer hardening sprint (1 week):**
1. ✅ Add `gate*Access` helpers and patch the 6 service-role-without-org-check routes (#1–6). Highest cross-tenant blast radius.
2. ✅ Add `requireAdmin` to the two public deck routes (#11, #12). Trivial fix, explicit memory-rule violation.
3. ✅ Patch the 4 account-takeover paths (#7–10). The invite-token-not-bound-to-email and the password-oracle are the most exploitable.
4. ✅ Verify Resend + Meta webhooks (#13, #14). Standard svix / x-hub-signature-256 pattern.
5. ✅ `npm install next@14.2.35` (#critical).
6. ✅ Sanitize the share-page iframe (#16) or move to server-rendered structured turns.
7. ✅ Replace `getSession()` with `getUser()` in `lib/supabase/server.ts` (#17).

**Structural sprint (2–4 weeks):**
8. Add `middleware.ts` with auth refresh + Origin/Referer same-origin gate for all `/api/*` mutating verbs.
9. Replace `xlsx@0.18.5` if users can upload spreadsheets.
10. Fix all 6 cron routes' fail-open auth.
11. SSRF allowlist for `fetch-url` / `deep-crawl` / `research`.
12. Extend `npm run test:rls` to assert `WITH CHECK` correctness and ban `USING(true)` policies.
13. Add zod validation across `req.json()` routes.

---

## Audit methodology

Six parallel read-only sub-agents, each with a self-contained domain:
1. AuthN/AuthZ — route gating, middleware, requireAdmin coverage
2. RLS policy correctness — service-role usage, cross-tenant leak risk
3. Input validation & injection — SQLi/XSS/SSRF/path traversal
4. Secrets & env — hardcoded keys, NEXT_PUBLIC misuse, server-only enforcement
5. External integrations & webhooks — signature verification, CSRF, rate limiting, magic-link tokens
6. Dependency CVEs & supply chain — `npm audit`, action pinning, Node version

Findings deduplicated where multiple agents flagged the same issue (Resend/Meta webhooks, share/invite, SSRF, cron auth all flagged by 2+ agents).
