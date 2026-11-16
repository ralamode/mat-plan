- **2026-11-16** — **`SCALE-2`: Sentry's and Vercel's regions are recorded from their consoles**
  ([plan.md → SCALE-2](../plan.md#scale-2)).
  - **Sentry** stores its data in the **US** (the organisation's Data Storage Region).
  - **Vercel** runs the app's functions in **`iad1`** only, shown as Overridden (the only override in
    the tree is the `apps/web/vercel.json` pin).
  - `docs/privacy/data-inventory.md` §7 and its paragraph are updated, and the two `docs/runbooks.md`
    boxes are ticked. Both reads were made by the maintainer on 2026-11-16. Nothing any processor
    receives changes; the agreement column is still ⏳ on every row.
