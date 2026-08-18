# Help KB — source articles for the in-product Help agent (🧭)

These Markdown files are the **authored, user-facing knowledge base** the Help
agent answers from. They are ingested into the help agent's KB via the existing
`ingestKnowledgeText` pipeline (one file = one source; `chunkText` splits on `##`
headings). See `docs/HELP_AGENT.md` for the full design.

**This is deliberately NOT the engineer specs.** Per the signed-off KB strategy
(HELP_AGENT §12.1), the agent is grounded in these hand-written articles — never
raw `docs/*.md` — so it can't leak internals, table names, or unshipped features.

## Voice & rules (every article follows these)

- **Second person, task-first.** "To filter TextMine, open the Filters bar and…"
- **UI labels, not slugs or internal names.** Say "the **Schema** tab",
  "**Analytics**", "**Ask Ana**" — never `/analyze/[id]/settings`,
  `dataset_rows_flat`, RPC names, or `townhall_*`.
- ⚠️ **The `/analyze` module is "Analytics"** (`TopNav`, `MODULE_LABELS.analyze`) —
  **never "Advanced Analytics"**. That is a *different*, real on-screen label: the
  multi-location section INSIDE TextMine (Brand Health · Leaderboard · Outlet
  Deep-Dive, `AnalyticsNav`), which is gated behind the `outletReporting`
  capability and invisible to most orgs. Calling the module "Advanced Analytics"
  sends users hunting for a label that sits one level deeper — and inverts the
  hierarchy, since that section is a SIBLING of TextMine, not its parent. Fixed
  across 11 articles + the nav map on 2026-08-18. **Both names are correct for
  their own thing** — `advanced-analytics.md` documents the section, and every
  other article says "Analytics" for the module.
- **Only describe shipped features.** If it isn't in these articles, the agent
  doesn't claim it exists.
- **No invented URLs / emails / prices / stats.** Ask for the real value or omit.
- **Keep it short** — ~150–400 words, scannable, one task per `##` section.
- **Redirect data questions to Ask Ana.** The Help agent answers *how to use the
  product*; questions about *what the data says* belong to **Ask Ana** (which lives
  inside a dataset). State that boundary when relevant.

## Article plan (~20)

Status: ✅ drafted (awaiting owner review) · ⏳ to draft

| # | File | Topic | Status |
|---|---|---|---|
| 1 | `what-is-sentimetrx.md` | Product overview + which tool does what | ✅ |
| 2 | `create-a-survey.md` | Build & launch a conversational survey | ✅ |
| 3 | `textmine-filter-and-themes.md` | Filter results, themes, entities, dimensions | ✅ |
| 4 | `statistics-tab.md` | Read the Statistics tab (charts, drivers, Likert) | ✅ |
| 5 | `create-an-agent.md` | Build an agent; what a Super Agent is | ✅ |
| 6 | `schema-tab.md` | Configure fields/column types (Schema tab) | ✅ |
| 7 | `export-report-or-deck.md` | Export a PPTX deck / PDF / HTML report | ✅ |
| 8 | `ask-ana.md` | What Ask Ana is and how to use it | ✅ |
| 9 | `pulseiq-vs-townhall.md` | PulseIQ vs Town Hall — which to use | ✅ |
| 10 | `add-data-sources.md` | Import CSV, Google reviews, Reddit, Substack | ✅ |
| 11 | `campaigns.md` | Send a survey by email/SMS (Campaign Manager) | ✅ |
| 12 | `collections-and-brands.md` | Group datasets; brand collections | ✅ |
| 13 | `invite-teammates.md` | Invite users, roles, team management | ✅ |
| 14 | `org-settings-and-branding.md` | Org settings, theming, logo | ✅ |
| 15 | `billing-and-usage.md` | Where to see usage (no fabricated numbers) | ✅ |
| 16 | `privacy-and-data.md` | Where data lives; link to the privacy notice | ✅ |
| 17 | `search-your-responses.md` | Full-text + AI search in TextMine | ✅ |
| 18 | `share-a-survey.md` | Get the survey link / QR, response limits | ✅ |
| 19 | `dimensions-and-emotion.md` | Dimensions taxonomy + emotion-language flags | ✅ |
| 20 | `getting-started.md` | First-time orientation / where to click first | ✅ |
| 21 | `advanced-analytics.md` | Advanced Analytics — the multi-location section (Brand Health · Leaderboard · Outlet Deep-Dive), why it may be hidden | ✅ |
| — | `not-sure-fallback.md` | The honest "I'm not certain" fallback copy | ✅ |

**Updated 2026-08-18** — `dimensions-and-emotion.md` gained a **How do I turn
Dimensions on?** section. Browser QC on 2026-08-16 caught the agent answering
*"Dimensions are computed automatically — there's no toggle"*, which is false:
there is an explicit **Enable Dimensions** button (and a **Schema** tab checkbox
for datasets that aren't already eligible). The article had described what
Dimensions *are* but never how to switch them on, and one sentence actively
implied it was automatic — so the model filled the gap. Exactly the content gap
the thumbs-down KB-gap detector exists to surface. **Re-seed after editing any
article, or the change never reaches the agent.**

**All 21 drafted 2026-07-16 — awaiting owner review.** A handful of exact UI
labels the drafting flagged for owner verification against the live app: the
**Agent Capability / Super Agent** editor labels; the PulseIQ facilitator surface
name (**Live Console**); the **Team** settings nav label; and that there is **no
customer-facing billing/usage page** (billing article routes to the account team
by design). See the per-article notes carried back to the session.
