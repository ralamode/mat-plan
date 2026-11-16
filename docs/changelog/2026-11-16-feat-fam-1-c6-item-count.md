- **2026-11-16** — **FAM-1: one spelling of "1 item" / "6 items"**
  ([plan](../plans/fam-1-family-program.md)). `itemCount(n)` in `apps/web/lib/constants.ts`,
  beside `movementCount`, through `plural()`. The builder's workout line and the day page's
  look-ahead each spelled it themselves; both lanes adopt this one in their next PR. It lives in the
  web app and not in `@mat-plan/shared` because the count is spelled in the app's locale, which the
  shared package does not have. No screen changes with this PR, no schema change, no new dependency.
