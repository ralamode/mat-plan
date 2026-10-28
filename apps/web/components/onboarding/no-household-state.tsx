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
 *    `app/design/tokens/token-sets.test.ts`. Grouping comes from the heading + `gap-3`.
 *  - **No `id`, so no `aria-labelledby`** — which is what lets this render more than once in a
 *    document, because it is also a cell in `app/design/tokens/inventory.tsx`. That route is the
 *    **only** place this gets axe-scanned in both themes and measured for overflow at 360px: the
 *    no-household picker is unreachable from the Playwright suite, which runs `fullyParallel` against
 *    one shared seeded database.
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
 * do what it says, which is exactly what parked #303. The copy names the fix without offering a
 * button that would lie about performing it.
 *
 * Pure sync Server Component — no state, no `'use client'`.
 */
export function NoHouseholdState() {
  return (
    <section className="flex max-w-prose flex-col gap-3">
      <p>{NO_HOUSEHOLD_COPY.what}</p>
      <p>{NO_HOUSEHOLD_COPY.wrongAccount}</p>
      <p>{NO_HOUSEHOLD_COPY.next}</p>
    </section>
  );
}
