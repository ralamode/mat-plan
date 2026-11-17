#!/usr/bin/env bash
# Self-test for check-conflict-markers.mjs: throwaway git repos, one per case. Offline only.
# Markers are built with printf so this file never holds one at the start of a line.
#
#   bash .github/scripts/check-conflict-markers.test.sh
set -uo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check-conflict-markers.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0
lt="$(printf '<%.0s' 1 2 3 4 5 6 7)"
eq="$(printf '=%.0s' 1 2 3 4 5 6 7)"
gt="$(printf '>%.0s' 1 2 3 4 5 6 7)"
pp="$(printf '|%.0s' 1 2 3 4 5 6 7)"
bq="$(printf '> %.0s' 1 2 3 4 5 6)>"

# expect <name> <exit> <text-or-empty> <mode: tracked|staged|unstaged> ; file body on stdin
expect() {
  rm -rf "$tmp/r" && mkdir -p "$tmp/r" && git -C "$tmp/r" init -q
  cat >"$tmp/r/f.md"
  case "$4" in
    tracked) git -C "$tmp/r" add f.md && git -C "$tmp/r" -c user.email=t@t -c user.name=t commit -qm t ;;
    staged) git -C "$tmp/r" add f.md ;;
  esac
  flag=""
  [ "$4" = staged ] && flag="--staged"
  out="$(cd "$tmp/r" && node "$guard" $flag 2>&1)"
  code=$?
  if [ "$code" -ne "$2" ] || { [ -n "$3" ] && ! grep -qF -- "$3" <<<"$out"; }; then
    printf '✗ %s: want exit %s + "%s", got %s\n%s\n' "$1" "$2" "$3" "$code" "$out"
    fails=$((fails + 1))
  else printf '✓ %s\n' "$1"; fi
}

# --- pass ---
expect "clean file passes" 0 "no markers" tracked <<<"# Title
plain text"
expect "eight = (a heading underline) passes" 0 "" tracked <<<"Title
${eq}="
expect "markers mid-line pass" 0 "" tracked <<<"see \`${lt} HEAD\` in the docs"
expect "six spaced > pass" 0 "" tracked <<<"$(printf '> %.0s' 1 2 3 4 5)>"
expect "untracked, unstaged markers are not this guard's" 0 "" unstaged <<<"${lt} HEAD"

# --- fail ---
expect "opening marker fails" 1 "f.md:1" tracked <<<"${lt} HEAD"
expect "separator fails" 1 "f.md:2" tracked <<<"a
${eq}
b"
expect "diff3 base marker fails" 1 "f.md:1" tracked <<<"${pp} merged common ancestors"
expect "CRLF separator fails" 1 "f.md:1" tracked < <(printf '%s\r\nb\r\n' "$eq")
expect "Prettier's table-cell opening marker fails" 1 "f.md:1" tracked <<<"| ${lt} HEAD |"
expect "Prettier's escaped quote separator fails" 1 "f.md:1" tracked <<<"> \\${eq}"
expect "a table row of pipes passes" 0 "" tracked <<<"| a | b |
| --- | --- |"
expect "closing marker fails" 1 "f.md:1" tracked <<<"${gt} origin/main"
expect "bare closing marker fails" 1 "" tracked <<<"${gt}"
expect "Prettier's reflowed blockquote fails" 1 "reflowed" tracked <<<"${bq} origin/main"
expect "--staged sees the index" 1 "staged" staged <<<"${lt} HEAD"

# --- fails closed ---
out="$(cd "$tmp" && mkdir -p nogit && cd nogit && GIT_CEILING_DIRECTORIES="$tmp" node "$guard" 2>&1)"
code=$?
if [ "$code" -eq 2 ]; then printf '✓ outside a repo exits 2, never 0\n'
else printf '✗ outside a repo: want exit 2, got %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); fi

if [ "$fails" -ne 0 ]; then echo "check-conflict-markers self-test: $fails failure(s)"; exit 1; fi
echo "check-conflict-markers self-test: all passed"
