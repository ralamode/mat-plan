#!/usr/bin/env bash
# Self-test for probe.mjs: a throwaway repo per case, asserting the exit code and the message.
# Mirrors .github/scripts/check-feature-guides.test.sh.
#
# 🔴 WHY THIS FILE EXISTS, and case 6 is the whole reason. The rule "a probe must not eat uncommitted
# work" has been in docs/lessons.md since #367 and was violated three more times in one session, each
# time by an ad-hoc `git checkout -- <file>`. Case 6 is that exact scenario: a file holding
# uncommitted work is probed with --allow-dirty, and the work must come BACK. If it ever does not,
# this fails rather than a session silently losing an afternoon.
#
#   bash .github/scripts/probe.test.sh
set -uo pipefail

probe="$(cd "$(dirname "$0")" && pwd)/probe.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

git -C "$tmp" init -q -b main
git -C "$tmp" config user.email t@t && git -C "$tmp" config user.name t
# `ok.sh` exits 0 when `KEEP` is present and 1 when it is not — a stand-in for a gate that catches a
# mutation, with a distinctive message so --expect has something real to match.
printf 'export const value = "KEEP";\n' >"$tmp/src.js"
printf '#!/bin/sh\ngrep -q KEEP "$(dirname "$0")/src.js" || { echo "GATE SAYS NO"; exit 1; }\n' >"$tmp/gate.sh"
chmod +x "$tmp/gate.sh"
git -C "$tmp" add -A && git -C "$tmp" commit -qm init

# run <name> <expected exit> <expected substring> -- <probe args...>
run() {
  local name="$1" wantCode="$2" wantText="$3"
  shift 4
  local out code
  out="$(cd "$tmp" && node "$probe" "$@" 2>&1)"
  code=$?
  if [ "$code" != "$wantCode" ] || ! printf '%s' "$out" | grep -qF "$wantText"; then
    printf '✗ %s: want exit %s + "%s", got exit %s\n%s\n' "$name" "$wantCode" "$wantText" "$code" "$out"
    fails=$((fails + 1))
  else
    printf '✓ %s\n' "$name"
  fi
}

# 1 · the happy path: the gate catches the mutation and names its reason
run 'RED for the named reason passes' 0 'probe: RED' -- \
  --file src.js --from KEEP --to GONE --gate ./gate.sh --expect 'GATE SAYS NO'

# 2 · the gap: the gate does not care
printf '#!/bin/sh\nexit 0\n' >"$tmp/blind.sh" && chmod +x "$tmp/blind.sh"
git -C "$tmp" add -A && git -C "$tmp" commit -qm blind
run 'GREEN is reported as a defect, not a pass' 1 'THE ASSERTION CANNOT FAIL' -- \
  --file src.js --from KEEP --to GONE --gate ./blind.sh --expect 'GATE SAYS NO'

# 3 · red, but for another reason — the "wrong cause" case
run 'RED without the expected text is not a pass' 1 'NOT FOR THE NAMED REASON' -- \
  --file src.js --from KEEP --to GONE --gate ./gate.sh --expect 'SOMETHING ELSE'

# 4 · DID-NOT-RUN is its own outcome, never a gap
run 'a gate that cannot run is DID-NOT-RUN' 1 'Nothing was proved' -- \
  --file src.js --from KEEP --to GONE --gate ./no-such-command-here --expect x

# 5 · an ambiguous target changes nothing
printf 'const a = "X";\nconst b = "X";\n' >"$tmp/two.js"
git -C "$tmp" add -A && git -C "$tmp" commit -qm two
run 'an ambiguous --from aborts' 1 'exactly once' -- \
  --file two.js --from '"X"' --to '"Y"' --gate ./gate.sh --expect x
if [ "$(cd "$tmp" && git status --porcelain two.js)" != "" ]; then
  printf '✗ an ambiguous --from must change NOTHING\n'
  fails=$((fails + 1))
else
  printf '✓ an ambiguous --from leaves the file untouched\n'
fi

# 6 · 🔴 THE CASE THIS FILE EXISTS FOR: uncommitted work in the probed file SURVIVES.
printf 'export const value = "KEEP";\nexport const precious = "UNCOMMITTED WORK";\n' >"$tmp/src.js"
run 'a dirty file is refused by default' 1 'has uncommitted changes' -- \
  --file src.js --from KEEP --to GONE --gate ./gate.sh --expect 'GATE SAYS NO'
run 'with --allow-dirty the probe runs' 0 'probe: RED' -- \
  --file src.js --from KEEP --to GONE --gate ./gate.sh --expect 'GATE SAYS NO' --allow-dirty
if ! grep -q 'UNCOMMITTED WORK' "$tmp/src.js"; then
  printf '✗ 🔴 THE UNCOMMITTED WORK WAS LOST — the restore read HEAD instead of the snapshot\n'
  fails=$((fails + 1))
else
  printf '✓ 🔴 uncommitted work in the probed file survived the probe\n'
fi

# 7 · and the refusal must not have been destructive either
if ! grep -q 'UNCOMMITTED WORK' "$tmp/src.js"; then
  printf '✗ the refusal path touched the file\n'
  fails=$((fails + 1))
else
  printf '✓ the refusal path touched nothing\n'
fi

# 8 · the stash STACK is never used — several worktrees share it
if [ "$(cd "$tmp" && git stash list | wc -l | tr -d ' ')" != "0" ]; then
  printf '✗ the probe pushed onto the stash stack; `git stash create` must write a bare commit\n'
  fails=$((fails + 1))
else
  printf '✓ the stash stack is untouched\n'
fi

if [ "$fails" != "0" ]; then
  printf '\n%s probe self-test(s) failed\n' "$fails"
  exit 1
fi
printf 'all probe self-tests passed\n'
