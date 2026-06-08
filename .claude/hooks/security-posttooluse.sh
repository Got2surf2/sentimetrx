#!/usr/bin/env bash
# PostToolUse secret scanner — flags leaked secret-shaped values in tool output.
#
# Wired in .claude/settings.json (matcher "Bash|Read"). Runs AFTER the tool, so
# it cannot un-leak — it alerts (exit 2 → message fed back to Claude) so the
# secret is never echoed onward, committed, or sent to an external service.
# Patterns mirror the `secrets:` block in .claude/resources/threat-db.yaml plus
# this project's own token shapes (Supabase service-role JWT, Sentry token).
#
# Regexes describe high-signal credential *prefixes*, so reading the threat-db
# or .env.example (which hold pattern templates, not real 20+ char values) does
# not self-trigger.
set -euo pipefail

payload="$(cat 2>/dev/null || true)"
[ -z "$payload" ] && exit 0

# Scan the whole tool-call payload (input + response). Strip JSON escaping noise.
text="$(printf '%s' "$payload" | jq -r '[.tool_input, .tool_response] | tostring' 2>/dev/null || printf '%s' "$payload")"
[ -z "$text" ] && exit 0

declare -a HITS=()
scan() { # <label> <ERE>
  if printf '%s' "$text" | grep -qE -e "$2"; then HITS+=("$1"); fi
}

scan "Anthropic API key (sk-ant-)"        'sk-ant-[A-Za-z0-9_-]{20,}'
scan "OpenAI-style API key (sk-)"          'sk-[A-Za-z0-9]{20,}'
scan "GitHub token (gh[ps oru]_)"          'gh[psour]_[A-Za-z0-9]{30,}'
scan "GitLab PAT (glpat-)"                 'glpat-[A-Za-z0-9_-]{20,}'
scan "AWS access key id (AKIA…)"           'AKIA[A-Z0-9]{16}'
scan "Slack token (xox…)"                  'xox[baprs]-[A-Za-z0-9-]{10,}'
scan "Google API key (AIza…)"              'AIza[0-9A-Za-z_-]{35}'
scan "Sentry auth token (sntryu_)"         'sntryu_[a-f0-9]{40,}'
scan "Stripe secret key (sk_live/rk_live)" '(sk|rk)_live_[A-Za-z0-9]{20,}'
scan "Private key block"                    '-----BEGIN ([A-Z]+ )*PRIVATE KEY-----'
scan "JWT (possible Supabase service-role key)" 'eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}'

if [ "${#HITS[@]}" -gt 0 ]; then
  {
    echo "⚠️  security-posttooluse: secret-shaped value(s) detected in tool output:"
    for h in "${HITS[@]}"; do echo "  • $h"; done
    echo "Do NOT echo, commit, paste into a file, or send this value to any external service."
    echo "If it is a real credential that leaked, treat it as compromised and rotate it."
    echo "(If this is a placeholder/pattern/example, you can disregard.)"
  } >&2
  exit 2
fi

exit 0
