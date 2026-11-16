'use client';

import {
  MONDAY_FIRST,
  SLOT_LABEL_MAX,
  SLOT_LABEL_SUGGESTIONS,
  type Weekday,
} from '@mat-plan/shared';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { WEEK_COPY, weekdayName } from '../builder-text';
import { NameField } from '../name-field';

/**
 * A slot's label and the days it goes on (FAM-1 step 10's add form; step 10b's Copy dialog takes
 * the same fields, so the two cannot drift).
 *
 * - **Days are checkboxes in four columns**, 44px tall: seven in one row would leave 43px each at
 *   360px. Each is named by the full weekday; the visible text is the short one.
 * - **A day that already has the workout is shown ticked and inactive**, with "has it": the
 *   once-a-day rule is visible before the tap, and the skip message is only the backstop.
 * - The label's suggestions are buttons that fill the field (a `<datalist>` barely shows on iOS).
 */
export function DaysLabelFields({
  idPrefix,
  label,
  onLabel,
  days,
  onDays,
  hasIt,
  daysError,
}: {
  idPrefix: string;
  label: string;
  onLabel: (label: string) => void;
  days: ReadonlySet<Weekday>;
  onDays: (days: Set<Weekday>) => void;
  /** Days that already have the chosen workout. */
  hasIt: ReadonlySet<Weekday>;
  /** A refusal of the days ("Pick at least one day."), said in the fieldset. */
  daysError: string | null;
}) {
  const daysHintId = `${idPrefix}-days-hint`;
  return (
    <>
      <div className="flex flex-col gap-2">
        <NameField
          id={`${idPrefix}-label`}
          label={WEEK_COPY.label}
          hint={WEEK_COPY.labelHint}
          value={label}
          max={SLOT_LABEL_MAX}
          placeholder="e.g. Morning"
          onChange={onLabel}
          error={null}
          optional
        />
        <div className="flex flex-wrap gap-2">
          {SLOT_LABEL_SUGGESTIONS.map((suggestion) => (
            <Button
              key={suggestion}
              type="button"
              variant="outline"
              className="min-w-11"
              aria-pressed={label === suggestion}
              onClick={() => onLabel(suggestion)}
            >
              {suggestion}
            </Button>
          ))}
        </div>
      </div>
      <fieldset
        className="flex flex-col gap-2"
        aria-describedby={daysHintId}
        aria-invalid={daysError ? true : undefined}
      >
        <legend className="mb-2 text-sm font-medium">{WEEK_COPY.days}</legend>
        <div className="grid grid-cols-4 gap-2">
          {MONDAY_FIRST.map((day) => {
            const has = hasIt.has(day);
            const checked = has || days.has(day);
            return (
              <label
                key={day}
                className={cn(
                  'flex min-h-11 items-center gap-2 rounded-lg border px-2 text-sm',
                  has && 'text-muted-foreground',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  aria-disabled={has || undefined}
                  aria-label={has ? `${weekdayName(day)}, ${WEEK_COPY.hasIt}` : weekdayName(day)}
                  onChange={() => {
                    if (has) return;
                    const next = new Set(days);
                    if (next.has(day)) next.delete(day);
                    else next.add(day);
                    onDays(next);
                  }}
                  className="size-4"
                />
                <span aria-hidden>
                  {weekdayName(day, 'short')}
                  {has ? <span className="block text-xs">{WEEK_COPY.hasIt}</span> : null}
                </span>
              </label>
            );
          })}
        </div>
        <p
          id={daysHintId}
          className={daysError ? 'text-destructive text-sm' : 'text-muted-foreground text-sm'}
        >
          {daysError ?? WEEK_COPY.oncePerDay}
        </p>
      </fieldset>
    </>
  );
}
