#!/usr/bin/env bash
# Self-test for check-snapshot-chain.mjs. Each case writes a small synthetic meta/ (only `id` and
# `prevId` matter), except "the real meta/", which reads the committed one in place.
# Plan: docs/plans/dx-snapshot-chain-script.md.
#
#   bash .github/scripts/check-snapshot-chain.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
guard="$here/check-snapshot-chain.mjs"
root="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

# expect <name> <dir> <exit> <text> [<text>...] — every text must appear in the output.
expect() {
  local name="$1" dir="$2" want="$3"
  shift 3
  out="$(node "$guard" --dir "$dir" 2>&1)"
  code=$?
  local missing=''
  for t in "$@"; do grep -qF -- "$t" <<<"$out" || missing="$missing [$t]"; done
  if [ "$code" -ne "$want" ] || [ -n "$missing" ]; then
    printf '✗ %s: want exit %s, got %s; missing:%s\n%s\n' "$name" "$want" "$code" "${missing:- none}" "$out"
    [ -n "${GITHUB_ACTIONS:-}" ] && printf '::error::check-snapshot-chain self-test: %s (want exit %s, got %s)\n' "$name" "$want" "$code"
    fails=$((fails + 1))
  else printf '✓ %s\n' "$name"; fi
}

# meta <case> <name>=<id>:<prevId> ... — writes one snapshot file per argument.
meta() {
  local d="$tmp/$1"
  shift
  mkdir -p "$d"
  for spec in "$@"; do
    local file="${spec%%=*}" ids="${spec#*=}"
    node -e 'require("fs").writeFileSync(process.argv[1], JSON.stringify({ id: process.argv[2], prevId: process.argv[3], dialect: "postgresql" }))' \
      "$d/$file" "${ids%%:*}" "${ids#*:}"
  done
  printf '%s' "$d"
}
Z=00000000-0000-0000-0000-000000000000

expect 'the real meta/ (with the 0018 gap)' "$root/packages/db/migrations/meta" 0 'Snapshot chain OK'

d="$(meta gap 0000_snapshot.json=a:$Z 0001_snapshot.json=b:a 0003_snapshot.json=c:b)"
expect 'a gap in the numbering' "$d" 0 'Snapshot chain OK — 3 snapshot(s)'

d="$(meta broken 0000_snapshot.json=a:$Z 0001_snapshot.json=b:a 0002_snapshot.json=c:a)"
expect 'a broken link' "$d" 1 '"0002_snapshot.json": prevId="a", expected "b"' 'Regenerate on top of main'

# On 0000 there is no snapshot before it, so ONLY the self-reference check can fail this case.
d="$(meta self0 0000_snapshot.json=a:a 0001_snapshot.json=b:a)"
expect 'a self-reference on 0000' "$d" 1 '"0000_snapshot.json": prevId === id (self-referential)'

# The #139 shape: a later snapshot whose prevId is its own id breaks both checks.
d="$(meta s139 0000_snapshot.json=a:$Z 0001_snapshot.json=b:b)"
expect 'the #139 shape' "$d" 1 '"0001_snapshot.json": prevId="b", expected "a"' '"0001_snapshot.json": prevId === id (self-referential)'

mkdir -p "$tmp/empty"
expect 'no snapshots' "$tmp/empty" 2 'no *_snapshot.json'
expect 'no directory' "$tmp/does-not-exist" 2 'cannot read the directory'

d="$(meta badname 0000_snapshot.json=a:$Z 00010_snapshot.json=b:a)"
expect 'a name without four digits' "$d" 2 'not named NNNN_snapshot.json: "00010_snapshot.json"'

d="$(meta malformed 0000_snapshot.json=a:$Z)"
printf '{ not json' >"$d/0001_snapshot.json"
expect 'malformed JSON' "$d" 2 '"0001_snapshot.json" is not readable JSON'

d="$(meta nullbody 0000_snapshot.json=a:$Z)"
printf 'null' >"$d/0001_snapshot.json"
expect 'a null body' "$d" 2 '"0001_snapshot.json" is not an object'

d="$(meta noid 0000_snapshot.json=a:$Z)"
printf '{"prevId":"a"}' >"$d/0001_snapshot.json"
expect 'a missing id' "$d" 2 '"0001_snapshot.json" is not an object'

d="$(meta noprev 0000_snapshot.json=a:$Z)"
printf '{"id":"b"}' >"$d/0001_snapshot.json"
expect 'a missing prevId' "$d" 2 '"0001_snapshot.json" is not an object'

d="$(meta numid 0000_snapshot.json=a:$Z)"
printf '{"id":5,"prevId":"a"}' >"$d/0001_snapshot.json"
expect 'a non-string id' "$d" 2 '"0001_snapshot.json" is not an object'

# A value that would be a workflow command if printed raw reaches the log only quoted: the case is
# reported as a broken link with the value escaped, and no line of the output starts with it.
d="$(meta inject 0000_snapshot.json=a:$Z)"
printf '{"id":"b","prevId":"x\\n::error::forged"}' >"$d/0001_snapshot.json"
expect 'a value is printed escaped' "$d" 1 'prevId="x\n::error::forged"'
if grep -q '^::error::forged' <<<"$out"; then
  printf '✗ a value cannot become a workflow command\n%s\n' "$out"
  fails=$((fails + 1))
else printf '✓ a value cannot become a workflow command\n'; fi

# The sort: APFS lists names in order, so on macOS no case here can catch a missing sort. On the
# Linux runner, ext4 lists them in hash order, and "the real meta/" case above is what catches it.

if [ "$fails" -gt 0 ]; then
  echo "check-snapshot-chain self-test: $fails failure(s)"
  exit 1
fi
echo 'check-snapshot-chain self-test: all passed'
