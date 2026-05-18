# Weekly Control Reports

This directory contains automatically-generated, human-reviewed weekly reports covering all development activity on the Sentimetrx codebase.

## Purpose

The Sentimetrx codebase is developed primarily with [Claude Code](https://claude.com/claude-code) (Anthropic's coding assistant). These weekly reports are a control mechanism for **responsibly relying on AI-generated code**. Each report contains:

1. **Development summary** — every commit, file change, feature added, and security/infrastructure modification in the past 7 days
2. **Codebase health audit** — a 7-category, 100-point scorecard covering secrets exposure, security patterns, dependency CVEs, structure, tests, documentation, and maintainability
3. **Trend signal** — score deltas vs prior week, plus a prioritized progression plan

## How They're Produced

A scheduled remote agent (Claude Code routine) runs every Monday at 4am Eastern. It:

1. Clones the repo and runs the audit defined in [`.claude/commands/audit-codebase.md`](../../.claude/commands/audit-codebase.md)
2. Reads the editorial dev log for the past week (`YYYY-WXX-devlog.md`) — falls back to `git log` if no devlog exists
3. Correlates audit findings against the dev log (did this week's work address open findings?)
4. Synthesizes everything into a single Markdown report named `YYYY-WXX.md` (ISO week)
5. Opens a pull request with the report

A human (the project owner) reviews and merges the PR. **The merge itself is the governance signal**: AI generated the report, a human verified it, the resulting commit is in the audit trail.

## Three file types

- **`YYYY-WXX-devlog.md`** — editorial dev log appended-to throughout the week. Captures the **why** behind each work session (intent, deferred items, surprises). Written by Claude Code sessions as work happens; can also be edited manually. **Source of the WHY.**
- **`YYYY-WXX.md`** — the Monday governance report (Control Report #1). Created by the 04:00 ET routine; combines the dev log narrative + the 7-category audit + correlation + trend. **The merged governance artifact.** Parsed by `lib/governanceReports.ts` and displayed at `/admin/control-reports/governance`.
- **`YYYY-WXX-drift.md`** — the Monday spec-drift report (Control Report #2). Created by the 02:00 ET routine via `npx tsx scripts/spec-drift.ts --write-weekly`; lists which module specs drifted (code changed without the spec being updated) in the prior week. Parsed by `lib/specDriftReports.ts` and displayed at `/admin/control-reports/spec-drift`.

## Why Git, Not a Database

Reports live in version control because:
- **Tamper-evident** — git history is cryptographically verifiable
- **Reviewed** — every report goes through a PR before being recorded
- **Portable** — auditors, prospects, and insurers can review the full history without account access to a separate system
- **Diffable** — week-over-week changes are visible in standard tooling

## Who This Is For

- **Enterprise prospects** evaluating Sentimetrx's AI governance posture
- **Insurance / security questionnaires** asking about continuous code review
- **Compliance frameworks** (SOC 2, NIST AI RMF, EU AI Act) requiring evidence of human oversight of AI systems
- **The project owner** monitoring codebase health drift over time

## File Naming

`YYYY-WXX[suffix].md` where `WXX` is the ISO week number. Example for the week of May 4–10, 2026:
- `2026-W19-devlog.md` — running dev log
- `2026-W19.md` — governance audit
- `2026-W19-drift.md` — spec-drift report
