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
  echo "production deployment → build"
  exit 1
fi

echo "preview deployment → skip (only production builds)"
exit 0
