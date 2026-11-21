# An end-to-end test for restoring an archived athlete from the add-athlete form

Tech debt: "The archived-match → Restore path has no end-to-end test, because Playwright hangs on
`/p/new` after an archive" (closed and removed).

### Added

- `apps/web/e2e/athletes.spec.ts`: archive Athlete Three, open Add athlete, type the name in lower
  case, and the duplicate warning shows the stored spelling with **Restore Athlete Three**. Tapping
  it lands on their day page, and the picker lists them once. It reuses the seeded archive fixture,
  so it adds no athlete to the e2e household, and it restores at the start and in a `finally`, so a
  retry on the same database starts clean.

### Not changed

- Nothing in the app. The hang the row recorded does not reproduce, on `main` or at the commit that
  filed it, with page listeners and a trace on. The attempt that hung was never committed, so its
  cause cannot be recovered; [lessons.md](../lessons.md) → E2E / Playwright has the measurement and
  the rule it leaves.
