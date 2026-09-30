#!/usr/bin/env bash
# hold-the-bar: flag every way this branch's diff could have quietly LOWERED the quality bar.
# Diff-scoped (merge-base with the base ref .. working tree, so uncommitted edits count too).
#
#   bash .claude/skills/hold-the-bar/check.sh            # vs origin/main
#   bash .claude/skills/hold-the-bar/check.sh <base-ref> # vs an explicit base
#
# Exit 0 = clean (bar-file notices may still print), 1 = findings that each need a fix or a
# one-line justification in the PR description. Adapted from addyosmani/agent-skills'
# constraint-driven-development "floor guard"; the bar itself lives in AGENTS.md + the DoD.
set -euo pipefail

base_ref="${1:-origin/main}"
base="$(git merge-base "$base_ref" HEAD)"
findings=0

# Only code/config files carry live suppressions; markdown merely *mentions* them.
code_paths=(-- '*.ts' '*.tsx' '*.js' '*.mjs' '*.cjs' '*.sql' '*.yml' '*.yaml' '*.json'
  ':!pnpm-lock.yaml' ':!.claude/skills/hold-the-bar/*')

# Print "file:+line" for each ADDED line matching an extended regex.
added_matching() {
  # Regex goes via ENVIRON, not -v: awk -v processes backslash escapes and mangles \. and \(.
  git diff -U0 "$base" "${code_paths[@]}" | RE="$1" awk '
    /^\+\+\+ b\// { file = substr($0, 7); next }
    /^\+/ && !/^\+\+\+/ { if ($0 ~ ENVIRON["RE"]) print "    " file ": " substr($0, 2) }'
}

report() { # $1 = heading, $2 = hits
  if [ -n "$2" ]; then
    printf '\n✗ %s\n%s\n' "$1" "$2"
    findings=$((findings + 1))
  fi
}

report "A checker was silenced (new suppression — fix the cause, or justify it right above the line)" \
  "$(added_matching '@ts-(ignore|nocheck|expect-error)|eslint-disable|istanbul ignore|c8 ignore|squawk-ignore|gitleaks:allow')"

report "A test got easier (.skip / .only / .todo / fixme added)" \
  "$(added_matching '(describe|it|test)\.(skip|only|todo|fixme)\(|(^|[^[:alnum:]_.])(xit|xdescribe)\(')"

report "Work is unfinished (stub throw or swallowed error)" \
  "$(added_matching '[Nn]ot [Ii]mplemented|catch *(\([^)]*\))? *\{ *\}|\.catch\(\(\) *=> *(\{ *\}|undefined|null)\)')"

deleted_tests="$(git diff --name-only --diff-filter=D "$base" -- '*.test.ts' '*.test.tsx' '*.spec.ts' | sed 's/^/    /')"
report "A test file was deleted (say why in the PR — replaced? moved?)" "$deleted_tests"

# Assertions pulled out of tests that stayed: net-negative expect() count per surviving test file.
thinned=""
for f in $(git diff --name-only --diff-filter=M "$base" -- '*.test.ts' '*.test.tsx' '*.spec.ts'); do
  removed=$(git diff -U0 "$base" -- "$f" | grep -cE '^-[^-].*expect\(' || true)
  added=$(git diff -U0 "$base" -- "$f" | grep -cE '^\+[^+].*expect\(' || true)
  if [ "$removed" -gt "$added" ]; then thinned="$thinned    $f: -$removed / +$added expect()"$'\n'; fi
done
report "Assertions were removed from a test that stayed" "${thinned%$'\n'}"

# The bar's own definition. Tightening is fine and silent; loosening must be loud. Notice only.
bar_files="$(git diff --name-only "$base" -- AGENTS.md docs/definition-of-done.md .squawk.toml \
  '.github/workflows/*' '.github/scripts/*' .husky 'tsconfig*.json' 'apps/web/tsconfig*.json' \
  'apps/web/eslint.config.*' 'apps/web/vitest.config.*' 'apps/web/playwright.config.*' \
  'commitlint.config.*' | sed 's/^/    /')"
if [ -n "$bar_files" ]; then
  printf '\n! The bar itself changed — confirm each is a TIGHTENING, or say why it loosens:\n%s\n' "$bar_files"
fi

if [ "$findings" -eq 0 ]; then
  echo "✓ hold-the-bar: no suppressions, skipped/deleted/thinned tests, or stubs in the diff vs $base_ref"
  exit 0
fi
printf '\n%s finding group(s). Fix each, or justify it in one line in the PR description.\n' "$findings"
exit 1
