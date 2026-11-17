- **2026-11-17** — **A push tests only what it carries: the committed changes, not the working tree**
  (`DX-18`, a fix to 1a). The pre-push used vitest's `--changed`, which also counts staged, unstaged
  and untracked files. A mutation patch left applied, or another local edit, made a database-and-docs
  push run the editor suites for about 22 minutes.

  `test-changed.mjs` now:
  - traces only the `base...HEAD` diff, with `vitest related` on absolute paths;
  - reports local changes as untested.

  The self-test gains a case for each, plus one that the run never uses `--changed`. No roadmap item
  moved.
