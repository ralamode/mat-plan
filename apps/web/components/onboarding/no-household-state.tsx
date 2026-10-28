import { NO_HOUSEHOLD_COPY } from '@/lib/constants';

/**
 * "This account has no household" (AUTH-1 1c-2) — the state `PickerEmptyState` must stop absorbing.
 *
 * Today `listProfiles` returns `[]` for a null scope AND for a household with no athletes, so both
 * land on `PICKER_EMPTY_COPY` — which tells the reader that adding an athlete _"takes a change to
 * this deployment's seed data"_ and offers a link into a public GitHub repo. That is wrong for every
 * reader of THIS state, and after 1c-4 one of those readers is an invited parent on a gym floor.
 *
 * 🔴 **The copy is cause-free on purpose.** `householdState()` answers `'none'` for five different
 * situations (unseeded deploy · table missing · parent with no membership · the maintainer before
 * the claim correction · **the wrong Google account**, the likeliest on a phone). Naming one would
 * be false for the other four, so the cause lives in `scope_outcome` telemetry and the runbook, and
 * this screen says only what is true in all five. See `NO_HOUSEHOLD_COPY`.
 *
 * Follows `PickerEmptyState`'s committed constraints for the same reasons, which are not style:
 *
 *  - **No box.** `border` measures **1.26:1** on the light page and is pinned as failing SC 1.4.11 in
 *    `app/design/tokens/token-sets.test.ts`. Grouping comes from `gap-3`.
 *  - 🔴 **No heading of its own, and a `<div>` rather than `<section>`.** `PickerEmptyState` earns its
 *    `<section>` from the `<h2>` that names it; this block has none, because `p/page.tsx` swaps the
 *    PAGE's `<h1>` to `NO_HOUSEHOLD_COPY.heading`. A `<section>` with no accessible name is exposed as
 *    a generic element — a `div` wearing a section's name — so it is a `div`. **That also makes this
 *    component coupled to its host:** render it only where the `<h1>` is already this state's heading,
 *    or the block arrives unlabelled. (`no-household-state.test.tsx` pins the no-heading contract.)
 *  - **No `id`, so no `aria-labelledby`** — which is what lets this render more than once in a
 *    document, because it is also a cell in `app/design/tokens/inventory.tsx`. That route is the
 *    **only** place this gets axe-scanned in both themes and measured for overflow at 360px: the
 *    no-household picker is unreachable from the Playwright suite, which runs `fullyParallel` against
 *    one shared seeded database. ⚠️ That cell does NOT cover the `<h1>`, the subhead or the theme
 *    block, which are the parts most likely to overflow at 200% text.
 *  - **`text-foreground` on the explanatory paragraphs**, not `text-muted-foreground` (4.74:1 — AA by
 *    0.24). Prose read once, cold, on a phone should not sit on the AA floor.
 *
 * ⚠️ **Props-free and no Server Action**, deliberately: the inventory cell renders it directly, and a
 * `'use server'` import reachable from `/design/tokens` would put an action in a page's module graph
 * for no reason. The one control this state will eventually have — **Sign out** — therefore lives in
 * `p/page.tsx`'s `mt-auto` block, not in here.
 *
 * 🔴 **That control arrives at 1c-3, not here.** Until the session is the boundary, signing out of
 * Clerk would leave the gate cookie in place and the person still logged in — a control that does not
 * do what it says, which is exactly what parked #303. So the copy names the fix AND says the control
 * is not here yet (`NO_HOUSEHOLD_COPY.notYet`, the `PICKER_EMPTY_COPY.notYet` idiom): without that
 * line `wrongAccount` prescribes an action with no affordance anywhere on the page, and `next`'s
 * *"Otherwise"* reads as though the first branch were live. **1c-3 deletes `notYet` and ships the
 * button.**
 *
 * Pure sync Server Component — no state, no `'use client'`.
 */
export function NoHouseholdState() {
  return (
    <div className="flex max-w-prose flex-col gap-3">
      <p>{NO_HOUSEHOLD_COPY.what}</p>
      <p>{NO_HOUSEHOLD_COPY.wrongAccount}</p>
      <p className="text-muted-foreground text-sm">{NO_HOUSEHOLD_COPY.notYet}</p>
      <p>{NO_HOUSEHOLD_COPY.next}</p>
    </div>
  );
}
