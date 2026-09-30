import type { ReactNode } from 'react';

import { formatValueUnit } from '@/lib/entries/format-value-unit';
import type { LoggedBodyweight } from '@/lib/entries/activity-totals';

/**
 * The day's logged bodyweight, shown where the empty input used to be (V1-24 PR 1a).
 *
 * ## Why a receipt and not a checkmark
 *
 * A checkmark asserts *finished* — finality. On a value that can still be corrected that is a lie;
 * and an inert field you **cannot** correct is the V1-24 data-loss bug in nicer clothes, which is what
 * check-ins ship today. So the completeness signal is **the value itself, sitting where the input
 * was**: past tense, factual, and facts are amendable. See docs/plans/v1-24-form-is-the-day.md.
 *
 * ## ⚠️ A SERVER component, and that is load-bearing in two ways
 *
 * 1. **The receipt is READ state.** `BodyweightForm` is mounted only when the day is writable
 *    (`page.tsx`, the V1-15 ±1 window). Rendering the value *inside* it would make the day's state
 *    invisible on exactly the history days V1-15 shipped — the screen this whole row was reported
 *    from. So `page.tsx` renders this OUTSIDE that gate, and the day's truth shows on every day.
 * 2. **Zero client JS.** The `EditableSet` rule (`editable-set.tsx`): hydrate only where a control
 *    actually exists. A read-only receipt on a closed day ships no JavaScript at all; PR 1b passes a
 *    `'use client'` Change control into `control` only when the day is writable.
 *
 * `control` is a SLOT rather than a prop-driven button for the same reason the check-in amend will
 * need one: the control's form association differs per surface, and a component that owns its own
 * `<form>` cannot be nested inside `CheckinForm`'s single batch form (invalid HTML).
 */
export function BodyweightReceipt({
  logged,
  control,
  note,
}: {
  logged: LoggedBodyweight;
  /** The amend affordance, when the day allows one. PR 1a passes none — see `note`. */
  control?: ReactNode;
  /** Why there is no control, when there isn't one. Never rendered as a disabled button: a dead
   *  control is what teaches someone the app is broken (the 2026-09-28 lesson). */
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border px-4 py-3">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        {/* `tabular-nums` so a value changing under an amend doesn't shift the row's width. */}
        <span className="text-base font-medium tabular-nums">
          {formatValueUnit(logged.value, logged.unit)}
        </span>
        {control ?? null}
      </div>
      {/* Its OWN line, never a suffix: at 360px the usable width is ~294px, and the value plus an
          88px control already fills it. A reason wrapped onto the value's line would push the
          control below the fold on the narrow phone this is read on. */}
      {note ? <p className="text-muted-foreground text-sm">{note}</p> : null}
    </div>
  );
}
