#!/usr/bin/env bash
# Self-test for check-audit.mjs. Offline: every case feeds a crafted report through --report, except
# the last, which shims `pnpm` on PATH to assert the argv the guard spawns.
# Plan: docs/plans/sec-5-verify-in-ci.md.
#
#   bash .github/scripts/check-audit.test.sh
set -uo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check-audit.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

# expect <name> <exit> <text-or-empty> ; report body on stdin
expect() {
  cat >"$tmp/report.json"
  out="$(node "$guard" --report "$tmp/report.json" 2>&1)"
  code=$?
  if [ "$code" -ne "$2" ] || { [ -n "$3" ] && ! grep -qF "$3" <<<"$out"; }; then
    printf '✗ %s: want exit %s + "%s", got %s\n%s\n' "$1" "$2" "$3" "$code" "$out"
    [ -n "${GITHUB_ACTIONS:-}" ] && printf '::error::check-audit self-test: %s (want exit %s, got %s)\n' "$1" "$2" "$code"
    fails=$((fails + 1))
  else printf '✓ %s\n' "$1"; fi
}

# metadata <info> <low> <moderate> <high> <critical> [deps]
meta() {
  printf '"metadata":{"vulnerabilities":{"info":%s,"low":%s,"moderate":%s,"high":%s,"critical":%s},"dependencies":%s,"devDependencies":0,"totalDependencies":409}' \
    "$1" "$2" "$3" "$4" "$5" "${6:-297}"
}
# advisory <key> <severity> <module> <ghsa>
adv() {
  printf '"%s":{"id":%s,"severity":"%s","module_name":"%s","github_advisory_id":"%s","patched_versions":">=1.2.3","url":"https://github.com/advisories/%s","findings":[{"paths":["app > %s"]}]}' \
    "$1" "$1" "$2" "$3" "$4" "$4" "$3"
}

# --- 1-2 pass ---
expect "clean report passes, counts printed" 0 "297 prod dep(s)" <<EOF
{"advisories":{},$(meta 0 0 0 0 0)}
EOF
expect "moderate-only passes" 0 "moderate 1" <<EOF
{"advisories":{$(adv 1 moderate esbuild GHSA-67mh-4wv8-2f99)},$(meta 0 0 1 0 0)}
EOF

# --- 3-4, 16 blocking ---
expect "one high fails, naming package + GHSA + path" 1 "braces  GHSA-vfj7-8cjw-p6xm" <<EOF
{"advisories":{$(adv 1 high braces GHSA-vfj7-8cjw-p6xm)},$(meta 0 0 0 1 0)}
EOF
expect "one critical fails" 1 "critical  next" <<EOF
{"advisories":{$(adv 1 critical next GHSA-vcvr-r3jv-pc5j)},$(meta 0 0 0 0 1)}
EOF
expect "empty github_advisory_id falls back to id, still blocks" 1 "braces  1" <<EOF
{"advisories":{$(adv 1 high braces "")},$(meta 0 0 0 1 0)}
EOF
expect "missing patched_versions is context, not evidence" 1 "patched: (not stated)" <<EOF
{"advisories":{"1":{"id":1,"severity":"high","module_name":"braces","github_advisory_id":"GHSA-x","findings":[]}},$(meta 0 0 0 1 0)}
EOF

# --- 5-9 could-not-check: RETRYABLE (exit 2) vs NOT (exit 3). The whole bypass lived here. ---
expect "a real registry outage is retryable" 2 "retryable" <<EOF
{"error":{"code":"pnpm","message":"fetch failed"}}
EOF
expect "a bad upstream response is retryable" 2 "retryable" <<EOF
{"error":{"code":"ERR_PNPM_AUDIT_BAD_RESPONSE","message":"bad JSON"}}
EOF
expect "no lockfile is NOT retryable" 3 "not retryable" <<EOF
{"error":{"code":"ERR_PNPM_AUDIT_NO_LOCKFILE","message":"No pnpm-lock.yaml found"}}
EOF
expect "an unrecognised failure is NOT retryable" 3 "not retryable" <<EOF
{"error":{"code":"ERR_PNPM_SOMETHING_NEW","message":"who knows"}}
EOF

# --- 10-15 vacuity, all NOT retryable ---
printf 'No new vulnerabilities were ignored\n' >"$tmp/report.json"
out="$(node "$guard" --report "$tmp/report.json" 2>&1)"; code=$?
if [ "$code" -eq 3 ]; then printf '✓ %s\n' "prose instead of JSON (ignore/ignoreUnfixable/fix) exits 3"
else printf '✗ prose instead of JSON: want 3, got %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); fi

: >"$tmp/report.json"
out="$(node "$guard" --report "$tmp/report.json" 2>&1)"; code=$?
if [ "$code" -eq 2 ]; then printf '✓ %s\n' "empty output (killed) is retryable"
else printf '✗ empty output: want 2, got %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); fi

expect "advisories present but metadata absent exits 3" 3 "not a verdict" <<EOF
{"advisories":{$(adv 1 high braces GHSA-x)}}
EOF
expect "counts say 1 high, list empty (the ignoreGhsas shape)" 3 "disagree" <<EOF
{"advisories":{},$(meta 0 0 0 1 0)}
EOF
expect "counts off by one is caught (zero-ness would not be)" 3 "disagree" <<EOF
{"advisories":{$(adv 1 high braces GHSA-x)},$(meta 0 0 0 2 0)}
EOF
expect "a renamed severity bucket exits 3" 3 "unknown severity vocabulary" <<EOF
{"advisories":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"HIGH":0,"critical":0},"dependencies":297}}
EOF
expect "an advisory severity outside the vocabulary exits 3" 3 "outside the known vocabulary" <<EOF
{"advisories":{$(adv 1 HIGH braces GHSA-x)},$(meta 0 0 0 0 0)}
EOF
expect "zero production dependencies exits 3" 3 "checked nothing must not pass" <<EOF
{"advisories":{},$(meta 0 0 0 0 0 0)}
EOF

# --- 17 argv. No report fixture can see this, and dropping the flag flips the gate between
#        "always red" (metadata counts info, the list does not) and "quietly partial". ---
mkdir -p "$tmp/bin"
cat >"$tmp/bin/pnpm" <<'SHIM'
#!/usr/bin/env bash
printf '%s\n' "$*" >"$ARGV_LOG"
echo '{"advisories":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0},"dependencies":297,"devDependencies":0,"totalDependencies":409}}'
SHIM
chmod +x "$tmp/bin/pnpm"
ARGV_LOG="$tmp/argv" PATH="$tmp/bin:$PATH" node "$guard" >/dev/null 2>&1
want='audit --prod --json --audit-level info'
if [ "$(cat "$tmp/argv" 2>/dev/null)" = "$want" ]; then printf '✓ %s\n' "spawns: pnpm $want"
else
  printf '✗ argv: want "%s", got "%s"\n' "$want" "$(cat "$tmp/argv" 2>/dev/null)"
  [ -n "${GITHUB_ACTIONS:-}" ] && printf '::error::check-audit self-test: wrong audit argv\n'
  fails=$((fails + 1))
fi

if [ "$fails" -ne 0 ]; then
  printf '\ncheck-audit: %s case(s) failed\n' "$fails"
  [ -n "${GITHUB_ACTIONS:-}" ] && printf '::error::check-audit self-test: %s case(s) failed\n' "$fails"
  exit 1
fi
printf '\ncheck-audit: all cases pass\n'
