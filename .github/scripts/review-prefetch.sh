#!/usr/bin/env bash
# review-prefetch: gather everything the review-pr skill needs about PR <n> into <out-dir>, as DATA.
# One definition for both callers: the claude-review workflow (DX-1) and a local review-pr run.
#
#   .github/scripts/review-prefetch.sh <pr-number> <out-dir>
#
# Writes <out>/pr.json, pr.diff, checks.txt, hold-the-bar.txt, a skeleton review.md, and the PR head
# at <out>/head (symlinks materialised as plain files, PR-authored agent config renamed *.pr-data).
# Emits head_sha=<sha> to $GITHUB_OUTPUT when set. Never runs PR code: no install, build or tests.
# Plan and threat model: docs/plans/dx-1-claude-review.md (design points 4-6).
set -euo pipefail

PR="${1:?usage: review-prefetch.sh <pr-number> <out-dir>}"
OUT="${2:?usage: review-prefetch.sh <pr-number> <out-dir>}"
REPO="$(git rev-parse --show-toplevel)"
case "$PR" in *[!0-9]*) echo "::error::PR must be a number, got '$PR'" >&2; exit 2 ;; esac

# The agent-config paths the action itself treats as sensitive (restore-config.ts:26-35), plus
# AGENTS.md. Inside the PR head they are data to review, never instructions to load.
SENSITIVE=(.claude .claude.json CLAUDE.md CLAUDE.local.md .mcp.json .gitmodules .ripgreprc .husky AGENTS.md)

# The ONLY hook commands a base-branch .claude/settings.json may contain for the model job to run
# (design point 5). Deliberately a second copy of settings.json's strings: this list is a pin, so a
# new hook or a changed command fails here and forces a re-read of the threat model. Both hooks are
# no-ops under CI (they check CI/GITHUB_ACTIONS).
ALLOWED_HOOK_COMMANDS='[
  "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard-main-checkout.mjs\"",
  "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/session-context.mjs\""
]'

die() { echo "::error::$*" >&2; exit 1; }

# ── 8. Settings guard (fail closed) — first, so nothing is fetched for a job that must not run ──
for f in .claude/settings.local.json .mcp.json; do
  [ -e "$REPO/$f" ] && die "$f exists on the base branch; the review job must not load it (.github/SECURITY.md → CI / Actions secrets)"
done
if [ -e "$REPO/.claude/settings.json" ]; then
  jq -e --argjson allowed "$ALLOWED_HOOK_COMMANDS" '
    (keys - ["hooks", "$schema"] | length == 0)
    and ([.hooks // {} | .[][] | .hooks[] | (.type == "command" and (.command as $c | $allowed | index($c) != null))] | all)
  ' "$REPO/.claude/settings.json" >/dev/null ||
    die ".claude/settings.json has keys or hooks beyond the pinned allowlist; revisit the review workflow's threat model before loading it (.github/SECURITY.md → CI / Actions secrets)"
  # …and each allowlisted hook must still be a no-op under CI, since the model job runs them.
  for h in "$REPO"/.claude/hooks/guard-main-checkout.mjs "$REPO"/.claude/hooks/session-context.mjs; do
    [ ! -e "$h" ] || grep -qF '!process.env.CI && !process.env.GITHUB_ACTIONS' "$h" ||
      die "${h#"$REPO"/} no longer exits under CI; the review job would run it"
  done
fi

mkdir -p "$OUT"

# ── 1. PR metadata, read ONCE: the head SHA pins everything below ──
gh pr view "$PR" --json number,title,body,files,labels,headRefName,baseRefName,headRefOid,author >"$OUT/pr.json"
SHA="$(jq -r .headRefOid "$OUT/pr.json")"
BASE="$(jq -r .baseRefName "$OUT/pr.json")"
[[ "$SHA" =~ ^[0-9a-f]{40}$ ]] || die "unexpected head SHA '$SHA'"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "head_sha=$SHA" >>"$GITHUB_OUTPUT"

# ── 2. Fetch the head as objects; if the author pushed since, pin the SHA we read ──
git -C "$REPO" fetch --quiet --no-tags origin "pull/$PR/head" "$BASE"
if [ "$(git -C "$REPO" rev-parse FETCH_HEAD)" != "$SHA" ]; then
  git -C "$REPO" fetch --quiet --no-tags origin "$SHA" || die "head moved and $SHA is no longer fetchable"
fi

# ── 3. Materialise as data: no symlinks, no hooks, no LFS smudge ──
HEAD_DIR="$(cd "$OUT" && pwd)/head"
git -C "$REPO" worktree remove --force "$HEAD_DIR" 2>/dev/null || rm -rf "$HEAD_DIR" # a re-run
git -C "$REPO" worktree prune
GIT_LFS_SKIP_SMUDGE=1 git -C "$REPO" -c core.symlinks=false -c core.hooksPath=/dev/null \
  worktree add --quiet --detach "$HEAD_DIR" "$SHA"

# ── 4. Neutralise PR-authored agent config, then prove it (fail closed) ──
find_sensitive() {
  local args=() n
  for n in "${SENSITIVE[@]}"; do args+=(-o -name "$n"); done
  find "$OUT/head" -depth \( -false "${args[@]}" \) ! -name '*.pr-data' -print0
}
find_sensitive | xargs -0 -I{} mv -- {} {}.pr-data
find "$OUT/head" -type l -delete # belt: core.symlinks=false already made them plain files
[ -z "$(find_sensitive | tr -d '\0')" ] || die "PR agent config survived neutralisation"

# ── 5. The diff, from the pinned SHA (not a second API call that could race) ──
git -C "$REPO" diff "$(git -C "$REPO" merge-base "origin/$BASE" "$SHA")" "$SHA" >"$OUT/pr.diff"

# ── 6. CI state; exit 8 is "pending", an empty file is "unknown" (the skill says both) ──
set +e
gh pr checks "$PR" >"$OUT/checks.txt" 2>&1
echo "exit=$?" >>"$OUT/checks.txt"
set -e

# ── 7. The quality-bar guard: the BASE's trusted script, run against the head's files (git/awk only) ──
(cd "$OUT/head" && bash "$REPO/.claude/skills/hold-the-bar/check.sh" "origin/$BASE") >"$OUT/hold-the-bar.txt" 2>&1 || true

# ── 9. The only file the model may edit ──
printf '# Review in progress for %s\n\n_(The review did not finish; see the run log.)_\n' "$SHA" >"$OUT/review.md"

echo "prefetched PR #$PR at $SHA into $OUT"
