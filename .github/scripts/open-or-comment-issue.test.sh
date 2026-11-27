#!/usr/bin/env bash
# Self-test for open-or-comment-issue.sh with a stub `gh` that serves a fixed issue list and records
# what would have been posted. No network.
#
#   bash .github/scripts/open-or-comment-issue.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

mkdir -p "$tmp/bin"
cat >"$tmp/bin/gh" <<EOF
#!/usr/bin/env bash
# gh issue list … --json …     → print the fixture list
# gh issue comment <n> …       → record "comment <n>" and keep the body
# gh issue create …            → record "create" and keep the body
case "\$2" in
  list) cat "$tmp/issues.json" ;;
  comment) echo "comment \$3" >>"$tmp/calls"; while [ \$# -gt 0 ]; do [ "\$1" = --body-file ] && cp "\$2" "$tmp/body"; shift; done ;;
  create) echo "create" >>"$tmp/calls"; while [ \$# -gt 0 ]; do [ "\$1" = --body-file ] && cp "\$2" "$tmp/body"; shift; done ;;
esac
EOF
chmod +x "$tmp/bin/gh"

TITLE='sign-in drift check red'
BOT='{"login":"app/github-actions","is_bot":true}'
HUMAN='{"login":"someone","is_bot":false}'

# expect <name> <title> <want-calls> ; issue list JSON on stdin
expect() {
  rm -f "$tmp/calls" "$tmp/body"
  cat >"$tmp/issues.json"
  printf 'run https://run @someone\nsecond line\n' >"$tmp/in.md"
  (PATH="$tmp/bin:$PATH" REPO=o/r bash "$here/open-or-comment-issue.sh" "$2" "$tmp/in.md" >/dev/null 2>&1)
  code=$?
  calls="$(tr '\n' ';' <"$tmp/calls" 2>/dev/null)"
  if [ "$code" -eq 0 ] && [ "$calls" = "$3" ] && cmp -s "$tmp/in.md" "$tmp/body"; then
    printf '✓ %s\n' "$1"
  else
    printf '✗ %s: exit %s, calls %s (want %s)\n' "$1" "$code" "${calls:-none}" "$3"
    fails=$((fails + 1))
  fi
}

expect "no open issue → one is created" "$TITLE" 'create;' <<<'[]'
expect "the bot's open issue → commented on" "$TITLE" 'comment 41;' <<EOF
[{"number":41,"title":"$TITLE","author":$BOT}]
EOF
expect "a same-titled issue by someone else is ignored → a new one is created" "$TITLE" 'create;' <<EOF
[{"number":7,"title":"$TITLE","author":$HUMAN}]
EOF
expect "the bot's issue is found behind a squatted one" "$TITLE" 'comment 41;' <<EOF
[{"number":7,"title":"$TITLE","author":$HUMAN},{"number":41,"title":"$TITLE","author":$BOT}]
EOF
expect "a title with a quote is data, not filter" 'red" or true or "' 'create;' <<EOF
[{"number":41,"title":"$TITLE","author":$BOT}]
EOF
expect "a different title of the bot's is not this one" "$TITLE" 'create;' <<EOF
[{"number":41,"title":"mutation gate red on main","author":$BOT}]
EOF

# A missing body file refuses before any call.
rm -f "$tmp/calls"
echo '[]' >"$tmp/issues.json"
if ! (PATH="$tmp/bin:$PATH" REPO=o/r bash "$here/open-or-comment-issue.sh" "$TITLE" "$tmp/none.md" >/dev/null 2>&1) &&
  [ ! -f "$tmp/calls" ]; then
  echo '✓ a missing body file refuses, posting nothing'
else
  echo '✗ a missing body file was not refused'
  fails=$((fails + 1))
fi

[ "$fails" -eq 0 ] && echo 'open-or-comment-issue: all cases pass' || exit 1
