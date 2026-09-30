#!/usr/bin/env bash
# Self-test for the Claude Code hooks in this directory. A throwaway repo with a main checkout and a
# linked worktree; the guard must deny history-changing git in the main checkout only, and the
# session briefing must flag an off-main main checkout.
#
#   bash .claude/hooks/hooks.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

repo="$tmp/repo"
git init -q -b main "$repo"
git -C "$repo" config user.email t@t && git -C "$repo" config user.name t
echo x >"$repo/f" && git -C "$repo" add f && git -C "$repo" commit -qm base
git -C "$repo" worktree add -q "$repo/.claude/worktrees/wt" -b feat/x
wt="$repo/.claude/worktrees/wt"

# guard <name> <cwd> <command> <want: deny|allow>
guard() {
  out="$(jq -n --arg c "$3" --arg d "$2" '{cwd:$d, tool_input:{command:$c}}' | node "$here/guard-main-checkout.mjs")"
  got=allow
  grep -q '"permissionDecision":"deny"' <<<"$out" && got=deny
  if [ "$got" = "$4" ]; then printf '✓ %s\n' "$1"; else printf '✗ %s: want %s, got %s\n%s\n' "$1" "$4" "$got" "$out"; fails=$((fails + 1)); fi
}

guard "main checkout: checkout a feature branch is denied" "$repo" "git checkout -b feat/y" deny
guard "main checkout: switch is denied" "$repo" "git switch feat/x" deny
guard "main checkout: rebase is denied" "$repo" "git rebase origin/main" deny
guard "main checkout: pull without --ff-only is denied" "$repo" "git pull origin main" deny
guard "main checkout: pull --ff-only on main is allowed" "$repo" "git pull --ff-only origin main" allow
guard "main checkout: returning to main is allowed" "$repo" "git checkout main" allow
guard "main checkout: read-only git is allowed" "$repo" "git status && git log --oneline -3" allow
guard "main checkout: worktree add is allowed" "$repo" "git fetch origin && git worktree add x -b y origin/main" allow
guard "worktree: checkout is allowed" "$wt" "git checkout -b feat/z" allow
guard "worktree: rebase is allowed" "$wt" "git rebase main" allow
guard "cd into the main checkout is followed" "$wt" "cd $repo && git checkout feat/x" deny
guard "git -C the main checkout is followed" "$wt" "git -C $repo switch feat/x" deny
guard "escape hatch allows it, visibly" "$repo" "MAT_PLAN_ALLOW_MAIN_CHECKOUT=1 git checkout feat/x" allow
guard "not a git repo: allowed (fail open)" "$tmp" "git checkout foo" allow
guard "non-git commands: allowed" "$repo" "ls -la" allow

# Session briefing: off-main main checkout → a warning for the person.
git -C "$repo" checkout -q -b feat/off-main
out="$(cd "$wt" && node "$here/session-context.mjs" </dev/null)"
if grep -q 'is on \\"feat/off-main\\"' <<<"$out"; then echo "✓ session: warns when the main checkout is off main"
else echo "✗ session: no off-main warning"; echo "$out"; fails=$((fails + 1)); fi
git -C "$repo" checkout -q main
out="$(cd "$wt" && node "$here/session-context.mjs" </dev/null)"
if ! grep -q 'systemMessage' <<<"$out" && grep -q 'additionalContext' <<<"$out"; then echo "✓ session: quiet when all is well, still gives context"
else echo "✗ session: unexpected output on a clean repo"; echo "$out"; fails=$((fails + 1)); fi

[ "$fails" -eq 0 ] && echo "all hook self-tests passed" || exit 1
