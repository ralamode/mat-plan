#!/usr/bin/env bash
# Self-test for check.sh: plants each violation in a throwaway git repo and asserts the guard
# catches it (exit 1 + the right heading), and that a clean diff passes (exit 0).
#
#   bash .claude/skills/hold-the-bar/check.test.sh
set -uo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check.sh"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

git -C "$tmp" init -q
git -C "$tmp" config user.email t@t && git -C "$tmp" config user.name t
mkdir -p "$tmp/src"
printf 'it("a", () => {\n  expect(1).toBe(1)\n  expect(2).toBe(2)\n})\n' >"$tmp/src/a.test.ts"
printf 'it("b", () => { expect(1).toBe(1) })\n' >"$tmp/src/b.test.ts"
printf 'export const x = 1\n' >"$tmp/src/x.ts"
git -C "$tmp" add -A && git -C "$tmp" commit -qm base && git -C "$tmp" branch -q base

# expect <name> <exit> <heading-or-empty>; runs the guard against the current working tree.
expect() {
  out="$(cd "$tmp" && bash "$guard" base 2>&1)"
  code=$?
  if [ "$code" -ne "$2" ] || { [ -n "$3" ] && ! grep -qF "$3" <<<"$out"; }; then
    printf '✗ %s: want exit %s + "%s", got exit %s\n%s\n' "$1" "$2" "$3" "$code" "$out"
    fails=$((fails + 1))
  else
    printf '✓ %s\n' "$1"
  fi
  git -C "$tmp" checkout -q -- . && git -C "$tmp" clean -qfd
}

expect "clean diff passes" 0 "no suppressions"

printf '// @ts-ignore\n' >>"$tmp/src/x.ts"
expect "suppression" 1 "A checker was silenced"

printf 'it.skip("s", () => {})\n' >>"$tmp/src/a.test.ts"
expect ".skip" 1 "A test got easier"

printf 'xit("s", () => {})\n' >>"$tmp/src/a.test.ts"
expect "xit" 1 "A test got easier"

printf 'try { f() } catch {}\n' >>"$tmp/src/x.ts"
expect "swallowed error" 1 "Work is unfinished"

git -C "$tmp" rm -q src/b.test.ts
expect "deleted test" 1 "A test file was deleted"
git -C "$tmp" reset -q HEAD

sed -i.bak '/expect(2)/d' "$tmp/src/a.test.ts" && rm "$tmp/src/a.test.ts.bak"
expect "thinned assertions" 1 "Assertions were removed"

printf '// mentions eslint-disable in prose\n' >"$tmp/notes.md"
expect "markdown mentions are not findings" 0 ""

[ "$fails" -eq 0 ] && echo "all hold-the-bar self-tests passed" || exit 1
