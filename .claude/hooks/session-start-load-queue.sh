#!/usr/bin/env bash
# SessionStart hook — inject project_open_work_queue.md into every new session
# so the next session always opens with the current state of in-flight work.
#
# Wired in .claude/settings.local.json (gitignored — the file path below
# is user-specific and won't exist for other contributors).

set -euo pipefail

F="$HOME/.claude/projects/-Users-sanjaypatel-Documents-GitHub-sentimetrx/memory/project_open_work_queue.md"

# Silent no-op if the file is missing — protects against renames/deletes.
[ -f "$F" ] || exit 0

# Output the hook JSON. additionalContext gets injected into the session.
jq -Rs --arg header $'# Open work queue (auto-loaded from memory)\n\n' \
  '{hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:($header + .)}}' \
  < "$F"
