#!/usr/bin/env bash
# Self-test for check-action-pins.mjs: throwaway workflow dirs with good and bad pins. Offline only;
# `--resolve` needs the network and is exercised by CI (plan: docs/plans/sec-2-pin-actions.md).
#
#   bash .github/scripts/check-action-pins.test.sh
set -uo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check-action-pins.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0
sha=3d3c42e5aac5ba805825da76410c181273ba90b1

# expect <name> <exit> <text-or-empty> [file] ; workflow body on stdin, written to a fresh dir
expect() {
  rm -rf "$tmp/wf" && mkdir -p "$tmp/wf"
  cat >"$tmp/wf/${4:-w.yml}"
  out="$(node "$guard" "$tmp/wf" 2>&1)"
  code=$?
  if [ "$code" -ne "$2" ] || { [ -n "$3" ] && ! grep -qF "$3" <<<"$out"; }; then
    printf '✗ %s: want exit %s + "%s", got %s\n%s\n' "$1" "$2" "$3" "$code" "$out"
    fails=$((fails + 1))
  else printf '✓ %s\n' "$1"; fi
}

# --- pass ---
expect "sha + bare version comment passes" 0 "1 ref(s)" <<EOF
      - uses: actions/checkout@$sha # v7.0.1
EOF
expect ".yaml extension is scanned" 0 "1 ref(s)" w.yaml <<EOF
      - uses: actions/checkout@$sha # v7.0.1
EOF
expect "job-level reusable workflow, pinned, passes" 0 "" <<EOF
  call:
    uses: o/r/.github/workflows/x.yml@$sha # v1.2.3
EOF
expect "bare uses: under name: passes" 0 "" <<EOF
      - name: Setup
        uses: pnpm/action-setup@$sha # v6.0.10
EOF
expect "quoted key and value pass" 0 "" <<EOF
      - "uses": "actions/checkout@$sha" # v7.0.1
EOF
expect "local reusable workflow passes" 0 "" <<EOF
    uses: ./.github/workflows/y.yml
EOF

# --- fail (1) ---
expect "major tag fails" 1 "actions/checkout@v7" <<'EOF'
      - uses: actions/checkout@v7
EOF
expect "branch fails" 1 "@main" <<'EOF'
      - uses: actions/checkout@main
EOF
expect "branch with a version comment still fails" 1 "@main" <<'EOF'
      - uses: actions/checkout@main # v7
EOF
expect "sha without a comment fails" 1 "bare \"# vX.Y.Z\"" <<EOF
      - uses: actions/checkout@$sha
EOF
expect "non-version comment fails" 1 "# pinned" <<EOF
      - uses: actions/checkout@$sha # pinned
EOF
expect "text after the version fails (Dependabot leaves it stale)" 1 "— note" <<EOF
      - uses: actions/checkout@$sha # v7.0.1 — note
EOF
expect "39-hex sha fails" 1 "" <<EOF
      - uses: actions/checkout@${sha:1} # v7.0.1
EOF
expect "uppercase sha fails" 1 "" <<EOF
      - uses: actions/checkout@$(tr a-f A-F <<<"$sha") # v7.0.1
EOF
expect "owner starting with .. fails" 1 "" <<EOF
      - uses: ../b/c@$sha # v1
EOF
expect "local composite action fails" 1 "not scanned" <<'EOF'
      - uses: ./.github/actions/foo
EOF
expect "job-level reusable workflow on a tag fails" 1 "@v1" <<'EOF'
  call:
    uses: o/r/.github/workflows/x.yml@v1
EOF
expect "every offender is listed" 1 "2 action ref(s)" <<'EOF'
      - uses: actions/checkout@v7
      - uses: actions/cache@v6
EOF

# --- no match ---
expect "statuses: read with uses: in its comment is not a ref" 0 "1 ref(s)" <<EOF
    permissions:
      statuses: read # uses: x@v1
    steps:
      - uses: actions/checkout@$sha # v7.0.1
EOF

# --- exit 2: a guard that checked nothing must not pass ---
rm -rf "$tmp/empty" && mkdir -p "$tmp/empty"
out="$(node "$guard" "$tmp/empty" 2>&1)"
if [ $? -eq 2 ] && grep -qF "no workflow files" <<<"$out"; then printf '✓ empty dir exits 2\n'
else printf '✗ empty dir: %s\n' "$out"; fails=$((fails + 1)); fi
expect "workflows with no uses: exit 2" 2 "no uses: found" <<'EOF'
    steps:
      - run: echo hi
EOF

[ "$fails" -eq 0 ] && echo "check-action-pins: all cases pass" || { echo "check-action-pins: $fails failing"; exit 1; }
