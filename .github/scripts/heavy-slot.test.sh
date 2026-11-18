#!/usr/bin/env bash
# Self-test for heavy-slot.mjs and pid-lock.mjs (DX-18 D3; plan: docs/plans/dx-18-heavy-runs-to-ci.md).
#
# Every case points MAT_PLAN_HEAVY_SLOT_PATH at a throwaway dir, so it never takes, steals or deletes
# a live slot. CI is unset so the slot is exercised rather than skipped. It stops only the processes
# it started, by the pid it captured.
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
SLOT="$HERE/heavy-slot.mjs"
LOCKLIB="$HERE/pid-lock.mjs"
unset CI GITHUB_ACTIONS MAT_PLAN_HEAVY_SLOT MAT_PLAN_HEAVY_SLOTS MAT_PLAN_HEAVY_SLOT_HELD
T="$(mktemp -d)"
export MAT_PLAN_HEAVY_SLOT_PATH="$T/slot.json"
pass=0
fail=0
pids=()
# Each tracked pid is stored with its start time, and cleanup stops it only while that still matches:
# a pid reused by another lane's process on this shared machine is never signalled.
# The same pinned environment pid-lock.mjs uses, so the two agree on a start time.
start_of() { TZ=UTC LC_ALL=C LANG=C ps -o lstart= -p "$1" 2>/dev/null | sed 's/^ *//;s/ *$//'; }
track() { pids+=("$1|$(start_of "$1")"); }
# SIGKILL <pid> only while it is still the process that started at <start>.
own_kill() { [ -n "$2" ] && [ "$(start_of "$1")" = "$2" ] && kill -9 "$1" 2>/dev/null; return 0; }
cleanup() {
  for entry in "${pids[@]:-}"; do
    [ -n "$entry" ] || continue
    p="${entry%%|*}"
    [ -n "${entry#*|}" ] && [ "$(start_of "$p")" = "${entry#*|}" ] && kill -9 "$p" 2>/dev/null
  done
  rm -rf "$T"
}
trap cleanup EXIT

ok() { pass=$((pass + 1)); echo "✓ $1"; }
no() { fail=$((fail + 1)); echo "✗ $1"; }
check() { if eval "$2"; then ok "$1"; else no "$1"; fi; }
gone() { [ ! -e "$MAT_PLAN_HEAVY_SLOT_PATH" ]; }
wait_for() { for _ in $(seq 1 100); do eval "$1" && return 0; sleep 0.05; done; return 1; }
field() { node -e 'const l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(eval("l."+process.argv[2]))' "$MAT_PLAN_HEAVY_SLOT_PATH" "$1"; }
# A lock whose single holder is <pid> with start time <start>.
plant() {
  printf '{"pid":%s,"lane":"planted","command":"planted run","startedAt":"then","holders":[{"pid":%s,"start":"%s"}]}' \
    "$1" "$1" "$2" >"$MAT_PLAN_HEAVY_SLOT_PATH"
}
# Hold the slot in the background with the wrapper; sets HOLDER to the wrapper's pid.
hold() {
  node "$SLOT" -- sleep 30 >"$T/hold.out" 2>&1 &
  HOLDER=$!
  track "$HOLDER"
  wait_for '[ -e "$MAT_PLAN_HEAVY_SLOT_PATH" ] && [ "$(field "holders.length" 2>/dev/null)" = 2 ]' ||
    no "the wrapper took the slot and recorded its child"
  CHILD="$(field 'holders[1].pid')"
  CHILD_START="$(field 'holders[1].start')"
  track "$CHILD"
}
stop_holder() {
  kill -TERM "$HOLDER" 2>/dev/null
  wait "$HOLDER" 2>/dev/null
  own_kill "$CHILD" "$CHILD_START"
  rm -f "$MAT_PLAN_HEAVY_SLOT_PATH"
}

# ── The wrapper ─────────────────────────────────────────────────────────────────────────────────
node "$SLOT" -- sh -c 'exit 7' >"$T/out" 2>&1
code=$?
check "the wrapper passes the command's exit code through" '[ "$code" = 7 ]'
check "…and frees the slot when it ends" gone

node "$SLOT" >"$T/out" 2>&1
code=$?
check "no command: usage, exit 64" '[ "$code" = 64 ] && grep -qF usage "$T/out"'

node "$SLOT" -- sh -c 'test "$MAT_PLAN_HEAVY_SLOT_HELD" = "$PPID"' >"$T/out" 2>&1
code=$?
check "the child sees HELD = the wrapper's pid" '[ "$code" = 0 ]'

# ── Busy ────────────────────────────────────────────────────────────────────────────────────────
hold
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "a second run while the slot is held: exit 2" '[ "$code" = 2 ]'
check "…naming the holder's lane and command" 'grep -qF "heavy-run slot held by" "$T/out" && grep -qF "(sleep 30, since" "$T/out" && grep -qF "Push and let CI gate it, or wait." "$T/out"'
check "…and leaves the holder's lock alone" '[ "$(field pid)" = "$HOLDER" ]'

# ── Nesting ─────────────────────────────────────────────────────────────────────────────────────
MAT_PLAN_HEAVY_SLOT_HELD=12345 node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "a stray HELD that is not the live lock's pid does not count" '[ "$code" = 2 ]'
stop_holder
node "$SLOT" -- node "$SLOT" -- sh -c 'exit 0' >"$T/out" 2>&1
code=$?
check "a run under the wrapper (HELD matches) is not refused" '[ "$code" = 0 ]'
check "…and the slot is free afterwards" gone

# ── Bypass and CI ───────────────────────────────────────────────────────────────────────────────
hold
MAT_PLAN_HEAVY_SLOT=off node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "MAT_PLAN_HEAVY_SLOT=off runs while the slot is held" '[ "$code" = 0 ] && grep -qF "skipped" "$T/out"'
CI=1 node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "under CI it does nothing" '[ "$code" = 0 ]'
GITHUB_ACTIONS=true node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "under GITHUB_ACTIONS it does nothing" '[ "$code" = 0 ]'
for off in false 0 FALSE; do
  CI="$off" node "$SLOT" -- true >"$T/out" 2>&1
  [ $? = 2 ] || no "CI=$off still takes the slot"
done
check "CI=false, 0 or FALSE does not turn the slot off" '[ "$(field pid)" = "$HOLDER" ]'
CI=1 node "$SLOT" -- true >"$T/out" 2>&1
check "skipping under CI says so" 'grep -qF "skipped (CI)" "$T/out"'
check "…and neither touched the holder's lock" '[ "$(field pid)" = "$HOLDER" ]'

# ── A dead wrapper with a live child ────────────────────────────────────────────────────────────
kill -9 "$HOLDER"
wait "$HOLDER" 2>/dev/null
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "the wrapper killed with -9 while its child runs: still held" '[ "$code" = 2 ]'
own_kill "$CHILD" "$CHILD_START"
wait_for '! kill -0 "$CHILD" 2>/dev/null'
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "…and once the child is gone too, the stale lock is taken over" '[ "$code" = 0 ] && gone'

# ── Signals ─────────────────────────────────────────────────────────────────────────────────────
hold
kill -TERM "$HOLDER"
wait "$HOLDER" 2>/dev/null
code=$?
check "SIGTERM to the wrapper: it dies by the same signal (143)" '[ "$code" = 143 ]'
check "…its child's group is ended" 'wait_for "! kill -0 $CHILD 2>/dev/null"'
check "…and the slot is freed" gone

# ── More than one slot (MAT_PLAN_HEAVY_SLOTS) ───────────────────────────────────────────────────
SLOT2="${MAT_PLAN_HEAVY_SLOT_PATH%.json}.2.json"
hold
node "$SLOT" -- true >"$T/out" 2>&1
check "the busy message gives the load average and the override" 'grep -qF "load average" "$T/out" && grep -qF "MAT_PLAN_HEAVY_SLOTS=<n>" "$T/out"'
MAT_PLAN_HEAVY_SLOTS=2 node "$SLOT" -- sh -c 'test -e "$0"' "$SLOT2" >"$T/out" 2>&1
code=$?
check "MAT_PLAN_HEAVY_SLOTS=2: a second run takes slot 2 while slot 1 is held" '[ "$code" = 0 ]'
check "…and frees slot 2 when it ends, leaving slot 1 alone" '[ ! -e "$SLOT2" ] && [ "$(field pid)" = "$HOLDER" ]'
MAT_PLAN_HEAVY_SLOTS=2 node "$SLOT" -- sleep 30 >"$T/hold2.out" 2>&1 &
HOLDER2=$!
track "$HOLDER2"
wait_for '[ -e "$SLOT2" ]' || no "the second holder took slot 2"
MAT_PLAN_HEAVY_SLOTS=2 node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "…a third run with both held: exit 2, naming both holders" '[ "$code" = 2 ] && grep -qF "all 2 heavy-run slots held by" "$T/out" && [ "$(grep -o "sleep 30" "$T/out" | wc -l | tr -d " ")" = 2 ]'
MAT_PLAN_HEAVY_SLOTS=2 MAT_PLAN_HEAVY_SLOT_HELD="$HOLDER2" node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "…a run under slot 2's holder is nested, not refused" '[ "$code" = 0 ]'
kill -TERM "$HOLDER2"
wait "$HOLDER2" 2>/dev/null
check "…and slot 2's holder frees it when stopped" 'wait_for "[ ! -e $SLOT2 ]"'
stop_holder
# ── The machine file (heavy-slots beside the lock) ──────────────────────────────────────────────
COUNTFILE="$(dirname "$MAT_PLAN_HEAVY_SLOT_PATH")/heavy-slots"
hold
echo 2 >"$COUNTFILE"
node "$SLOT" -- sh -c 'test -e "$0"' "$SLOT2" >"$T/out" 2>&1
code=$?
check "the machine file allows a second run with no env var set" '[ "$code" = 0 ] && [ ! -e "$SLOT2" ]'
MAT_PLAN_HEAVY_SLOTS=1 node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "…and MAT_PLAN_HEAVY_SLOTS still wins over it" '[ "$code" = 2 ]'
printf '\n' >"$COUNTFILE"
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "an empty machine file means the default of 1" '[ "$code" = 2 ]'
echo lots >"$COUNTFILE"
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "a machine file that is not 1 to 16 is refused, naming the file" '[ "$code" = 64 ] && grep -qF "heavy-slots must be a whole number" "$T/out"'
rm -f "$COUNTFILE"
stop_holder
# Lowered mid-run: a run holding slot 2 keeps going when the file drops to 1.
echo 2 >"$COUNTFILE"
hold
node "$SLOT" -- sh -c 'sleep 1; MAT_PLAN_HEAVY_SLOT_HELD="$MAT_PLAN_HEAVY_SLOT_HELD" node "$0" -- true' "$SLOT" >"$T/out" 2>&1 &
lowered=$!
track "$lowered"
wait_for '[ -e "$SLOT2" ]'
echo 1 >"$COUNTFILE"
wait "$lowered"
code=$?
check "lowering the file mid-run does not fail a step of a run already holding slot 2" '[ "$code" = 0 ]'
mkdir "$COUNTFILE.d" 2>/dev/null; rm -f "$COUNTFILE"; mv "$COUNTFILE.d" "$COUNTFILE"
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "an unreadable machine file is refused with a message, not a stack" '[ "$code" = 64 ] && grep -qF "could not read" "$T/out"'
rmdir "$COUNTFILE"
stop_holder

for bad in 0 -1 two 1.5 17; do
  MAT_PLAN_HEAVY_SLOTS="$bad" node "$SLOT" -- true >"$T/out" 2>&1
  [ $? = 64 ] || no "MAT_PLAN_HEAVY_SLOTS=$bad is refused"
done
check "a slot count that is not 1 to 16 is refused (exit 64)" 'grep -qF "must be a whole number" "$T/out" && gone'

# ── Time zone and pass-through signals ──────────────────────────────────────────────────────────
TZ=UTC node "$SLOT" -- sleep 30 >"$T/hold.out" 2>&1 &
HOLDER=$!
track "$HOLDER"
wait_for '[ -e "$MAT_PLAN_HEAVY_SLOT_PATH" ] && [ "$(field "holders.length" 2>/dev/null)" = 2 ]'
CHILD="$(field 'holders[1].pid')"
CHILD_START="$(field 'holders[1].start')"
TZ=Asia/Tokyo node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "a holder started under TZ=UTC still holds against a taker under TZ=Asia/Tokyo" '[ "$code" = 2 ]'
stop_holder

MAT_PLAN_HEAVY_SLOT=off node "$SLOT" -- sleep 30 >"$T/out" 2>&1 &
bypassed=$!
track "$bypassed"
sleep 0.5
kill -TERM "$bypassed"
wait "$bypassed" 2>/dev/null
code=$?
check "SIGTERM to a bypassed wrapper reaches its child: 143" '[ "$code" = 143 ]'

# ── The steal guard ─────────────────────────────────────────────────────────────────────────────
sh -c 'exit 0' &
gone_pid=$!
wait "$gone_pid"
plant "$gone_pid" "Mon Jan  1 00:00:00 2024"
printf '{"pid":%s,"holders":[{"pid":%s,"start":"%s"}]}' "$$" "$$" "$(start_of $$)" >"$MAT_PLAN_HEAVY_SLOT_PATH.steal"
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "a stale lock under a LIVE steal guard is not cleared by another taker" '[ "$code" != 0 ] && grep -qF planted "$MAT_PLAN_HEAVY_SLOT_PATH"'
printf '{"pid":%s,"holders":[{"pid":%s,"start":"then"}]}' "$gone_pid" "$gone_pid" >"$MAT_PLAN_HEAVY_SLOT_PATH.steal"
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "a guard left by a dead stealer is broken, and the stale lock taken" '[ "$code" = 0 ] && gone && [ ! -e "$MAT_PLAN_HEAVY_SLOT_PATH.steal" ]'

# ── A runner under the slot (runUnderSlot: e2e:local, screenshot:ephemeral) ─────────────────────
cat >"$T/runner.mjs" <<EOF
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { runUnderSlot } from '$SLOT';
if (!runUnderSlot('test runner')) {
  const c = spawn('sleep', ['30'], { stdio: 'ignore' });
  writeFileSync(process.env.RUNNER_OUT, process.pid + ' ' + c.pid);
  c.on('close', () => process.exit(0));
}
EOF
RUNNER_OUT="$T/runner.out" node "$T/runner.mjs" >"$T/runner.log" 2>&1 &
outer=$!
track "$outer"
wait_for '[ -s "$T/runner.out" ] && [ "$(field "holders.length" 2>/dev/null)" = 2 ]' || no "the runner re-ran under the wrapper"
read -r inner kid <"$T/runner.out"
inner_start="$(start_of "$inner")"
kid_start="$(start_of "$kid")"
track "$inner"
track "$kid"
check "a runner re-runs itself under the wrapper, labelled with its command" '[ "$(field command)" = "test runner" ] && [ "$(field "holders[1].pid")" = "$inner" ]'
RUNNER_OUT="$T/r2.out" node "$T/runner.mjs" >"$T/out" 2>&1
code=$?
check "a second runner while the slot is held: exit 2" '[ "$code" = 2 ] && [ ! -e "$T/r2.out" ]'
own_kill "$inner" "$inner_start"
sleep 0.5
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "the runner killed with -9 while its child runs: the slot stays held" '[ "$code" = 2 ]'
own_kill "$kid" "$kid_start"
wait "$outer" 2>/dev/null
check "…and is freed once the child has exited too" 'wait_for gone'

# runUnderSlot passes arguments and the exit code through, and a SIGTERM to the outer pid ends it.
cat >"$T/runner2.mjs" <<EOF
import { runUnderSlot } from '$SLOT';
if (!runUnderSlot('test runner 2')) {
  console.log(JSON.stringify(process.argv.slice(2)));
  if (process.argv[2] === 'hang') setTimeout(() => {}, 30000);
  else process.exit(Number(process.argv[2]));
}
EOF
node "$T/runner2.mjs" 7 "a b" -- --x >"$T/out" 2>&1
code=$?
check "a runner's arguments and exit code pass through the re-run" '[ "$code" = 7 ] && grep -qF '"'"'["7","a b","--","--x"]'"'"' "$T/out" && gone'
node "$T/runner2.mjs" hang >"$T/out" 2>&1 &
outer2=$!
track "$outer2"
wait_for '[ -e "$MAT_PLAN_HEAVY_SLOT_PATH" ] && [ "$(field "holders.length" 2>/dev/null)" = 2 ]'
kill -TERM "$outer2"
wait "$outer2" 2>/dev/null
code=$?
check "SIGTERM to the runner's own pid ends the run and frees the slot" '[ "$code" = 143 ] && wait_for gone'

# A leftover that ignores TERM: the busy message names its group, and a Ctrl-C to the waiting wrapper ends it.
cat >"$T/runner3.mjs" <<EOF
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { runUnderSlot } from '$SLOT';
if (!runUnderSlot('test runner 3')) {
  const c = spawn('sh', ['-c', "trap '' TERM INT HUP; sleep 30"], { stdio: 'ignore' });
  writeFileSync(process.env.RUNNER_OUT, process.pid + ' ' + c.pid);
  setTimeout(() => {}, 30000);
}
EOF
rm -f "$T/runner3.out"
RUNNER_OUT="$T/runner3.out" node "$T/runner3.mjs" >"$T/runner3.log" 2>&1 &
outer3=$!
track "$outer3"
wait_for '[ -s "$T/runner3.out" ] && [ "$(field "holders.length" 2>/dev/null)" = 2 ]'
read -r inner3 kid3 <"$T/runner3.out"
wrapper3="$(field pid)"
group3="$(field 'holders[1].pid')"
track "$inner3"
track "$kid3"
own_kill "$inner3" "$(start_of "$inner3")"
wait_for 'grep -qF "waiting for the run" "$T/runner3.log"'
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "a busy slot held only by leftovers names their group and how to end it" '[ "$code" = 2 ] && grep -qF "kill -TERM -- -$group3" "$T/out"'
check "…and the waiting wrapper says which group it waits for" 'grep -qF "(group $group3)" "$T/runner3.log"'
kill -INT "$wrapper3"
wait "$outer3" 2>/dev/null
check "Ctrl-C to a waiting wrapper ends the leftovers and frees the slot" 'wait_for gone && ! kill -0 "$kid3" 2>/dev/null'

hold
kill -TSTP "$HOLDER"
sleep 0.3
check "Ctrl-Z (SIGTSTP) to a wrapper holding the slot: it is not stopped" '! ps -o stat= -p "$HOLDER" | grep -q T && grep -qF "Ctrl-Z is held" "$T/hold.out"'
stop_holder

# ── Stale and reused pids ───────────────────────────────────────────────────────────────────────
sh -c 'exit 0' &
dead=$!
wait "$dead"
plant "$dead" "Mon Jan  1 00:00:00 2024"
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "a lock whose holder is gone is taken over" '[ "$code" = 0 ] && gone'

plant "$$" "Mon Jan  1 00:00:00 2024"
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "a live pid with a different start time (reused) counts as dead" '[ "$code" = 0 ] && gone'

plant "$$" "$(start_of $$)"
node -e 'const fs=require("fs"),p=process.env.MAT_PLAN_HEAVY_SLOT_PATH,l=JSON.parse(fs.readFileSync(p,"utf8"));l.lane="x\u009b31m\u202ey";fs.writeFileSync(p,JSON.stringify(l))'
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "a live pid with its recorded start time holds" '[ "$code" = 2 ] && grep -qF "held by x31my (" "$T/out"'
check "…and the holder's C1 and bidi control characters are stripped" '! LC_ALL=C grep -q "$(printf "\xc2\x9b")" "$T/out"'
rm -f "$MAT_PLAN_HEAVY_SLOT_PATH"

printf 'not json' >"$MAT_PLAN_HEAVY_SLOT_PATH"
node "$SLOT" -- true >"$T/out" 2>&1
code=$?
check "an unreadable lock is treated as stale" '[ "$code" = 0 ] && gone'

# ── Release never removes someone else's lock ───────────────────────────────────────────────────
cat >"$T/release.mjs" <<EOF
import { acquire, holder, release, readLock } from '$LOCKLIB';
const path = process.env.MAT_PLAN_HEAVY_SLOT_PATH;
const mine = { pid: process.pid, holders: [holder(process.pid)] };
if (!acquire(path, mine).held) process.exit(3);
const { writeFileSync } = await import('node:fs');
writeFileSync(path, JSON.stringify({ pid: 1, holders: [{ pid: 1, start: 'other' }] }));
release(path, mine);
process.exit(readLock(path) === null ? 4 : 0);
EOF
node "$T/release.mjs"
code=$?
check "release() leaves a lock that is no longer ours" '[ "$code" = 0 ]'
rm -f "$MAT_PLAN_HEAVY_SLOT_PATH"

# ── Two takers racing ───────────────────────────────────────────────────────────────────────────
# Each taker waits for the same start file, then tries once; a winner holds for 1s. Even trials plant
# a stale lock first, so the stale-clear path races too (it found a double hold in the first design).
cat >"$T/racer.mjs" <<EOF
import { existsSync } from 'node:fs';
import { acquire, holder } from '$LOCKLIB';
const path = process.env.MAT_PLAN_HEAVY_SLOT_PATH;
while (!existsSync(process.argv[2])) {}
const r = acquire(path, { pid: process.pid, holders: [holder(process.pid)] });
console.log(r.held ? 'HELD' : 'BUSY');
if (r.held) await new Promise((res) => setTimeout(res, 1000));
EOF
bad=0
for trial in $(seq 1 20); do
  rm -f "$MAT_PLAN_HEAVY_SLOT_PATH" "$T/go"
  [ $((trial % 2)) = 0 ] && plant "$dead" "Mon Jan  1 00:00:00 2024"
  racers=()
  for n in 1 2 3; do
    node "$T/racer.mjs" "$T/go" >"$T/out.race.$n" 2>&1 &
    racers+=("$!")
  done
  for r in "${racers[@]}"; do track "$r"; done
  sleep 0.3
  touch "$T/go"
  for r in "${racers[@]}"; do wait "$r" 2>/dev/null; done
  held="$(cat "$T"/out.race.* | grep -c HELD)"
  [ "$held" = 1 ] || { bad=$((bad + 1)); echo "  trial $trial: $held holders"; }
done
check "three takers racing, 20 trials (half over a stale lock): exactly one holds each time" '[ "$bad" = 0 ]'

echo
echo "heavy-slot.test.sh: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
