#!/usr/bin/env bash
# Self-test for resolve-pr-base.sh, and the pin that ci.yml uses it. Builds a throwaway repo per case.
#
#   bash .github/scripts/resolve-pr-base.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
script="$here/resolve-pr-base.sh"
ci="$here/../workflows/ci.yml"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0
ok() { printf '✓ %s\n' "$1"; }
bad() { printf '✗ %s\n%s\n' "$1" "${2:-}"; fails=$((fails + 1)); }

g() { git -C "$tmp" "$@"; }
g init -q -b main && g config user.email t@t && g config user.name t
echo a >"$tmp/a" && g add -A && g commit -qm 'chore: base'
g checkout -q -b feat/x && echo b >"$tmp/b" && g add -A && g commit -qm 'feat(x): add'
g checkout -q main && echo c >"$tmp/c" && g add -A && g commit -qm 'feat(y): main moved'
main_tip="$(g rev-parse main)"

# run <event> <github-sha> → sets out, code. CI's self-test step inherits real GITHUB_* values, so
# every case sets both explicitly.
# stdout is the value ci.yml stores; stderr is the log line and the refusals.
run() {
  out="$(cd "$tmp" && GITHUB_EVENT_NAME="$1" GITHUB_SHA="$2" bash "$script" 2>"$tmp/.err")"; code=$?
  err="$(cat "$tmp/.err")"
}

# 1. The merge ref: a detached merge of the PR head into main, and the runner's GITHUB_SHA is it.
g checkout -q --detach main && g merge -q --no-ff --no-edit feat/x >/dev/null
merge_ref="$(g rev-parse HEAD)"
run pull_request "$merge_ref"
[ "$code" -eq 0 ] && [ "$out" = "$main_tip" ] && ok "merge ref → its first parent" \
  || bad "merge ref → its first parent: exit $code" "$out"

# 2. GITHUB_SHA is not HEAD: the checkout was overridden.
run pull_request "$main_tip"
[ "$code" -eq 2 ] && grep -qF 'not the merge ref' <<<"$err" && ok "HEAD != GITHUB_SHA exits 2" \
  || bad "HEAD != GITHUB_SHA exits 2: exit $code" "$err"

# 3. The head-ref trap: a branch tip that merged main also has two parents. Its HEAD^1 is the
#    branch's previous commit, which would hide the branch's own commits. GITHUB_SHA (the merge ref)
#    differs, so it is refused.
g checkout -q feat/x && g merge -q --no-ff --no-edit main >/dev/null
run pull_request "$merge_ref"
[ "$code" -eq 2 ] && ok "a head tip that merged main is refused" \
  || bad "a head tip that merged main is refused: exit $code" "$out"

# 4. Single parent, even when GITHUB_SHA matches.
g checkout -q main
run pull_request "$(g rev-parse HEAD)"
[ "$code" -eq 2 ] && grep -qF 'not a merge commit' <<<"$err" && ok "single-parent HEAD exits 2" \
  || bad "single-parent HEAD exits 2: exit $code" "$err"

# 5. push: no PR, no base; the consumers' empty-base branches take the strict path.
run push "$(g rev-parse HEAD)"
[ "$code" -eq 0 ] && [ -z "$out" ] && ok "push prints nothing" || bad "push prints nothing: exit $code" "$out"

# 6. The pin: ci.yml reads the PR base from the resolver and nowhere else. On the parent of the PR
#    that added this, six steps read pull_request.base.sha — the defect this file exists for.
if grep -qF 'pull_request.base.sha' "$ci"; then
  bad "ci.yml has no pull_request.base.sha" "$(grep -nF 'pull_request.base.sha' "$ci")"
else ok "ci.yml has no pull_request.base.sha"; fi
others="$(grep -nE '^[[:space:]]+BASE_SHA:' "$ci" | grep -vF 'steps.base.outputs.sha')"
[ -z "$others" ] && ok "every BASE_SHA reads steps.base.outputs.sha" || bad "every BASE_SHA reads steps.base.outputs.sha" "$others"
grep -qF 'bash .github/scripts/resolve-pr-base.sh' "$ci" && ok "ci.yml runs the resolver" || bad "ci.yml runs the resolver"

[ "$fails" -eq 0 ] && echo "all resolve-pr-base self-tests passed" || exit 1
