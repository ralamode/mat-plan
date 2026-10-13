- **2026-10-13** — **`PRIV-2` is planned, and it ships as two PRs rather than one**
  ([plan](../plans/priv-2-serve-the-notice.md)). The settled shape holds — a committed generator
  renders [notice.md](../privacy/notice.md) into a committed module, and a **byte-exact** drift test
  fails when the two diverge, so the served page cannot become a second copy of a privacy notice and
  no parser enters the `--prod` tree `audit:check` gates. What a six-lens panel changed is the
  sequencing and about twenty details. The first draft carried the notice's unfilled blanks as a test
  assertion **expected to be red for the PR's life**; `.husky/pre-push` is `pnpm typecheck` then
  `pnpm test` with no `set -e`, and `verify` is a single `&&` chain with `test` **fourth of ten**, so
  that gate would have blocked every push and stopped `db:verify`, `guards:test` and **`audit:check`**
  from running at all — on the one PR whose supply-chain argument rests on `audit:check`. So a
  docs-only `docs(priv-1)` lands first and `feat(priv-2)` opens green, with the zero-placeholder
  assertion kept as a real regression gate. That first PR also fixes **three factual errors** in the
  notice: it tells a parent _"there are no public pages"_ (which serving one makes false, and which is
  the notice's own re-review trigger), its 7-day restore promise contradicts both
  [runbooks.md](../runbooks.md) and its own next paragraph in the **only** place the notice quantifies
  retention, and its sign-off is a blank form. Why the rest matters: the panel found defects no test
  in the plan could have caught — a `dl` model that silently dropped **both tables' column headers**,
  a Tailwind preflight that would have rendered the whole notice as one unbroken block with **no
  bullets and no numbers** (while `notice.md:85` says _"that follows from (1) and (2)"_), a
  `length > 60` non-vacuity guard whose true value is ~51 so the cheapest fix was lowering it, and no
  stated escaping rule for prose that becomes compiled source. `docs/architecture.md` — which still
  calls `/` _"the only route in `PUBLIC_PATHS`"_ — and `data-inventory.md`'s staleness command, which
  does not watch the file that defines the public surface, are now in scope too.
