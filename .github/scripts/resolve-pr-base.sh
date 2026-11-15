#!/usr/bin/env bash
# Print the base a PR's guards should diff against: the first parent of the merge ref CI checked out.
# Prints nothing (exit 0) when the event is not a pull_request.
#
# WHY NOT pull_request.base.sha: actions/checkout checks out refs/pull/<n>/merge, the PR head merged
# into main AS GITHUB BUILT IT FOR THIS RUN. base.sha is main when the EVENT was created and is not
# refreshed when main moves. In the gap, main's commits and files read as the PR's own: #388, a docs
# branch, failed the status guard as "a feat branch" because #387's feat had landed (run 43662580861).
# HEAD^1 of the merge ref is exactly the main that the checked-out tree was built from.
#
# The checkout must BE the merge ref (exit 2 otherwise). Two parents alone don't prove it: a PR
# head that merged main (AGENTS.md's update method) has two too, and its HEAD^1 is the branch's
# previous commit, which would hide the branch's own commits. GITHUB_SHA is the merge ref's SHA on
# pull_request, so HEAD must equal it.
#
# Inputs: GITHUB_EVENT_NAME, GITHUB_SHA (set by the runner). Self-test: resolve-pr-base.test.sh.
set -euo pipefail

[ "${GITHUB_EVENT_NAME:-}" = pull_request ] || exit 0

head="$(git rev-parse HEAD)"
if [ "$head" != "${GITHUB_SHA:-}" ]; then
  echo "resolve-pr-base: HEAD ($head) is not the merge ref GITHUB_SHA (${GITHUB_SHA:-unset})." >&2
  echo "Has the checkout been given a ref:? The PR guards need refs/pull/<n>/merge." >&2
  exit 2
fi
if ! git rev-parse -q --verify 'HEAD^2' >/dev/null; then
  echo "resolve-pr-base: HEAD ($head) is not a merge commit, so it has no base parent." >&2
  exit 2
fi
base="$(git rev-parse 'HEAD^1')"
echo "resolve-pr-base: PR base = $base (merge ref $head)" >&2
echo "$base"
