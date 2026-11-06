#!/usr/bin/env bash
# Self-test for check-feature-guides.mjs: builds a throwaway repo per case and asserts the exit code
# and message. Mirrors .github/scripts/check-status-touched.test.sh.
#
# 🔴 WHY THIS FILE EXISTS. The guard shipped without one, and a parser bug then went unnoticed for
# two releases: a `#` comment inside `owns:` ended the list, so `write-path.md` DECLARED thirteen
# owned paths and the guard READ three. Ten paths were unguarded by both rot checks while the guard
# printed OK. The first four cases below are that bug, pinned from both directions.
#
#   bash .github/scripts/check-feature-guides.test.sh
set -uo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check-feature-guides.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

git -C "$tmp" init -q -b main
git -C "$tmp" config user.email t@t && git -C "$tmp" config user.name t
mkdir -p "$tmp/docs/features" "$tmp/src/owned" "$tmp/src/free"
echo 'x' >"$tmp/src/owned/a.ts"
echo 'y' >"$tmp/src/owned/b.ts"
echo 'z' >"$tmp/src/free/c.ts"
git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: base'

# write_guide <owns-block-body> — recreates the dir, because a checkout that empties
# `docs/features/` removes it and the next write would ENOENT.
write_guide() {
  mkdir -p "$tmp/docs/features"
  { printf -- '---\nfeature: Probe\nowns:\n'; printf '%s\n' "$1"; printf -- '---\n\n# Probe guide\n'; } \
    >"$tmp/docs/features/probe.md"
}

# case_ <name> <owns-body> <file-to-touch> <touch-guide: y|n> <want-exit> <want-text>
#
# ⚠️ The guide is committed ON MAIN, never on the branch. Committing it to the branch puts it in the
# diff, so rot check #2 sees the guide as touched and every case passes — the first draft of this
# harness did exactly that and reported the baseline case green.
case_() {
  git -C "$tmp" checkout -q main
  write_guide "$2"
  git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: guide' >/dev/null 2>&1
  git -C "$tmp" checkout -q -B "probe/$RANDOM"
  echo "$RANDOM" >>"$tmp/$3"
  [ "$4" = y ] && printf '\nedited\n' >>"$tmp/docs/features/probe.md"
  git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: change' >/dev/null 2>&1
  out="$(cd "$tmp" && node "$guard" main 2>&1)"
  code=$?
  if [ "$code" -ne "$5" ] || ! grep -qF "$6" <<<"$out"; then
    printf '✗ %s: want exit %s + "%s", got exit %s\n%s\n' "$1" "$5" "$6" "$code" "$out"
    fails=$((fails + 1))
  else
    printf '✓ %s\n' "$1"
  fi
}

OWNS_PLAIN='  - src/owned/'
OWNS_AFTER_COMMENT='  - src/free/
  # a note about the next entry
  - src/owned/'
OWNS_TRAILING_COMMENT='  - src/owned/ # a trailing slash owns everything beneath'
OWNS_STALE='  - src/owned/
  - src/gone/'

# 1-2 · the baseline, so the harness is not vacuous
case_ "owned file touched without the guide fails"  "$OWNS_PLAIN"  src/owned/a.ts n 1 'was not updated, but this PR changes files it documents'
case_ "owned file touched with the guide passes"    "$OWNS_PLAIN"  src/owned/a.ts y 0 'consistent with the diff'

# 3 · 🔴 THE BUG. An entry AFTER a comment line must still be owned. Pre-fix this exited 0.
case_ "an entry after a # comment is still owned"   "$OWNS_AFTER_COMMENT" src/owned/a.ts n 1 'was not updated, but this PR changes files it documents'

# 4 · the comment must not swallow the entry it annotates (documented trailing form).
case_ "a trailing # comment is stripped, not owned" "$OWNS_TRAILING_COMMENT" src/owned/a.ts n 1 'was not updated, but this PR changes files it documents'

# 5 · and a trailing comment must not break rot check #1 by becoming part of the path.
case_ "a trailing # comment leaves the path valid"  "$OWNS_TRAILING_COMMENT" src/owned/a.ts y 0 'consistent with the diff'

# 6 · an unowned file is still free, so the fix did not over-widen ownership.
case_ "an unowned file needs no guide edit"         "$OWNS_PLAIN"  src/free/c.ts  n 0 'consistent with the diff'

# 7 · rot check #1 still fires on a path that does not exist.
case_ "a claimed path that is missing fails"        "$OWNS_STALE"  src/owned/a.ts y 1 'does not exist'

[ "$fails" -eq 0 ] && echo 'all feature-guide guard self-tests passed' || { echo "$fails failing"; exit 1; }
