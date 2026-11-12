#!/bin/bash
# Adds one Google Calendar to the Today card of Memo, from the clipboard, so that nobody edits .env by hand.
#   In Google Calendar: Settings, your calendar, Integrate calendar, copy "Secret address in iCal format".
#   Then run: ~/memo/scripts/add-calendar.sh   (once for each calendar)
# The script puts the address in MEMO_CALENDAR_ICS of ~/memo/.env (after a comma when the line already has one),
# keeps a copy of the old .env in data/env.before-calendar.bak, starts Memo again, and checks that the calendar loads.
# The address is a secret: the script never prints it, nor any other line of .env.
#   MEMO_ENV_FILE=<path>  edits that file instead of ~/memo/.env (for a test).
#   MEMO_NO_RESTART=1     only edits the file: no restart of Memo, no check of the calendar.
set -eu
umask 077
root="$(cd "$(dirname "$0")/.." && pwd)"
env_file="${MEMO_ENV_FILE:-$root/.env}"
env_dir="$(cd "$(dirname "$env_file")" && pwd)"
backup="$env_dir/data/env.before-calendar.bak"
help_text='The clipboard does not hold a Google Calendar secret address. In Google Calendar: Settings, your calendar, Integrate calendar, copy Secret address in iCal format, then run this again.'

[ -f "$env_file" ] || { echo "The file $env_file is missing. Copy .env.example to .env first (see README.md)." >&2; exit 1; }

# 1. The address, from the clipboard, with no white space around it.
raw="$(pbpaste 2>/dev/null || true)"
addr="${raw#"${raw%%[![:space:]]*}"}"
addr="${addr%"${addr##*[![:space:]]}"}"
case "$addr" in
  *[[:space:]]* | *,* | *\"* | *\'* | *\\* | *\#*) echo "$help_text" >&2; exit 1 ;;
  https://calendar.google.com/calendar/ical/*.ics | webcal://calendar.google.com/calendar/ical/*.ics) ;;
  *) echo "$help_text" >&2; exit 1 ;;
esac

# 2. The current line. The value may be in double quotes; the new line is written without them.
has_line=0
if grep -q '^MEMO_CALENDAR_ICS=' "$env_file"; then has_line=1; fi
current=""
if [ "$has_line" = 1 ]; then
  current="$(awk '/^MEMO_CALENDAR_ICS=/ { sub(/^MEMO_CALENDAR_ICS=/, ""); print; exit }' "$env_file")"
  current="${current#\"}"; current="${current%\"}"
fi
new_value=""
count=0
old_ifs="$IFS"; IFS=', '
for part in $current; do
  [ -n "$part" ] || continue
  if [ "$part" = "$addr" ]; then IFS="$old_ifs"; echo "That calendar is already in Memo."; exit 0; fi
  new_value="${new_value:+$new_value,}$part"
  count=$((count + 1))
done
IFS="$old_ifs"
new_value="${new_value:+$new_value,}$addr"
count=$((count + 1))

# 3. Write .env: a copy of the old file first, then a new file next to it (mode 600) that replaces it in one move.
# awk gets the value through the environment, not -v, so that no character of the address is read as an escape.
mkdir -p "$env_dir/data"
cp "$env_file" "$backup"
chmod 600 "$backup"
tmp="$(mktemp "$env_dir/.env.new.XXXXXX")"
trap 'rm -f "$tmp"' EXIT
MEMO_NEW_VALUE="$new_value" awk '
  BEGIN { v = ENVIRON["MEMO_NEW_VALUE"]; done = 0 }
  /^MEMO_CALENDAR_ICS=/ && !done { print "MEMO_CALENDAR_ICS=" v; done = 1; next }
  { print }
  END { if (!done) print "MEMO_CALENDAR_ICS=" v }
' "$env_file" > "$tmp"
chmod 600 "$tmp"
mv -f "$tmp" "$env_file"
trap - EXIT
chmod 600 "$env_file"
echo "Saved: MEMO_CALENDAR_ICS now holds $count calendar(s). The old .env is in $backup."

if [ "${MEMO_NO_RESTART:-}" = 1 ]; then
  echo "Memo was not started again (MEMO_NO_RESTART=1)."
  exit 0
fi

# 4. Start Memo again and wait for it.
port="$(awk '/^PORT=/ { sub(/^PORT=/, ""); print; exit }' "$env_file")"
port="${port:-3280}"
base="http://127.0.0.1:$port"
if ! launchctl kickstart -k "gui/$(id -u)/memo.server" 2>/dev/null; then
  echo "Memo could not be started again with launchctl (is the LaunchAgent memo.server installed?). Start it by hand: Control-C it and run scripts/start.sh. Then the Today card shows the new calendar." >&2
  exit 1
fi
sleep 3
up=0
for i in 1 2 3 4 5 6 7 8; do
  if curl -s --max-time 3 "$base/health" 2>/dev/null | grep -q ok; then up=1; break; fi
  sleep 1
done
if [ "$up" != 1 ]; then
  echo "Memo did not answer at $base/health after the restart. Look at data/server.log." >&2
  exit 1
fi

# 5. Ask the server for today, with the owner's token. The answer of the server never has the address.
token="$(awk '/^MEMO_TOKEN=/ { sub(/^MEMO_TOKEN=/, ""); print; exit }' "$env_file")"
token="${token#\"}"; token="${token%\"}"
if [ -z "$token" ]; then
  echo "Memo is running, but MEMO_TOKEN is not in .env, so the calendar was not checked. Open the Inbox and look at the Today card." >&2
  exit 1
fi
result="$(curl -s --max-time 30 -H "Authorization: Bearer $token" "$base/api/calendar?date=$(date +%F)&tz=America/New_York" \
  | python3 -I -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("ERR Memo did not give a readable answer for the calendar. Look at data/server.log."); sys.exit(0)
if isinstance(d, dict) and "error" in d:
    print("ERR " + str(d["error"]))
elif isinstance(d, dict) and d.get("configured") is False:
    print("ERR Memo does not see MEMO_CALENDAR_ICS. Was the server started from this .env?")
else:
    print("OK " + str(len(d.get("events", []))))
')"
case "$result" in
  "OK "*) echo "Done. Memo now shows $count calendar(s); today has ${result#OK } events." ;;
  *) echo "${result#ERR }" >&2; exit 1 ;;
esac
