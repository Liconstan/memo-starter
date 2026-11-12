#!/bin/sh
# Scans every file of the kit that git tracks, or would track, for personal data and secrets. Run it before you
# publish or share your copy:
#   npm run scan                              (this kit)
#   npm run scan -- ~/second-brain-starter    (another folder, for example the vault template)
# It looks for:
#   - the general patterns below: tokens, private keys, home folders, tailnet names, mail addresses, phone numbers;
#   - your own patterns in app/local/scan-patterns.txt of this kit (setup writes your name, email, domain and host
#     there). One extended regular expression in each line, "#" for a comment.
# A line that matches an expression of scripts/scan-allow.txt (made-up values in tests and examples) or of
# app/local/scan-allow.txt is not a finding. The scan of the commits of a push is app/scripts/pre-push-scan.sh.
set -eu
kit="$(cd "$(dirname "$0")/.." && pwd)"
root="$(cd "${1:-$kit}" && pwd)"
cd "$root"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

cat > "$tmp/patterns" <<'PATTERNS'
-----BEGIN [A-Z ]*PRIVATE KEY-----
sk-ant-[A-Za-z0-9_-]{20,}
gh[pousr]_[A-Za-z0-9]{30,}
github_pat_[A-Za-z0-9_]{30,}
xox[abprs]-[A-Za-z0-9-]{10,}
AKIA[0-9A-Z]{16}
tskey-[a-z]+-[A-Za-z0-9-]{10,}
[MN][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}
(TOKEN|SECRET|PASSWORD|API_KEY|AUTHKEY)[A-Z_]*["']?[=:] *["']?[A-Za-z0-9_/+-]{24,}
/Users/[A-Za-z0-9._-]+/
/home/[a-z0-9._-]+/
[a-z0-9-]+\.tail[0-9a-f]{4,}\.ts\.net
[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[a-z]{2,}
(^|[^0-9.])(\+1[ .-]?)?\(?[0-9]{3}\)?[ .-][0-9]{3}[ .-][0-9]{4}([^0-9]|$)
\+[0-9]{10,14}([^0-9]|$)
PATTERNS
for extra in "$kit/app/local/scan-patterns.txt"; do
  [ -n "$extra" ] && [ -f "$extra" ] || continue
  # A line that still holds a [PLACEHOLDER] is not a pattern yet.
  grep -v -E '^[[:space:]]*(#|$)' "$extra" | grep -v -E '\[[A-Z][A-Z0-9]*(_[A-Z0-9]+)+\]' >> "$tmp/patterns" || true
done
: > "$tmp/allow"
for allow in "$kit/scripts/scan-allow.txt" "$kit/app/local/scan-allow.txt"; do
  [ -f "$allow" ] && grep -v -E '^[[:space:]]*(#|$)' "$allow" >> "$tmp/allow" || true
done
[ -s "$tmp/allow" ] || echo 'a^' > "$tmp/allow"   # an expression that matches nothing

stop() { echo "scan: the scan failed: $1" >&2; exit 2; }
# The files: tracked, plus new files that .gitignore does not leave out. No binary files, and no lock file.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then git ls-files -co --exclude-standard > "$tmp/files"
else find . -type f -not -path './.git/*' -not -path '*/node_modules/*' -not -path './my-setup/*' -not -path './app/local/*' -not -path './app/data/*' -not -name '.env' | sed 's|^\./||' > "$tmp/files"; fi
: > "$tmp/lines"
while IFS= read -r f; do
  [ -f "$f" ] || continue
  case "$f" in *.png|*.mov|*.mp4|*.webp|*.gif|*.jpg|package-lock.json) continue ;; esac
  grep -n -I -E -f "$tmp/patterns" -- "$f" 2>/dev/null | sed "s|^|$f:|" >> "$tmp/lines" || true
done < "$tmp/files"
status=0; grep -v -E -f "$tmp/allow" "$tmp/lines" > "$tmp/found" || status=$?
[ "$status" -le 1 ] || stop "grep could not use the allow list."
count="$(wc -l < "$tmp/files" | tr -d ' ')"
if [ -s "$tmp/found" ]; then
  echo "scan: these lines look like personal data or a secret:" >&2
  cut -c1-220 "$tmp/found" >&2
  echo "scan: $(wc -l < "$tmp/found" | tr -d ' ') finding(s) in $count files. Remove the text, or add an expression to app/local/scan-allow.txt if it is not personal." >&2
  exit 1
fi
echo "scan: clean ($count files)."
