#!/bin/bash
# .claude/hooks/stop-queue-prompt.sh
#
# Stop hook: when a session is ending, prompt Claude to update the
# project_open_work_queue memory file IF the session produced meaningful
# changes. Without this prompt the queue silently drifts out of date —
# updates only happen when a user remembers to ask. With it, Claude is
# forced to make the judgment call before stopping.
#
# Mechanism:
#   1. Stop hook fires; we output {"decision":"block","reason":"..."}
#      which keeps Claude going for one more turn with `reason` injected
#      as system context.
#   2. Claude reads the reason, decides whether to update the queue,
#      writes the update (or not), then tries to stop again.
#   3. Second stop attempt finds the per-session sentinel file already
#      exists, so we exit normally and the session ends.
#
# Without the sentinel this would loop forever.

set -e

input=$(cat)
session_id=$(echo "$input" | /usr/bin/env jq -r '.session_id // "default"' 2>/dev/null || echo "default")
sentinel="/tmp/claude-queue-prompt-${session_id}"

if [ -f "$sentinel" ]; then
  exit 0
fi
touch "$sentinel"

cat <<'JSON'
{
  "decision": "block",
  "reason": "Before ending this session: did it produce meaningful changes — new commits, env vars set, migrations applied, decisions made about pending work, or new memories saved? If YES, update the project_open_work_queue memory file (in your auto-memory directory) to reflect what was completed and what the next session's entry points are. Keep it under 6 lines; lead with the date. If NO meaningful changes (questions, exploration, read-only work), skip the update — say one line acknowledging no queue update is needed and stop. Make the judgment yourself; no need to ask the user."
}
JSON
