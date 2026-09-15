# YYYY-MM-DD — <Short incident title>

| | |
|---|---|
| **Severity** | SEV-1 / SEV-2 / near-miss |
| **Status** | Draft / Reviewed / Closed |
| **Incident start (UTC)** | YYYY-MM-DD HH:MM |
| **Detected (UTC)** | YYYY-MM-DD HH:MM — time-to-detect: _N min_ |
| **Resolved (UTC)** | YYYY-MM-DD HH:MM — time-to-resolve: _N min_ |
| **Author** | role (e.g. "the operator on call") |
| **Reviewed by** | role, date |
| **Devlog link** | `docs/weekly-reports/YYYY-WXX-devlog.md` |

## 1. Summary

Two to four sentences a customer could read: what broke, who was affected,
for how long, and whether any data was exposed or lost.

## 2. Impact

- **Customers / orgs affected:** count and scope (never customer names in a
  file that may be shared; use org ids or "N orgs").
- **Data exposure:** none / cross-tenant read / cross-tenant write / loss —
  state exactly what and how much. If cross-tenant: which tables, which rows
  (counts), and whether any of it was PII per SECURITY.md §7.
- **Duration of impact:** from first affected request to full recovery.
- **User-visible symptoms:** what people actually saw.

## 3. Timeline (UTC)

| Time | What happened | Source |
|---|---|---|
| HH:MM | First bad deploy / first error / first customer report | Sentry issue / Vercel deploy id / support thread |
| HH:MM | Detected — how (alert, customer, chance) | |
| HH:MM | Mitigation started (e.g. `vercel rollback`, feature flag off) | |
| HH:MM | Mitigation confirmed | |
| HH:MM | Root cause identified | |
| HH:MM | Permanent fix deployed | commit sha |

## 4. Root cause

The mechanism, not the symptom. Work the "why" down until it stops at a
decision or a missing control, e.g. "the query paired `id` without `org_id`
→ because the helper took only an id → because no shared gate existed for
that resource type → because the gate helper predated this table."

## 5. Contributing factors

Things that did not cause it but made it worse or slower to find: missing
alert, missing test, ambiguous ownership, deploy during low staffing, etc.

## 6. Detection & response — what went well / what didn't

- **Went well:**
- **Didn't:**
- **Where we got lucky:**

## 7. Action items

Every row has an owner and a due date. Preventive items (make the class of
bug impossible) rank above detective items (find it faster) rank above
corrective items (fix this one instance).

| # | Action | Type (prevent / detect / correct) | Owner (role) | Due | Tracked in |
|---|---|---|---|---|---|
| 1 | | | | | commit / devlog / SECURITY.md item |

## 8. Lessons

What we now believe that we didn't before. If a policy doc should change
(SECURITY.md, ENGINEERING.md, CLAUDE.md verification bar), name the section.
