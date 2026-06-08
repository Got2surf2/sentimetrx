# 2026-W24 — Dev log (Week of Jun 8 to Jun 14)

## 2026-06-08 — Vercel Ignored Build Step: skip preview builds for docs-only commits

**Why**: Owner saw a flood of Vercel preview builds — they come from frequent pushes to non-`main` branches (a `claude/brainstorm…` feature branch + the weekly `spec-drift` routine), since Vercel auto-deploys a preview for every commit on every branch. Wanted to stop burning builds on commits that don't change deployable code.

**What changed**: New `scripts/vercel-ignore-build.sh` — a Vercel "Ignored Build Step" (exit 0 = skip, exit 1 = build). Always builds Production; for Preview deployments it diffs against `VERCEL_GIT_PREVIOUS_SHA` and **skips when every changed file is docs/non-deployable** (`*.md`, `docs/*`, `*.txt`, `LICENSE`) — any code change still builds. Fails safe (builds) when it can't resolve the diff (e.g. shallow-clone range, first build on a branch).

**Activation (one-time, dashboard — owner)**: Vercel project → Settings → Git → **Ignored Build Step** → `bash scripts/vercel-ignore-build.sh`. The script is version-controlled so it applies regardless of which session pushes.

**Verify**: tested locally — production→build, code change→build, docs-only→skip, mixed→build. **Local-only, not pushed** (per the no-push-without-explicit-say-so policy; pushing this to `main` is itself a production build, and it only takes effect once the dashboard Ignored Build Step is set).
