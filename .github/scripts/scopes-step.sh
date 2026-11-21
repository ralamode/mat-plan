#!/usr/bin/env bash
# The scopes step every heavy CI job runs (DX-18 D7): one definition, called from ci.yml as
# `bash .github/scripts/scopes-step.sh` with BASE_SHA (resolve-pr-base.sh) in the env.
#
# It runs the BASE's copy of changed-scopes.mjs, so a PR cannot reclassify itself by editing that
# script. This catches mistakes, not a hostile author: the PR's own tree supplies this file and
# ci.yml. A push (no base), a base without the script, or a script that fails runs every heavy step.
# Self-test: changed-scopes.test.sh.
set -uo pipefail

: "${GITHUB_OUTPUT:?scopes-step.sh needs GITHUB_OUTPUT}"
all() { printf 'run_mutations=true\nrun_build=true\nrun_e2e=true\nrun_import_pins=true\n' >>"$GITHUB_OUTPUT"; }

script="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/changed-scopes.mjs"
if [ -n "${BASE_SHA:-}" ] && git show "$BASE_SHA:.github/scripts/changed-scopes.mjs" >"$script" 2>/dev/null; then
  if ! node "$script"; then
    echo "changed-scopes: the script failed; every heavy step runs"
    all
  fi
else
  echo "changed-scopes: a push, or no base copy of the script; every heavy step runs"
  all
fi
