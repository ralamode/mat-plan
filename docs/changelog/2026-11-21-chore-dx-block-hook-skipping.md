- **2026-11-21** — **Claude sessions can no longer skip git's hooks** (maintainer). A new `PreToolUse`
  guard, `.claude/hooks/guard-hook-skip.mjs`, refuses `--no-verify`, `git commit -n`, `HUSKY=0` and
  any `core.hooksPath` change, in every directory, with a visible escape for when a person asks. The
  docs-only overlap rule skips waiting for another CI run, never the hooks (`docs/lessons.md`). The
  kill guard's wrapper walk moved to `.claude/hooks/shell-commands.mjs`, which both guards share.
