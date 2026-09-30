#!/usr/bin/env bash
# review-prefetch: gather everything the review-pr skill needs about PR <n> into <out-dir>, as DATA.
# One definition for both callers: the claude-review workflow (DX-1) and a local review-pr run.
#
#   .github/scripts/review-prefetch.sh <pr-number> <out-dir>
#
# Writes <out>/pr.json, pr.diff, checks.txt, hold-the-bar.txt, guides.txt, a skeleton review.md, and the PR head
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

# The canonical (jq -S -c) sha256 of the ONLY .claude/settings.json the model job may load (design
# point 5, D1). A pin, deliberately: any change to that file (a new hook, a matcher, an allow rule)
# fails here until someone re-reads the threat model and updates this hash. Recompute with:
#   git show HEAD:.claude/settings.json | jq -S -c . | shasum -a 256
SETTINGS_SHA256='aeef8c5b0f2edaa15daed3c8b6307a1d25bbdc9e4476a10405f2be1b2045386e'
PINNED_HOOKS=(.claude/hooks/guard-main-checkout.mjs .claude/hooks/session-context.mjs)

SKELETON_MARK='<!-- claude-review:skeleton -->' # also in review-post.sh; review-prefetch.test.sh pins both
# ::error:: for the log; the step summary too, so the cause is on the run page, not only in a log.
die() {
  echo "::error::$*" >&2
  [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "**review-prefetch refused:** $*" >>"$GITHUB_STEP_SUMMARY"
  exit 1
}

# ── 8. Settings guard (fail closed) — first, so nothing is fetched for a job that must not run ──
# Checked against what is COMMITTED (HEAD): CI's checkout holds only tracked files, and locally an
# untracked settings.local.json is the person's own, not the base branch's.
tracked() { git -C "$REPO" cat-file -e "HEAD:$1" 2>/dev/null; }
for f in .claude/settings.local.json .mcp.json; do
  tracked "$f" && die "$f is committed on the base branch; the review job must not load it (.github/SECURITY.md → CI / Actions secrets)"
done
if tracked .claude/settings.json; then
  got="$(git -C "$REPO" show HEAD:.claude/settings.json | jq -S -c . | { sha256sum 2>/dev/null || shasum -a 256; } | cut -d' ' -f1)"
  [ "$got" = "$SETTINGS_SHA256" ] ||
    die ".claude/settings.json differs from the pinned copy (sha256 $got); re-read the review workflow's threat model, then update SETTINGS_SHA256 (.github/SECURITY.md → CI / Actions secrets)"
  # …and each allowlisted hook must still be a no-op under CI, since the model job runs them.
  for h in "${PINNED_HOOKS[@]}"; do
    tracked "$h" || continue
    git -C "$REPO" show "HEAD:$h" | grep -qF '!process.env.CI && !process.env.GITHUB_ACTIONS' ||
      die "$h no longer exits under CI; the review job would run it"
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
# No system/global git config for the checkout, the one step where smudge filters run: a runner-level
# filter.lfs must not meet the PR's .gitattributes / .lfsconfig.
HEAD_DIR="$(cd "$OUT" && pwd)/head"
git -C "$REPO" worktree remove --force "$HEAD_DIR" 2>/dev/null || rm -rf "$HEAD_DIR" # a re-run
git -C "$REPO" worktree prune
GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_LFS_SKIP_SMUDGE=1 \
  git -C "$REPO" -c core.symlinks=false -c core.hooksPath=/dev/null \
  worktree add --quiet --detach "$HEAD_DIR" "$SHA"

# ── 7 (runs here, before the rename). The quality-bar guard: the BASE's trusted script against the
#    head as committed (git/awk only). After step 4 the renamed config would read as deleted. ──
# Likewise no system/global git config while the base's scripts run git in the head.
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null
(cd "$OUT/head" && bash "$REPO/.claude/skills/hold-the-bar/check.sh" "origin/$BASE") >"$OUT/hold-the-bar.txt" 2>&1 || true
# The feature-guide gate, likewise the BASE's script against the head: never `pnpm guides:check` in the
# head, which would run the PR's own package.json script.
(cd "$OUT/head" && node "$REPO/.github/scripts/check-feature-guides.mjs" "origin/$BASE") >"$OUT/guides.txt" 2>&1 || true
unset GIT_CONFIG_NOSYSTEM GIT_CONFIG_GLOBAL

# ── 4. Neutralise PR-authored agent config, then prove it (fail closed) ──
find_sensitive() {
  local args=() n
  for n in "${SENSITIVE[@]}"; do args+=(-o -name "$n"); done
  find "$OUT/head" -depth \( -false "${args[@]}" \) ! -name '*.pr-data' -print0
}
find_sensitive | xargs -0 sh -c 'for p; do mv -- "$p" "$p.pr-data"; done' sh
find "$OUT/head" -type l -delete # belt: core.symlinks=false already made them plain files
[ -z "$(find_sensitive | tr -d '\0')" ] || die "PR agent config survived neutralisation"

# ── 5. The diff, from the pinned SHA (not a second API call that could race) ──
git -C "$REPO" diff "$(git -C "$REPO" merge-base "origin/$BASE" "$SHA")" "$SHA" >"$OUT/pr.diff"

# ── 6. CI state. `gh pr checks` reports the PR's CURRENT head, so say which SHA was reviewed and
#    whether the head has moved since. exit=8 is "pending"; exit=1 with no check rows is "unknown"
#    (a gh error or no checks yet), not red. The skill reads all three. ──
set +e
{
  echo "reviewed-sha=$SHA"
  gh pr checks "$PR" 2>&1
  echo "exit=$?"
  now="$(gh pr view "$PR" --json headRefOid 2>/dev/null | jq -r .headRefOid 2>/dev/null)"
  [ "$now" = "$SHA" ] || echo "head-moved-to=${now:-unknown} (these checks are for that head, not reviewed-sha)"
} >"$OUT/checks.txt"
set -e

# ── 9. The only file the model may edit ──
# The marker line is how review-post.sh tells an untouched skeleton from a real review.
printf '# Review in progress for %s\n\n%s\n_(The review did not finish; see the run log.)_\n' "$SHA" "$SKELETON_MARK" >"$OUT/review.md"

echo "prefetched PR #$PR at $SHA into $OUT"
