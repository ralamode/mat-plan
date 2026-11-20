#!/usr/bin/env bash
# Open one issue for a red scheduled check, or comment on it if the bot's copy is already open.
#
#   open-or-comment-issue.sh <title> <body-file>      (env: GH_TOKEN, REPO)
#
# - Only an OPEN issue AUTHORED BY the Actions bot counts: this repo is public, so anyone can open an
#   issue with the same title, and a title-only match would post under their body (or be pushed past
#   the listing by junk ones).
# - The title reaches jq as data (`--arg`), never inside the filter, so a quote in it cannot rewrite
#   the program.
# - The body is posted from a file (`--body-file`), never as an argument. Callers write fixed text:
#   nothing a checked page rendered belongs in it.
# - The plain listing, not `--search`: search indexing lags, so two quick red runs would each miss
#   the other's issue and open two.
set -euo pipefail

title="${1:?usage: open-or-comment-issue.sh <title> <body-file>}"
body_file="${2:?usage: open-or-comment-issue.sh <title> <body-file>}"
: "${REPO:?REPO is required}"
[ -f "$body_file" ] || { echo "body file not found: $body_file" >&2; exit 2; }

BOT='app/github-actions'
number="$(gh issue list --repo "$REPO" --state open --limit 200 --json number,title,author \
  | jq -r --arg t "$title" --arg bot "$BOT" \
    'map(select(.title == $t and .author.login == $bot)) | .[0].number // empty')"

if [ -n "$number" ]; then
  gh issue comment "$number" --repo "$REPO" --body-file "$body_file"
else
  gh issue create --repo "$REPO" --title "$title" --body-file "$body_file"
fi
