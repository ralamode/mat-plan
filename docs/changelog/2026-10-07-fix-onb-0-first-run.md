- **2026-10-07** — **ONB-0: first run is honest** ([plan](../plans/onb-0-first-run.md) ·
  [UX panel](../plans/onb-0-first-run-ux-panel.md)). A brand-new household no longer inherits the
  maintainer's household's routine, and the picker no longer tells a human to run a database command.
  `routine_config = NULL` used to fall back to the **whole** `ROUTINE_CATALOG` — ~17 unexplained
  controls including seven wrestling-drill metrics grouped under the label "Brush teeth" — and now falls
  back to `NEUTRAL_DEFAULT_KEYS` = `['strength']`, which with the pinned weigh-in is the UX panel's own
  A2 candidate. **Membership and the fallback are now two lists:** membership stays the full catalog, so
  an authored item is never silently stripped on read, and `resolveProfileRoutine` is the one place they
  are paired. `resolveRoutine`'s third parameter is defaulted, so the write path
  (`validateRoutineForWrite`) is untouched and keeps catalog-as-default, which is correct there. The
  empty state is now an explained block (what the app is, what happens next, and that adding an athlete
  isn't in the app yet, with a link to the new README section) and the picker's **subhead branches**,
  because "Pick a profile to start logging." is an imperative with no object when the list is empty.
  Seeded profile 1 **was** NULL, so it gets an explicit full-catalog config — otherwise
  `e2e/global.setup.ts` and the V0-11 smoke, which drive habits and a `brush_teeth` metric there, would
  have failed the whole suite — and the guarded `null-routine-to-full-2026-10-07` correction (scoped to
  the seeded household, so it can never reach a PROF-1-created athlete elsewhere) does the same for the
  live row; run it **before** the deploy. `db:verify`'s routine proof got stronger rather than weaker:
  it now asserts no seeded fixture rides a read-time default, and sets up the NULL → set transition
  explicitly instead of inheriting it. The empty picker is unreachable from Playwright
  (`fullyParallel: true`, one shared DB), so `--state no-profiles` renders it for screenshots and the
  block renders as a `/design/tokens` inventory cell for axe in both themes plus the 360px overflow
  check; the picker also gained the 360px assertion it never had. Fixed along the way: the docstring at
  `app/p/[profileId]/routine/page.tsx` that had claimed the editor was URL-only since #157 linked it
  from Today, and the ONB-0 row's own citation, stale since OSS-2 moved the app to `/p`.
