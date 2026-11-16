- **2026-11-16** — **FAM-1: one spelling of "1 item" / "6 items"**
  ([plan](../plans/fam-1-family-program.md)). `itemCountText(n)` in `apps/web/lib/constants.ts`,
  beside `movementCount`, through `plural()`. The builder's workout line spells the count itself
  today (`workoutSummary`), and the day page's look-ahead does the same on step 13b's open branch;
  each is meant to swap its own line for this one in a later PR of its lane, and until then only the
  test calls it. It lives in the web app and not in `@mat-plan/shared` because the count is spelled
  in the app's locale, which the shared package does not have. No screen changes with this PR, no
  schema change, no new dependency.
