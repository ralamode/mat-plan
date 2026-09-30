#!/usr/bin/env bash
# Self-test for check-status-touched.mjs: builds a throwaway repo per case and asserts the exit code
# and message. Mirrors .claude/skills/hold-the-bar/check.test.sh.
#
#   bash .github/scripts/check-status-touched.test.sh
set -uo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check-status-touched.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

git -C "$tmp" init -q -b main
git -C "$tmp" config user.email t@t && git -C "$tmp" config user.name t
mkdir -p "$tmp/docs" "$tmp/src"
echo '# status' >"$tmp/docs/status.md" && echo 'x' >"$tmp/src/a.ts"
git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: base'

# case <name> <branch> <commit-subject> <touch-status: y|n> <want-exit> <want-text> [STATUS_SKIP]
case_() {
  git -C "$tmp" checkout -q main && git -C "$tmp" checkout -q -B "$2"
  echo "$RANDOM" >>"$tmp/src/a.ts"
  [ "$4" = y ] && echo "$RANDOM" >>"$tmp/docs/status.md"
  git -C "$tmp" add -A && git -C "$tmp" commit -qm "$3"
  out="$(cd "$tmp" && STATUS_SKIP="${7:-}" node "$guard" main 2>&1)"
  code=$?
  if [ "$code" -ne "$5" ] || ! grep -qF "$6" <<<"$out"; then
    printf '✗ %s: want exit %s + "%s", got exit %s\n%s\n' "$1" "$5" "$6" "$code" "$out"
    fails=$((fails + 1))
  else
    printf '✓ %s\n' "$1"
  fi
}

case_ "feat branch without status fails"      feat/x-1  'feat(x): add'   n 1 'Status guard failed'
case_ "feat branch with status passes"         feat/x-2  'feat(x): add'   y 0 'is updated'
case_ "docs branch passes without status"      docs/x-3  'docs(x): write' n 0 "don't owe"
case_ "chore branch, fix commit, still owes"   chore/x-4 'fix(x): patch'  n 1 'Status guard failed'
case_ "db branch without status fails"         db/x-5    'db(x): migrate' n 1 'Status guard failed'
case_ "override passes and prints the reason"  fix/x-6   'fix(x): patch'  n 0 'copy-only fix' 'copy-only fix'
case_ "blank override does not pass"           fix/x-7   'fix(x): patch'  n 1 'Status guard failed' '   '

[ "$fails" -eq 0 ] && echo "all status-guard self-tests passed" || exit 1
