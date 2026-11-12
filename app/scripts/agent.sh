#!/bin/sh
# Starts the Claude Code session of one long or remote Memo agent, in its work directory, with its charter.
#   scripts/agent.sh <name>
# The server runs this in the tmux session memo-<name> (src/agents.js). Do not run it by hand while that session exists.
#   MEMO_AGENT_DRY=1 prints the settings, the start text, the variables of the agent, and the options of claude, and starts nothing.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
name="${1:?Usage: scripts/agent.sh <name>}"
# scripts/ is in PATH so that the agent can run "memo".
PATH="$root/scripts:$HOME/.local/bin:$HOME/Library/pnpm/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"; export PATH
. "$root/scripts/_node.sh"
# A file of this installation is in local/ (git ignores it). If it is not there, the example in the repository applies.
local_file() { if [ -e "${MEMO_LOCAL:-$root/local}/$1" ]; then echo "${MEMO_LOCAL:-$root/local}/$1"; else echo "$root/$1"; fi; }
field() {
  node --input-type=commonjs -e '
    const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).find((x) => x.name === process.argv[2] && x.kind !== "short");
    if (!a) process.exit(1);
    process.stdout.write(String(a[process.argv[3]]));' "$(local_file agents.json)" "$name" "$1"
}
dir="$(field dir)" || { echo "No long agent has the name $name in agents.json." >&2; exit 1; }
model="$(field model)"
[ "$dir" != undefined ] && [ "$model" != undefined ] || { echo "The agent $name needs a dir and a model in the agents.json of this computer." >&2; exit 1; }
case "$dir" in "~"*) dir="$HOME${dir#"~"}" ;; esac
# The optional "chrome" of the agent: false starts its session without the Claude in Chrome integration (claude --chrome).
# The default is on (README.md, "An agent with a different Claude account").
chrome="$(field chrome)"
case "$chrome" in undefined|true) chrome_opt="--chrome" ;; false) chrome_opt="" ;; *) echo "The chrome of $name must be true or false." >&2; exit 1 ;; esac
# The optional "env" of the agent: variables for its session, for example CLAUDE_CONFIG_DIR for a different Claude
# account (README.md, "An agent with a different Claude account"). A value that starts with "~" gets the home directory.
# One line for each variable, NAME=value. The name and the value are checked, so the file cannot run a command here.
env_lines="$(node --input-type=commonjs -e '
    const a = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).find((x) => x.name === process.argv[2] && x.kind !== "short");
    const env = a.env === undefined ? {} : a.env;
    if (typeof env !== "object" || env === null || Array.isArray(env)) { console.error(`The env of ${a.name} must be an object.`); process.exit(1); }
    for (const [k, v] of Object.entries(env)) {
      if (!/^[A-Z_][A-Z0-9_]*$/.test(k) || typeof v !== "string" || /[\n\r]/.test(v)) { console.error(`The env of ${a.name}: ${k} must be a name in capitals with a text value on one line.`); process.exit(1); }
      process.stdout.write(`${k}=${v}\n`);
    }' "$(local_file agents.json)" "$name")" || exit 1
env_set=""
while IFS= read -r line; do
  [ -n "$line" ] || continue
  key="${line%%=*}"; value="${line#*=}"
  case "$value" in "~"*) value="$HOME${value#"~"}" ;; esac
  export "$key=$value"
  env_set="$env_set$key=$value
"
done <<EOF_ENV
$env_lines
EOF_ENV
# The server builds the start text: the charter, then the recap of the last session if one exists.
prompt="$(memo prompt --as "$name")"
# Claude Code settings for the agent sessions of this installation, for example plugins and MCP servers to switch off.
# The file is optional: local/agent-settings.json.
settings='{}'
[ -f "$(local_file agent-settings.json)" ] && settings="$(tr -d '\n' < "$(local_file agent-settings.json)")"
# The dry run prints the settings, the start text, the variables of the agent (with the home directory put in), and the
# options of claude as its last part (the model and, when it is on, --chrome).
if [ -n "${MEMO_AGENT_DRY:-}" ]; then printf '%s\n---\n%s\n' "$settings" "$prompt"; [ -z "$env_set" ] || printf -- '---\n%s' "$env_set"; printf -- '---\n--model %s%s\n' "${MEMO_AGENT_MODEL:-$model}" "${chrome_opt:+ $chrome_opt}"; exit 0; fi
mkdir -p "$dir"
cd "$dir"
# "--" ends the option list. Without it, claude can read the start text as an option value.
# $chrome_opt has no quotes: when it is empty, it must leave no argument.
exec claude --model "${MEMO_AGENT_MODEL:-$model}" $chrome_opt --settings "$settings" -- "$prompt

Start now: run \`memo list --to $name\`, then do the work."
