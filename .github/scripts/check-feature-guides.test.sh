#!/usr/bin/env bash
# Self-test for check-feature-guides.mjs: builds a throwaway repo per case and asserts the exit code
# and message. Mirrors .github/scripts/check-status-touched.test.sh.
#
# 🔴 WHY THIS FILE EXISTS. The guard shipped without one, and a parser bug then went unnoticed for
# two releases: a `#` comment inside `owns:` ended the list, so `write-path.md` DECLARED thirteen
# owned paths and the guard READ three. Ten paths were unguarded by both rot checks while the guard
# printed OK. The first four cases below are that bug, pinned from both directions.
#
#   bash .github/scripts/check-feature-guides.test.sh
set -uo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check-feature-guides.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

git -C "$tmp" init -q -b main
git -C "$tmp" config user.email t@t && git -C "$tmp" config user.name t
mkdir -p "$tmp/docs/features" "$tmp/src/owned" "$tmp/src/free"
echo 'x' >"$tmp/src/owned/a.ts"
echo 'y' >"$tmp/src/owned/b.ts"
echo 'z' >"$tmp/src/free/c.ts"
git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: base'

# write_guide <owns-block-body> — recreates the dir, because a checkout that empties
# `docs/features/` removes it and the next write would ENOENT.
write_guide() {
  mkdir -p "$tmp/docs/features"
  { printf -- '---\nfeature: Probe\nowns:\n'; printf '%s\n' "$1"; printf -- '---\n\n# Probe guide\n'; } \
    >"$tmp/docs/features/probe.md"
}

# case_ <name> <owns-body> <file-to-touch> <touch-guide: y|n> <want-exit> <want-text>
#
# ⚠️ The guide is committed ON MAIN, never on the branch. Committing it to the branch puts it in the
# diff, so rot check #2 sees the guide as touched and every case passes — the first draft of this
# harness did exactly that and reported the baseline case green.
case_() {
  git -C "$tmp" checkout -q main
  write_guide "$2"
  git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: guide' >/dev/null 2>&1
  git -C "$tmp" checkout -q -B "probe/$RANDOM"
  echo "$RANDOM" >>"$tmp/$3"
  [ "$4" = y ] && printf '\nedited\n' >>"$tmp/docs/features/probe.md"
  git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: change' >/dev/null 2>&1
  out="$(cd "$tmp" && node "$guard" main 2>&1)"
  code=$?
  if [ "$code" -ne "$5" ] || ! grep -qF "$6" <<<"$out"; then
    printf '✗ %s: want exit %s + "%s", got exit %s\n%s\n' "$1" "$5" "$6" "$code" "$out"
    fails=$((fails + 1))
  else
    printf '✓ %s\n' "$1"
  fi
}

OWNS_PLAIN='  - src/owned/'
OWNS_AFTER_COMMENT='  - src/free/
  # a note about the next entry
  - src/owned/'
OWNS_TRAILING_COMMENT='  - src/owned/ # a trailing slash owns everything beneath'
OWNS_STALE='  - src/owned/
  - src/gone/'

# 1-2 · the baseline, so the harness is not vacuous
case_ "owned file touched without the guide fails"  "$OWNS_PLAIN"  src/owned/a.ts n 1 'was not updated, but this PR changes files it documents'
case_ "owned file touched with the guide passes"    "$OWNS_PLAIN"  src/owned/a.ts y 0 'consistent with the diff'

# 3 · 🔴 THE BUG. An entry AFTER a comment line must still be owned. Pre-fix this exited 0.
case_ "an entry after a # comment is still owned"   "$OWNS_AFTER_COMMENT" src/owned/a.ts n 1 'was not updated, but this PR changes files it documents'

# 4 · the comment must not swallow the entry it annotates (documented trailing form).
case_ "a trailing # comment is stripped, not owned" "$OWNS_TRAILING_COMMENT" src/owned/a.ts n 1 'was not updated, but this PR changes files it documents'

# 5 · and a trailing comment must not break rot check #1 by becoming part of the path.
case_ "a trailing # comment leaves the path valid"  "$OWNS_TRAILING_COMMENT" src/owned/a.ts y 0 'consistent with the diff'

# 6 · an unowned file is still free, so the fix did not over-widen ownership.
case_ "an unowned file needs no guide edit"         "$OWNS_PLAIN"  src/free/c.ts  n 0 'consistent with the diff'

# 7 · rot check #1 still fires on a path that does not exist.
case_ "a claimed path that is missing fails"        "$OWNS_STALE"  src/owned/a.ts y 1 'does not exist'

# 8 · a top-level key ends the `owns:` list: an item under the NEXT key is not owned. Pinned before
#     DX-14 item 8 generalised the list loop, so the refactor can't move it.
OWNS_THEN_KEY='  - src/free/
related:
  - src/owned/'
case_ "a later top-level key ends the owns list"    "$OWNS_THEN_KEY" src/owned/a.ts n 0 'consistent with the diff'

# 9-10 · a guide with no frontmatter is skipped, and README.md is never a guide, even with owns:.
git -C "$tmp" checkout -q main
printf '# Notes, no frontmatter\n' >"$tmp/docs/features/plain.md"
printf -- '---\nfeature: Index\nowns:\n  - src/owned/\n---\n' >"$tmp/docs/features/README.md"
git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: plain + readme' >/dev/null 2>&1
case_ "no-frontmatter and README files are not guides" "  - src/free/" src/owned/a.ts n 0 '1 guide(s) consistent'
git -C "$tmp" checkout -q main && git -C "$tmp" rm -q docs/features/plain.md docs/features/README.md && git -C "$tmp" commit -qm 'chore: drop' >/dev/null

# ── Most specific owner (DX-14 item 9): two guides, so a case can tell the new rule from the old ──
# g2_case <name> <broad-owns> <narrow-owns> <setup-on-branch> <edit: broad|narrow|none> <exit> <text> [absent-text]
g2_case() {
  git -C "$tmp" checkout -q main
  rm -f "$tmp/docs/features/"*.md && mkdir -p "$tmp/src/lane" "$tmp/src/other"
  echo l >"$tmp/src/lane/a.ts"; echo x >"$tmp/src/x.ts"; echo o >"$tmp/src/old.ts"; echo z >"$tmp/src/other/b.ts"
  { printf -- '---\nfeature: Broad\nowns:\n%s\n---\n' "$2"; } >"$tmp/docs/features/broad.md"
  { printf -- '---\nfeature: Narrow\nowns:\n%s\n---\n' "$3"; } >"$tmp/docs/features/narrow.md"
  git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: two guides' >/dev/null 2>&1
  git -C "$tmp" checkout -q -B "probe/$RANDOM"
  (cd "$tmp" && eval "$4")
  [ "$5" != none ] && printf '\nedited\n' >>"$tmp/docs/features/$5.md"
  git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: change' >/dev/null 2>&1
  out="$(cd "$tmp" && node "$guard" main 2>&1)"; code=$?
  if [ "$code" -ne "$6" ] || ! grep -qF "$7" <<<"$out" || { [ -n "${8:-}" ] && grep -qF "$8" <<<"$out"; }; then
    printf '✗ %s: want exit %s + "%s"%s, got exit %s\n%s\n' "$1" "$6" "$7" "${8:+, without \"$8\"}" "$code" "$out"
    fails=$((fails + 1))
  else printf '✓ %s\n' "$1"; fi
}
g2_case "owner: a narrower directory relieves the broader one" '  - src/' '  - src/lane/' \
  'echo 1 >>src/lane/a.ts' narrow 0 'consistent with the diff'
g2_case "owner: the narrower guide is still owed"               '  - src/' '  - src/lane/' \
  'echo 1 >>src/lane/a.ts' none 1 'docs/features/narrow.md (Narrow) was not updated' 'docs/features/broad.md (Broad) was not updated'
g2_case "owner: an exact entry adds, never displaces"            '  - src/' '  - src/x.ts' \
  'echo 1 >>src/x.ts' narrow 1 'docs/features/broad.md (Broad) was not updated'
g2_case "owner: the same directory in two guides owes both"      '  - src/' '  - src/' \
  'echo 1 >>src/x.ts' broad 1 'docs/features/narrow.md (Narrow) was not updated'
g2_case "owner: a rename into the narrow dir still owes the broad" '  - src/' '  - src/lane/' \
  'git mv src/old.ts src/lane/old.ts' narrow 1 'docs/features/broad.md (Broad) was not updated'
g2_case "owner: a directory without its / is refused"             '  - src/' '  - src/lane' \
  'echo 1 >>src/x.ts' broad 1 "lists the directory 'src/lane' without a trailing '/'"
# Lanes use the same rule: under one broad guide two lanes collide; each under its own lane guide, not.
git -C "$tmp" checkout -q main && rm -f "$tmp/docs/features/"*.md && mkdir -p "$tmp/docs/milestones"
printf -- '---\nfeature: Broad\nowns:\n  - src/\n---\n' >"$tmp/docs/features/broad.md"
printf -- '---\nlane-a:\n  - src/lane/\nlane-b:\n  - src/other/\n---\n' >"$tmp/docs/milestones/m.md"
git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: lanes, broad only' >/dev/null 2>&1
out="$(cd "$tmp" && node "$guard" main 2>&1)"; code=$?
[ "$code" -eq 1 ] && grep -qF 'both reach docs/features/broad.md' <<<"$out" && printf '✓ %s\n' "owner: lanes under one broad guide collide" \
  || { printf '✗ owner: lanes under one broad guide collide: exit %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); }
printf -- '---\nfeature: A\nowns:\n  - src/lane/\n---\n' >"$tmp/docs/features/lane-a.md"
printf -- '---\nfeature: B\nowns:\n  - src/other/\n---\n' >"$tmp/docs/features/lane-b.md"
git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: lane guides' >/dev/null 2>&1
out="$(cd "$tmp" && node "$guard" main 2>&1)"; code=$?
[ "$code" -eq 0 ] && grep -qF '2 lane(s) in 1 document(s)' <<<"$out" && printf '✓ %s\n' "owner: each lane under its own guide passes" \
  || { printf '✗ owner: each lane under its own guide passes: exit %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); }
git -C "$tmp" checkout -q main && rm -rf "$tmp/docs/milestones" "$tmp/docs/features/broad.md" "$tmp/docs/features/narrow.md" "$tmp/docs/features/lane-a.md" "$tmp/docs/features/lane-b.md" && git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: reset' >/dev/null 2>&1

# ── Lanes (DX-14 item 8). Whole-tree, so each case commits on main and runs with no diff. ─────────
# lane_case <name> <dir> <frontmatter-body> <guide-owns> <want-exit> <want-text>
lane_case() {
  git -C "$tmp" checkout -q main
  rm -rf "$tmp/docs/milestones" "$tmp/docs/specs" && mkdir -p "$tmp/docs/$2"
  write_guide "$4"
  printf -- '---\n%s\n---\n\n# Milestone\n' "$3" >"$tmp/docs/$2/m.md"
  git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: lanes' >/dev/null 2>&1
  out="$(cd "$tmp" && node "$guard" main 2>&1)"
  code=$?
  if [ "$code" -ne "$5" ] || ! grep -qF "$6" <<<"$out"; then
    printf '✗ %s: want exit %s + "%s", got exit %s\n%s\n' "$1" "$5" "$6" "$code" "$out"
    fails=$((fails + 1))
  else
    printf '✓ %s\n' "$1"
  fi
}
FREE='  - src/free/'
DISJOINT='lane-a:
  - src/owned/a.ts
lane-b:
  - src/other/'
lane_case "lanes: disjoint, in a milestone"            milestones "$DISJOINT" "$FREE" 0 '2 lane(s) in 1 document(s)'
lane_case "lanes: disjoint, in a spec"                 specs      "$DISJOINT" "$FREE" 0 '2 lane(s) in 1 document(s)'
lane_case "lanes: the same path in two lanes"          milestones 'lane-a:
  - src/x.ts
lane-b:
  - src/x.ts' "$FREE" 1 "lane-a 'src/x.ts' and lane-b 'src/x.ts' overlap"
lane_case "lanes: a dir prefix collides"               milestones 'lane-a:
  - packages/db
lane-b:
  - packages/db/src/x.ts' "$FREE" 1 'overlap'
lane_case "lanes: a dir prefix collides, reversed"     milestones 'lane-a:
  - packages/db/src/x.ts
lane-b:
  - packages/db/' "$FREE" 1 'overlap'
lane_case "lanes: a string prefix is not a dir prefix" milestones 'lane-a:
  - src/a/
lane-b:
  - src/ab.ts' "$FREE" 0 '2 lane(s) in 1 document(s)'
lane_case "lanes: two lanes reach one guide"           milestones 'lane-a:
  - src/owned/a.ts
lane-b:
  - src/owned/b.ts' '  - src/owned/' 1 'both reach docs/features/probe.md'
lane_case "lanes: naming a guide reaches it"           milestones 'lane-a:
  - docs/features/probe.md
lane-b:
  - src/owned/b.ts' '  - src/owned/' 1 'both reach docs/features/probe.md'
lane_case "lanes: one lane, two entries, one guide"    milestones 'lane-a:
  - src/owned/a.ts
  - src/owned/b.ts
  - src/owned/b.ts
lane-b:
  - src/other/' '  - src/owned/' 0 '2 lane(s) in 1 document(s)'
lane_case "lanes: a # comment does not end a list"     milestones 'lane-a:
  - src/x.ts # trailing
  # whole line
  - src/y.ts
lane-b:
  - src/y.ts' "$FREE" 1 "lane-a 'src/y.ts' and lane-b 'src/y.ts' overlap"
for bad in 'src/**' './src/a.ts' '/src/a.ts' 'src/../a.ts' 'src//a.ts' '"src/"'; do
  lane_case "lanes: '$bad' is refused"                 milestones "lane-a:
  - $bad
lane-b:
  - src/other/" "$FREE" 2 'is not a plain path'
done
lane_case "lanes: an empty lane is refused"            milestones 'lane-a:
lane-b:
  - src/other/' "$FREE" 2 'lane-a declares no paths'
lane_case "lanes: a duplicate key is refused"          milestones 'lane-a:
  - src/x.ts
lane-a:
  - src/y.ts' "$FREE" 2 'declared twice'
lane_case "lanes: an unrecognised line is refused"     milestones 'lane-a:
  - src/x.ts
  src/y.ts
lane-b:
  - src/other/' "$FREE" 2 "lane-a: 'src/y.ts' is not a two-space-indented"
# An entry is exactly a two-space-indented "- path" line. Before 2026-11-15 a column-0 "- path"
# ended the list silently and every entry after it was dropped, so the overlap check passed on a
# lane it could not see (found in #420's review: three paths dropped).
lane_case "lanes: a column-0 '- path' is refused, not the end of the list" milestones 'lane-a:
  - src/x.ts
- src/y.ts
  - src/z.ts
lane-b:
  - src/z.ts' "$FREE" 2 "lane-a: '- src/y.ts' is not a two-space-indented '- path' line"
lane_case "lanes: the entries after a column-0 line are still read" milestones 'lane-a:
  - src/x.ts
- src/y.ts
  - src/**
lane-b:
  - src/other/' "$FREE" 2 "lane-a: 'src/**' is not a plain path"
lane_case "lanes: a column-0 comment does not end a list" milestones 'lane-a:
  - src/x.ts
# a note
  - src/y.ts
lane-b:
  - src/y.ts' "$FREE" 1 "lane-a 'src/y.ts' and lane-b 'src/y.ts' overlap"
for bad in '    - src/y.ts' ' - src/y.ts' '	- src/y.ts' '  -src/y.ts' '  -  src/y.ts'; do
  lane_case "lanes: '$bad' is refused"                 milestones "lane-a:
  - src/x.ts
$bad
lane-b:
  - src/other/" "$FREE" 2 "is not a two-space-indented '- path' line"
done
lane_case "lanes: a bad lane key is refused"           milestones 'lane-a:
  - src/x.ts
lane B · Builder:
  - src/other/' "$FREE" 2 'is not a lane key'
# CRLF hides the frontmatter, which would read as "no lanes".
git -C "$tmp" checkout -q main && rm -rf "$tmp/docs/milestones" "$tmp/docs/specs" && mkdir -p "$tmp/docs/milestones"
printf -- '---\r\nlane-a:\r\n  - src/x.ts\r\n---\r\n' >"$tmp/docs/milestones/m.md"
git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: crlf' >/dev/null 2>&1
out="$(cd "$tmp" && node "$guard" main 2>&1)"; code=$?
[ "$code" -eq 2 ] && grep -qF 'CRLF' <<<"$out" && printf '✓ %s\n' "lanes: CRLF frontmatter is refused" \
  || { printf '✗ lanes: CRLF frontmatter is refused: exit %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); }
# One home per milestone.
git -C "$tmp" checkout -q main && rm -rf "$tmp/docs/milestones" "$tmp/docs/specs" && mkdir -p "$tmp/docs/milestones" "$tmp/docs/specs"
printf -- '---\nlane-a:\n  - src/x.ts\n---\n' | tee "$tmp/docs/milestones/m.md" >"$tmp/docs/specs/m.md"
git -C "$tmp" add -A && git -C "$tmp" commit -qm 'chore: two homes' >/dev/null 2>&1
out="$(cd "$tmp" && node "$guard" main 2>&1)"; code=$?
[ "$code" -eq 2 ] && grep -qF 'both declare lanes' <<<"$out" && printf '✓ %s\n' "lanes: one milestone, two homes, is refused" \
  || { printf '✗ lanes: two homes: exit %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); }
# FAM-1's shape (fam-1-family-program.md § Lanes): as drafted, lanes A and C reach one guide; once d2
# gives the guide's files to integration (no declared lane), it passes.
lane_case "lanes: FAM-1 as drafted serialises"         milestones 'lane-a-schema-and-writers:
  - packages/db/
lane-b-builder-ui:
  - apps/web/app/p/[profileId]/program/
lane-c-today-ui:
  - apps/web/app/p/[profileId]/strength-form.tsx' '  - packages/db/src/writers/strength-session.ts
  - apps/web/app/p/[profileId]/strength-form.tsx' 1 'both reach docs/features/probe.md'
lane_case "lanes: FAM-1 with the guide split passes"   milestones 'lane-a-schema-and-writers:
  - packages/db/
lane-b-builder-ui:
  - apps/web/app/p/[profileId]/program/
lane-c-today-ui:
  - apps/web/app/p/[profileId]/day/' '  - packages/db/src/writers/strength-session.ts' 0 '3 lane(s) in 1 document(s)'
git -C "$tmp" checkout -q main && rm -rf "$tmp/docs/milestones" "$tmp/docs/specs"

[ "$fails" -eq 0 ] && echo 'all feature-guide guard self-tests passed' || { echo "$fails failing"; exit 1; }
