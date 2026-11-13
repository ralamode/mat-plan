- **2026-11-12** — **an argument named `_something` is documentation, not dead code, and the linter
  now agrees** _(maintainer's call)_. `@typescript-eslint/no-unused-vars` gains
  `argsIgnorePattern: '^_'`. The convention already had adherents in this repo and the linter had
  never honoured it: of the eight warnings [#377](https://github.com/ralamode/mat-plan/pull/377)
  cleared, **four were underscore-prefixed on purpose** — two mock parameters typing a call whose
  assertions read `calls[0][1]`, and two in a middleware mock the handler shape requires. Writing
  `_exec` is how an author says "this exists because the signature needs it"; the linter answering
  "unused" left them choosing between a misleading name and a suppression comment. ⚠️ **It silences
  nothing today** — #377 fixed all eight by other means, so `pnpm lint` was already clean — which is
  why it is a separate, forward-looking change. 🔴 **Arguments only:** `varsIgnorePattern` and
  `caughtErrorsIgnorePattern` are deliberately not set, because an unused local or `catch` binding is
  dead code with no signature forcing it to exist, and renaming one to `_x` is precisely what this
  rule should keep catching. Probed three ways before shipping: an underscored arg is silent, a bare
  one still warns, and an underscored local still warns.
