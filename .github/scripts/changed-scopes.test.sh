#!/usr/bin/env bash
# Self-test for changed-scopes.mjs (DX-18 D7). Builds a throwaway repo with the real layout (the
# script, the mutation runner and one patch that touches a file outside the packages), changes files
# on top of a base commit, and reads the three flags. No network. Runs in guards:test.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
pass=0
fail=0
ok() { pass=$((pass + 1)); echo "✓ $1"; }
no() { fail=$((fail + 1)); echo "✗ $1"; }
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
unset GITHUB_OUTPUT

R="$T/repo"
mkdir -p "$R/.github/scripts" "$R/packages/db/scripts/mutations" "$R/apps/web/lib" "$R/docs"
cp "$HERE/changed-scopes.mjs" "$HERE/heavy-slot.mjs" "$HERE/pid-lock.mjs" "$R/.github/scripts/"
cp "$ROOT/packages/db/scripts/mutations.mjs" "$R/packages/db/scripts/"
printf 'export const scope = "household";\n' >"$R/apps/web/lib/scoped.ts"
printf 'export const x = 1;\n' >"$R/apps/web/lib/other.ts"
printf '# doc\n' >"$R/docs/a.md"
g() { git -C "$R" -c user.email=t@t -c user.name=t "$@"; }
g init -q
g add -A && g commit -qm base
# A patch that touches a file OUTSIDE packages/db and packages/shared (as 13 real patches do).
sed -i.bak 's/"household"/"any"/' "$R/apps/web/lib/scoped.ts" && rm "$R/apps/web/lib/scoped.ts.bak"
g diff >"$R/packages/db/scripts/mutations/01-scope.patch"
g checkout -q -- apps/web/lib/scoped.ts
g add -A && g commit -qm patch
BASE="$(g rev-parse HEAD)"

# scopes <event> <base>: run the script on the current HEAD, print its stdout.
scopes() {
  (cd "$R" && GITHUB_EVENT_NAME="$1" BASE_SHA="$2" node .github/scripts/changed-scopes.mjs 2>/dev/null)
}
# case <name> <expected: mutations build e2e> — commits the staged change, checks, then resets.
case_() {
  local name="$1" want="$2" event="${3:-pull_request}"
  g add -A && g commit -qm "$name" --allow-empty
  local got
  got="$(scopes "$event" "$BASE" | sed 's/^[a-z0-9_]*=//' | tr '\n' ' ' | sed 's/ $//')"
  if [ "$got" = "$want" ]; then ok "$name → $want"; else no "$name: want '$want', got '$got'"; fi
  g reset -q --hard "$BASE"
}

printf 'more\n' >>"$R/docs/a.md"
case_ "a docs-only change skips all three" "false false false"

printf 'more\n' >"$R/README.md"
case_ "root markdown is inert" "false false false"

printf 'x\n' >"$R/pnpm-lock.yaml"
case_ "a lockfile-only change (#306) runs everything" "true true true"

printf 'export const x = 2;\n' >"$R/apps/web/lib/other.ts"
case_ "an app file no patch touches: build and e2e, no mutations" "false true true"

printf '// edit\n' >>"$R/apps/web/lib/scoped.ts"
case_ "an app file a patch touches runs the mutations" "true true true"

mkdir -p "$R/packages/shared/src" && printf 'x\n' >"$R/packages/shared/src/x.ts"
case_ "a packages/shared change runs the mutations" "true true true"

mkdir -p "$R/.github/workflows" && printf 'name: x\n' >"$R/.github/workflows/x.yml"
case_ "a workflow change runs everything" "true true true"

mkdir -p "$R/.github/PULL_REQUEST_TEMPLATE" && printf 'x\n' >"$R/.github/PULL_REQUEST_TEMPLATE/a.md"
case_ "a PR template is inert for build and e2e, but runs the mutations (.github/)" "true false false"

printf 'png' >"$R/docs/shot.png"
case_ "an image under docs/ is inert" "false false false"

printf 'png' >"$R/apps/web/logo.png"
case_ "an image under apps/web/ is app content" "false true true"

g mv apps/web/lib/scoped.ts docs/scoped.md
case_ "a move counts its source path (--no-renames)" "true true true"

case_ "an empty diff runs everything" "true true true"

printf 'more\n' >>"$R/docs/a.md"
case_ "a push runs everything" "true true true" push

# Fail-safes that need no commit.
got="$(scopes pull_request "" | tr '\n' ' ')"
[ "$got" = "run_mutations=true run_build=true run_e2e=true " ] && ok "no base SHA runs everything" || no "no base SHA: got '$got'"
got="$(scopes pull_request "0000000000000000000000000000000000000000" | tr '\n' ' ')"
[ "$got" = "run_mutations=true run_build=true run_e2e=true " ] && ok "an unreadable base runs everything" || no "unreadable base: got '$got'"

out="$T/gh-output"
: >"$out"
(cd "$R" && GITHUB_OUTPUT="$out" GITHUB_EVENT_NAME=push node .github/scripts/changed-scopes.mjs >/dev/null 2>&1)
[ "$(cat "$out")" = "$(printf 'run_mutations=true\nrun_build=true\nrun_e2e=true')" ] && ok "writes the flags to GITHUB_OUTPUT" || no "GITHUB_OUTPUT: $(cat "$out")"

# scopes-step.sh, the step every heavy job runs: its fallbacks.
cp "$HERE/scopes-step.sh" "$R/.github/scripts/"
step() { : >"$T/out"; (cd "$R" && GITHUB_OUTPUT="$T/out" RUNNER_TEMP="$T" BASE_SHA="$1" GITHUB_EVENT_NAME=pull_request bash .github/scripts/scopes-step.sh >"$T/step.log" 2>&1); tr '\n' ' ' <"$T/out"; }
ALL="run_mutations=true run_build=true run_e2e=true "
[ "$(step "")" = "$ALL" ] && ok "scopes-step: no base runs everything" || no "scopes-step no base: $(cat "$T/out")"
nobase="$(git -C "$R" rev-list --max-parents=0 HEAD)"
g rm -q --cached .github/scripts/changed-scopes.mjs && g commit -qm "no script" && g checkout -q -- .github/scripts 2>/dev/null; cp "$HERE/changed-scopes.mjs" "$R/.github/scripts/"
noscript="$(g rev-parse HEAD)"
[ "$(step "$noscript")" = "$ALL" ] && ok "scopes-step: a base without the script runs everything" || no "scopes-step no script: $(cat "$T/out")"
printf 'throw new Error("broken");\n' >"$R/.github/scripts/changed-scopes.mjs"; g add -A && g commit -qm broken
broken="$(g rev-parse HEAD)"
[ "$(step "$broken")" = "$ALL" ] && ok "scopes-step: a base script that fails runs everything" || no "scopes-step broken: $(cat "$T/out")"
g reset -q --hard "$BASE"
printf 'more\n' >>"$R/docs/a.md"; g add docs && g commit -qm docs
cp "$HERE/scopes-step.sh" "$R/.github/scripts/" # untracked: the step is the PR's own file
[ "$(step "$BASE")" = "run_mutations=false run_build=false run_e2e=false " ] && ok "scopes-step: the base's script decides a docs-only PR" || no "scopes-step docs: $(cat "$T/out") $(cat "$T/step.log")"
g reset -q --hard "$BASE"

# The polarity rule, on the real workflows: a step skips only on a literal false. Any comparison of
# a scope (or an env var carrying one) with true, quoted or not, is refused.
if grep -nE "(run_(mutations|build|e2e)|RUN_(MUTATIONS|BUILD|E2E))[^#]*(==|=|!=)[[:space:]]*['\"]?true\b" "$ROOT"/.github/workflows/*.yml; then
  no "a workflow compares a scope with true (must compare with false)"
else
  ok "no workflow compares a scope with true"
fi

echo
echo "changed-scopes.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
