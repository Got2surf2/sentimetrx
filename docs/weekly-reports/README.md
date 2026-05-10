# Weekly Governance Reports

This directory contains automatically-generated, human-reviewed weekly reports covering all development activity on the Sentimetrx codebase.

## Purpose

The Sentimetrx codebase is developed primarily with [Claude Code](https://claude.com/claude-code) (Anthropic's coding assistant). These weekly reports are a control mechanism for **responsibly relying on AI-generated code**. Each report contains:

1. **Development summary** — every commit, file change, feature added, and security/infrastructure modification in the past 7 days
2. **Codebase health audit** — a 7-category, 100-point scorecard covering secrets exposure, security patterns, dependency CVEs, structure, tests, documentation, and maintainability
3. **Trend signal** — score deltas vs prior week, plus a prioritized progression plan

## How They're Produced

A scheduled remote agent (Claude Code routine) runs every Monday at 4am Eastern. It:

1. Clones the repo and runs the audit defined in [`.claude/commands/audit-codebase.md`](../../.claude/commands/audit-codebase.md)
2. Analyzes the past week's git history
3. Synthesizes both into a single Markdown report named `YYYY-WXX.md` (ISO week)
4. Opens a pull request with the report

A human (the project owner) reviews and merges the PR. **The merge itself is the governance signal**: AI generated the report, a human verified it, the resulting commit is in the audit trail.

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

`YYYY-WXX.md` where `WXX` is the ISO week number. Example: `2026-W19.md` is the report for the week of May 4–10, 2026.
