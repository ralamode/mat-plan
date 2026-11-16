import type { ReactNode } from 'react';

import { BODYWEIGHT_COPY, LOGGED_ROW_CLASS } from '@/lib/constants';
import type { LoggedBodyweight } from '@/lib/entries/activity-totals';
import { formatValueUnit } from '@/lib/entries/format-value-unit';

/** The day's logged weights as display strings (`84.5 lb`), in the DAL's oldest-first order. */
export function formatLoggedWeights(logged: readonly LoggedBodyweight[]): string[] {
  return logged.map((l) => formatValueUnit(l.value, l.unit));
}

/**
 * The day's logged bodyweight, where the empty field was (V1-24 PR 1a; the prototype's logged row
 * since 3b-bw, plan W4).
 *
 * ## A tick now, and why that no longer contradicts 1a
 *
 * 1a's "a receipt, not a checkmark" held while a logged weight could not be corrected: a tick on an
 * uncorrectable value asserted a finality the app could not back. Since 1b it has Change, and since
 * 3b-bw a blank Save clears it, so the filled `done` tick says only "logged", which is true. This
 * supersedes 1a's rule (`docs/plans/v1-24-3b-logs-in-place.md`, W4).
 *
 * ## Its states
 *
 * - **One value:** `✓ 84.5 lb` (the tick in the filled done style, with `sr-only` "Logged"), and the
 *   Change control beside it on today and yesterday. No time: nothing records when a weight was taken.
 * - **Several values** (a pre-1d day, or V1-32's slots): `2 weights logged: 84.5 lb, 845 lb`, never
 *   silently one of them, then ONE line from `BODYWEIGHT_COPY.duplicates`, and no Change control.
 * - **None, on a read-only day:** `Nothing logged.` (None on a writable day is the form, not this.)
 *
 * ## ⚠️ A SERVER component, and that is load-bearing
 *
 * The row is READ state, shown on every day including read-only ones, with zero client JS. The
 * section passes a `'use client'` Change control into `control`; the live region and the focus
 * hand-off are the section's `SingleValueLive`, not this.
 */
export function BodyweightReceipt({
  logged,
  control,
}: {
  logged: readonly LoggedBodyweight[];
  /** The amend affordance (PR 1b), beside the value. Absent on a read-only day. */
  control?: ReactNode;
}) {
  if (logged.length === 0) {
    return <p className="text-muted-foreground text-base">{BODYWEIGHT_COPY.noneOnClosedDay}</p>;
  }

  const values = formatLoggedWeights(logged);
  return (
    // The done tint marks ONE logged weight (and drops while the editor is open: LOGGED_ROW_CLASS).
    // Duplicates are a problem to resolve, not a done row.
    <div
      className={`flex flex-col gap-1 rounded-lg border px-4 py-3 ${values.length === 1 ? LOGGED_ROW_CLASS : ''}`}
    >
      {/* ⚠️ The OPEN editor is `w-full`, so `flex-wrap` drops it onto its own line beneath the value,
          deterministically — load-bearing at 360px (why: `bodyweight-amend.tsx`). Keeping the saved
          value visible above it shows what you are changing FROM while you type. `min-h-11` is the
          one row height the Life row shares (plan W13). */}
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        {values.length === 1 ? (
          <p className="flex items-center gap-2 text-base font-medium tabular-nums">
            <span
              aria-hidden="true"
              className="bg-done text-done-foreground inline-flex size-6 items-center justify-center rounded-full text-sm"
            >
              ✓
            </span>
            <span className="sr-only">{BODYWEIGHT_COPY.logged} </span>
            {/* Its own element, so the value is findable on its own (`e2e/steps.ts`). */}
            <span>{values[0]}</span>
          </p>
        ) : (
          // `tabular-nums` so a value changing under an amend doesn't shift the row's width.
          <p className="text-base font-medium tabular-nums">{BODYWEIGHT_COPY.several(values)}</p>
        )}
        {control ?? null}
      </div>
      {/* Its OWN line, never a suffix: at 360px the row has ~294px, and the values already fill it. */}
      {values.length > 1 ? (
        <p className="text-muted-foreground text-sm">{BODYWEIGHT_COPY.duplicates(values)}</p>
      ) : null}
    </div>
  );
}
