'use client';

import {
  MONDAY_FIRST,
  SLOT_LABEL_MAX,
  SLOT_LABEL_SUGGESTIONS,
  type Weekday,
} from '@mat-plan/shared';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { hasItLabel, WEEK_COPY, weekdayName } from '../builder-text';
import { NameField } from '../name-field';

/**
 * A slot's label and the days it goes on (FAM-1 step 10's add form; step 10b's Copy dialog takes
 * the same fields, so the two cannot drift).
 *
 * - **Days are checkboxes in four columns**, 44px tall: seven in one row would leave 43px each at
 *   360px. Each is named by the full weekday; the visible text is the short one.
 * - **A day that already has the workout is shown ticked and inactive**, with "has it": the
 *   once-a-day rule is visible before the tap, and the skip message is only the backstop.
 */
export function DaysLabelFields({
  idPrefix,
  label,
  onLabel,
  days,
  onDays,
  hasIt,
  daysError,
  labelError,
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
  /** A refusal of the label (not one line of plain text), said on the field. */
  labelError: string | null;
}) {
  const daysHintId = `${idPrefix}-days-hint`;
  return (
    <>
      <SlotLabelField id={`${idPrefix}-label`} label={label} onLabel={onLabel} error={labelError} />
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
                // Stacked: at 360px a column is ~70px, too narrow for a box, "Wed" and "has it"
                // side by side.
                className={cn(
                  'flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-1 py-1 text-sm',
                  has && 'text-muted-foreground',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  aria-disabled={has || undefined}
                  aria-label={has ? hasItLabel(day) : weekdayName(day)}
                  onChange={() => {
                    if (has) return;
                    const next = new Set(days);
                    if (next.has(day)) next.delete(day);
                    else next.add(day);
                    onDays(next);
                  }}
                  // Dimmed, so a day that has it does not look like one the person ticked.
                  className="size-4 aria-disabled:opacity-50"
                />
                <span aria-hidden className="text-center whitespace-nowrap">
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

/**
 * A slot's label: the field and its suggestions. The add form, 10b's Copy dialog and the label
 * editor all take this one, so the field cannot drift between them.
 */
export function SlotLabelField({
  id,
  label,
  onLabel,
  error,
}: {
  id: string;
  label: string;
  onLabel: (label: string) => void;
  error: string | null;
}) {
  return (
    <div className="flex flex-col gap-2">
      <NameField
        id={id}
        label={WEEK_COPY.label}
        hint={WEEK_COPY.labelHint}
        value={label}
        max={SLOT_LABEL_MAX}
        placeholder={WEEK_COPY.labelPlaceholder}
        onChange={onLabel}
        error={error}
        optional
      />
      <LabelSuggestions label={label} onLabel={onLabel} />
    </div>
  );
}

/**
 * The label's suggestions, as buttons that fill the field (a `<datalist>` barely shows on iOS); a
 * pressed one clears it. The add form and the label editor both offer them (plan D8).
 */
export function LabelSuggestions({
  label,
  onLabel,
}: {
  label: string;
  onLabel: (label: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {SLOT_LABEL_SUGGESTIONS.map((suggestion) => (
        <Button
          key={suggestion}
          type="button"
          variant="outline"
          className="min-w-11"
          aria-pressed={label === suggestion}
          onClick={() => onLabel(label === suggestion ? '' : suggestion)}
        >
          {suggestion}
        </Button>
      ))}
    </div>
  );
}
