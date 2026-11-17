#!/usr/bin/env bash
# Self-test for check-audit.mjs. Offline: every case feeds a crafted report through --report, except
# the ones that shim `pnpm` on PATH (the argv the guard spawns, and what it refuses before spawning).
# Plan: docs/plans/sec-5-verify-in-ci.md.
#
#   bash .github/scripts/check-audit.test.sh
set -uo pipefail

guard="$(cd "$(dirname "$0")" && pwd)/check-audit.mjs"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

# expect <name> <exit> <text-or-empty> ; report body on stdin
# Every case reads an exception list: none by default, so the committed one never leaks in.
printf '[]' >"$tmp/none.json"
EXCEPTIONS="$tmp/none.json"
TODAY=2026-11-17
expect() {
  cat >"$tmp/report.json"
  out="$(node "$guard" --report "$tmp/report.json" --exceptions "$EXCEPTIONS" --today "$TODAY" 2>&1)"
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
  printf '"%s":{"id":%s,"severity":"%s","module_name":"%s","github_advisory_id":"%s","patched_versions":">=1.2.3","url":"https://github.com/advisories/%s","findings":[{"paths":["app>%s"]}]}' \
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

# --- 18-30 SEC-5c exceptions (docs/plans/sec-5c-advisory-exceptions.md) ---
# exc <ghsa> <module> <severity> <paths-json> <added> <expires> [extra-json]
exc() {
  printf '{"ghsa":"%s","module":"%s","severity":"%s","paths":%s,"reason":"build-time tooling only; the app imports none of it and no request reaches it","added":"%s","expires":"%s"%s}' \
    "$1" "$2" "$3" "$4" "$5" "$6" "${7:-}"
}
G=GHSA-fc5q-39xc-vjpf
P='["app>picomatch"]'
HIGH="{\"advisories\":{$(adv 1 high picomatch $G)},$(meta 0 0 0 1 0)}"
ex() { printf '[%s]' "$1" >"$tmp/ex.json"; EXCEPTIONS="$tmp/ex.json"; }

ex "$(exc $G picomatch high "$P" 2026-11-17 2026-12-17)"
expect "an excepted high passes, with a warning naming it" 0 "EXCEPTED through 2026-12-17 UTC" <<<"$HIGH"
TODAY=2026-12-17
expect "the expiry day itself still passes" 0 "EXCEPTED" <<<"$HIGH"
TODAY=2026-12-18
expect "the day after expiry fails" 1 "expired on 2026-12-17" <<<"$HIGH"
expect "the day after expiry, the advisory itself blocks again" 1 "1 high/critical advisory(ies)" <<<"$HIGH"
TODAY=2026-11-17
expect "a stale entry fails (the advisory is gone)" 1 "is stale" <<EOF
{"advisories":{},$(meta 0 0 0 0 0)}
EOF
expect "a second, un-excepted high still fails beside it" 1 "braces  GHSA-vfj7-8cjw-p6xm" <<EOF
{"advisories":{$(adv 1 high picomatch $G),$(adv 2 high braces GHSA-vfj7-8cjw-p6xm)},$(meta 0 0 0 2 0)}
EOF
ex "$(exc $G picomatch high '["app>somewhere-else>picomatch"]' 2026-11-17 2026-12-17)"
expect "a reported path the entry does not name fails" 1 "picomatch  $G" <<<"$HIGH"
ex "$(exc $G minimatch high "$P" 2026-11-17 2026-12-17)"
expect "the same id on another module fails" 1 "picomatch  $G" <<<"$HIGH"
ex "$(exc $G picomatch high "$P" 2026-11-17 2026-12-17)"
expect "the same advisory raised to critical fails" 1 "critical  picomatch" <<EOF
{"advisories":{$(adv 1 critical picomatch $G)},$(meta 0 0 0 0 1)}
EOF
ex "$(exc $G picomatch critical "$P" 2026-11-17 2026-12-17)"
expect "a critical entry is refused (3)" 3 "never exceptable" <<<"$HIGH"
ex "$(exc $G picomatch high "$P" 2026-11-17 2026-12-18)"
expect "a window over 30 days is refused (3)" 3 "lasts 0" <<<"$HIGH"
ex "$(exc $G picomatch high "$P" 2026-11-17 2026-12-17),$(exc $G picomatch high "$P" 2026-11-17 2026-12-17)"
expect "a duplicate entry is refused (3)" 3 "repeats" <<<"$HIGH"
ex "$(exc $G picomatch high "$P" 2026-11-17 2026-12-17 ',"wildcard":true')"
expect "an unknown field is refused (3)" 3 "must have exactly" <<<"$HIGH"
ex "$(exc $G 'picomatch\n::stop-commands::k' high "$P" 2026-11-17 2026-12-17)"
expect "a module carrying a workflow command is refused (3)" 3 "not a package name" <<<"$HIGH"
ex "$(exc $G picomatch high '["app picomatch"]' 2026-11-17 2026-12-17)"
expect "a path outside pnpm's shape is refused (3)" 3 "must list every reported path" <<<"$HIGH"
printf '{not json' >"$tmp/ex.json"; EXCEPTIONS="$tmp/ex.json"
expect "an unparseable list is refused (3)" 3 "not valid JSON" <<<"$HIGH"
ex "$(exc $G picomatch high "$P" 2026-11-17 2026-12-17)"
TODAY=2026-12-11
expect "seven days or fewer left warns loudly" 0 "EXPIRES IN 6 DAY(S)" <<<"$HIGH"
TODAY=2026-11-17
ex "$(exc $G picomatch high "$P" 2026-11-18 2026-12-17)"
expect "an entry added in the future is refused (3)" 3 "is after today" <<<"$HIGH"
ex "$(exc $G picomatch high "$P" 2026-11-17 2026-11-16)"
expect "a negative window is refused (3)" 3 "lasts 0" <<<"$HIGH"
ex "$(exc $G picomatch high "$P" 2026-02-30 2026-03-02)"
expect "a calendar-impossible date is refused (3)" 3 "not a real ISO date" <<<"$HIGH"
printf '[{"ghsa":"%s","module":"picomatch","severity":"high","paths":%s,"added":"2026-11-17","expires":"2026-12-17"}]' "$G" "$P" >"$tmp/ex.json"
expect "a missing field is refused (3)" 3 "must have exactly" <<<"$HIGH"
ex "$(exc $G picomatch high "$P" 2026-11-17 2026-12-17)"
expect "an advisory with no findings is never excepted" 1 "picomatch  $G" <<EOF
{"advisories":{"1":{"id":1,"severity":"high","module_name":"picomatch","github_advisory_id":"$G","findings":[]}},$(meta 0 0 0 1 0)}
EOF
expect "a second finding's unlisted path is not excepted" 1 "picomatch  $G" <<EOF
{"advisories":{"1":{"id":1,"severity":"high","module_name":"picomatch","github_advisory_id":"$G","findings":[{"version":"4.0.7","paths":["app>picomatch"]},{"version":"4.0.6","paths":["app>other>picomatch"]}]}},$(meta 0 0 0 1 0)}
EOF
expect "the same advisory downgraded to moderate leaves a stale entry" 1 "is stale" <<EOF
{"advisories":{$(adv 1 moderate picomatch $G)},$(meta 0 0 1 0 0)}
EOF
ex "$(exc $G picomatch high '["app>picomatch","app>gone>picomatch"]' 2026-11-17 2026-12-17)"
expect "a listed path no longer reported fails" 1 "no longer reported: app>gone>picomatch" <<<"$HIGH"
ex "$(exc $G picomatch high "$P" 2026-11-17 2026-11-30)"
TODAY=2026-12-01
out="$(node "$guard" --report - --exceptions "$EXCEPTIONS" --today "$TODAY" 2>&1 <<EOF
{"advisories":{$(adv 1 high picomatch $G),$(adv 2 high braces GHSA-vfj7-8cjw-p6xm)},$(meta 0 0 0 2 0)}
EOF
)"; code=$?
if [ "$code" -eq 1 ] && grep -qF "expired on 2026-11-30" <<<"$out" && grep -qF "braces  GHSA-vfj7-8cjw-p6xm" <<<"$out"; then
  printf '✓ %s\n' "an expired entry and a fresh high are both named"
else printf '✗ expired + fresh high: want 1 naming both, got %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); fi
TODAY=2026-11-17
EXCEPTIONS="$tmp/none.json"
expect "a missing exception file means none" 1 "picomatch  $G" <<<"$HIGH"

# Offline and no-spawn: the self-test flags are refused, and a malformed list exits 3, BEFORE pnpm
# runs, so neither depends on the registry (an outage's exit 2 would otherwise be made lenient).
mkdir -p "$tmp/bin2"
cat >"$tmp/bin2/pnpm" <<'SHIM'
#!/usr/bin/env bash
: >"$SPAWN_LOG"
echo '{"error":{"code":"pnpm","message":"fetch failed"}}'
SHIM
chmod +x "$tmp/bin2/pnpm"
rm -f "$tmp/spawned"
out="$(SPAWN_LOG="$tmp/spawned" PATH="$tmp/bin2:$PATH" node "$guard" --today 2099-01-01 2>&1)"; code=$?
if [ "$code" -eq 3 ] && grep -qF "needs --report" <<<"$out" && [ ! -e "$tmp/spawned" ]; then
  printf '✓ %s\n' "--today without --report is refused (3) before pnpm runs"
else printf '✗ --today without --report: want 3 and no spawn, got %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); fi
mkdir -p "$tmp/repo/.github"; printf '{not json' >"$tmp/repo/.github/audit-exceptions.json"
rm -f "$tmp/spawned"
out="$(cd "$tmp/repo" && SPAWN_LOG="$tmp/spawned" PATH="$tmp/bin2:$PATH" node "$guard" 2>&1)"; code=$?
if [ "$code" -eq 3 ] && grep -qF "not valid JSON" <<<"$out" && [ ! -e "$tmp/spawned" ]; then
  printf '✓ %s\n' "a malformed committed list exits 3 even in a registry outage"
else printf '✗ malformed list in an outage: want 3 and no spawn, got %s\n%s\n' "$code" "$out"; fails=$((fails + 1)); fi
EXCEPTIONS="$tmp/none.json"

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
