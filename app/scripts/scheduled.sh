#!/bin/sh
# For launchd: the things that run on a schedule (see templates/launchd/ in the kit).
#   scripts/scheduled.sh memo <agent> <text>     sends a memo from the owner to an agent, for example the nightly sync
#   scripts/scheduled.sh restart <agent> ...     stops each agent with a recap, waits for its session to end, starts it
# The restart gives each agent a fresh session once a day: the agent records a recap first, and its next session gets
# the recap after its charter. An agent that the owner stopped by hand (no session) stays stopped.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
PATH="$root/scripts:$HOME/.local/bin:$HOME/Library/pnpm/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH
. "$root/scripts/_node.sh"
setting() { sed -n "s/^$1=//p" "$root/.env" 2>/dev/null | head -1; }
owner="${MEMO_OWNER:-$(setting MEMO_OWNER)}"; owner="${owner:-owner}"
port="$(setting PORT)"; port="${port:-3280}"
stamp() { date -u +%FT%TZ; }
# A POST to the local server with the token of .env. The token goes to curl in a private file, never on a command line.
post() {
  conf="$(mktemp)"; chmod 600 "$conf"
  printf 'header = "Authorization: Bearer %s"\n' "$(setting MEMO_TOKEN)" > "$conf"
  curl -s -m 20 -K "$conf" -H 'Content-Type: application/json' -d "$2" "http://127.0.0.1:$port$1" >/dev/null || echo "$(stamp) $1 did not answer" >&2
  rm -f "$conf"
}
case "${1:-}" in
  memo)
    agent="${2:?Usage: scripts/scheduled.sh memo <agent> <text>}"; shift 2
    [ $# -gt 0 ] || { echo "Usage: scripts/scheduled.sh memo <agent> <text>" >&2; exit 1; }
    memo send --from "$owner" --to "$agent" -- "$*"
    ;;
  restart)
    shift
    [ $# -gt 0 ] || { echo "Usage: scripts/scheduled.sh restart <agent> ..." >&2; exit 1; }
    for name in "$@"; do
      case "$name" in *[!a-z0-9-]*|"") echo "The name must have only a-z, 0-9 and \"-\"." >&2; exit 1 ;; esac
      if ! tmux has-session -t "=memo-$name" 2>/dev/null; then echo "$(stamp) $name has no session, left as it is"; continue; fi
      post /api/agent/stop "{\"name\":\"$name\"}"
      # The agent has 3 minutes for its recap; then the server ends the session.
      n=0
      while tmux has-session -t "=memo-$name" 2>/dev/null && [ "$n" -lt 50 ]; do sleep 5; n=$((n + 1)); done
      post /api/agent/start "{\"name\":\"$name\"}"
      echo "$(stamp) restarted $name"
    done
    ;;
  *) echo "Usage: scripts/scheduled.sh memo <agent> <text> | scripts/scheduled.sh restart <agent> ..." >&2; exit 1 ;;
esac
