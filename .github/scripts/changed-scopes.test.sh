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
# The catalog's shape (DX-18 (c)): shared's exports map, its data behind ./catalog/data, and a db file
# that imports shared the way packages/db does today, so nothing it runs reaches the data.
CAT=packages/shared/src/catalog
mkdir -p "$R/$CAT/data" "$R/packages/db/src"
printf '{"name":"@mat-plan/shared","exports":{".":"./src/index.ts","./catalog/data":"./src/catalog/data/index.ts","./catalog/fixture":"./src/catalog/fixture.ts"}}\n' >"$R/packages/shared/package.json"
printf "export * from './catalog/fixture';\n" >"$R/packages/shared/src/index.ts"
printf 'export const fixture = 1;\n' >"$R/$CAT/fixture.ts"
printf "export * from './batch-01';\n" >"$R/$CAT/data/index.ts"
printf 'export const batch01 = [];\n' >"$R/$CAT/data/batch-01.ts"
printf "import { fixture } from '@mat-plan/shared/catalog/fixture';\nimport { y } from './y';\nimport { z } from 'drizzle-orm';\nexport { fixture, y, z };\n" >"$R/packages/db/src/seed.ts"
printf 'export const y = 1;\n' >"$R/packages/db/src/y.ts"
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

# ── (c) catalog data is not a mutation trigger (docs/plans/dx-18-mutation-savings.md C1–C5) ────────
# Each case: an optional PRE commit on top of BASE (what main already holds), then the PR: a batch
# file plus a docs change, plus the case's own extra. The flags are read with SCRIPT, the copy under
# test, run from outside the repo as CI runs the base's copy. Only run_mutations is compared, except
# C-1. A setup that belongs on main goes in PRE: a PR that edited packages/db or shared itself would
# trigger on that file and prove nothing about the catalog rule.
c_pre_c2() { printf "import { batch01 } from '@mat-plan/shared/catalog/data';\nexport { batch01 };\n" >"$R/packages/db/src/reads-data.ts"; }
c_pre_c3() {
  sed -i.bak 's/\[\]/[1]/' "$R/$CAT/data/batch-01.ts" && rm "$R/$CAT/data/batch-01.ts.bak"
  g diff >"$R/packages/db/scripts/mutations/02-catalog.patch"
  g checkout -q -- "$CAT/data/batch-01.ts"
}
c_pr_c4() { mkdir -p "$R/packages/shared/src" && printf 'export const x = 1;\n' >"$R/packages/shared/src/x.ts"; }
c_pre_c5() { printf "import './nope';\nexport const fixture = 1;\n" >"$R/$CAT/fixture.ts"; }
c_pre_c7() { printf "import './data/batch-01';\nexport const fixture = 1;\n" >"$R/$CAT/fixture.ts"; }
c_pre_c9() { printf "import { x } from '@mat-plan/other';\nexport { x };\n" >"$R/packages/db/src/reads-other.ts"; }
# A git that fails on the walk's `ls-files`, and only there: the diff still works.
SHIM="$T/shim"
mkdir -p "$SHIM"
printf '#!/bin/sh\n[ "$1" = ls-files ] && { echo "shim: git failed" >&2; exit 128; }\nexec "%s" "$@"\n' "$(command -v git)" >"$SHIM/git"
chmod +x "$SHIM/git"

# c_flags <script> <pre-fn|-> <pr-fn|-> [path-prefix]: prints "mutations build e2e".
c_flags() {
  local script="$1" pre="$2" pr="$3" path="${4:-}" base
  g reset -q --hard "$BASE"
  [ "$pre" = - ] || "$pre"
  g add -A && g commit -qm pre --allow-empty
  base="$(g rev-parse HEAD)"
  printf 'export const batch01 = [2];\n' >"$R/$CAT/data/batch-01.ts"
  printf 'more\n' >>"$R/docs/a.md"
  [ "$pr" = - ] || "$pr"
  g add -A && g commit -qm pr
  (cd "$R" && PATH="${path}${PATH}" GITHUB_EVENT_NAME=pull_request BASE_SHA="$base" node "$script" 2>/dev/null) |
    sed 's/^[a-z0-9_]*=//' | tr '\n' ' ' | sed 's/ $//'
  g reset -q --hard "$BASE"
}
# c_cases <script>: one "<case>=<ok|RED>" line per case, against that copy of the script.
c_cases() {
  local s="$1" got
  got="$(c_flags "$s" - -)"
  [ "$got" = "false true true" ] && echo "C-1=ok" || echo "C-1=RED(${got// /,})"
  got="$(c_flags "$s" c_pre_c2 -)"
  [ "${got%% *}" = true ] && echo "C-2=ok" || echo "C-2=RED(${got// /,})"
  got="$(c_flags "$s" c_pre_c3 -)"
  [ "${got%% *}" = true ] && echo "C-3=ok" || echo "C-3=RED(${got// /,})"
  got="$(c_flags "$s" - c_pr_c4)"
  [ "${got%% *}" = true ] && echo "C-4=ok" || echo "C-4=RED(${got// /,})"
  got="$(c_flags "$s" c_pre_c5 -)"
  [ "${got%% *}" = true ] && echo "C-5=ok" || echo "C-5=RED(${got// /,})"
  got="$(c_flags "$s" - - "$SHIM:")"
  [ "${got%% *}" = true ] && echo "C-6=ok" || echo "C-6=RED(${got// /,})"
  got="$(c_flags "$s" c_pre_c7 -)"
  [ "${got%% *}" = true ] && echo "C-7=ok" || echo "C-7=RED(${got// /,})"
  # C-8: one home for the path. check-catalog-append-only.mjs keeps DIR private; its exported FILES
  # sit directly in it.
  got="$(node --input-type=module -e "
    import { CATALOG_DATA } from '$s';
    import { FILES } from '$HERE/check-catalog-append-only.mjs';
    import { dirname } from 'node:path';
    const dirs = [...new Set(FILES.map((f) => dirname(f)))];
    console.log(dirs.length === 1 && dirs[0] === CATALOG_DATA ? 'equal' : 'CATALOG_DATA=' + CATALOG_DATA + ' DIR=' + dirs);
  " 2>&1 | tail -1)"
  [ "$got" = equal ] && echo "C-8=ok" || echo "C-8=RED(${got// /,})"
  got="$(c_flags "$s" c_pre_c9 -)"
  [ "${got%% *}" = true ] && echo "C-9=ok" || echo "C-9=RED(${got// /,})"
}
C_DESC=(
  "C-1 a batch file plus docs: no mutations; build and e2e still run"
  "C-2 a db file on main imports @mat-plan/shared/catalog/data: mutations run"
  "C-3 a patch on main targets batch-01.ts: mutations run (the target branch)"
  "C-4 a batch file plus packages/shared/src/x.ts: mutations run"
  "C-5 a fixture's relative specifier does not resolve: mutations run"
  "C-6 git fails during the walk: mutations run"
  "C-7 fixture.ts on main imports ./data/batch-01: mutations run (the walk, not a grep)"
  "C-8 CATALOG_DATA equals check-catalog-append-only.mjs's DIR"
  "C-9 a db file imports another @mat-plan package the walk cannot follow: mutations run"
)
cp "$HERE/changed-scopes.mjs" "$T/under-test.mjs"
results="$(c_cases "$T/under-test.mjs")"
i=0
for line in $results; do
  [ "${line#*=}" = ok ] && ok "${C_DESC[$i]}" || no "${C_DESC[$i]}: ${line#*=}"
  i=$((i + 1))
done
[ "$i" -eq 9 ] || no "the (c) cases: expected 9 results, got $i"

# C-1 again, through scopes-step.sh with the BASE's copy (R3: a decider that imported a sibling would
# throw from $RUNNER_TEMP and run everything, so the saving would never save).
g reset -q --hard "$BASE"
printf 'export const batch01 = [2];\n' >"$R/$CAT/data/batch-01.ts"
printf 'more\n' >>"$R/docs/a.md"
g add -A && g commit -qm batch
cp "$HERE/scopes-step.sh" "$R/.github/scripts/"
[ "$(step "$BASE")" = "run_mutations=false run_build=true run_e2e=true " ] && ok "C-1 through scopes-step.sh: the base's copy skips the mutations for a batch file" || no "C-1 scopes-step: $(cat "$T/out") $(cat "$T/step.log")"
g reset -q --hard "$BASE"

# The (c) mutants (H5): each is one from/to literal on a copy of the script. `from` must occur exactly
# once (probe.mjs's rule) and the copy must compile, or the mutant proves nothing. Then the cases in
# its red list must go RED and every other case stay green.
# mutant <name> <red cases, space-separated> <from> <to>
mutant() {
  local name="$1" want="$2" from="$3" to="$4" copy="$T/mutant-$1.mjs" got red
  if ! FROM="$from" TO="$to" SRC="$HERE/changed-scopes.mjs" OUT="$copy" node -e '
    const fs = require("node:fs");
    const s = fs.readFileSync(process.env.SRC, "utf8");
    const n = s.split(process.env.FROM).length - 1;
    if (n !== 1) { console.error(`from occurs ${n} times`); process.exit(1); }
    fs.writeFileSync(process.env.OUT, s.replace(process.env.FROM, () => process.env.TO));
  '; then
    no "mutant $name: its from literal must occur exactly once"
    return
  fi
  if ! node --check "$copy" 2>/dev/null; then
    no "mutant $name: does not compile"
    return
  fi
  got="$(c_cases "$copy")"
  red="$(printf '%s\n' $got | grep -v '=ok$' | sed 's/=.*//' | tr '\n' ' ' | sed 's/ $//')"
  [ "$red" = "$want" ] && ok "mutant $name: turns $want red, the rest stay green" || no "mutant $name: want red '$want', got red '$red'"
}
# Ignoring relative specifiers also hides C-5's unresolved RELATIVE specifier: both go red.
mutant c-walk-ignores-relative "C-5 C-7" \
  "if (spec.startsWith('.')) {" "if (spec.startsWith('.')) { return undefined;"
mutant c-unresolved-is-fine "C-5 C-9" \
  "if (next === null) return true;" "if (next === null) continue;"
mutant c-any-throw-is-no-match "C-6" \
  "return true; // an error proves nothing" "return false; // an error proves nothing"

# The mutants live here, never as markers in the shipped source.
if grep -rln '@mutant' "$HERE" | grep -v '/changed-scopes\.test\.sh$'; then
  no "a @mutant marker in .github/scripts/ outside this test"
else
  ok "no @mutant marker in .github/scripts/ outside this test"
fi

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
