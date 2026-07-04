#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" — keep this in the repo; point the Vercel project's
#   Settings → Git → Ignored Build Step  at:   bash scripts/vercel-ignore-build.sh
#
# Vercel exit-code convention (intentionally inverted):
#   exit 1 → BUILD  (proceed with the deployment)
#   exit 0 → SKIP   (ignore this commit; no build, no preview, no cost)
#
# Policy since deploy-behind-CI (2026-07-04):
#   - Production builds are triggered ONLY by the CI deploy hook after every
#     check is green (vercel.json git.deploymentEnabled disables push-triggered
#     main builds). By the time a production build reaches this script, CI has
#     already decided it is deploy-worthy — including the docs-only skip,
#     evaluated over the FULL push range (the old HEAD^..HEAD diff here could
#     mis-skip a multi-commit push that merely ENDED in a docs commit). So
#     production always builds here.
#   - Every Preview build is still skipped: pushes to feature branches / PRs
#     (by any session) never burn a build. The only way to deploy remains an
#     authorized push to main — gated by the human-only push policy in
#     CLAUDE.md, and now by CI green.

set -uo pipefail

if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "production deployment (CI-gated deploy hook) → build"
  exit 1
fi

echo "preview deployment → skip (only production builds)"
exit 0
