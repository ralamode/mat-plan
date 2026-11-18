# A hook stops a Claude session from killing processes by name

DX-18 1b, the guard half ([plan](../plans/dx-18-heavy-runs-to-ci.md), D2). A second `PreToolUse`
Bash hook, `.claude/hooks/guard-process-kill.mjs`, applies in every directory and denies `pkill`,
`killall`, `fuser -k`, a `kill` of a command substitution or of pids fed by `xargs`, and `kill 0`,
`kill 1`, `kill -1`, a negative pid and `kill -- …`. It allows `kill <pid>`, `kill $!`,
`kill "$name"` and `kill %job`, and a command that only mentions `pkill` (a commit message, a
heredoc). It reads the command with the main-checkout guard's lexer, sees through the same wrappers
(`sudo`, `env`, `timeout`, `xargs`, `bash -c`, `find -exec`, …), fails open, and does nothing under
CI. The escape is a leading `MAT_PLAN_ALLOW_PATTERN_KILL=1`.

- `hooks.test.sh` gains the kill guard's cases (each deny form, each wrapper, the allowed forms, the
  mentions, the escape, CI, and both registered hooks loading).
- The review workflow's settings pin moves: `PINNED_HOOKS` lists the new hook and `SETTINGS_SHA256`
  is the new `settings.json`; `review-prefetch.test.sh` refuses a kill guard without its CI exit.
- The heavy-run slot (D3) follows after #554.
