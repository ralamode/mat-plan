#!/usr/bin/env bash
# Self-test for test-changed.mjs: what the pre-push hook selects for a change (DX-18 D4).
#
# 🔴 It NEVER runs vitest. Every case uses --dry-run, which prints the selection and spawns nothing,
# in a throwaway repo laid out like this one. The last cases read the real repo, also dry.
#
#   bash .github/scripts/test-changed.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
script="$here/test-changed.mjs"
real="$(cd "$here/../.." && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0
ok() { printf '✓ %s\n' "$1"; }
bad() { printf '✗ %s\n%s\n' "$1" "${2:-}"; fails=$((fails + 1)); }

repo="$tmp/repo"
g() { git -C "$repo" "$@"; }
mkdir -p "$repo" && g init -q -b main && g config user.email t@t && g config user.name t
put() { mkdir -p "$(dirname "$repo/$1")" && printf '%s\n' "$2" >"$repo/$1"; }
# The required scanners, each reading the filesystem as the real ones do.
for f in apps/web/app/pages-need-a-session.test.ts apps/web/app/tenancy-is-not-cached.test.ts \
  apps/web/test/bypass-is-contained.test.ts packages/db/src/writers/no-bare-unhide.test.ts \
  apps/web/lib/privacy/notice-content.test.ts; do
  put "$f" "import { globSync, readFileSync } from 'node:fs';"
done
put packages/shared/src/units.ts 'export const UNITS = ["kg"];'
put packages/shared/src/units.test.ts "import { UNITS } from './units';"
put apps/web/app/layout.tsx 'export default function Layout() {}'
put docs/guide.md '# guide'
put docs/privacy/notice.md '# notice'
put pnpm-lock.yaml 'lockfileVersion: 9'
g add -A && g commit -qm 'chore: base'
g update-ref refs/remotes/origin/main HEAD

# dry <ref-to-reset-to-or-empty> -> selection on stdout. Each case starts from a clean base.
reset() { g reset -q --hard origin/main && g clean -qfd; }
dry() { (cd "$repo" && GITHUB_ACTIONS= node "$script" --base origin/main --dry-run 2>&1); }
has() { printf '%s' "$1" | grep -qxF "$2"; }

reset
put packages/shared/src/units.ts 'export const UNITS = ["kg", "lb"];'
g commit -qam 'feat: lb'
out="$(dry)"
if has "$out" 'mode: changed' && has "$out" 'traced: packages/shared/src/units.ts' &&
  has "$out" 'scanner: apps/web/app/pages-need-a-session.test.ts'; then
  ok 'a committed packages/shared file is traced (vitest related reaches its test), plus the scanners'
else bad 'packages/shared change' "$out"; fi

reset
put 'apps/web/app/p/[profileId]/new/page.tsx' 'export default function Page() {}'
g add -A && g commit -qm 'feat: a page'
out="$(dry)"
if has "$out" 'scanner: apps/web/app/pages-need-a-session.test.ts'; then
  ok 'a new committed page.tsx selects pages-need-a-session'
else bad 'new page.tsx' "$out"; fi

# 🔴 The working tree is not the push (2026-11-17: an applied mutation patch made a db push run the
# editor suites). An uncommitted edit is reported, never traced.
reset
put packages/shared/src/units.ts 'export const UNITS = ["kg", "st"];' # modified, NOT committed
put docs/guide.md '# guide, revised'
g commit -qam 'docs: guide' -- docs/guide.md
out="$(dry)"
if has "$out" 'untested-local: packages/shared/src/units.ts' && ! printf '%s' "$out" | grep -q '^traced:'; then
  ok 'an uncommitted edit is reported as untested-local and never traced'
else bad 'uncommitted edit' "$out"; fi

# The real run must not hand vitest --changed (which re-adds the working tree).
if ! grep -qE "'--changed'" "$script" && grep -qF "'related'" "$script"; then
  ok 'the real run uses vitest related on committed files, never --changed'
else bad 'the run still uses --changed'; fi

reset
put docs/privacy/notice.md '# notice, revised'
g commit -qam 'docs: notice'
out="$(dry)"
if has "$out" 'scanner: apps/web/lib/privacy/notice-content.test.ts' && ! printf '%s' "$out" | grep -q '^traced:'; then
  ok 'notice.md selects notice-content, and traces nothing'
else bad 'notice.md' "$out"; fi

reset
put docs/guide.md '# guide, revised'
g commit -qam 'docs: guide'
out="$(dry)"
if has "$out" 'mode: none' && has "$out" 'reason: no tests reached by this change'; then
  ok 'a docs-only change runs nothing'
else bad 'docs-only' "$out"; fi
out="$(cd "$repo" && GITHUB_ACTIONS= node "$script" --base origin/main 2>&1)"; code=$?
if [ "$code" -eq 0 ] && printf '%s' "$out" | grep -qF 'no tests reached by this change'; then
  ok 'and a real (non-dry) run of it says so and exits 0 without spawning vitest'
else bad "docs-only real run: exit $code" "$out"; fi

for trigger in pnpm-lock.yaml pnpm-workspace.yaml apps/web/tsconfig.json packages/db/tsconfig.build.json \
  apps/web/package.json apps/web/vitest.config.ts; do
  reset
  put "$trigger" "# changed $trigger"
  g add -A && g commit -qm "chore: $trigger"
  out="$(dry)"
  if has "$out" 'mode: full' && has "$out" "reason: $trigger forces a full run"; then
    ok "$trigger forces a full run"
  else bad "trigger $trigger" "$out"; fi
done

reset
g mv packages/shared/src/units.ts docs/units.md && g commit -qm 'chore: move'
out="$(dry)"
if has "$out" 'traced: packages/shared/src/units.ts'; then
  ok "a move out of packages/ still sees the source path (--no-renames)"
else bad 'rename source' "$out"; fi

reset
g rm -q apps/web/test/bypass-is-contained.test.ts && g commit -qm 'test: drop'
out="$(cd "$repo" && GITHUB_ACTIONS= node "$script" --base origin/main --dry-run 2>&1)"; code=$?
if [ "$code" -eq 2 ] && printf '%s' "$out" | grep -qF 'apps/web/test/bypass-is-contained.test.ts' &&
  ! printf '%s' "$out" | grep -qF 'pages-need-a-session'; then
  ok 'a required scanner the grep no longer finds: exit 2, naming it'
else bad "missing scanner: exit $code" "$out"; fi

# The real repo, dry: the derivation finds every required scanner.
out="$(cd "$real" && node "$script" --list-scanners 2>&1)"; code=$?
if [ "$code" -eq 0 ] && printf '%s' "$out" | grep -qxF 'apps/web/app/pages-need-a-session.test.ts'; then
  ok "the real repo's scanners are all found ($(printf '%s\n' "$out" | wc -l | tr -d ' '))"
else bad "real-repo scanners: exit $code" "$out"; fi

# The script's trigger list and vitest's config must agree.
cfg="$real/apps/web/vitest.config.ts"
for t in "'**/pnpm-lock.yaml'" "'**/pnpm-workspace.yaml'" "'**/tsconfig*.json'" 'configDefaults.forceRerunTriggers'; do
  if grep -qF "$t" "$cfg"; then ok "vitest.config.ts forceRerunTriggers has $t"
  else bad "vitest.config.ts forceRerunTriggers lacks $t"; fi
done

# The hook is the slim one.
if grep -qxF 'pnpm typecheck && pnpm test:changed' "$real/.husky/pre-push"; then ok 'pre-push runs typecheck + test:changed'
else bad 'pre-push is not `pnpm typecheck && pnpm test:changed`' "$(cat "$real/.husky/pre-push")"; fi

if [ "$fails" -gt 0 ]; then printf '\n%s case(s) failed\n' "$fails"; exit 1; fi
printf '\nall test-changed cases passed\n'
