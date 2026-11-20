#!/usr/bin/env bash
# Self-test for changed-scopes.mjs (DX-18 D7). Builds a throwaway repo with the real layout (the
# script, the mutation runner and one patch that touches a file outside the packages), changes files
# on top of a base commit, and reads the four flags. No network. Runs in guards:test.
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
# Both tsconfigs the walk reads for `paths`/`baseUrl` (C-17); a missing one would run everything.
printf '{ "compilerOptions": { "strict": true } }\n' | tee "$R/packages/db/tsconfig.json" >"$R/packages/shared/tsconfig.json"
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
# case <name> <expected: mutations build e2e import_pins> — commits the staged change, checks, then resets.
case_() {
  local name="$1" want="$2" event="${3:-pull_request}"
  g add -A && g commit -qm "$name" --allow-empty
  local got
  got="$(scopes "$event" "$BASE" | sed 's/^[a-z0-9_]*=//' | tr '\n' ' ' | sed 's/ $//')"
  if [ "$got" = "$want" ]; then ok "$name → $want"; else no "$name: want '$want', got '$got'"; fi
  g reset -q --hard "$BASE"
}

printf 'more\n' >>"$R/docs/a.md"
case_ "a docs-only change skips all four" "false false false false"

printf 'more\n' >"$R/README.md"
case_ "root markdown is inert" "false false false false"

printf 'x\n' >"$R/pnpm-lock.yaml"
case_ "a lockfile-only change (#306) runs everything" "true true true true"

printf 'export const x = 2;\n' >"$R/apps/web/lib/other.ts"
case_ "an app file no patch touches: build, e2e and the import pins, no mutations" "false true true true"

printf '// edit\n' >>"$R/apps/web/lib/scoped.ts"
case_ "an app file a patch touches runs the mutations" "true true true true"

mkdir -p "$R/packages/shared/src" && printf 'x\n' >"$R/packages/shared/src/x.ts"
case_ "a packages/shared change runs the mutations" "true true true true"

mkdir -p "$R/.github/workflows" && printf 'name: x\n' >"$R/.github/workflows/x.yml"
case_ "a workflow change runs everything" "true true true true"

mkdir -p "$R/.github/PULL_REQUEST_TEMPLATE" && printf 'x\n' >"$R/.github/PULL_REQUEST_TEMPLATE/a.md"
case_ "a PR template is inert for build, e2e and the import pins, but runs the mutations (.github/)" "true false false false"

printf 'png' >"$R/docs/shot.png"
case_ "an image under docs/ is inert" "false false false false"

printf 'png' >"$R/apps/web/logo.png"
case_ "an image under apps/web/ is app content" "false true true true"

g mv apps/web/lib/scoped.ts docs/scoped.md
case_ "a move counts its source path (--no-renames)" "true true true true"

case_ "an empty diff runs everything" "true true true true"

printf 'more\n' >>"$R/docs/a.md"
case_ "a push runs everything" "true true true true" push

# ── run_import_pins (docs/plans/td-program-tables-import-graph.md D7): one case per scope entry ────
# pins_case <name> <want>: like case_, but compares run_import_pins alone.
pins_case() {
  local name="$1" want="$2"
  g add -A && g commit -qm "$name" --allow-empty
  local got
  got="$(scopes pull_request "$BASE" | sed -n 's/^run_import_pins=//p')"
  if [ "$got" = "$want" ]; then ok "import pins: $name → $want"; else no "import pins: $name: want '$want', got '$got'"; fi
  g reset -q --hard "$BASE"
}
# B1: the privacy-docs test stays in the unscoped program-tables-stay-dark.test.ts, so a skip here
# skips no privacy check.
mkdir -p "$R/docs/privacy" && printf '# inventory\n' >"$R/docs/privacy/data-inventory.md"
pins_case "docs/privacy/data-inventory.md alone skips them" false
mkdir -p "$R/packages/db/scripts" && printf 'x\n' >"$R/packages/db/scripts/x.ts"
pins_case "a packages/db/scripts file skips them" false
mkdir -p "$R/packages/evals/src" && printf 'x\n' >"$R/packages/evals/src/x.ts"
pins_case "a packages/evals file skips them" false
mkdir -p "$R/.claude/skills" && printf 'x\n' >"$R/.claude/skills/x.md"
pins_case "a .claude/ file skips them" false
printf 'a {}\n' >"$R/apps/web/lib/x.css"
pins_case "an apps/web stylesheet runs them" true
printf 'x\n' >"$R/packages/db/src/x.ts"
pins_case "a packages/db/src file runs them" true
mkdir -p "$R/packages/shared/src" && printf 'x\n' >"$R/packages/shared/src/x.ts"
pins_case "a packages/shared/src file runs them" true
mkdir -p "$R/packages/engine/src" && printf 'x\n' >"$R/packages/engine/src/x.ts"
pins_case "a packages/engine/src file runs them" true
mkdir -p "$R/packages/evals" && printf '{}\n' >"$R/packages/evals/package.json"
pins_case "a nested package.json runs them" true
mkdir -p "$R/packages/evals" && printf '{}\n' >"$R/packages/evals/tsconfig.json"
pins_case "a nested tsconfig.json runs them" true
printf 'x\n' >"$R/.npmrc"
pins_case ".npmrc runs them" true
printf 'x\n' >"$R/pnpm-lock.yaml"
pins_case "the lockfile runs them" true
printf 'x\n' >"$R/pnpm-workspace.yaml"
pins_case "pnpm-workspace.yaml runs them" true
printf '// x\n' >>"$R/.github/scripts/changed-scopes.mjs"
pins_case "changed-scopes.mjs runs them" true
got="$(cd "$R" && node --input-type=module -e "
  import { importPinsInScope } from './.github/scripts/changed-scopes.mjs';
  console.log(importPinsInScope([]), importPinsInScope(['docs/a.md']));
")"
[ "$got" = "true false" ] && ok "import pins: an empty list runs them, a docs list does not" || no "importPinsInScope([]), ([docs]): got '$got'"

# Fail-safes that need no commit.
got="$(scopes pull_request "" | tr '\n' ' ')"
[ "$got" = "run_mutations=true run_build=true run_e2e=true run_import_pins=true " ] && ok "no base SHA runs everything" || no "no base SHA: got '$got'"
got="$(scopes pull_request "0000000000000000000000000000000000000000" | tr '\n' ' ')"
[ "$got" = "run_mutations=true run_build=true run_e2e=true run_import_pins=true " ] && ok "an unreadable base runs everything" || no "unreadable base: got '$got'"

out="$T/gh-output"
: >"$out"
(cd "$R" && GITHUB_OUTPUT="$out" GITHUB_EVENT_NAME=push node .github/scripts/changed-scopes.mjs >/dev/null 2>&1)
[ "$(cat "$out")" = "$(printf 'run_mutations=true\nrun_build=true\nrun_e2e=true\nrun_import_pins=true')" ] && ok "writes the flags to GITHUB_OUTPUT" || no "GITHUB_OUTPUT: $(cat "$out")"

# scopes-step.sh, the step every heavy job runs: its fallbacks.
cp "$HERE/scopes-step.sh" "$R/.github/scripts/"
step() { : >"$T/out"; (cd "$R" && GITHUB_OUTPUT="$T/out" RUNNER_TEMP="$T" BASE_SHA="$1" GITHUB_EVENT_NAME=pull_request bash .github/scripts/scopes-step.sh >"$T/step.log" 2>&1); tr '\n' ' ' <"$T/out"; }
ALL="run_mutations=true run_build=true run_e2e=true run_import_pins=true "
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
[ "$(step "$BASE")" = "run_mutations=false run_build=false run_e2e=false run_import_pins=false " ] && ok "scopes-step: the base's script decides a docs-only PR" || no "scopes-step docs: $(cat "$T/out") $(cat "$T/step.log")"
g reset -q --hard "$BASE"

# ── (c) catalog data is not a mutation trigger (docs/plans/dx-18-mutation-savings.md C1–C5) ────────
# Each case: an optional PRE commit on top of BASE (what main already holds), then the PR: a batch
# file plus a docs change, plus the case's own extra. A setup that belongs on main goes in PRE: a PR
# that edited packages/db or shared itself would trigger on that file and prove nothing about the
# catalog rule. The commits are built once; each copy of the script (the real one, every mutant) is
# then run on them from outside the repo, as CI runs the base's copy. Only run_mutations is
# compared, except C-1.
db() { mkdir -p "$(dirname "$R/packages/db/$1")" && printf '%b' "$2" >"$R/packages/db/$1"; }
c_pre_c2() { db src/reads-data.ts "import { batch01 } from '@mat-plan/shared/catalog/data';\nexport { batch01 };\n"; }
c_pre_c3() {
  printf 'export const batch01 = [1];\n' >"$R/$CAT/data/batch-01.ts"
  g diff >"$R/packages/db/scripts/mutations/02-catalog.patch"
  g checkout -q -- "$CAT/data/batch-01.ts"
}
c_pr_c4() { mkdir -p "$R/packages/shared/src" && printf 'export const x = 1;\n' >"$R/packages/shared/src/x.ts"; }
c_pre_c5() { printf "import './nope';\nexport const fixture = 1;\n" >"$R/$CAT/fixture.ts"; }
c_pre_c7() { printf "import './data/batch-01';\nexport const fixture = 1;\n" >"$R/$CAT/fixture.ts"; }
c_pre_c9() { db src/reads-other.ts "import { x } from '@mat-plan/other';\nexport { x };\n"; }
c_pre_c10() { db scripts/verify/x.ts "export const load = async () => await import('@mat-plan/shared/catalog/data');\n"; }
c_pre_c11() { printf "const data = require('./data/batch-01');\nexport const fixture = data;\n" >"$R/$CAT/fixture.ts"; }
c_pre_c12() { db src/subpath.ts "import '@mat-plan/shared/catalog/data/batch-01';\n"; }
c_pre_c13() { db src/reads-path.ts "import { readFileSync } from 'node:fs';\nexport const shipped = readFileSync(new URL('../../shared/src/catalog/data/shipped.json', import.meta.url), 'utf8');\n"; }
c_pre_c14() { db src/hash.ts "import { data } from '#data';\nexport { data };\n"; }
c_pre_c15() { db src/dynamic.ts "const name = './y';\nexport const load = () => import(name);\n"; }
c_pre_c16() { db src/cjs.ts "import { createRequire } from 'node:module';\nconst load = createRequire(import.meta.url);\nexport const y = load('./y');\n"; }
c_pre_c17() { printf '{ "compilerOptions": { "baseUrl": ".", "paths": { "x": ["y"] } } }\n' >"$R/packages/db/tsconfig.json"; }
c_pre_c19() { db src/comment.ts "// the cases under verify/*.ts\nimport { d } from '@mat-plan/shared/catalog/data';\n/** doc */\nexport { d };\n"; }
c_pre_c20() { db src/resolve.ts "import { readFileSync } from 'node:fs';\nexport const t = readFileSync(new URL(import.meta.resolve('@mat-plan/shared/catalog/data')), 'utf8');\n"; }
c_pre_c21() { printf "import { readFileSync } from 'node:fs';\nexport const fixture = readFileSync(new URL('./data/batch-03.ts', import.meta.url), 'utf8');\n" >"$R/$CAT/fixture.ts"; }
c_pre_c22() { printf '{ "extends": "../../tsconfig.base.json" }\n' >"$R/packages/db/tsconfig.json"; }
c_pre_c23() { db src/reads-name.ts "import { readFileSync } from 'node:fs';\nexport const s = readFileSync(new URL('./shipped.json', import.meta.url), 'utf8');\n"; }
c_pr_c18() { printf '{ "name": "planted" }\n' >"$R/$CAT/data/package.json"; }
# A git that fails on the walk's `ls-files`, and only there: the diff still works.
SHIM="$T/shim"
mkdir -p "$SHIM"
printf '#!/bin/sh\n[ "$1" = ls-files ] && { echo "shim: git failed" >&2; exit 128; }\nexec "%s" "$@"\n' "$(command -v git)" >"$SHIM/git"
chmod +x "$SHIM/git"

# id | pre-fn | pr-fn | PATH prefix | expected (C-1 compares all four flags, the rest run_mutations)
C_SPEC=(
  "C-1|-|-||false true true true"
  "C-2|c_pre_c2|-||true"
  "C-3|c_pre_c3|-||true"
  "C-4|-|c_pr_c4||true"
  "C-5|c_pre_c5|-||true"
  "C-6|-|-|$SHIM:|true"
  "C-7|c_pre_c7|-||true"
  "C-8|-|-||equal"
  "C-9|c_pre_c9|-||true"
  "C-10|c_pre_c10|-||true"
  "C-11|c_pre_c11|-||true"
  "C-12|c_pre_c12|-||true"
  "C-13|c_pre_c13|-||true"
  "C-14|c_pre_c14|-||true"
  "C-15|c_pre_c15|-||true"
  "C-16|c_pre_c16|-||true"
  "C-17|c_pre_c17|-||true"
  "C-18|-|c_pr_c18||true"
  "C-19|c_pre_c19|-||true"
  "C-20|c_pre_c20|-||true"
  "C-21|c_pre_c21|-||true"
  "C-22|c_pre_c22|-||true"
  "C-23|c_pre_c23|-||true"
)
C_DESC=(
  "C-1 a batch file plus docs: no mutations; build, e2e and the import pins still run"
  "C-2 a db file on main imports @mat-plan/shared/catalog/data: mutations run"
  "C-3 a patch on main targets batch-01.ts: mutations run (the target branch)"
  "C-4 a batch file plus packages/shared/src/x.ts: mutations run"
  "C-5 a fixture's relative specifier does not resolve: mutations run"
  "C-6 git fails during the walk: mutations run"
  "C-7 fixture.ts on main imports ./data/batch-01: mutations run (the walk, not a grep)"
  "C-8 CATALOG_DATA equals check-catalog-append-only.mjs's DIR"
  "C-9 a db file imports another @mat-plan package the walk cannot follow: mutations run"
  "C-10 a packages/db/scripts file await-imports the data: mutations run"
  "C-11 fixture.ts requires ./data/batch-01: mutations run"
  "C-12 an import of an unmapped subpath (catalog/data/batch-01): mutations run"
  "C-13 a db file reads shipped.json by path: mutations run"
  "C-14 a #imports specifier: mutations run"
  "C-15 a non-literal import(): mutations run"
  "C-16 createRequire: mutations run"
  "C-17 a tsconfig with paths or baseUrl: mutations run"
  "C-18 a package.json placed in catalog/data still triggers"
  "C-19 a // comment holding /* does not hide the next import: mutations run"
  "C-20 import.meta.resolve of the data: mutations run"
  "C-21 a catalog/ file reads ./data/batch-03.ts by path: mutations run"
  "C-22 a tsconfig that extends a base: mutations run"
  "C-23 a db file reads a file named shipped.json, no catalog/data in the path: mutations run"
)
C_BASES=()
C_HEADS=()
for spec in "${C_SPEC[@]}"; do
  IFS='|' read -r id pre pr _path _want <<<"$spec"
  if [ "$id" = C-8 ]; then
    C_BASES+=(-) && C_HEADS+=(-)
    continue
  fi
  g reset -q --hard "$BASE"
  [ "$pre" = - ] || "$pre"
  g add -A -- packages docs && g commit -qm "pre $id" --allow-empty
  C_BASES+=("$(g rev-parse HEAD)")
  printf 'export const batch01 = [2];\n' >"$R/$CAT/data/batch-01.ts"
  printf 'more\n' >>"$R/docs/a.md"
  [ "$pr" = - ] || "$pr"
  g add -A -- packages docs && g commit -qm "pr $id"
  C_HEADS+=("$(g rev-parse HEAD)")
done
g reset -q --hard "$BASE"
BRANCH="$(g symbolic-ref --short HEAD)"

# c_cases <script>: one "<case>=<ok|RED(flags)>" line per case, against that copy of the script.
c_cases() {
  local s="$1" i=0 id pre pr path want got
  for spec in "${C_SPEC[@]}"; do
    IFS='|' read -r id pre pr path want <<<"$spec"
    if [ "$id" = C-8 ]; then
      # One home for the path. check-catalog-append-only.mjs keeps DIR private; its exported FILES
      # sit directly in it.
      got="$(node --input-type=module -e "
        import { CATALOG_DATA } from '$s';
        import { FILES } from '$HERE/check-catalog-append-only.mjs';
        import { dirname } from 'node:path';
        const dirs = [...new Set(FILES.map((f) => dirname(f)))];
        console.log(dirs.length === 1 && dirs[0] === CATALOG_DATA ? 'equal' : 'CATALOG_DATA=' + CATALOG_DATA + ' DIR=' + dirs);
      " 2>&1 | tail -1)"
    else
      g checkout -q --detach "${C_HEADS[$i]}"
      got="$(cd "$R" && PATH="${path}${PATH}" GITHUB_EVENT_NAME=pull_request BASE_SHA="${C_BASES[$i]}" node "$s" 2>/dev/null |
        sed 's/^[a-z0-9_]*=//' | tr '\n' ' ' | sed 's/ $//')"
      [ "$want" = true ] && got="${got%% *}"
    fi
    [ "$got" = "$want" ] && echo "$id=ok" || echo "$id=RED(${got// /,})"
    i=$((i + 1))
  done
  g checkout -q "$BRANCH" && g reset -q --hard "$BASE"
}
cp "$HERE/changed-scopes.mjs" "$T/under-test.mjs"
results="$(c_cases "$T/under-test.mjs")"
i=0
for line in $results; do
  [ "${line#*=}" = ok ] && ok "${C_DESC[$i]}" || no "${C_DESC[$i]}: ${line#*=}"
  i=$((i + 1))
done
[ "$i" -eq "${#C_SPEC[@]}" ] || no "the (c) cases: expected ${#C_SPEC[@]} results, got $i"

# C-1 again, through scopes-step.sh with the BASE's copy (R3: a decider that imported a sibling would
# throw from $RUNNER_TEMP and run everything, so the saving would never save).
g reset -q --hard "$BASE"
printf 'export const batch01 = [2];\n' >"$R/$CAT/data/batch-01.ts"
printf 'more\n' >>"$R/docs/a.md"
g add -A -- packages docs && g commit -qm batch
cp "$HERE/scopes-step.sh" "$R/.github/scripts/"
[ "$(step "$BASE")" = "run_mutations=false run_build=true run_e2e=true run_import_pins=true " ] && ok "C-1 through scopes-step.sh: the base's copy skips the mutations for a batch file" || no "C-1 scopes-step: $(cat "$T/out") $(cat "$T/step.log")"
g reset -q --hard "$BASE"

# The (c) mutants (H5): each is one from/to literal on a copy of the script. `from` must occur exactly
# once (probe.mjs's rule) and the copy must compile, or the mutant proves nothing. Then the cases in
# its red list must go RED and every other case stay green.
# mutant <name> <red cases, space-separated, in case order> <from> <to>
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
# Ignoring relative specifiers hides every relative path to the data: C-7's import, C-11's require,
# and C-5's unresolved RELATIVE specifier.
mutant c-walk-ignores-relative "C-5 C-7 C-11" \
  "if (spec.startsWith('.')) {" "if (spec.startsWith('.')) { return undefined;"
# Every unresolved first-party specifier passes through this line: a relative one (C-5), another
# workspace package (C-9), an unmapped shared subpath (C-12) and #imports (C-14).
mutant c-unresolved-is-fine "C-5 C-9 C-12 C-14" \
  "if (next === null) return true;" "if (next === null) continue;"
mutant c-any-throw-is-no-match "C-6" \
  "return true; // an error proves nothing" "return false; // an error proves nothing"
# The scan keeps only `from` and a bare `import '…'`: the dynamic import (C-10) and require (C-11) go.
# No scan-regex mutant: dropping the call forms leaves `import('…catalog/data')` and `require('./data…')`
# un-blanked, so the path-read checks (C-13, C-21) catch them anyway. That backstop is the design.
mutant c-unmapped-export-is-third-party "C-12" \
  "fromExports(target) : null;" "fromExports(target) : undefined;"
mutant c-scripts-not-entries "C-10" \
  "CODE_FILE.test(f) && !TEST_FILE.test(f)" "CODE_FILE.test(f) && !TEST_FILE.test(f) && !f.startsWith('packages/db/scripts/')"
mutant c-path-reads-ignored "C-13 C-23" \
  "if (READS_DATA.test(rest)) return true;" "if (false) return true;"
mutant c-hash-is-third-party "C-14" \
  "if (spec.startsWith('#')) return null;" "if (spec.startsWith('#')) return undefined;"
# One pattern covers both: a non-literal call (C-15) and createRequire (C-16).
mutant c-unfollowable-ignored "C-15 C-16" \
  "UNFOLLOWABLE.test(code(text))" "false"
mutant c-tsconfig-paths-ignored "C-17 C-22" \
  "/\"(?:paths|baseUrl|extends)\"/.test(io.read(f))" "false"
mutant c-relative-data-ignored "C-21" \
  "READS_DATA_RELATIVE.test(rest)" "false"
# No mutant for UNFOLLOWABLE's `.resolve` arm: C-20's resolved string still names catalog/data, so
# READS_DATA catches it too. The arm is the backstop for a resolve whose string does not.
mutant c-blocks-before-lines "C-19" \
  "text.replace(/(^|[\\s;{}(),])\\/\\/.*\$/gm, '\$1').replace(/\\/\\*[\\s\\S]*?\\*\\//g, '')" "text.replace(/\\/\\*[\\s\\S]*?\\*\\//g, '').replace(/(^|[\\s;{}(),])\\/\\/.*\$/gm, '\$1')"
mutant c-data-dir-config-excluded "C-18" \
  " && !/\/(?:package|tsconfig[^/]*)\.json\$/.test(f)" ""

# The mutants live here, never as markers in the shipped source.
if grep -rln '@mutant' "$HERE" | grep -v '/changed-scopes\.test\.sh$'; then
  no "a @mutant marker in .github/scripts/ outside this test"
else
  ok "no @mutant marker in .github/scripts/ outside this test"
fi

# The polarity rule, on the real workflows: a step skips only on a literal false. Any comparison of
# a scope (or an env var carrying one) with true, quoted or not, is refused.
GUARD="$ROOT/apps/web/test/program-imports.test.ts"
if grep -nE "(run_(mutations|build|e2e|import_pins)|RUN_(MUTATIONS|BUILD|E2E|IMPORT_PINS))[^#]*(==|=|!=)[[:space:]]*['\"]?true\b" "$ROOT"/.github/workflows/*.yml "$GUARD"; then
  no "a workflow or the import-pins guard compares a scope with true (must compare with false)"
else
  ok "no workflow, nor the import-pins guard, compares a scope with true"
fi
# The guard skips only on a literal 'false': unset, empty or mistyped runs it.
if grep -qF "process.env.RUN_IMPORT_PINS === 'false'" "$GUARD"; then
  ok "the import-pins guard skips only on RUN_IMPORT_PINS === 'false'"
else
  no "the import-pins guard's skip does not read RUN_IMPORT_PINS === 'false'"
fi

echo
echo "changed-scopes.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
