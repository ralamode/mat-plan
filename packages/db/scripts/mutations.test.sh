#!/usr/bin/env bash
# Self-test for scripts/mutations.mjs (plan: docs/plans/dx-mutations-kill-safe.md).
#
# Builds a throwaway git repo with the real layout (packages/db/scripts/mutations.mjs and one patch
# in scripts/mutations/), and puts a `pnpm` shim first on PATH that stands in for `pnpm db:verify`,
# so the runner's own `spawn('pnpm', ['db:verify'])` runs unchanged. The shim's behaviour is read
# from a file. No database, no network: it runs in guards:test.
#
# The shim's "hang" mode starts a GRANDCHILD (a backgrounded sleep), because the real gate is four
# processes deep (pnpm → tsx → esbuild → node): a test whose gate is a direct child would pass even
# if the runner killed only its child, not the group.
set -uo pipefail

RUNNER_SRC="$(cd "$(dirname "$0")" && pwd)/mutations.mjs"
SCRIPTS_SRC="$(cd "$(dirname "$0")/../../../.github/scripts" && pwd)"
# The runner takes the machine-wide heavy-run slot (DX-18 D3). Each setup points it at the throwaway
# dir, so the test never touches a live slot; CI is unset so the slot is exercised, not skipped.
unset CI GITHUB_ACTIONS MAT_PLAN_HEAVY_SLOT MAT_PLAN_HEAVY_SLOTS MAT_PLAN_HEAVY_SLOT_HELD
pass=0
fail=0
pids=()
cleanup() {
  for p in "${pids[@]:-}"; do [ -n "$p" ] && kill -9 "$p" 2>/dev/null; done
  [ -n "${T:-}" ] && rm -rf "$T"
}
trap cleanup EXIT

ok() { pass=$((pass + 1)); echo "✓ $1"; }
no() { fail=$((fail + 1)); echo "✗ $1"; }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }

BASE=$'export const scope = "household";\n// 1\n// 2\n// 3\n// 4\n// 5\n// 6\n// 7\n// 8\nexport const keep = 1;\n'
# Uncommitted work far below the patch's hunk (outside its three lines of context).
ORIGINAL="${BASE}// uncommitted work, not in any commit"$'\n'
BASE_B="${BASE/household/second}"
ORIGINAL_B="${BASE_B}// more uncommitted work"$'\n'

setup() {
  [ -n "${T:-}" ] && rm -rf "$T"
  T="$(mktemp -d)"
  R="$T/repo"
  mkdir -p "$R/packages/db/scripts/mutations" "$R/packages/db/src" "$R/.github/scripts" "$T/bin"
  cp "$RUNNER_SRC" "$R/packages/db/scripts/mutations.mjs"
  cp "$SCRIPTS_SRC/heavy-slot.mjs" "$SCRIPTS_SRC/pid-lock.mjs" "$R/.github/scripts/"
  export MAT_PLAN_HEAVY_SLOT_PATH="$T/heavy-slot.json"
  printf '%s' "$BASE" >"$R/packages/db/src/a.ts"
  printf '%s' "$BASE_B" >"$R/packages/db/src/b.ts"
  git -C "$R" init -q
  git -C "$R" -c user.email=t@t -c user.name=t add -A
  git -C "$R" -c user.email=t@t -c user.name=t commit -qm base
  # The patch: drop the household conjunct.
  sed -i.bak 's/"household"/"any"/' "$R/packages/db/src/a.ts" && rm "$R/packages/db/src/a.ts.bak"
  git -C "$R" diff >"$R/packages/db/scripts/mutations/01-drop-scope.patch"
  git -C "$R" checkout -q -- packages/db/src/a.ts
  echo 'the scope holds' >"$R/packages/db/scripts/mutations/01-drop-scope.expect"
  # A second patch, on another file, so the run covers more than one patch.
  sed -i.bak 's/"second"/"none"/' "$R/packages/db/src/b.ts" && rm "$R/packages/db/src/b.ts.bak"
  git -C "$R" diff >"$R/packages/db/scripts/mutations/02-drop-second.patch"
  git -C "$R" checkout -q -- packages/db/src/b.ts
  echo 'the scope holds' >"$R/packages/db/scripts/mutations/02-drop-second.expect"
  git -C "$R" -c user.email=t@t -c user.name=t add -A
  git -C "$R" -c user.email=t@t -c user.name=t commit -qm patch
  # Uncommitted work in the patched file (outside the patch's hunk) and in another file.
  printf '%s' "$ORIGINAL" >"$R/packages/db/src/a.ts"
  printf '%s' "$ORIGINAL_B" >"$R/packages/db/src/b.ts"
  printf '%s' "$ORIGINAL" >"$T/a.expected"
  printf '%s' "$ORIGINAL_B" >"$T/b.expected"
  cat >"$T/bin/pnpm" <<'SHIM'
#!/usr/bin/env bash
mode="$(cat "$MUT_T/mode")"
case "$mode" in
  red-right) echo 'AssertionError [ERR_ASSERTION]: the scope holds' >&2; exit 1 ;;
  red-wrong) echo 'AssertionError [ERR_ASSERTION]: something else' >&2; exit 1 ;;
  green) exit 0 ;;
  late-edit)
    # The second gate run edits a file the FIRST patch touched (a developer's edit mid-run).
    n=$(( $(cat "$MUT_T/count" 2>/dev/null || echo 0) + 1 )); echo $n >"$MUT_T/count"
    [ "$n" = 2 ] && echo '// edited mid-run' >>"$MUT_T/repo/packages/db/src/a.ts"
    echo 'AssertionError [ERR_ASSERTION]: the scope holds' >&2; exit 1 ;;
  hang)
    sleep 60 &
    echo $! >"$MUT_T/gc.pid"
    echo $$ >"$MUT_T/gate.pid"
    touch "$MUT_T/ready"
    wait ;;
esac
SHIM
  chmod +x "$T/bin/pnpm"
  export MUT_T="$T"
  export PATH="$T/bin:$PATH"
  GITDIR="$(git -C "$R" rev-parse --absolute-git-dir)"
}
mode() { echo "$1" >"$T/mode"; }
run() { node "$R/packages/db/scripts/mutations.mjs" "$@" >"$T/out" 2>&1; echo $? >"$T/code"; }
code() { cat "$T/code"; }
out_has() { grep -qF -- "$1" "$T/out"; }
# Byte comparisons (cmp), not $(cat): command substitution strips trailing newlines.
file_is_original() { cmp -s "$R/packages/db/src/a.ts" "$T/a.expected"; }
both_original() { file_is_original && cmp -s "$R/packages/db/src/b.ts" "$T/b.expected"; }
file_is_patched() { grep -q '"any"' "$R/packages/db/src/a.ts"; }
journal_gone() { [ ! -e "$GITDIR/mat-plan-mutations-inflight.json" ]; }
lock_gone() { [ ! -e "$GITDIR/mat-plan-mutations.lock" ]; }
wait_ready() {
  for _ in $(seq 1 100); do [ -e "$T/ready" ] && return 0; sleep 0.1; done
  return 1
}
dead() { ! kill -0 "$(cat "$1")" 2>/dev/null; }
start_hanging() {
  rm -f "$T/ready" "$T/gc.pid" "$T/gate.pid"
  mode hang
  node "$R/packages/db/scripts/mutations.mjs" >"$T/out" 2>&1 &
  RUNNER=$!
  pids+=("$RUNNER")
  wait_ready || { no "the gate started"; return 1; }
  pids+=("$(cat "$T/gc.pid")" "$(cat "$T/gate.pid")")
  file_is_patched || no "the patch is applied while the gate runs"
}

# ── Verdicts ─────────────────────────────────────────────────────────────────────────────────────
setup; mode red-right; run
check "red on the expected assertion, both patches: exit 0, reported RED" \
  '[ "$(code)" = 0 ] && [ "$(grep -c "RED (expected)" "$T/out")" = 2 ] && out_has "2 mutations, all RED"'
check "…and both patched files are byte-identical, uncommitted work kept" 'both_original'
check "…and no journal or lock is left" 'journal_gone && lock_gone'

setup; mode green; run
check "a gate that stays green: exit 1, STAYED GREEN" '[ "$(code)" = 1 ] && out_has "STAYED GREEN"'
check "…and the file is restored" 'file_is_original && journal_gone'

setup; mode red-wrong; run
check "red on the wrong assertion: exit 1, WRONG assertion" '[ "$(code)" = 1 ] && out_has "WRONG assertion"'

# A PATH with node and nothing else (not the real pnpm either), so the runner's spawn finds no gate.
setup; rm "$T/bin/pnpm"; mkdir -p "$T/nodeonly"; ln -s "$(command -v node)" "$T/nodeonly/node"
PATH="$T/nodeonly:/usr/bin:/bin" run
check "a gate that cannot start: exit 1, DID-NOT-RUN" '[ "$(code)" = 1 ] && out_has "DID-NOT-RUN"'
check "…and the file is restored" 'file_is_original && journal_gone'

setup; printf 'export const scope = "elsewhere";\n' >"$R/packages/db/src/a.ts"; mode red-right; run
check "a patch that does not apply: exit 1, does not apply" '[ "$(code)" = 1 ] && out_has "does not apply"'

setup; git -C "$R" apply "$R/packages/db/scripts/mutations/01-drop-scope.patch"
cp "$R/packages/db/src/a.ts" "$T/a.before"; cp "$R/packages/db/src/b.ts" "$T/b.before"; mode red-right; run
check "a patch left applied with no journal: exit 1, still applied" '[ "$(code)" = 1 ] && out_has "still applied: 01-drop-scope.patch"'
check "…and the runner touched nothing: both files as it found them, no journal written" \
  'cmp -s "$R/packages/db/src/a.ts" "$T/a.before" && cmp -s "$R/packages/db/src/b.ts" "$T/b.before" && journal_gone'

setup; mode late-edit; run
check "a watched file edited during the run: exit 1, not byte-identical" \
  '[ "$(code)" = 1 ] && out_has "not byte-identical to how the run found them" && out_has "packages/db/src/a.ts"'

setup
printf 'new\n' >"$R/packages/db/src/c.ts"; git -C "$R" add -N packages/db/src/c.ts
git -C "$R" diff -- packages/db/src/c.ts >"$R/packages/db/scripts/mutations/03-creates-a-file.patch"
git -C "$R" rm -q --cached packages/db/src/c.ts; rm "$R/packages/db/src/c.ts"
echo x >"$R/packages/db/scripts/mutations/03-creates-a-file.expect"; mode red-right; run
check "a patch that creates a file: refused, exit 1, nothing created" \
  '[ "$(code)" = 1 ] && out_has "03-creates-a-file.patch: creates, deletes" && [ ! -e "$R/packages/db/src/c.ts" ]'

# ── Signals: restore, end the gate's whole group, die by the signal ─────────────────────────────
for pair in SIGTERM:143 SIGINT:130 SIGHUP:129 SIGQUIT:131; do
  sig="${pair%%:*}"; want="${pair##*:}"
  setup; start_hanging || continue
  kill -s "${sig#SIG}" "$RUNNER"; wait "$RUNNER" 2>/dev/null; got=$?
  check "$sig mid-gate: exits $want" '[ "$got" = "$want" ]'
  check "$sig mid-gate: the file is byte-identical, uncommitted work kept" 'file_is_original'
  check "$sig mid-gate: the gate AND its grandchild are gone" 'sleep 0.3; dead "$T/gate.pid" && dead "$T/gc.pid"'
  check "$sig mid-gate: no journal or lock is left" 'journal_gone && lock_gone'
done

# ── SIGKILL: untrappable; the next run recovers ─────────────────────────────────────────────────
setup; start_hanging && {
  kill -9 "$RUNNER"; wait "$RUNNER" 2>/dev/null
  check "SIGKILL mid-gate: the patch is still applied and the journal exists" 'file_is_patched && ! journal_gone'
  run --recover
  check "--recover: exit 0, recovered" '[ "$(code)" = 0 ] && out_has "recovered"'
  check "--recover: the file is byte-identical, uncommitted work kept" 'file_is_original && journal_gone'
  check "--recover: the orphaned gate and its grandchild are ended" 'sleep 0.3; dead "$T/gate.pid" && dead "$T/gc.pid"'
}

setup; start_hanging && {
  kill -9 "$RUNNER"; wait "$RUNNER" 2>/dev/null
  printf '%s' "$ORIGINAL" >"$R/packages/db/src/a.ts" # someone restored it by hand
  run --recover
  check "recovery when the file is already restored: exit 0, file untouched, journal removed" \
    '[ "$(code)" = 0 ] && file_is_original && journal_gone'
}

setup; start_hanging && {
  kill -9 "$RUNNER"; wait "$RUNNER" 2>/dev/null
  rm "$R/packages/db/src/a.ts" # killed inside git apply's remove-then-write
  run --recover
  check "recovery when the kill left the file missing: exit 0, file restored byte-identical" \
    '[ "$(code)" = 0 ] && file_is_original && journal_gone'
}

setup; start_hanging && {
  kill -9 "$RUNNER"; wait "$RUNNER" 2>/dev/null
  printf 'edited after the kill\n' >"$R/packages/db/src/a.ts"
  run --recover
  check "recovery when the file was edited after the kill: exit 1, file untouched, journal kept" \
    '[ "$(code)" = 1 ] && [ "$(cat "$R/packages/db/src/a.ts")" = "edited after the kill" ] && ! journal_gone && out_has "PRE-PATCH bytes"'
}

# ── One run per worktree ────────────────────────────────────────────────────────────────────────
# The slot is bypassed for the second run, so the worktree lock is what refuses it.
setup; start_hanging && {
  MAT_PLAN_HEAVY_SLOT=off node "$R/packages/db/scripts/mutations.mjs" >"$T/out2" 2>&1; second=$?
  check "a second run while the first is live: refuses" '[ "$second" = 1 ] && grep -qF "in flight in this worktree" "$T/out2"'
  check "…and leaves the first run's patch and journal alone" 'file_is_patched && ! journal_gone'
  kill -TERM "$RUNNER"; wait "$RUNNER" 2>/dev/null
  check "…and the first run still restores when stopped" 'file_is_original && journal_gone && lock_gone'
}

# ── The heavy-run slot (DX-18 D3) ───────────────────────────────────────────────────────────────
setup; start_hanging && {
  check "a live run holds the heavy-run slot" '[ -f "$MAT_PLAN_HEAVY_SLOT_PATH" ]'
  node "$R/packages/db/scripts/mutations.mjs" >"$T/out2" 2>&1; second=$?
  check "a second run while the slot is held: exit 2, names the holder" '[ "$second" = 2 ] && grep -qF "heavy-run slot held by" "$T/out2" && grep -qF "db:mutations" "$T/out2"'
  check "…and leaves the first run's patch and journal alone" 'file_is_patched && ! journal_gone'
  kill -TERM "$RUNNER"; wait "$RUNNER" 2>/dev/null
  check "a run stopped by a signal frees the slot" 'file_is_original && [ ! -e "$MAT_PLAN_HEAVY_SLOT_PATH" ]'
}
setup; mode red-right; run
check "a finished run frees the slot" '[ ! -e "$MAT_PLAN_HEAVY_SLOT_PATH" ]'

# ── Selections and shards (DX-18 D6) ────────────────────────────────────────────────────────────
setup
run --list --shard 0/2; s0="$(cat "$T/out")"
run --list --shard 1/2; s1="$(cat "$T/out")"
check "two shards partition the patches: each once, none twice" \
  '[ "$(printf "%s\n%s\n" "$s0" "$s1" | sort)" = "$(printf "01-drop-scope.patch\n02-drop-second.patch")" ]'
run --list --only 1; check "--only 1 takes patch 01 alone" '[ "$(cat "$T/out")" = "01-drop-scope.patch" ]'
run --list --only 1-2; check "--only 1-2 takes both" '[ "$(wc -l <"$T/out" | tr -d " ")" = 2 ]'
run --list --only drop-second; check "--only <text> matches by name" '[ "$(cat "$T/out")" = "02-drop-second.patch" ]'
run --list-paths
check "--list-paths prints every path the patches touch" \
  '[ "$(cat "$T/out")" = "$(printf "packages/db/src/a.ts\npackages/db/src/b.ts")" ]'
run --shard 2/2; check "--shard out of range: exit 1" '[ "$(code)" = 1 ] && out_has "--shard takes i/n"'
mode red-right; run --only nomatch
check "a selection with no patch: exit 1, vacuous" '[ "$(code)" = 1 ] && out_has "no patch matches"'

setup; mode red-right; mkdir -p "$T/reports"
run --shard 0/2 --report "$T/reports/0.json"; c0="$(code)"
run --shard 1/2 --report "$T/reports/1.json"; c1="$(code)"
check "each shard runs its own patches and writes its report" '[ "$c0" = 0 ] && [ "$c1" = 0 ] && [ -s "$T/reports/0.json" ] && [ -s "$T/reports/1.json" ]'
check "…and the patched files are byte-identical afterwards" 'both_original'
run --verify-reports "$T/reports"
check "--verify-reports: two shards, every patch once: exit 0" '[ "$(code)" = 0 ] && out_has "2 shards ran all 2 patches"'
rm "$T/reports/1.json"; run --verify-reports "$T/reports"
check "--verify-reports: a missing shard: exit 1, names the patch never run" '[ "$(code)" = 1 ] && out_has "never run: 02-drop-second.patch"'
printf '%s\n' '{"index":1,"total":2,"patches":["01-drop-scope.patch"]}' >"$T/reports/1.json"
run --verify-reports "$T/reports"
check "--verify-reports: a patch run twice: exit 1" '[ "$(code)" = 1 ] && out_has "run more than once: 01-drop-scope.patch"'

# ── More report and flag cases (review of #675) ────────────────────────────────────────────────
setup; mkdir -p "$T/r"
printf '%s\n' '{"index":0,"total":2,"patches":["01-drop-scope.patch","02-drop-second.patch"]}' >"$T/r/a.json"
printf '%s\n' '{"index":0,"total":2,"patches":[]}' >"$T/r/b.json"
run --verify-reports "$T/r"
check "--verify-reports: one shard reported twice, the other never: exit 1" '[ "$(code)" = 1 ] && out_has "shards reported: [0,0]"'
printf '%s\n' '{"index":1,"total":3,"patches":[]}' >"$T/r/b.json"
run --verify-reports "$T/r"
check "--verify-reports: reports disagree on the shard count: exit 1" '[ "$(code)" = 1 ] && out_has "disagree on the shard count"'
printf '%s\n' '{"index":1,"total":2,"patches":["99-gone.patch"]}' >"$T/r/b.json"
run --verify-reports "$T/r"
check "--verify-reports: a patch that is not committed: exit 1" '[ "$(code)" = 1 ] && out_has "not a committed patch: 99-gone.patch"'
mkdir -p "$T/empty"; run --verify-reports "$T/empty"
check "--verify-reports: no reports at all: exit 1" '[ "$(code)" = 1 ] && out_has "no shard reports were found"'
run --verify-reports "$T/missing"
check "--verify-reports: a missing directory: exit 1" '[ "$(code)" = 1 ]'
run --shard 1/0; check "--shard 1/0: exit 1" '[ "$(code)" = 1 ] && out_has "--shard takes i/n"'
run --shard x/y; check "--shard x/y: exit 1" '[ "$(code)" = 1 ] && out_has "--shard takes i/n"'

# A lock written by the runner before DX-18 PR 2 ({pid, startedAt}, no holders) by a LIVE process.
setup; mode red-right
printf '{"pid":%s,"startedAt":"2026-11-18T00:00:00Z"}' "$$" >"$GITDIR/mat-plan-mutations.lock"
MAT_PLAN_HEAVY_SLOT=off node "$R/packages/db/scripts/mutations.mjs" >"$T/out" 2>&1; c=$?
check "an older runner's live lock is held, not stolen: exit 1" '[ "$c" = 1 ] && out_has "in flight in this worktree" && both_original'
rm -f "$GITDIR/mat-plan-mutations.lock"

echo
echo "mutations.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
