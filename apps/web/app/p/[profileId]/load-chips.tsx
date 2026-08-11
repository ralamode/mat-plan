'use client';

import { CANONICAL_LOAD_LABELS } from '@mat-plan/shared';

import { Button } from '@/components/ui/button';

/**
 * One-tap load labels for a set (GAP-1 P0-2).
 *
 * WHY CHIPS AND NOT JUST A TEXT FIELD: the load input keeps the numeric keypad for the ~90% case where
 * a number is what's wanted. Typing `BW` still works, but on iOS a numeric `inputMode` offers no
 * letters — so without a tap-to-fill affordance the common bodyweight case would be the *hardest* thing
 * to enter, on the device the kids actually use.
 *
 * The labels come from `CANONICAL_LOAD_LABELS` in `packages/shared`, so the spelling the chip writes is
 * the spelling the CSV expects (`BW` upper, `band` lower) and can never drift from casing typed by hand.
 *
 * Deliberately NOT rendered in the V1-9 edit form: that path is numeric-only by design.
 */
export function LoadChips({
  onPick,
  ariaLabel,
  active,
}: {
  onPick: (label: string) => void;
  /** Context for the accessible name, e.g. "Movement 1 set 2". */
  ariaLabel: string;
  /** The set's current load, so a chip can show as selected. */
  active: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CANONICAL_LOAD_LABELS.map((label) => {
        const selected = active === label;
        return (
          <Button
            key={label}
            type="button"
            size="sm"
            variant={selected ? 'secondary' : 'outline'}
            // Toggles: tapping the active chip clears the field, so a mis-tap is recoverable without
            // hunting for the text cursor.
            onClick={() => onPick(selected ? '' : label)}
            aria-pressed={selected}
            aria-label={`${ariaLabel}: ${label}`}
          >
            {label}
          </Button>
        );
      })}
    </div>
  );
}
