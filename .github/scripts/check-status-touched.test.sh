#!/usr/bin/env bash
# Self-test for check-status-touched.mjs: builds a throwaway repo per case and asserts the exit code
# and message. Mirrors .claude/skills/hold-the-bar/check.test.sh.
#
#   bash .github/scripts/check-status-touched.test.sh
set -uo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check-status-touched.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

git -C "$tmp" init -q -b main
git -C "$tmp" config user.email t@t && git -C "$tmp" config user.name t
mkdir -p "$tmp/docs" "$tmp/src"
echo '# status' >"$tmp/docs/status.md" && echo 'x' >"$tmp/src/a.ts"
git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: base'

# case <name> <branch> <commit-subject> <touch-status: y|n> <want-exit> <want-text> [STATUS_SKIP]
case_() {
  git -C "$tmp" checkout -q main && git -C "$tmp" checkout -q -B "$2"
  echo "$RANDOM" >>"$tmp/src/a.ts"
  [ "$4" = y ] && echo "$RANDOM" >>"$tmp/docs/status.md"
  git -C "$tmp" add -A && git -C "$tmp" commit -qm "$3"
  out="$(cd "$tmp" && STATUS_SKIP="${7:-}" node "$guard" main 2>&1)"
  code=$?
  if [ "$code" -ne "$5" ] || ! grep -qF "$6" <<<"$out"; then
    printf '✗ %s: want exit %s + "%s", got exit %s\n%s\n' "$1" "$5" "$6" "$code" "$out"
    fails=$((fails + 1))
  else
    printf '✓ %s\n' "$1"
  fi
}

case_ "feat branch without status fails"      feat/x-1  'feat(x): add'   n 1 'Status guard failed'
case_ "feat branch with status passes"         feat/x-2  'feat(x): add'   y 0 'is updated'
case_ "docs branch passes without status"      docs/x-3  'docs(x): write' n 0 "don't owe"
case_ "chore branch, fix commit, still owes"   chore/x-4 'fix(x): patch'  n 1 'Status guard failed'
# `db` is owed by branch name only (commitlint has no `db` type): a non-owing commit type, so only
# the branch name can make this case owe.
case_ "db branch without status fails"         db/x-5    'chore(db): tidy' n 1 'Status guard failed'
case_ "override passes and prints the reason"  fix/x-6   'fix(x): patch'  n 0 'copy-only fix' 'copy-only fix'
case_ "blank override does not pass"           fix/x-7   'fix(x): patch'  n 1 'Status guard failed' '   '

case_ "breaking feat on a chore branch owes"   chore/x-8 'feat(x)!: drop' n 1 'Status guard failed'
case_ "refactor branch owes"                   refactor/x-9 'refactor(x): move' n 1 'Status guard failed'
case_ "perf branch owes"                       perf/x-10 'perf(x): faster' n 1 'Status guard failed'
case_ "revert owes"                            chore/x-11 'revert: feat(x): add' n 1 'Status guard failed'
case_ "git's default revert subject owes"      chore/x-14 'Revert "feat(x): add"' n 1 'Status guard failed'

# check <name> <want-exit> <want-text> — runs the guard against the CURRENT state of $tmp.
check() {
  out="$(cd "$tmp" && node "$guard" "${4:-main}" 2>&1)"
  code=$?
  if [ "$code" -ne "$2" ] || ! grep -qF "$3" <<<"$out"; then
    printf '✗ %s: want exit %s + "%s", got exit %s\n%s\n' "$1" "$2" "$3" "$code" "$out"
    fails=$((fails + 1))
  else
    printf '✓ %s\n' "$1"
  fi
}

# An uncommitted (unstaged) status.md edit counts: the useful moment is before the last commit.
git -C "$tmp" checkout -q main && git -C "$tmp" checkout -q -B feat/x-12
echo "$RANDOM" >>"$tmp/src/a.ts" && git -C "$tmp" commit -qam 'feat(x): add'
echo "$RANDOM" >>"$tmp/docs/status.md"
check "unstaged status edit counts" 0 'is updated'
git -C "$tmp" checkout -q -- docs/status.md

# Deleting status.md is not updating it.
git -C "$tmp" rm -q docs/status.md && git -C "$tmp" commit -qm 'feat(x): drop status'
check "deleted status.md does not count" 1 'Status guard failed'

# A base that can't be resolved exits 2.
check "bad base ref exits 2" 2 'Could not resolve a merge base' no-such-ref

# Detached HEAD warns that it is judging by commit subjects only.
git -C "$tmp" checkout -q main && git -C "$tmp" checkout -q -B feat/x-13
echo "$RANDOM" >>"$tmp/src/a.ts" && git -C "$tmp" commit -qam 'chore(x): tidy'
git -C "$tmp" checkout -q --detach
check "detached HEAD warns" 0 'detached HEAD'


# ── Post-DX-2: once docs/changelog/README.md exists, the entry is an ADDED fragment ────────────────
# A legacy branch, cut BEFORE the README lands on main, for the mid-merge case at the end.
git -C "$tmp" checkout -q main && git -C "$tmp" checkout -q -B feat/legacy
echo "$RANDOM" >>"$tmp/src/a.ts" && echo "$RANDOM" >>"$tmp/docs/status.md"
git -C "$tmp" commit -qam 'feat(x): legacy entry in status.md'
check "legacy: status.md still passes before DX-2" 0 'is updated'

git -C "$tmp" checkout -q main
mkdir -p "$tmp/docs/changelog"
echo '# changelog' >"$tmp/docs/changelog/README.md"
echo 'old entry' >"$tmp/docs/changelog/2026-01-01-feat-old.md"
echo 'a draft entry' >"$tmp/docs/changelog/draft.txt"
git -C "$tmp" add -A && git -C "$tmp" commit -qm 'docs: changelog fragments'

# branch <name> — a fresh owing branch off main with one committed code change.
branch() {
  git -C "$tmp" checkout -q main && git -C "$tmp" checkout -q -B "$1"
  echo "$RANDOM" >>"$tmp/src/a.ts" && git -C "$tmp" commit -qam "${2:-feat(x): add}"
}
frag() { echo "$RANDOM" >"$tmp/docs/changelog/$1"; }

branch feat/y-1; frag 2026-10-01-feat-y-1.md; git -C "$tmp" add -A && git -C "$tmp" commit -qm 'docs: entry'
check "committed fragment passes" 0 'fragment is added'

branch feat/y-2; frag 2026-10-01-feat-y-2.md; git -C "$tmp" add -A
check "staged fragment passes" 0 'fragment is added'
git -C "$tmp" reset -q --hard

branch feat/y-3; frag 2026-10-01-feat-y-3.md
check "untracked fragment passes" 0 'fragment is added'
rm "$tmp/docs/changelog/2026-10-01-feat-y-3.md"

branch feat/y-4; echo "$RANDOM" >>"$tmp/docs/status.md" && git -C "$tmp" commit -qam 'docs: status'
check "status.md alone fails after DX-2" 1 'adds no changelog fragment'

branch feat/y-5; frag 2026-10-01-feat-other.md; git -C "$tmp" add -A && git -C "$tmp" commit -qm 'docs: entry'
check "fragment named for another branch fails" 1 'not a valid entry'

branch feat/y-6; frag feat-y-6.md; git -C "$tmp" add -A && git -C "$tmp" commit -qm 'docs: entry'
check "fragment without a date fails" 1 'not a valid entry'

branch feat/y-7; mkdir -p "$tmp/docs/changelog/sub"; frag sub/2026-10-01-feat-y-7.md
git -C "$tmp" add -A && git -C "$tmp" commit -qm 'docs: entry'
check "nested fragment fails (the name check)" 1 'adds no changelog fragment'

branch feat/y-8; echo "$RANDOM" >>"$tmp/docs/changelog/2026-01-01-feat-old.md"
git -C "$tmp" commit -qam 'docs: edit old entry'
check "editing an old fragment fails" 1 'adds no changelog fragment'

branch feat/y-9; echo "$RANDOM" >>"$tmp/docs/changelog/README.md" && git -C "$tmp" commit -qam 'docs: readme'
check "README edit alone fails (the name check)" 1 'adds no changelog fragment'

# Delete a file and add a fragment with the SAME content, both inside docs/changelog/ (rename
# detection only pairs within the pathspec): without --no-renames this is `R`, not an add.
branch feat/y-10; git -C "$tmp" mv docs/changelog/draft.txt docs/changelog/2026-10-01-feat-y-10.md
git -C "$tmp" commit -qm 'docs: entry'
check "rename-shaped add passes" 0 'fragment is added'

# The branch name is compared literally: `.` must not act as a regex wildcard.
branch fix/v1.2-x 'fix(x): patch'; frag 2026-10-01-fix-v1x2-x.md
check "branch name is matched literally, not as a regex" 1 'not a valid entry'
rm "$tmp/docs/changelog/2026-10-01-fix-v1x2-x.md"; frag 2026-10-01-fix-v1.2-x.md
check "metacharacter branch with its exact fragment passes" 0 'fragment is added'
rm "$tmp/docs/changelog/2026-10-01-fix-v1.2-x.md"

# Detached HEAD (keep-mergeable): STATUS_BRANCH supplies the name; without it, the generic shape.
branch feat/y-11; frag 2026-10-01-feat-y-11.md; git -C "$tmp" add -A && git -C "$tmp" commit -qm 'feat(x): entry'
git -C "$tmp" checkout -q --detach
out="$(cd "$tmp" && STATUS_BRANCH=feat/y-11 node "$guard" main 2>&1)"; code=$?
if [ "$code" -eq 0 ] && grep -qF 'fragment is added' <<<"$out"; then printf '✓ %s\n' "detached + STATUS_BRANCH passes"
else printf '✗ detached + STATUS_BRANCH passes: exit %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); fi
out="$(cd "$tmp" && STATUS_BRANCH=feat/other node "$guard" main 2>&1)"; code=$?
if [ "$code" -eq 1 ] && grep -qF 'not a valid entry' <<<"$out"; then printf '✓ %s\n' "detached + wrong STATUS_BRANCH fails"
else printf '✗ detached + wrong STATUS_BRANCH fails: exit %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); fi
check "detached without STATUS_BRANCH: generic shape passes" 0 'fragment is added'

# The name check, piece by piece: each case fails if one part of it is dropped.
branch feat/y-12; frag XXXXXXXXXXXfeat-y-12.md; git -C "$tmp" add -A && git -C "$tmp" commit -qm 'docs: entry'
check "an 11-char junk prefix is not a date" 1 'not a valid entry'
branch fix/x-c 'fix(x): patch'; frag 2026-10-01-feat-fix-x-c.md; git -C "$tmp" add -A && git -C "$tmp" commit -qm 'docs: entry'
check "another branch's fragment that ENDS with ours fails" 1 'not a valid entry'
branch feat/y-13; frag notes.md; git -C "$tmp" add -A && git -C "$tmp" commit -qm 'feat(x): notes'
git -C "$tmp" checkout -q --detach
check "detached without STATUS_BRANCH: an undated file fails" 1 'not a valid entry'

# THE round-2 case: a legacy branch mid-merge of main (conflict-free here, uncommitted). The README is
# now in the working tree, so the new rule applies and its status.md entry no longer passes. Main's own
# fragments arrive as staged adds and must not count — even detached, with no branch name to match.
git -C "$tmp" checkout -q feat/legacy
git -C "$tmp" merge -q --no-commit --no-ff main >/dev/null 2>&1
check "legacy branch mid-merge of main fails" 1 'adds no changelog fragment'
git -C "$tmp" checkout -q --detach
check "legacy mid-merge, detached, main's fragments don't count" 1 'adds no changelog fragment'
git -C "$tmp" checkout -q feat/legacy 2>/dev/null; git -C "$tmp" merge --abort 2>/dev/null

# ── Frozen history: post-DX-2, NO branch may add to status.md's or the skills README's changelog ──
git -C "$tmp" checkout -q main
mkdir -p "$tmp/.claude/skills"
printf '# status\n\n## Where we are right now\n\npointer v1\n\n## Changelog (merged PRs)\n\n- old entry\n' >"$tmp/docs/status.md"
printf '# skills\n\n## Changelog\n\n- old skill entry\n\n## Later\n\ntext\n' >"$tmp/.claude/skills/README.md"
git -C "$tmp" add -A && git -C "$tmp" commit -qm 'docs: sections'
# hist <file> <after-line> <new-line> — insert a line after a matching line, in the working tree.
hist() { awk -v a="$2" -v n="$3" '{print} $0==a{print n}' "$tmp/$1" >"$tmp/.h" && mv "$tmp/.h" "$tmp/$1"; }

branch docs/z-1 'docs(x): note'; hist docs/status.md '## Changelog (merged PRs)' '- **2026-10-01** — misfiled'
git -C "$tmp" commit -qam 'docs: entry'
check "docs branch adding a status.md history entry fails" 1 'adds to a changelog that DX-2 froze'
out="$(cd "$tmp" && STATUS_SKIP='just docs' node "$guard" main 2>&1)"; code=$?
if [ "$code" -eq 1 ] && grep -qF 'does not bypass' <<<"$out"; then printf '✓ %s\n' "STATUS_SKIP does not bypass the frozen check"
else printf '✗ STATUS_SKIP does not bypass the frozen check: exit %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); fi

branch docs/z-2 'docs(x): pointer'; sed 's/pointer v1/pointer v2/' "$tmp/docs/status.md" >"$tmp/.h" && mv "$tmp/.h" "$tmp/docs/status.md"
git -C "$tmp" commit -qam 'docs: pointer'
check "docs branch editing only the pointer passes" 0 "don't owe"

branch chore/z-3 'chore(x): skill'; hist .claude/skills/README.md '## Changelog' '- **2026-10-01** — skill misfiled'
check "an unstaged skills-README history entry fails" 1 '.claude/skills/README.md'
git -C "$tmp" checkout -q -- .claude/skills/README.md

# Main's own history arriving mid-merge is not this branch's addition.
branch docs/z-4 'docs(x): other'
git -C "$tmp" checkout -q main && hist docs/status.md '- old entry' '- main entry, pre-freeze'
git -C "$tmp" commit -qam 'docs: main history'
git -C "$tmp" checkout -q docs/z-4 && git -C "$tmp" merge -q --no-commit --no-ff main >/dev/null 2>&1
check "main's history lines mid-merge don't count" 0 "don't owe"
git -C "$tmp" merge --abort 2>/dev/null

# Edits are not additions: skills:check can DEMAND an edit (a stale path in an old entry), so a typo
# or path fix, or a re-wrap that adds continuation lines, must pass — or the two guards deadlock.
branch docs/z-5 'docs(x): fix'; sed 's/^- old entry$/- old entry, path fixed/' "$tmp/docs/status.md" >"$tmp/.h" && mv "$tmp/.h" "$tmp/docs/status.md"
hist docs/status.md '- old entry, path fixed' '  re-wrapped continuation'
git -C "$tmp" commit -qam 'docs: fix old entry'
check "editing an existing history entry (and re-wrapping it) passes" 0 "don't owe"

# Renaming the heading would switch the check off, so it fails instead.
branch docs/z-6 'docs(x): rename'; sed 's/^## Changelog (merged PRs)$/## Old changelog/' "$tmp/docs/status.md" >"$tmp/.h" && mv "$tmp/.h" "$tmp/docs/status.md"
hist docs/status.md '## Old changelog' '- **2026-10-01** — hidden'
git -C "$tmp" commit -qam 'docs: rename'
check "renaming a frozen heading fails" 1 'heading was renamed or removed'

# The section ends at the next `## ` heading: text below it is not history.
branch docs/z-7 'docs(x): later'; hist .claude/skills/README.md '## Later' '- a later bullet'
git -C "$tmp" commit -qam 'docs: later'
check "a bullet under the next heading passes" 0 "don't owe"

# Main edited an old entry after this branch was cut; the branch still has the old text, unmerged.
branch docs/z-8 'docs(x): stale'
git -C "$tmp" checkout -q main && sed 's/^- old skill entry$/- old skill entry, main fixed it/' "$tmp/.claude/skills/README.md" >"$tmp/.h" && mv "$tmp/.h" "$tmp/.claude/skills/README.md"
git -C "$tmp" commit -qam 'docs: main edits history'
git -C "$tmp" checkout -q docs/z-8
check "an entry main edited after the cut isn't this branch's addition" 0 "don't owe"

# Pre-DX-2 (no README in the working tree), history entries are still how the changelog is written.
branch docs/z-9 'docs(x): legacy'; git -C "$tmp" rm -q docs/changelog/README.md
hist docs/status.md '## Changelog (merged PRs)' '- **2026-09-29** — legacy entry'
git -C "$tmp" commit -qam 'docs: legacy entry'
check "a pre-DX-2 branch may still add a history entry" 0 "don't owe"

[ "$fails" -eq 0 ] && echo "all status-guard self-tests passed" || exit 1
