#!/usr/bin/env bash
#
# Vercel "Ignored Build Step" — keep this in the repo; point the Vercel project's
#   Settings → Git → Ignored Build Step  at:   bash scripts/vercel-ignore-build.sh
#
# Vercel exit-code convention (intentionally inverted):
#   exit 1 → BUILD  (proceed with the deployment)
#   exit 0 → SKIP   (ignore this commit; no build, no preview, no cost)
#
# Policy: always build PRODUCTION. For PREVIEW deployments, skip the build when
# the commit changed ONLY docs / non-deployable files — so doc/spec/devlog
# pushes on feature branches don't burn preview builds. Any code change still
# builds a preview as normal.

set -uo pipefail

# 1. Production deployments always build.
if [ "${VERCEL_ENV:-}" = "production" ]; then
  echo "production deployment → build"
  exit 1
fi

# 2. Need the previously-deployed commit to diff against. Absent on a branch's
#    first build — build to be safe.
PREV="${VERCEL_GIT_PREVIOUS_SHA:-}"
if [ -z "$PREV" ]; then
  echo "no previous SHA (first build on this branch) → build"
  exit 1
fi

# 3. Diff the changed files. Vercel shallow-clones (depth=10); if PREV isn't in
#    range the diff fails — build to be safe rather than wrongly skip.
CHANGED="$(git diff --name-only "$PREV" HEAD 2>/dev/null)" || {
  echo "could not diff against $PREV → build to be safe"
  exit 1
}
if [ -z "$CHANGED" ]; then
  echo "no file diff resolved → build to be safe"
  exit 1
fi

# 4. If EVERY changed file is a doc / non-deployable file, skip. One code change
#    anywhere → build. (case globs: '*' matches '/', so 'docs/*' covers nested.)
while IFS= read -r f; do
  [ -z "$f" ] && continue
  case "$f" in
    *.md|docs/*|*.txt|LICENSE) ;;          # docs / text — no effect on the build
    *) echo "deployable change: $f → build"; exit 1 ;;
  esac
done <<EOF
$CHANGED
EOF

echo "only docs / non-deployable files changed → skip preview build"
exit 0
