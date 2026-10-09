#!/usr/bin/env bash
# Self-test for check-preview-isolation.mjs. Offline: every case feeds a CRAFTED snapshot through
# --snapshot, the same shape check-audit.test.sh uses for --report. No network, no token.
# Plan: docs/plans/ops-1-preview-isolation.md.
#
# The snapshots are hand-written on purpose and the guard refuses an in-tree --snapshot path, so a
# live capture (which carries the project id and every plain value) can never become a fixture here.
# NOTE WHAT THIS DOES AND DOES NOT PROVE: crafted fixtures prove the guard's PARSER. They cannot
# detect that Vercel changed its API shape — only a live run does that, and a live run happens when
# the maintainer executes the runbook. The guard's header says the same thing.
#
#   bash .github/scripts/check-preview-isolation.test.sh
set -uo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check-preview-isolation.mjs"
tmp="$(mktemp -d)"
# The in-tree fixture of case 12 is listed here too, so an interrupted run leaves no stray file.
in_tree="$(cd "$(dirname "$0")/../.." && pwd)/.ops1-selftest-snapshot.json"
trap 'rm -rf "$tmp"; rm -f "$in_tree"' EXIT
fails=0

# expect <name> <exit> <text-or-empty> ; snapshot body on stdin
expect() {
  cat >"$tmp/snapshot.json"
  out="$(node "$guard" --snapshot "$tmp/snapshot.json" 2>&1)"
  code=$?
  if [ "$code" -ne "$2" ] || { [ -n "$3" ] && ! grep -qF "$3" <<<"$out"; }; then
    printf '✗ %s: want exit %s + "%s", got %s\n%s\n' "$1" "$2" "$3" "$code" "$out"
    [ -n "${GITHUB_ACTIONS:-}" ] && printf '::error::check-preview-isolation self-test: %s (want exit %s, got %s)\n' "$1" "$2" "$code"
    fails=$((fails + 1))
  else printf '✓ %s\n' "$1"; fi
}

# project <fork> <autoexpose>
project() { printf '"project":{"gitForkProtection":%s,"autoExposeSystemEnvs":%s}' "$1" "$2"; }
# env_var <key> <targets-json>
env_var() { printf '{"key":"%s","type":"encrypted","target":%s}' "$1" "$2"; }

ISOLATED_ENV="\"env\":{\"envs\":[
  $(env_var DATABASE_URL '["production"]'),
  $(env_var DATABASE_URL '["preview","development"]'),
  $(env_var ACCESS_GATE_PASSWORD '["production"]'),
  $(env_var ACCESS_GATE_PASSWORD '["preview","development"]'),
  $(env_var SENTRY_DSN '["production"]')
]}"

# --- 1. the good state ---
expect "a fully isolated project passes" 0 "Preview is isolated from production" <<EOF
{$(project true true),$ISOLATED_ENV}
EOF

# --- 2-3. project flags ---
expect "fork protection off fails (not 'could not check')" 1 "fork-PR protection: off" <<EOF
{$(project false true),$ISOLATED_ENV}
EOF
expect "autoExposeSystemEnvs off fails" 1 "system environment variables exposed: off" <<EOF
{$(project true false),$ISOLATED_ENV}
EOF

# --- 4-5. a MISSING field must be exit 2, never a pass. gitForkProtection is in no `required`
#          list in Vercel's schema, so absence is a real, reachable state.
expect "a missing gitForkProtection field is exit 2, not 0" 2 "has no \`gitForkProtection\` field" <<EOF
{"project":{"autoExposeSystemEnvs":true},$ISOLATED_ENV}
EOF
expect "a missing envs array is exit 2, not 0" 2 "no \`envs\` array" <<EOF
{$(project true true),"env":{}}
EOF

# --- 6. THE PRE-OPS-1 STATE: one DATABASE_URL record spanning every scope. This is the exact
#        configuration this whole PR exists to make impossible; it must never exit 0.
expect "one DATABASE_URL across all scopes FAILS (the pre-OPS-1 state)" 1 "DATABASE_URL targets development + preview + production" <<EOF
{$(project true true),"env":{"envs":[$(env_var DATABASE_URL '["production","preview","development"]')]}}
EOF

# --- 7. the two-of-three gap the privacy lens found: production shared with DEVELOPMENT only.
expect "production shared with development only FAILS" 1 "targets development + production" <<EOF
{$(project true true),"env":{"envs":[
  $(env_var DATABASE_URL '["production","development"]'),
  $(env_var DATABASE_URL '["preview"]')
]}}
EOF

# --- 8. the dashboard kill switch ---
expect "SKIP_ENV_VALIDATION anywhere FAILS" 1 "turns off env validation" <<EOF
{$(project true true),"env":{"envs":[
  $(env_var DATABASE_URL '["production"]'),
  $(env_var DATABASE_URL '["preview"]'),
  $(env_var SKIP_ENV_VALIDATION '["preview"]')
]}}
EOF

# --- 9. "not shared" is not the same as "present". A Preview scope with no DATABASE_URL at all
#        shares nothing and is still broken.
expect "DATABASE_URL missing from preview FAILS" 1 "missing from: preview" <<EOF
{$(project true true),"env":{"envs":[$(env_var DATABASE_URL '["production"]')]}}
EOF

# --- 10. the allowlist escape hatch exists and is honoured (it ships EMPTY, so this proves the
#         mechanism by asserting the DEFAULT: an unlisted shared key fails).
expect "an unlisted shared key is not excused" 1 "no variable shares the production scope" <<EOF
{$(project true true),"env":{"envs":[
  $(env_var DATABASE_URL '["production"]'),
  $(env_var DATABASE_URL '["preview"]'),
  $(env_var NEXT_PUBLIC_CLERK_SIGN_IN_URL '["production","preview"]')
]}}
EOF

# --- 11. malformed input is "could not check", never a pass ---
expect "unparseable snapshot is exit 2" 2 "not valid JSON" <<EOF
{ this is not json
EOF

# --- 12. the guard must never accept a snapshot inside the repo tree: a live capture holds the
#         project id and every plain value, and gitleaks flags none of it.
printf '{%s,%s}\n' "$(project true true)" "$ISOLATED_ENV" >"$in_tree"
out="$(node "$guard" --snapshot "$in_tree" 2>&1)"
code=$?
rm -f "$in_tree"
if [ "$code" -ne 2 ] || ! grep -qF 'must not resolve inside the repository' <<<"$out"; then
  printf '✗ in-tree snapshot path refused: want exit 2, got %s\n%s\n' "$code" "$out"
  fails=$((fails + 1))
else printf '✓ in-tree snapshot path refused\n'; fi

# --- 13. stdin works, so a capture never needs to touch the filesystem at all ---
out="$(printf '{%s,%s}\n' "$(project true true)" "$ISOLATED_ENV" | node "$guard" --snapshot - 2>&1)"
code=$?
if [ "$code" -ne 0 ]; then
  printf '✗ --snapshot - reads stdin: want exit 0, got %s\n%s\n' "$code" "$out"
  fails=$((fails + 1))
else printf '✓ --snapshot - reads stdin\n'; fi

# --- 14. THE NO-SECRET CONTRACT, asserted on the SOURCE rather than on output, because the claim is
#         about which endpoints exist in the code at all: no `decrypt` parameter, and no per-id
#         `/env/{id}` call. Omitting one (now-deprecated) query parameter is not the claim; the
#         endpoint set is. Comment lines are stripped first — the header discusses both by name.
code_only="$(grep -vE '^[[:space:]]*(//|\*|/\*)' "$guard")"
if grep -qE 'decrypt' <<<"$code_only" || grep -qE '/env/\$\{' <<<"$code_only"; then
  printf '✗ the guard builds a decrypt or per-id /env/ URL — it must read STRUCTURE only\n'
  fails=$((fails + 1))
else printf '✓ no decrypt and no per-id /env/ URL in the guard\n'; fi

# --- 15. no snapshot VALUE is ever echoed, even when a record carries one ---
out="$(printf '{%s,"env":{"envs":[{"key":"DATABASE_URL","type":"plain","target":["production"],"value":"postgres://u:TOPSECRET@h/neondb"},{"key":"DATABASE_URL","type":"plain","target":["preview"],"value":"x"}]}}\n' "$(project true true)" | node "$guard" --snapshot - 2>&1)"
if grep -qF 'TOPSECRET' <<<"$out"; then
  printf '✗ a snapshot value reached stdout\n%s\n' "$out"
  fails=$((fails + 1))
else printf '✓ no snapshot value reaches stdout\n'; fi

if [ "$fails" -eq 0 ]; then
  echo "check-preview-isolation self-test: all cases pass"
else
  echo "check-preview-isolation self-test: $fails case(s) failed"
  exit 1
fi
