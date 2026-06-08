#!/usr/bin/env bash
# PreToolUse security guard — blocks catastrophic / exfil-shaped Bash commands.
#
# Wired in .claude/settings.json (matcher "Bash"). Receives the tool-call JSON
# on stdin; extracts the command and refuses it (exit 2 → reason fed back to
# Claude) if it matches a dangerous pattern. Patterns mirror the dangerous-Bash
# entries in .claude/resources/threat-db.yaml (reverse shells, remote-exec
# pipes, root/home wipes, private-key reads). Allows everything else.
#
# Deliberately NOT blocked (legitimate in this repo): .env/.env.local reads
# (gitignored, dev loop needs them — the PostToolUse scanner catches leaked
# secret *values* instead), `rm -rf node_modules`, chmod +x on project files.
set -euo pipefail

payload="$(cat 2>/dev/null || true)"
[ -z "$payload" ] && exit 0

tool="$(printf '%s' "$payload" | jq -r '.tool_name // empty' 2>/dev/null || true)"
[ "$tool" = "Bash" ] || exit 0

cmd="$(printf '%s' "$payload" | jq -r '.tool_input.command // empty' 2>/dev/null || true)"
[ -z "$cmd" ] && exit 0

block() {
  echo "BLOCKED by security-pretooluse hook: $1" >&2
  echo "Command: $cmd" >&2
  echo "If this is genuinely needed, run it yourself in the terminal (the hook only guards the agent)." >&2
  exit 2
}

# 1. Reverse-shell / network redirects (threat-db: /dev/tcp|/dev/udp, critical)
printf '%s' "$cmd" | grep -qE '/dev/(tcp|udp)/' && block "bash network redirect (reverse-shell pattern)"

# 2. Netcat reverse shell (nc/ncat with -e, or mkfifo|nc backpipe)
printf '%s' "$cmd" | grep -qE '\b(nc|ncat|netcat)\b[^|]*-e\b' && block "netcat exec (-e) reverse shell"
printf '%s' "$cmd" | grep -qE 'mkfifo\b.*\b(nc|ncat|netcat)\b' && block "mkfifo+netcat backpipe (reverse shell)"

# 3. Remote-script execution: curl/wget piped into a shell, or base64 -d | sh
#    Require whitespace + an argument after curl/wget (real droppers fetch a URL),
#    so bare prose shorthand like "curl|sh" in a string/commit-message doesn't trip.
printf '%s' "$cmd" | grep -qE '\b(curl|wget|fetch)\b[[:space:]]+[^|]*\|[[:space:]]*(sudo[[:space:]]+)?(ba)?sh\b' && block "remote script piped into a shell (curl … | sh)"
printf '%s' "$cmd" | grep -qE 'base64[[:space:]]+(--decode|-[a-zA-Z]*[dD])[^|]*\|[[:space:]]*(ba)?sh\b' && block "base64-decoded command piped into a shell"

# 4. Fork bomb
printf '%s' "$cmd" | grep -qE ':\(\)[[:space:]]*\{[[:space:]]*:[[:space:]]*\|[[:space:]]*:' && block "fork bomb"

# 5. Recursive-force delete of filesystem root or home
#    Match an rm with a recursive+force flag (-rf, -fr, -r ... -f, or --recursive --force)
#    AND a root/home/wildcard-root target.
if printf '%s' "$cmd" | grep -qE '\brm\b'; then
  has_rf=0
  printf '%s' "$cmd" | grep -qE '\brm\b[^&;|]*-[a-zA-Z]*r[a-zA-Z]*f|\brm\b[^&;|]*-[a-zA-Z]*f[a-zA-Z]*r' && has_rf=1
  printf '%s' "$cmd" | grep -qE '\brm\b[^&;|]*(-r\b|--recursive)[^&;|]*(-f\b|--force)|\brm\b[^&;|]*(-f\b|--force)[^&;|]*(-r\b|--recursive)' && has_rf=1
  if [ "$has_rf" = 1 ]; then
    printf '%s' "$cmd" | grep -qE '\brm\b[^&;|]*[[:space:]](/|/\*|~|~/\*|\$HOME|\$\{HOME\}|\.)([[:space:]]|/\*?)*($|[;&|])' \
      && block "recursive force delete targeting / ~ \$HOME . or /* (catastrophic)"
  fi
fi

# 6. Reads of private credential material (SSH/AWS/cloud private keys).
#    Note: .env / .env.local are intentionally allowed (see header).
printf '%s' "$cmd" | grep -qE '\b(cat|bat|less|more|head|tail|xxd|od|strings|nl|cp|scp|rsync|tar)\b[^|]*(\bid_rsa\b|\bid_ed25519\b|\bid_dsa\b|\.ssh/|\.aws/credentials|\.pem([[:space:]]|$)|\.p12\b|\.pfx\b|\.pypirc\b)' \
  && block "read/copy of private credential file (SSH/AWS/cloud key)"

exit 0
