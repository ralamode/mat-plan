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
 *    0.24). Prose read once, cold, on a phone should not sit on the AA floor. (1c-2 carried a muted
 *    `notYet` exception; 1c-3b shipped the control it apologised for and deleted it.)
 *
 * ⚠️ **Props-free and no Clerk import**, deliberately: the inventory cell renders it directly, and a
 * `useClerk()` component reachable from `/design/tokens` would throw there — that route is captured
 * by the keyless harness, so no `<ClerkProvider>` exists. **Sign out therefore lives in
 * `p/page.tsx`'s `mt-auto` block**, where the page can branch on `clerkIsConfigured()`.
 *
 * ✅ **Sign out shipped in 1c-3b**, in that block. The wrong-Google-account line below prescribes
 * it, and until 1c-3b there was no control to prescribe — which is why 1c-2 carried a `notYet`
 * line rather than a button that would have lied about what it did (the argument that parked #303).
 *
 * Pure sync Server Component — no state, no `'use client'`.
 */
export function NoHouseholdState() {
  return (
    <div className="flex max-w-prose flex-col gap-3">
      <p>{NO_HOUSEHOLD_COPY.what}</p>
      <p>{NO_HOUSEHOLD_COPY.wrongAccount}</p>
      <p>{NO_HOUSEHOLD_COPY.next}</p>
    </div>
  );
}
