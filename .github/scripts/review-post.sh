#!/usr/bin/env bash
# review-post: the claude-review workflow's `post` job. No model and no PR code run here; the review
# arrives as an artifact and is treated as untrusted text. Exactly one PR comment per request:
#   - no review, or the untouched skeleton → "failed or ran out of budget" + the run URL
#   - the text matches a secret or a token shape → "withheld" + the run URL, and exit 1
#   - otherwise → the review, capped on a line boundary and stamped with the reviewed SHA; when the
#     review job did not succeed (timeout, turn limit, cancel), an "Incomplete" banner goes on top
# Plan: docs/plans/dx-1-claude-review.md. The scan is a backstop; the job split is the control.
#
# env: GH_TOKEN PR SHA RUN MAX_COMMENT_BYTES, optional T (the OAuth token, for the literal scan) and
#      REVIEW_RESULT (needs.review.result: success | failure | cancelled; unset reads as success).
# arg: the downloaded review file (default review/review.md).
set -euo pipefail

FILE="${1:-review/review.md}"
: "${PR:?}" "${RUN:?}" "${MAX_COMMENT_BYTES:?}" "${GH_TOKEN:?}"
SKELETON_MARK='<!-- claude-review:skeleton -->' # also in review-prefetch.sh; the test pins both
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT

post() { gh pr comment "$PR" --body-file "$BODY"; }
notice() { printf '%s\n' "$1" >"$BODY"; post; }

# Untouched = nothing left once the skeleton's own lines (heading, marker, placeholder) and blanks go.
# Captured, never `grep -q` in a pipe: under pipefail an early-exiting reader SIGPIPEs the writer, and
# a big REAL review then reads as untouched.
untouched() {
  [ -z "$(grep -vE '^[[:space:]]*$|^# Review in progress for |^_\(The review did not finish' "$FILE" | grep -vF "$SKELETON_MARK" || true)" ]
}
RESULT="${REVIEW_RESULT:-success}"
case "$RESULT" in *[!a-z_]*) RESULT=unknown ;; esac
if [ ! -s "$FILE" ] || untouched; then
  notice "**claude-review failed or ran out of budget** for \`${SHA:-unknown}\` (review job: $RESULT). The run log's first \`::error::\` names the cause; a prefetch refusal about \`SETTINGS_SHA256\` means the settings pin needs re-reading, not more budget. Details: $RUN"
  exit 0
fi

# The OAuth token, literally and as base64 (padding-tolerant: drop the last 4 chars), then token
# SHAPES. (The base64 needle catches one of the three byte alignments; this is a backstop, not the
# control.) The review job's GitHub token is a different token from this job's GH_TOKEN (one is minted
# per job), so only the `ghs_` shape can catch it. Every needle is guarded: `grep -F ""` matches all.
# GitHub decodes numeric HTML entities before rendering, so `&#115;k-ant-…` shows as the token: scan the
# raw text AND a copy with those entities decoded.
perl -CS -pe 's/&#[xX]([0-9a-fA-F]{1,6});/chr(hex $1)/ge; s/&#([0-9]{1,7});/chr($1)/ge' "$FILE" >"$FILE.decoded" 2>/dev/null || cp "$FILE" "$FILE.decoded"
leaked=0
for s in "${T:-}"; do
  [ -n "$s" ] || continue
  b64="$(printf '%s' "$s" | base64 | tr -d '\n')"
  for needle in "$s" "${b64%????}"; do
    [ "${#needle}" -ge 8 ] && grep -qF -- "$needle" "$FILE" "$FILE.decoded" && leaked=1
  done
done
grep -qE 'sk-ant-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}' "$FILE" "$FILE.decoded" && leaked=1
if [ "$leaked" -eq 1 ]; then
  notice "**claude-review withheld** its output: it matched a secret pattern. See $RUN (and rotate the token if it is real)."
  exit 1
fi

# Model-influenced text posts under the bot's identity: a zero-width space after EVERY @, whatever
# precedes it, so injected text can't notify users or teams. The HTML-entity spellings GitHub decodes
# to @ before it looks for mentions are turned into @ first (bracket classes: BSD sed has no /I).
ZWSP="$(printf '\342\200\213')"
sed -E -e 's/&#0*64;|&#[xX]0*40;|&[cC][oO][mM][mM][aA][tT];/@/g' -e "s/@/@${ZWSP}/g" "$FILE" >"$FILE.safe"
FILE="$FILE.safe"

# Over the cap: cut on a line boundary (a hard cut, minus any split UTF-8 character, when the kept
# bytes hold no newline), and close a code fence the cut left open so the note renders as text.
KEPT="$(mktemp)"
trap 'rm -f "$BODY" "$KEPT"' EXIT
truncate_to_cap() {
  head -c "$MAX_COMMENT_BYTES" "$FILE" >"$KEPT.raw"
  if [ "$(tr -cd '\n' <"$KEPT.raw" | wc -c)" -gt 0 ]; then
    sed '$d' "$KEPT.raw" >"$KEPT" # drop the partial last line
  else
    iconv -c -f UTF-8 -t UTF-8 <"$KEPT.raw" >"$KEPT" || true
  fi
  rm -f "$KEPT.raw"
  cat "$KEPT"
  [ $(($(grep -cE '^[[:space:]]*```' "$KEPT" || true) % 2)) -eq 0 ] || printf '\n```'
  printf '\n\n_(truncated; the full text is in the run artifact)_\n'
}

{
  printf 'Reviewed at `%s` · [run](%s)\n\n' "${SHA:-unknown}" "$RUN"
  if [ "$RESULT" != success ]; then
    printf '> **Incomplete: the review job ended `%s`; the findings below are partial and the verdict may be wrong.**\n\n' "$RESULT"
  fi
  if [ "$(wc -c <"$FILE")" -le "$MAX_COMMENT_BYTES" ]; then
    cat "$FILE"
  else
    truncate_to_cap
  fi
} >"$BODY"
post
