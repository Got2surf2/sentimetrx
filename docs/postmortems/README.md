# Post-mortems

Incident write-ups for Sentimetrx. Policy lives in `docs/SECURITY.md` §10
(SEV definitions, response times, on-call); this directory is where the
write-ups themselves live.

## When one is required

| SEV | Definition (SECURITY.md §10) | Post-mortem due |
|---|---|---|
| **SEV-1** | Customer data exposed cross-tenant; data loss; prod down > 5 min | **5 business days** |
| **SEV-2** | Single-customer impact, no cross-tenant breach; degraded performance | **10 business days** |
| **SEV-3** | Bug with a workaround, internal-only impact | Not required — track in the normal sprint |

A near-miss that *would* have been SEV-1 or SEV-2 had it not been caught
(e.g. a cross-org query found in review, a bad deploy rolled back before
customer traffic) gets a post-mortem too — those are the cheapest lessons
there are.

## How to file one

1. Copy `TEMPLATE.md` to `YYYY-MM-DD-short-slug.md` (date = when the incident
   **started**, UTC; slug = 3–4 words, e.g. `2026-09-03-textmine-filter-500s`).
2. Fill every section. "Not applicable" is a valid answer; a blank section is
   not. Timeline entries are in **UTC** with the local time in parentheses.
3. Blameless: name systems and decisions, not people. Roles ("the operator",
   "the on-call") stand in for names.
4. Every action item has an **owner and a due date** and is tracked where work
   is tracked (a devlog entry, a `<TBD>` item in SECURITY.md/ENGINEERING.md,
   or a commit). An action item with no owner is a wish.
5. Link the post-mortem from that week's `docs/weekly-reports/YYYY-WXX-devlog.md`.
6. Status moves `Draft → Reviewed → Closed`; **Closed** means every action
   item is done or explicitly declined with a reason.

## How this is verified

The quarterly review (SECURITY.md §10 "How we verify") counts SEV-1/SEV-2
incidents in the devlog against files in this directory. Any incident without
a write-up here within its window is itself a governance finding.

## Index

_None yet. First entry goes here as `- [YYYY-MM-DD — title](YYYY-MM-DD-slug.md) — SEV-n, one-line impact`._
