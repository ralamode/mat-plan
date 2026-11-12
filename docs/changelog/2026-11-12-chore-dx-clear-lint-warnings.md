- **2026-11-12** — **the app's three `no-unused-vars` lint warnings are gone, and neither fix was a
  suppression.** `undo-line.tsx` imported `ANNOUNCE_AFTER_FOCUS_MS` and never used it — a leftover
  from when the focus-then-announce delay moved to `athlete-list.tsx`, which is its one real consumer
  and where the component's own docblock says the live region lives. The bodyweight DAL test's mock
  declared `(_exec, _args)` to type a two-argument call that its assertions read as
  `mock.calls[0][1]`; the signature is now a `vi.fn<…>` generic, so the shape is still typed and
  nothing is unused. ⚠️ The tempting third option — adding `argsIgnorePattern: '^_'` to the eslint
  config — was **not** taken: the underscore convention is conventional enough that the original
  author clearly expected it to work, but changing it is a decision about the repo's bar rather than
  a fix to this code, and it is the maintainer's to make.
