# 2026-W22 — Dev log (Week of May 25 to May 31)

## 2026-05-25 — Defensive Vercel trace for weekly governance reports

**Why**: After the W21 audit PR (#7) was merged, the `/admin/control-reports*` page surfaced the new `2026-W21.md` only after a delay — Next.js' static file tracer can miss dynamically read files (`fs.readdir` + `fs.readFile` over `process.cwd()/docs/weekly-reports`), so a freshly-merged report can intermittently fail to bundle into the Vercel serverless function. Older reports happened to be picked up; the new one was not. Defensive fix so future weekly reports (every Monday) reliably ship with the build.

**What changed**:
- `next.config.js` — added `experimental.outputFileTracingIncludes` mapping `'/admin/control-reports'`, `'.../governance'`, and `'.../spec-drift'` to `./docs/weekly-reports/*.md`. Vercel will now copy every committed weekly markdown into the function bundle regardless of what the static tracer infers.
- `docs/ENGINEERING.md` § 12 — added a "Runtime file tracing for `docs/weekly-reports/*.md`" subsection explaining the pattern + when to extend the mapping (any new admin surface that reads these markdown files).

No code behavior change. No migration. Affects only what files ship in the next Vercel build.
