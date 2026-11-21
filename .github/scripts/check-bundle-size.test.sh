#!/usr/bin/env bash
# Self-test for check-bundle-size.mjs (PERF-1 (b)). Offline: every case is a fake project in a
# `mktemp -d` git repo, with real chunk files of known sizes and the small `.next` JSON the guard
# reads. Expected numbers are literals, never computed by the guard (docs/lessons.md → "THE
# RECURRING ONE"). Plan: docs/plans/perf-1-bundle-size.md → Test plan.
#
#   bash .github/scripts/check-bundle-size.test.sh
set -uo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check-bundle-size.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0
n=0

# ── The green template ─────────────────────────────────────────────────────────────────────────────
# The app-paths manifest is the REAL 20-key one from a Next 16.4.5 build, copied literally: 17 `/page`
# keys, minus `/_global-error/page`, is 16 rows.
t="$tmp/template"
nx="$t/apps/web/.next"
mkdir -p "$nx/diagnostics" "$nx/server" "$nx/static/chunks/app" "$t/.github"
cat >"$nx/server/app-paths-manifest.json" <<'EOF'
{
  "/_global-error/page": "app/_global-error/page.js",
  "/_not-found/page": "app/_not-found/page.js",
  "/design/program/page": "app/design/program/page.js",
  "/design/tokens/page": "app/design/tokens/page.js",
  "/favicon.ico/route": "app/favicon.ico/route.js",
  "/p/[profileId]/edit/page": "app/p/[profileId]/edit/page.js",
  "/p/[profileId]/export/route": "app/p/[profileId]/export/route.js",
  "/p/[profileId]/page": "app/p/[profileId]/page.js",
  "/p/[profileId]/routine/page": "app/p/[profileId]/routine/page.js",
  "/p/new/page": "app/p/new/page.js",
  "/p/page": "app/p/page.js",
  "/page": "app/page.js",
  "/privacy/page": "app/privacy/page.js",
  "/programs/[programId]/page": "app/programs/[programId]/page.js",
  "/programs/[programId]/workouts/[workoutId]/page": "app/programs/[programId]/workouts/[workoutId]/page.js",
  "/programs/[programId]/workouts/new/page": "app/programs/[programId]/workouts/new/page.js",
  "/programs/how-to/[optionId]/route": "app/programs/how-to/[optionId]/route.js",
  "/programs/page": "app/programs/page.js",
  "/settings/page": "app/settings/page.js",
  "/sign-in/[[...rest]]/page": "app/sign-in/[[...rest]]/page.js"
}
EOF
printf '{"name":"Next.js","version":"16.4.5"}' >"$nx/diagnostics/framework.json"
printf '{"pages":{},"polyfillFiles":["static/chunks/polyfill.js"],"rootMainFiles":[]}' >"$nx/build-manifest.json"
ROUTES=(/ /_not-found /design/program /design/tokens /p/[profileId]/edit /p/[profileId] \
  /p/[profileId]/routine /p/new /p /privacy /programs/[programId] \
  /programs/[programId]/workouts/[workoutId] /programs/[programId]/workouts/new /programs /settings \
  /sign-in/[[...rest]])
# Every route loads shared.js (600 B) + its own r<i>.js (400 B), except /p/[profileId], whose own
# chunk is 10,000 B so it can shrink by 8 KiB. lazy.js is dynamic()-only; the polyfill and the
# source map are not counted.
head -c 600 /dev/zero >"$nx/static/chunks/shared.js"
head -c 50000 /dev/zero >"$nx/static/chunks/polyfill.js"
head -c 999 /dev/zero >"$nx/static/chunks/shared.js.map"
head -c 100 /dev/zero >"$nx/static/chunks/app/lazy.js"
stats='['
for i in "${!ROUTES[@]}"; do
  r="${ROUTES[$i]}"
  if [ "$r" = "/p/[profileId]" ]; then head -c 10000 /dev/zero >"$nx/static/chunks/r$i.js"
  else head -c 400 /dev/zero >"$nx/static/chunks/r$i.js"; fi
  [ "$i" -gt 0 ] && stats+=','
  stats+="{\"route\":\"$r\",\"firstLoadUncompressedJsBytes\":1,\"firstLoadChunkPaths\":[\".next/static/chunks/shared.js\",\".next/static/chunks/r$i.js\"]}"
done
printf '%s]' "$stats" >"$nx/diagnostics/route-bundle-stats.json"
# The /p/[profileId] chunk, by name, for the cases that grow or shrink it.
for i in "${!ROUTES[@]}"; do [ "${ROUTES[$i]}" = "/p/[profileId]" ] && PROFILE_CHUNK="r$i.js"; done
cat >"$t/.github/bundle-baseline.json" <<'EOF'
{
  "next": "16.4.5",
  "routes": {
    "(lazy client chunks)": 100,
    "/": 1000,
    "/_not-found": 1000,
    "/design/program": 1000,
    "/design/tokens": 1000,
    "/p": 1000,
    "/p/[profileId]": 10600,
    "/p/[profileId]/edit": 1000,
    "/p/[profileId]/routine": 1000,
    "/p/new": 1000,
    "/privacy": 1000,
    "/programs": 1000,
    "/programs/[programId]": 1000,
    "/programs/[programId]/workouts/[workoutId]": 1000,
    "/programs/[programId]/workouts/new": 1000,
    "/settings": 1000,
    "/sign-in/[[...rest]]": 1000
  }
}
EOF
g() { git -C "$t" -c user.name=t -c user.email=t@example.invalid "$@"; }
git init -q "$t" && printf 'x\n' >"$t/README.md"
g add README.md && g commit -qm 'before the baseline'
BASE_NONE="$(g rev-parse HEAD)"
g add .github && g commit -qm 'baseline'
BASE_SHA_GREEN="$(g rev-parse HEAD)"

# fresh: a copy of the template in $p (cwd for the guard), with the default env reset.
fresh() {
  n=$((n + 1)); p="$tmp/c$n"; cp -R "$t" "$p"; c="$p/apps/web/.next/static/chunks"
  BO=success; BS="$BASE_SHA_GREEN"; CI=; XARGS=()
}
# setb <route> <bytes|delete> : edit the PR's working-tree baseline
setb() {
  node -e 'const fs=require("fs"),f=process.argv[1],b=JSON.parse(fs.readFileSync(f));
    if (process.argv[3]==="delete") delete b.routes[process.argv[2]]; else b.routes[process.argv[2]]=Number(process.argv[3]);
    fs.writeFileSync(f, JSON.stringify(b))' "$p/.github/bundle-baseline.json" "$1" "$2"
}
# json <file> <js mutating x> : edit a fixture JSON file
json() {
  node -e 'const fs=require("fs"),f=process.argv[1]; let x=JSON.parse(fs.readFileSync(f)); x=(new Function("x", process.argv[2]+"; return x"))(x); fs.writeFileSync(f, JSON.stringify(x))' "$1" "$2"
}
# expect <name> <exit> <text> : run the guard in $p; a text starting with ! must NOT appear
expect() {
  out="$(cd "$p" && env -u GITHUB_ACTIONS -u GITHUB_STEP_SUMMARY BUILD_OUTCOME="$BO" BASE_SHA="$BS" \
    ${CI:+GITHUB_ACTIONS=true} node "$guard" --summary "$p/summary.md" ${XARGS[@]+"${XARGS[@]}"} 2>&1)"
  code=$?
  if [ "${3#!}" != "$3" ]; then grep -qF -- "${3#!}" <<<"$out" && hit=0 || hit=1
  else { [ -z "$3" ] || grep -qF -- "$3" <<<"$out"; } && hit=1 || hit=0; fi
  if [ "$code" -ne "$2" ] || [ "$hit" -ne 1 ]; then
    printf '✗ %s: want exit %s + "%s", got %s\n%s\n' "$1" "$2" "$3" "$code" "$out"
    [ -n "${GITHUB_ACTIONS:-}" ] && printf '::error::check-bundle-size self-test: %s (want exit %s, got %s)\n' "$1" "$2" "$code"
    fails=$((fails + 1))
  else printf '✓ %s\n' "$1"; fi
}
grow() { head -c "$2" /dev/zero >>"$c/$1"; }
# insummary <name> <text> : the step summary file of the last run has <text> (Acceptance 2)
insummary() {
  if grep -qF -- "$2" "$p/summary.md" 2>/dev/null; then printf '✓ %s\n' "$1"
  else printf '✗ %s: want "%s" in the summary file\n' "$1" "$2"; fails=$((fails + 1)); fi
}

# ── Pass, and the boundary ─────────────────────────────────────────────────────────────────────────
fresh; expect "equal to baseline, real 20-key manifest" 0 '| / | 1000 | 1000 | 0 |'
expect "the summary file is written too" 0 'Bundle size: **pass**'
insummary "the summary file has the table" '| / | 1000 | 1000 | 0 |'
fresh; grow "$PROFILE_CHUNK" 8192; expect "+8192 is on the boundary and passes" 0 '| /p/[profileId] | 10600 | 18792 | +8.0 KiB |'
fresh; head -c 1808 /dev/zero >"$c/$PROFILE_CHUNK"; expect "-8192 is on the boundary and passes" 0 '| /p/[profileId] | 10600 | 2408 | -8.0 KiB |'

# ── Over budget, either way ───────────────────────────────────────────────────────────────────────
fresh; grow "$PROFILE_CHUNK" 8193
expect "+8193 on /p/[profileId] fails" 1 '::error::bundle: /p/[profileId] +8.0 KiB (+8,193 B; 10,600 → 18,793); budget ±8.0 KiB'
fresh; head -c 1807 /dev/zero >"$c/$PROFILE_CHUNK"; expect "-8193 fails: re-baseline" 1 're-baseline'
fresh; grow app/lazy.js 8193
expect "dynamic()-only chunk grows 8193, no route moves" 1 '::error::bundle: (lazy client chunks) +8.0 KiB (+8,193 B; 100 → 8,293)'
fresh; grow app/lazy.js 8193; expect "dynamic()-only growth moves no route" 1 '!::error::bundle: /p/'
# A regrouping (#798): the shared chunk becomes one copy per route. The files on disk grow 9,000 B,
# past the budget, but no route loads more and no lazy chunk moves, so it passes.
fresh; rm "$c/shared.js"
for i in "${!ROUTES[@]}"; do head -c 600 /dev/zero >"$c/s$i.js"; done
json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x.forEach((r, i) => { r.firstLoadChunkPaths = r.firstLoadChunkPaths.map((q) => q.endsWith("/shared.js") ? `.next/static/chunks/s${i}.js` : q); })'
expect "a regrouping that duplicates shared code across routes passes" 0 '| (lazy client chunks) | 100 | 100 | 0 |'

# ── Cannot measure: stats, shape, paths, count, inputs ────────────────────────────────────────────
fresh; rm "$p/apps/web/.next/diagnostics/route-bundle-stats.json"
expect "stats file missing" 2 'route-bundle-stats.json'
fresh; printf '[]' >"$p/apps/web/.next/diagnostics/route-bundle-stats.json"; expect "stats file is []" 2 'no routes'
fresh; json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x[0].extra = 1'
expect "an extra key" 2 'must have exactly ['
fresh; json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x[3].chunks = x[3].firstLoadChunkPaths; delete x[3].firstLoadChunkPaths'
expect "a renamed key" 2 'must have exactly ['
fresh; json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x[0].firstLoadChunkPaths.push(".next/static/chunks/gone.js")'
expect "chunk path missing on disk" 2 '.next/static/chunks/gone.js'
fresh; head -c 5 /dev/zero >"$p/apps/web/x.js"
json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x[0].firstLoadChunkPaths.push(".next/static/../../x.js")'
expect "chunk path escapes .next/static (../)" 2 'outside .next/static'
fresh; head -c 5 /dev/zero >"$p/outside.js"; ln -s "$p/outside.js" "$c/link.js"
json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x[0].firstLoadChunkPaths.push(".next/static/chunks/link.js")'
expect "chunk path escapes .next/static (symlink)" 2 'outside .next/static'
fresh; json "$p/apps/web/.next/server/app-paths-manifest.json" 'x["/extra/page"] = "app/extra/page.js"'
expect "manifest /page count != stats rows (a route Next skipped)" 2 'count'
fresh; rm "$p/apps/web/.next/server/app-paths-manifest.json"; expect "manifest missing" 2 'app-paths-manifest.json'
fresh; rm "$p/apps/web/.next/diagnostics/framework.json"; expect "framework.json missing" 2 'framework.json'
fresh; rm "$p/.github/bundle-baseline.json"; expect "baseline missing" 2 'baseline'
fresh; printf '{' >"$p/.github/bundle-baseline.json"; expect "baseline malformed" 2 'baseline'
fresh; printf '{"next":"16.4.5","routes":{}}' >"$p/.github/bundle-baseline.json"
expect "baseline routes {}" 2 'baseline'

# ── New or gone rows ───────────────────────────────────────────────────────────────────────────────
fresh; json "$p/apps/web/.next/server/app-paths-manifest.json" 'x["/extra/page"] = "app/extra/page.js"'
json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x.push({route: "/extra", firstLoadUncompressedJsBytes: 1, firstLoadChunkPaths: [".next/static/chunks/shared.js"]})'
expect "a row new to the build" 1 'add it'
fresh; json "$p/apps/web/.next/server/app-paths-manifest.json" 'delete x["/privacy/page"]'
json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x = x.filter((r) => r.route !== "/privacy")'
expect "a row gone from the build" 1 'remove it'

# ── The Next stamp, and the PR's baseline against the base's ──────────────────────────────────────
fresh; printf '{"name":"Next.js","version":"16.5.0"}' >"$p/apps/web/.next/diagnostics/framework.json"
expect "Next stamp != framework version, within tolerance: noted" 0 'Next 16.4.5 → 16.5.0'
expect "Next stamp != framework version: the table is still drawn" 0 '| / | 1000 | 1000 | 0 |'
fresh; grow "$PROFILE_CHUNK" 9000; setb "/p/[profileId]" 19600
expect "PR raised a baseline to the measurement: warned" 0 '::warning::bundle: baseline for /p/[profileId] raised by +8.8 KiB in this PR'
expect "PR raised a baseline: its own section" 0 '### Baseline changed in this PR'
expect "PR raised a baseline: vs main's column shows the growth" 0 "| /p/[profileId] | 19600 | 19600 | 0 | +8.8 KiB |"
fresh; setb "/" 1257; expect "PR padded a baseline by NOISE_BYTES + 1" 1 "must equal this run's measurement within 256 B"
# Once any row changes, EVERY row must be the measurement: a stale row beside a changed one fails.
fresh; grow "$PROFILE_CHUNK" 4000; setb "/" 1001; expect "a stale row beside a changed one fails" 1 "baseline for /p/[profileId] is"
fresh; setb "/" 1256; expect "a changed baseline within NOISE_BYTES of the measurement passes (CI build noise)" 0 'raised by +256 B in this PR'
fresh; setb "/" 743; expect "a changed baseline NOISE_BYTES + 1 below the measurement fails" 1 "must equal this run's measurement within 256 B"
fresh; BS="$BASE_NONE"; expect "base has no baseline file" 0 'baseline introduced'
fresh; BS="$BASE_NONE"; setb "/" 2000; expect "an introduced baseline must be the measurement" 1 "must equal this run's measurement within 256 B"
fresh; BS=0000000000000000000000000000000000000001; expect "BASE_SHA names a missing commit" 2 'cannot read the base'
fresh; BS=; expect "BASE_SHA empty (push): no vs main's column" 0 "!vs main's baseline"
fresh; BS=; setb "/" 1001; expect "BASE_SHA empty (push): no baseline-change check" 0 '| / | 1001 | 1000 | -1 B |'

# ── The Build step's outcome ──────────────────────────────────────────────────────────────────────
fresh; BO=skipped; rm -rf "$p/apps/web/.next"
expect "BUILD_OUTCOME=skipped" 0 '::notice::bundle size not measured (docs/tooling-only change (changed-scopes.mjs)); job still reports success.'
fresh; BO=skipped; expect "skipped never says pass" 0 '!pass'
insummary "skipped: the summary still has a status line" 'Bundle size: **not measured**'
fresh; BO=failure; expect "BUILD_OUTCOME=failure" 2 'cannot measure'
insummary "cannot measure: the summary still has a status line" 'Bundle size: **could not measure**'
fresh; BO=cancelled; expect "BUILD_OUTCOME=cancelled" 2 'cannot measure'
fresh; BO=; expect "BUILD_OUTCOME empty locally: measures" 0 '| / | 1000 | 1000 | 0 |'
fresh; BO=; CI=1; expect "BUILD_OUTCOME empty on CI: miswired step" 2 'BUILD_OUTCOME is empty on CI'
fresh; CI=1; expect "on CI with an outcome: measures" 0 '| / | 1000 | 1000 | 0 |'

# ── The baseline's next stamp ─────────────────────────────────────────────────────────────────────
fresh; json "$p/.github/bundle-baseline.json" 'x.next = "16.4.6"'
expect "a changed next stamp is warned" 1 "baseline's next stamp changed: 16.4.5 → 16.4.6"
expect "a changed next stamp must be the build's version" 1 "baseline's next is 16.4.6 but this build is 16.4.5"

# ── More shape refusals ───────────────────────────────────────────────────────────────────────────
fresh; json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x.push(x[0])'
expect "a duplicate route" 2 'repeats the route /'
fresh; json "$p/apps/web/.next/build-manifest.json" 'delete x.polyfillFiles'
expect "polyfillFiles missing" 2 'polyfillFiles'
fresh; json "$p/apps/web/.next/build-manifest.json" 'x.polyfillFiles = "static/chunks/polyfill.js"'
expect "polyfillFiles not an array" 2 'polyfillFiles'
fresh; json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x[0].firstLoadChunkPaths = []'
expect "an empty firstLoadChunkPaths" 2 'must be a non-empty string[]'
fresh; printf '{"name":"Next.js","version":16}' >"$p/apps/web/.next/diagnostics/framework.json"
expect "a non-string framework version" 2 'framework.json has no string version'
fresh; setb "/" -1; expect "a negative baseline value" 2 'is not a byte count'
fresh; setb "/" 1.5; expect "a non-integer baseline value" 2 'is not a byte count'
fresh; json "$p/apps/web/.next/server/app-paths-manifest.json" 'x["/k/page"] = "x"'
json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x.push({route: "constructor", firstLoadUncompressedJsBytes: 1, firstLoadChunkPaths: [".next/static/chunks/shared.js"]})'
expect "a route named constructor is refused" 2 'must be a string that starts with /'
fresh; json "$p/apps/web/.next/server/app-paths-manifest.json" 'x["/k/page"] = "x"'
json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x.push({route: "(lazy client chunks)", firstLoadUncompressedJsBytes: 1, firstLoadChunkPaths: [".next/static/chunks/shared.js"]})'
expect "a route cannot overwrite the (lazy client chunks) row" 2 'must be a string that starts with /'
fresh; BS=; setb constructor 5; expect "a baseline entry named constructor is not taken as measured" 1 'constructor is in .github/bundle-baseline.json but was not measured; remove it'
fresh; setb constructor 5; expect "a changed baseline's constructor entry is not compared with an inherited value" 1 '!measured function'
fresh; XARGS=(--next-dir); expect "--next-dir with no value" 2 '--next-dir needs a value'

# ── Escaping: a route name reaches the table and the annotations escaped ─────────────────────────
# Both routes have a baseline entry, so each reaches a TABLE ROW (not only the "new row" error).
fresh; json "$p/apps/web/.next/server/app-paths-manifest.json" 'x["/a|b%0A/page"] = "x"; x["/c/page"] = "y"'
json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x.push({route: "/a|b%0A", firstLoadUncompressedJsBytes: 1, firstLoadChunkPaths: [".next/static/chunks/shared.js"]}, {route: "/c\n::warning::injected", firstLoadUncompressedJsBytes: 1, firstLoadChunkPaths: [".next/static/chunks/shared.js"]})'
setb "/a|b%0A" 600; setb $'/c\n::warning::injected' 600
expect "a route named /a|b%0A is escaped in its table row" 0 '| /a\|b%250A | 600 | 600 | 0 |'
expect "a route named /a|b%0A is escaped in its annotation" 0 '::warning::bundle: baseline for /a\|b%250A added in this PR'
expect "a route with a newline cannot start a workflow command" 0 '/c%0A::warning::injected'
grep -q '^::warning::injected' <<<"$out" && { printf '✗ a newline in a route reached the log raw\n'; fails=$((fails + 1)); } \
  || printf '✓ no raw workflow command from a route name\n'
fresh; json "$p/apps/web/.next/server/app-paths-manifest.json" 'x["/t/page"] = "x"'
json "$p/apps/web/.next/diagnostics/route-bundle-stats.json" 'x.push({route: "/t```x", firstLoadUncompressedJsBytes: 1, firstLoadChunkPaths: [".next/static/chunks/shared.js"]})'
setb '/t```x' 600; expect "a backtick run in a route cannot close the <details> fence" 0 '````json'

# ── Contract: the tolerance, imported (the literal once, here) ────────────────────────────────────
out="$(node --input-type=module -e "import * as G from '$guard'; console.log(G.TOLERANCE_BYTES)" 2>&1)"
if [ "$out" = 8192 ]; then printf '✓ TOLERANCE_BYTES is 8192, and importing runs nothing\n'
else printf '✗ TOLERANCE_BYTES: want "8192", got\n%s\n' "$out"; fails=$((fails + 1)); fi
out="$(node --input-type=module -e "import * as G from '$guard'; console.log(G.NOISE_BYTES)" 2>&1)"
if [ "$out" = 256 ]; then printf '✓ NOISE_BYTES is 256\n'
else printf '✗ NOISE_BYTES: want "256", got\n%s\n' "$out"; fails=$((fails + 1)); fi

[ "$fails" -eq 0 ] && printf '\ncheck-bundle-size self-test: all passed\n' && exit 0
printf '\ncheck-bundle-size self-test: %s failed\n' "$fails"
exit 1
