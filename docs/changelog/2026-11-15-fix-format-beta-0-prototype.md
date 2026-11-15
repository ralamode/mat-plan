---
id: CI
pr: 407
---

## Main's format check passes again: the Beta 0 prototype is formatted

#405 added `docs/prototypes/beta-0/index.html` without running Prettier on it. The pre-commit hook
formats only `js, ts, json, md, css, yml` and their variants, **not `.html`**, so the gap first
surfaced in CI's `pnpm format:check`. #405 was merged with that check red, which left the quality
job failing for every PR.

This runs `prettier --write` on that one file. Its behaviour is unchanged: the inline script passes
`node --check`, and the prototype's jsdom smoke script gives identical output for both versions.

⚠️ **The lesson:** read the checks before merging, never the merge-tree alone. Anyone adding an
`.html` prototype should run `npx prettier --write` on it, since the hook won't.
