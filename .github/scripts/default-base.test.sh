#!/usr/bin/env bash
# Self-test for default-base.mjs: the base a local guard run compares with when none is passed.
# A fake `gh` on PATH stands in for GitHub, so the test needs no network and no login.
#
#   bash .github/scripts/default-base.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
helper="$here/default-base.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

g() { git -C "$tmp/repo" "$@"; }
mkdir -p "$tmp/repo" "$tmp/bin"
g init -q -b main && g config user.email t@t && g config user.name t
echo a >"$tmp/repo/a" && g add -A && g commit -qm 'chore: base'
g update-ref refs/remotes/origin/main HEAD
g update-ref refs/remotes/origin/feat/parent HEAD

# fake_gh <stdout> <exit>: what `gh pr view` answers; it also records that it was called.
fake_gh() {
  printf '#!/usr/bin/env bash\necho called >>"%s/gh-calls"\nprintf "%%s" "%s"\nexit %s\n' "$tmp" "$1" "$2" >"$tmp/bin/gh"
  chmod +x "$tmp/bin/gh"
  rm -f "$tmp/gh-calls"
}

# case <name> <explicit-or-empty> <GITHUB_ACTIONS-or-empty> <want>
check() {
  local got
  got="$(cd "$tmp/repo" && PATH="$tmp/bin:$PATH" GITHUB_ACTIONS="$3" node --input-type=module \
    -e "import { defaultBase } from '$helper'; process.stdout.write(defaultBase(process.argv[1] || undefined));" "$2" 2>/dev/null)"
  if [ "$got" = "$4" ]; then printf '✓ %s\n' "$1"; else printf '✗ %s: want %s, got %s\n' "$1" "$4" "$got"; fails=$((fails + 1)); fi
}

fake_gh 'feat/parent' 0
check 'an explicit base wins, and gh is not asked'           'origin/other' '' 'origin/other'
[ ! -e "$tmp/gh-calls" ] && printf '✓ %s\n' 'gh not called when a base is given' || { printf '✗ gh was called\n'; fails=$((fails + 1)); }
check 'a stacked PR compares with its base branch'          '' '' 'origin/feat/parent'
# In CI with no base: exit 2 and never ask gh (CI always passes one).
fake_gh 'feat/parent' 0
out="$(cd "$tmp/repo" && PATH="$tmp/bin:$PATH" GITHUB_ACTIONS=true node --input-type=module \
  -e "import { defaultBase } from '$helper'; defaultBase(undefined);" 2>&1)"; code=$?
if [ "$code" -eq 2 ] && [ ! -e "$tmp/gh-calls" ]; then printf '✓ %s\n' 'in CI with no base: exit 2, gh never called'
else printf '✗ in CI with no base: exit %s, gh-calls %s\n%s\n' "$code" "$([ -e "$tmp/gh-calls" ] && echo yes || echo no)" "$out"; fails=$((fails + 1)); fi
# The CLI form hold-the-bar uses.
fake_gh 'feat/parent' 0
got="$(cd "$tmp/repo" && PATH="$tmp/bin:$PATH" GITHUB_ACTIONS= node "$helper" 2>/dev/null)"
[ "$got" = 'origin/feat/parent' ] && printf '✓ %s\n' 'the CLI prints the base' || { printf '✗ CLI printed %s\n' "$got"; fails=$((fails + 1)); }
# …also from a path with a space, reached through a symlink (macOS's /tmp is one).
mkdir -p "$tmp/with space" && ln -s "$helper" "$tmp/with space/link.mjs"
got="$(cd "$tmp/repo" && PATH="$tmp/bin:$PATH" GITHUB_ACTIONS= node "$tmp/with space/link.mjs" 2>/dev/null)"
[ "$got" = 'origin/feat/parent' ] && printf '✓ %s\n' 'the CLI works through a symlink and a space' || { printf '✗ CLI via symlink printed [%s]\n' "$got"; fails=$((fails + 1)); }
if grep -q 'default-base.mjs' "$here/../../.claude/skills/hold-the-bar/check.sh"; then printf '✓ %s\n' 'hold-the-bar uses it'
else printf '✗ hold-the-bar does not use it\n'; fails=$((fails + 1)); fi
fake_gh 'main' 0
check 'a PR into main: origin/main'                         '' '' 'origin/main'
fake_gh '' 1
check 'no PR, or gh fails: origin/main'                     '' '' 'origin/main'
fake_gh '' 0
check 'only a merged or closed PR (gh filters it out): origin/main' '' '' 'origin/main'
fake_gh 'feat/not-fetched' 0
check 'a base that is not fetched: origin/main'             '' '' 'origin/main'

# Both guards use it (a guard that drifts back to a hard-coded origin/main fails here).
for s in check-feature-guides.mjs check-status-touched.mjs; do
  if grep -q "defaultBase(process.argv\[2\])" "$here/$s"; then printf '✓ %s uses defaultBase\n' "$s"
  else printf '✗ %s does not use defaultBase\n' "$s"; fails=$((fails + 1)); fi
done

[ "$fails" -eq 0 ] && echo 'all default-base self-tests passed' || { echo "$fails failing"; exit 1; }
