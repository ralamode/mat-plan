#!/usr/bin/env bash
# Self-test for review-post.sh with a stub `gh` that records the posted body. No network.
#
#   bash .github/scripts/review-post.test.sh
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
fails=0

mkdir -p "$tmp/bin"
cat >"$tmp/bin/gh" <<EOF
#!/usr/bin/env bash
# gh pr comment <n> --body-file <f>  → count the post and keep its body
echo x >>"$tmp/posts"; cp "\$5" "$tmp/body"
EOF
chmod +x "$tmp/bin/gh"

T_SECRET='sk-ant-oat01-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
GH_SECRET='ghs_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

# expect <name> <want-exit> <body-grep> ; review text on stdin ("-" for no file)
expect() {
  rm -f "$tmp/posts" "$tmp/body" "$tmp/review.md"
  content="$(cat)"
  [ "$content" = "-" ] || printf '%s\n' "$content" >"$tmp/review.md"
  (PATH="$tmp/bin:$PATH" GH_TOKEN="$GH_SECRET" T="$T_SECRET" PR=7 SHA=abc123 RUN=https://run MAX_COMMENT_BYTES="${CAP:-60000}" \
    bash "$here/review-post.sh" "$tmp/review.md" >/dev/null 2>&1)
  code=$?
  posts="$(wc -l <"$tmp/posts" 2>/dev/null | tr -d ' ')"
  if [ "$code" -eq "$2" ] && [ "${posts:-0}" = 1 ] && grep -qF -- "$3" "$tmp/body"; then printf '✓ %s\n' "$1"
  else printf '✗ %s: exit %s (want %s), posts %s, body:\n%s\n' "$1" "$code" "$2" "${posts:-0}" "$(cat "$tmp/body" 2>/dev/null)"; fails=$((fails + 1)); fi
}

expect "a clean review is posted, stamped with the SHA" 0 'Reviewed at `abc123`' <<<'## Review — x (#7)'
expect "no review file → one failure notice, never silence" 0 'failed or ran out of budget' <<<'-'
expect "the untouched skeleton → failure notice" 0 'failed or ran out of budget' <<'EOF'
# Review in progress for abc123

<!-- claude-review:skeleton -->
_(The review did not finish; see the run log.)_
EOF
expect "heading kept, findings added → posted, not called a failure" 0 'Reviewed at `abc123`' <<'EOF'
# Review in progress for abc123

**Verdict:** fix P0s first · P0 1
<!-- claude-review:skeleton -->
EOF
expect "the literal OAuth token → withheld, exit 1" 1 'withheld' <<<"leak: $T_SECRET"
expect "a token-SHAPED GitHub token (the review job's) → withheld" 1 'withheld' <<<"leak: $GH_SECRET"
T_SECRET='plainsecretvalue123456' expect "an unshaped OAuth value, literally → withheld (the literal scan)" 1 'withheld' <<<"leak: plainsecretvalue123456"
T_SECRET='plainsecretvalue123456' expect "an unshaped OAuth value, as base64 → withheld" 1 'withheld' <<<"leak: $(printf '%s' plainsecretvalue123456 | base64)"
expect "base64 of the OAuth token → withheld" 1 'withheld' <<<"leak: $(printf '%s' "$T_SECRET" | base64)"
expect "a token-shaped string that isn't ours → withheld" 1 'withheld' <<<'leak: ghp_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
expect "@mentions are broken (injected text can't ping people)" 0 "@$(printf '\342\200\213')some-user" <<<'please cc @some-user and @org/team'
if ! grep -qE '(^|[^[:alnum:]])@some-user' "$tmp/body"; then echo "✓ no live @mention survives"; else echo "✗ a live @mention survived"; fails=$((fails + 1)); fi
expect "an email address is left alone" 0 'ray@example.com' <<<'contact ray@example.com'
long="$(for i in $(seq 1 400); do echo "line $i of a long review"; done)"
CAP=2000 expect "an over-cap review is cut on a line boundary with a note" 0 'truncated' <<<"$long"
if tail -3 "$tmp/body" | head -1 | grep -qE '^line [0-9]+ of a long review$|^$'; then echo "✓ the cut leaves no partial line"; else echo "✗ partial line after the cut"; fails=$((fails + 1)); fi

[ "$fails" -eq 0 ] && echo "all review-post self-tests passed" || exit 1
