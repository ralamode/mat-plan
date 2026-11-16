'use client';

import {
  FREE_TEXT_NOTE_MAX,
  TRACKING_TYPE_FIELDS,
  TRACKING_TYPE_LABELS,
  UNIT_LABELS,
  unitsOfDimension,
  type Unit,
  type UnitDimension,
} from '@mat-plan/shared';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { INPUT_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';

import {
  EDITOR_COPY,
  moveLabel,
  PENDING_CLASS,
  QUANTITY_LABELS,
  removeLabel,
  supersetSpoken,
} from './builder-text';
import { fieldId, type EditorCard, type EditorError, type EditorField } from './editor-draft';
import { NameField } from './name-field';

/** A card's controls the screen refocuses after a move or a remove. */
export type CardControl = 'up' | 'down' | 'remove';

/** An optgroup's name, where a type's unit can be of several dimensions (a Count). */
const DIMENSION_LABELS: Partial<Record<UnitDimension, string>> = {
  mass: 'Weight',
  length: 'Distance',
  time: 'Time',
  count: 'Count',
};

/**
 * One item's card in the workout editor (FAM-1 step 8; the prototype's `.ed-card`): its name and
 * type, its fields by type (`TRACKING_TYPE_FIELDS`), its instructions, and Up, Down, Remove.
 *
 * - **The fields sit two to a row.** At 360px a card's content box is about 300px: four fields in
 *   one row leave 43px of text, so a weight and its unit select don't fit (plan §8 records the
 *   difference from the prototype's one row).
 * - The ends are `aria-disabled`, never `disabled`, so focus stays on the button (the routine
 *   editor's rule). The screen says "Already first." instead.
 * - The tools are two groups, reorder left and Remove right, so 8b's superset control can go
 *   between cards without wrapping Remove under the arrows.
 */
export function ItemCard({
  card,
  label,
  isFirst,
  isLast,
  errors,
  controlRef,
  onChange,
  onUnit,
  onMove,
  onRemove,
}: {
  card: EditorCard;
  /** The superset letter (A1), or `null`. */
  label: string | null;
  isFirst: boolean;
  isLast: boolean;
  errors: readonly EditorError[];
  controlRef: (control: CardControl, node: HTMLButtonElement | null) => void;
  onChange: (field: Exclude<EditorField, 'name' | 'description'>, value: string) => void;
  onUnit: (unit: Unit) => void;
  onMove: (direction: 'up' | 'down') => void;
  /** With the tap's `event.timeStamp`, so the screen can tell a double tap. */
  onRemove: (at: number) => void;
}) {
  const { item } = card;
  const id = item.prescriptionClientId;
  const fields = TRACKING_TYPE_FIELDS[item.trackingType];
  const headingId = `card-${id}-heading`;
  const errorOf = (field: EditorField) => errors.find((error) => error.field === field) ?? null;
  const errorId = (field: EditorField) => `${fieldId(id, field)}-error`;

  const numberField = (
    field: 'sets' | 'reps' | 'value',
    text: string,
    fieldLabel: string,
    optional: boolean,
  ) => (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={fieldId(id, field)} className="text-sm font-medium">
        {fieldLabel}
        {optional ? <span className="text-muted-foreground font-normal"> (optional)</span> : null}
      </label>
      <input
        id={fieldId(id, field)}
        type="text"
        inputMode={field === 'value' ? 'decimal' : 'numeric'}
        enterKeyHint="done"
        autoComplete="off"
        value={text}
        onChange={(event) => onChange(field, event.target.value)}
        aria-invalid={errorOf(field) ? true : undefined}
        aria-describedby={errorOf(field) ? errorId(field) : undefined}
        className={`${INPUT_CLASS} w-full min-w-0`}
      />
    </div>
  );

  const units = fields.unit ? [] : fields.dimensions.map((d) => [d, unitsOfDimension(d)] as const);
  const quantityLabel = QUANTITY_LABELS[item.trackingType];
  const shownErrors = (['sets', 'reps', 'value'] as const).flatMap((field) => {
    const error = errorOf(field);
    return error ? [{ field, message: error.message }] : [];
  });

  return (
    <li
      className={cn(
        'flex flex-col gap-3 rounded-lg border p-3',
        label && 'border-l-primary border-l-4',
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        {label ? (
          <span className="text-sm font-semibold" aria-hidden>
            {label}
          </span>
        ) : null}
        <h3 id={headingId} className={`font-semibold ${NAME_WRAP_CLASS}`}>
          {label ? <span className="sr-only">{supersetSpoken(label)}: </span> : null}
          {item.itemName}
        </h3>
        <span className="text-muted-foreground shrink-0 text-sm whitespace-nowrap">
          {TRACKING_TYPE_LABELS[item.trackingType]}
        </span>
      </div>

      {fields.sets || fields.reps || quantityLabel ? (
        <div role="group" aria-labelledby={headingId} className="flex flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {fields.sets ? numberField('sets', card.sets, EDITOR_COPY.sets, false) : null}
            {fields.reps ? numberField('reps', card.reps, EDITOR_COPY.reps, true) : null}
            {quantityLabel ? numberField('value', card.value, quantityLabel, true) : null}
            {units.length ? (
              <div className="flex min-w-0 flex-col gap-1">
                <label htmlFor={fieldId(id, 'value') + '-unit'} className="text-sm font-medium">
                  {EDITOR_COPY.unit}
                </label>
                <select
                  id={fieldId(id, 'value') + '-unit'}
                  value={card.unit ?? ''}
                  onChange={(event) => onUnit(event.target.value as Unit)}
                  className={`${INPUT_CLASS} w-full min-w-0`}
                >
                  {units.length === 1
                    ? units[0]![1].map((unit) => (
                        <option key={unit} value={unit}>
                          {UNIT_LABELS[unit]}
                        </option>
                      ))
                    : units.map(([dimension, list]) => (
                        <optgroup key={dimension} label={DIMENSION_LABELS[dimension] ?? dimension}>
                          {list.map((unit) => (
                            <option key={unit} value={unit}>
                              {UNIT_LABELS[unit]}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                </select>
              </div>
            ) : null}
          </div>
          {shownErrors.map(({ field, message }) => (
            <p key={field} id={errorId(field)} className="text-destructive text-sm">
              {message}
            </p>
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm">{EDITOR_COPY.checkHint}</p>
      )}

      <NameField
        id={fieldId(id, 'notes')}
        label={EDITOR_COPY.instructions}
        value={card.notes}
        max={FREE_TEXT_NOTE_MAX}
        onChange={(value) => onChange('notes', value)}
        error={errorOf('notes')?.message ?? null}
        placeholder={EDITOR_COPY.instructionsPlaceholder}
        optional
        multiline
        announce={false}
      />

      {item.restAfter ? (
        <p className={`text-muted-foreground text-sm ${NAME_WRAP_CLASS}`}>
          {EDITOR_COPY.rest} {item.restAfter}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-1">
        {(['up', 'down'] as const).map((direction) => {
          const atEnd = direction === 'up' ? isFirst : isLast;
          return (
            <Button
              key={direction}
              ref={(node) => controlRef(direction, node)}
              type="button"
              variant="ghost"
              className={`min-w-11 ${PENDING_CLASS}`}
              aria-label={moveLabel(direction, item.itemName)}
              aria-disabled={atEnd || undefined}
              onClick={() => onMove(direction)}
            >
              <span aria-hidden>{direction === 'up' ? '↑ ' : '↓ '}</span>
              {direction === 'up' ? EDITOR_COPY.up : EDITOR_COPY.down}
            </Button>
          );
        })}
        <Button
          ref={(node) => controlRef('remove', node)}
          type="button"
          variant="ghost"
          className="text-destructive ml-auto min-w-11"
          aria-label={removeLabel(item.itemName)}
          // A held Enter repeats the click on the next card's Remove, which takes focus.
          onKeyDown={(event) => {
            if (event.repeat) event.preventDefault();
          }}
          onClick={(event) => onRemove(event.timeStamp)}
        >
          {EDITOR_COPY.remove}
        </Button>
      </div>
    </li>
  );
}
