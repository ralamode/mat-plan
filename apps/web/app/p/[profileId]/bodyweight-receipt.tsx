import type { ReactNode } from 'react';

import { BODYWEIGHT_COPY, BODYWEIGHT_RECEIPT_ID } from '@/lib/constants';
import type { LoggedBodyweight } from '@/lib/entries/activity-totals';
import { formatValueUnit } from '@/lib/entries/format-value-unit';

/** The day's logged weights as display strings (`84.5 lb`), in the DAL's oldest-first order. */
export function formatLoggedWeights(logged: readonly LoggedBodyweight[]): string[] {
  return logged.map((l) => formatValueUnit(l.value, l.unit));
}

/**
 * The day's bodyweight, shown where the empty input used to be (V1-24 PR 1a). The copy is the
 * plan's §"The 1a receipt, exactly", verbatim, from `BODYWEIGHT_COPY`.
 *
 * ## Why a receipt and not a checkmark
 *
 * A checkmark asserts *finished* — finality. On a value that can still be corrected that is a lie;
 * and an inert field you **cannot** correct is the V1-24 data-loss bug in nicer clothes. So the
 * completeness signal is **the value itself, sitting where the input was**. See
 * docs/plans/v1-24-form-is-the-day.md.
 *
 * ## Its states
 *
 * - **One value:** `Saved: 84.5 lb`, the Change control beside it (PR 1b), then `One weigh-in per
 *   day.` on a writable day, where it is the reason there is no form.
 * - **Several values** (the pre-1c duplicates, or a two-phone race — PR 1d's index does not exist yet):
 *   `2 weights logged: 84.5 lb, 845 lb`, never silently one of them, then ONE line from
 *   `BODYWEIGHT_COPY.duplicates` in place of the one-per-day line, and no Change control: "the extra can’t be
 *   removed in the app yet" for one value repeated, "ask a parent which is right" when they differ.
 * - **None, on a closed day:** `No weight logged.` — a bare heading reads as broken. (None on a
 *   WRITABLE day is the form, not this.)
 *
 * On a closed day there is no second line: the page's closed-day notice already says why there is
 * no form, and that a logged weight can still be corrected.
 *
 * ## ⚠️ A SERVER component, and that is load-bearing
 *
 * 1. **The receipt is READ state.** `BodyweightForm` is mounted only when the day is writable (the
 *    V1-15 ±1 window). Rendering the value inside it would hide the day's state on exactly the
 *    history days V1-15 shipped — the screen this row was reported from.
 * 2. **Zero client JS.** The announcement and focus live in the sibling `SavedAnnouncer` island;
 *    this renders the `id` + `tabIndex={-1}` it focuses. PR 1b passes a `'use client'` Change
 *    control into `control` on EVERY day, closed ones included: the amend has no day bound (plan
 *    Decision 5 — an amend never moves the entry's date, so a bound buys no integrity and would
 *    render a dead control on exactly the history days a typo is found on).
 */
export function BodyweightReceipt({
  logged,
  writable,
  control,
}: {
  logged: readonly LoggedBodyweight[];
  writable: boolean;
  /** The amend affordance (PR 1b, on every day — no day bound), beside the value. */
  control?: ReactNode;
}) {
  if (logged.length === 0) {
    return <p className="text-muted-foreground text-base">{BODYWEIGHT_COPY.noneOnClosedDay}</p>;
  }

  const values = formatLoggedWeights(logged);
  return (
    <div
      id={BODYWEIGHT_RECEIPT_ID}
      // Focusable by script only (never in the tab order): `SavedAnnouncer` moves focus here after a
      // save, because the submit button that HAD focus has just unmounted and focus would otherwise
      // drop to <body>.
      tabIndex={-1}
      className="focus-visible:ring-ring/50 flex flex-col gap-1 rounded-lg border px-4 py-3 outline-none focus-visible:ring-3"
    >
      {/* ⚠️ The OPEN editor is `w-full`, so `flex-wrap` drops it onto its own line beneath the value,
          deterministically — load-bearing at 360px (why: `bodyweight-amend.tsx`). Keeping the saved
          value visible above it shows what you are changing FROM while you type. */}
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        {/* `tabular-nums` so a value changing under an amend doesn't shift the row's width. */}
        <p className="text-base font-medium tabular-nums">
          {values.length === 1
            ? BODYWEIGHT_COPY.saved(values[0]!)
            : BODYWEIGHT_COPY.several(values)}
        </p>
        {control ?? null}
      </div>
      {/* Their OWN lines, never a suffix: at 360px the card has ~294px, and the value plus the
          Change control already fills a row. */}
      {values.length > 1 ? (
        <p className="text-muted-foreground text-sm">{BODYWEIGHT_COPY.duplicates(values)}</p>
      ) : writable ? (
        <p className="text-muted-foreground text-sm">{BODYWEIGHT_COPY.onePerDay}</p>
      ) : null}
    </div>
  );
}
