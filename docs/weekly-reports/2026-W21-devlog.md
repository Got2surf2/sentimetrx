# 2026-W21 — Dev log (Week of May 18 to May 24)

## 2026-05-18 — Control Reports admin group

Added `/admin/control-reports/` as the parent for weekly machine-generated reports a human reviews and merges. Index lists governance + spec-drift; each links to a trend page that mirrors the existing GovernanceTrend layout.

**Why**: enterprise procurement (Darden DD form) and SOC 2 CC4 expect a single coherent evidence story for continuous human oversight of AI-built code. The two control reports were previously surfaced unevenly — governance had `/admin/governance` + a parseable weekly file, spec-drift only appended to the running devlog with no persistent artifact and no chart.

**What changed**:
- `scripts/spec-drift.ts` gains `--write-weekly` which writes `docs/weekly-reports/YYYY-WXX-drift.md` (parseable: summary metrics table + drift detail).
- `lib/specDriftReports.ts` parses those files; mirrors `lib/governanceReports.ts`.
- New routes: `/admin/control-reports/` (index), `/admin/control-reports/governance/` (existing trend, moved), `/admin/control-reports/spec-drift/` (new trend).
- `/admin/governance` is now a 308 redirect to the sub-route so external bookmarks keep working.
- Top-nav admin entry renamed "Governance Reports" → "Control Reports" pointing at the new index.
- `.claude/commands/spec-drift.md` now instructs the Monday 02:00 ET routine to use `--write-weekly` and commit the standalone file rather than appending to the devlog.
- `docs/weekly-reports/2026-W21-drift.md` produced as the first real drift report (0 drifted, 12 specs updated this range).

**Next**: when the routine runs next Monday it will produce `2026-W22-drift.md`, the trend chart gets its second data point, and week-over-week delta starts showing.

## 2026-05-18 — Two-step opener for all agents + Vindman → Axel surrogate

**Why**: every agent with `askName=true` was concatenating the topical opener and the name ask into one flaky double-question (e.g. `"Hi, I'm Alex! Thanks for stopping by. Tell me what's on your mind. What's your name?"`). Users had to parse two asks at once and often answered only one. Separately, the Vindman agent was scoped as a first-person avatar of the candidate, which is a fundraising-and-FEC liability — needed to repose as a campaign surrogate.

**What changed**:
- `components/ui/ChatBot.tsx`: when `askName` is on, the FIRST assistant message is a name-only ask. After the user provides a name, a SECOND assistant message renders the topical opener (`config.initialMessage`). English path renders directly; non-English path calls the API to translate the opener and personalize it with the name. New `nameExchangeMessages` state filters the name exchange out of future API calls so the server sees a clean turn 1 (preserves `askProfile` behavior).
- Vindman agent (`bots.id = 78991aa1-…`) DB updates: `name`/`config.name` → `Axel`, `config.subtitle` → `Vindman for Senate`, `config.initialMessage` → `"Thanks for stopping by. What's on your mind?"`, full rewrite of `system_prompt` + `personality` from first-person avatar to third-person campaign surrogate ("Alex served…", "the colonel has said…"). Slug stays `alexvindman` (public URL).

**Next**: QA the two-step opener on a couple of agents in production. Revisit Sonnet 4.6 → `fast` revert in the chat route once the Tuesday demo is past.
