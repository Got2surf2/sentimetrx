#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" — keep this in the repo; point the Vercel project's
#   Settings → Git → Ignored Build Step  at:   bash scripts/vercel-ignore-build.sh
#
# Vercel exit-code convention (intentionally inverted):
#   exit 1 → BUILD  (proceed with the deployment)
#   exit 0 → SKIP   (ignore this commit; no build, no preview, no cost)
#
# Policy: ONLY Production deployments build. Every Preview build is skipped, so
# pushes to feature branches / PRs (by any session) never burn a build. The only
# way to deploy is an authorized push to the production branch (main) — which is
# itself gated by the human-only push policy in CLAUDE.md.

set -uo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  # Even on production, skip when the commit range touches ONLY docs/ (markdown
  # specs + the weekly governance files in docs/weekly-reports/) — a docs-only
  # merge to main shouldn't trigger a ~$8-10 production deploy. git diff --quiet
  # exits 0 when the pathspec has NO changes; ":(exclude)docs" = everything but
  # docs/, so a clean exit means nothing outside docs/ changed. Default to BUILD
  # if HEAD^ isn't reachable (shallow clone) — never skip a deploy we can't
  # reason about.
  if git rev-parse HEAD^ >/dev/null 2>&1 && git diff --quiet HEAD^ HEAD -- . ':(exclude)docs'; then
    echo "production, but only docs/ changed → skip build"
    exit 0
  fi
  echo "production deployment → build"
  exit 1
fi

echo "preview deployment → skip (only production builds)"
exit 0
