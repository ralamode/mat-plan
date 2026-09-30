#!/usr/bin/env bash
# review-post: the claude-review workflow's `post` job. No model and no PR code run here; the review
# arrives as an artifact and is treated as untrusted text. Exactly one PR comment per request:
#   - no review, or the untouched skeleton → "failed or ran out of budget" + the run URL
#   - the text matches a secret or a token shape → "withheld" + the run URL, and exit 1
#   - otherwise → the review, capped on a line boundary and stamped with the reviewed SHA
# Plan: docs/plans/dx-1-claude-review.md. The scan is a backstop; the job split is the control.
#
# env: GH_TOKEN PR SHA RUN MAX_COMMENT_BYTES, optional T (the OAuth token, for the literal scan).
# arg: the downloaded review file (default review/review.md).
set -euo pipefail

FILE="${1:-review/review.md}"
: "${PR:?}" "${RUN:?}" "${MAX_COMMENT_BYTES:?}" "${GH_TOKEN:?}"
SKELETON='# Review in progress for'
BODY="$(mktemp)"
trap 'rm -f "$BODY"' EXIT

post() { gh pr comment "$PR" --body-file "$BODY"; }
notice() { printf '%s\n' "$1" >"$BODY"; post; }

if [ ! -s "$FILE" ] || head -1 "$FILE" | grep -qF "$SKELETON"; then
  notice "**claude-review failed or ran out of budget** for \`${SHA:-unknown}\`. Details: $RUN"
  exit 0
fi

# Literal secrets and their base64 (padding-tolerant: drop the last 4 chars), then token shapes.
# Every needle is guarded: `grep -F ""` matches everything.
leaked=0
for s in "${T:-}" "$GH_TOKEN"; do
  [ -n "$s" ] || continue
  b64="$(printf '%s' "$s" | base64 | tr -d '\n')"
  for needle in "$s" "${b64%????}"; do
    [ "${#needle}" -ge 8 ] && grep -qF -- "$needle" "$FILE" && leaked=1
  done
done
grep -qE 'sk-ant-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}' "$FILE" && leaked=1
if [ "$leaked" -eq 1 ]; then
  notice "**claude-review withheld** its output: it matched a secret pattern. See $RUN (and rotate the token if it is real)."
  exit 1
fi

{
  printf 'Reviewed at `%s` · [run](%s)\n\n' "${SHA:-unknown}" "$RUN"
  if [ "$(wc -c <"$FILE")" -le "$MAX_COMMENT_BYTES" ]; then
    cat "$FILE"
  else
    head -c "$MAX_COMMENT_BYTES" "$FILE" | sed '$d' # drop the partial last line
    printf '\n\n_(truncated; the full text is in the run artifact)_\n'
  fi
} >"$BODY"
post
