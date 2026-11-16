'use client';

import {
  FREE_TEXT_NOTE_MAX,
  SLOT_LABEL_MAX,
  TRACKING_TYPE_FIELDS,
  TRACKING_TYPE_LABELS,
  UNIT_DIMENSION_BY_CODE,
  UNIT_LABELS,
  unitsForTrackingType,
  type Unit,
  type UnitDimension,
} from '@mat-plan/shared';

import { Button } from '@/components/ui/button';
import { NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import {
  EDITOR_COPY,
  linkLabel,
  linkText,
  moveLabel,
  PENDING_CLASS,
  quantityLabel,
  removeLabel,
  restForLabel,
  supersetSpoken,
  UNIT_GROUP_LABELS,
  type MoveDirection,
} from './builder-text';
import {
  fieldId,
  unitFieldId,
  type EditorCard,
  type EditorError,
  type EditorField,
} from './editor-draft';
import { FieldLabel } from './field-label';
import { FIELD_CLASS, NameField } from './name-field';

/** A card's controls the screen refocuses after a move or a remove. */
export type CardControl = MoveDirection | 'remove' | 'link';

/** A card's link to the next card: whether they are linked, and what a link would join. */
export type CardLink = {
  linked: boolean;
  /** The two letters, when linking would join two supersets. */
  joins: readonly [string, string] | null;
  next: string;
};

/** The units the select offers (`unitsForTrackingType`), grouped by dimension for a Count. */
function unitGroups(type: Parameters<typeof unitsForTrackingType>[0]) {
  const groups = new Map<UnitDimension, Unit[]>();
  for (const unit of unitsForTrackingType(type)) {
    const dimension = UNIT_DIMENSION_BY_CODE[unit];
    groups.set(dimension, [...(groups.get(dimension) ?? []), unit]);
  }
  return [...groups];
}

const unitOptions = (units: readonly Unit[]) =>
  units.map((unit) => (
    <option key={unit} value={unit}>
      {UNIT_LABELS[unit]}
    </option>
  ));

/**
 * One item's card in the workout editor (FAM-1 step 8; the prototype's `.ed-card`): its name and
 * type, its fields by type (`TRACKING_TYPE_FIELDS`), its instructions, and Up, Down, Remove.
 *
 * - **The fields sit two to a row on a phone.** At 360px a card's content box is about 300px: four
 *   fields in one row leave 43px of text, so a weight and its unit select don't fit (guide
 *   invariant 14). From `sm` they sit in one row, as the prototype's.
 * - Everything under the card's heading is one group named by it, so five "Instructions" fields
 *   are told apart.
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
  link,
  onLink,
  restLetter,
  onRest,
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
  onMove: (direction: MoveDirection) => void;
  /** With the tap's `event.timeStamp`, so the screen can tell a double tap. */
  onRemove: (at: number) => void;
  /** `null` on the last card. */
  link: CardLink | null;
  /** With the tap's `event.timeStamp`, as Remove. */
  onLink: (at: number) => void;
  /** The superset's letter when this card is its last, where the group's rest is edited. */
  restLetter: string | null;
  onRest: (value: string) => void;
}) {
  const { item } = card;
  const id = item.prescriptionClientId;
  const fields = TRACKING_TYPE_FIELDS[item.trackingType];
  const headingId = `card-${id}-heading`;
  const errorOf = (field: EditorField) => errors.find((error) => error.field === field) ?? null;
  const errorId = (field: EditorField) => `${fieldId(id, field)}-error`;
  const quantity = quantityLabel(item.trackingType);
  const groups = fields.slot && !fields.unit ? unitGroups(item.trackingType) : [];

  const numberField = (
    field: 'sets' | 'reps' | 'value',
    text: string,
    fieldLabel: string,
    optional: boolean,
  ) => (
    <div className="flex min-w-0 flex-col gap-1">
      <FieldLabel htmlFor={fieldId(id, field)} optional={optional}>
        {fieldLabel}
      </FieldLabel>
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
        className={FIELD_CLASS}
      />
    </div>
  );

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

      <div role="group" aria-labelledby={headingId} className="flex flex-col gap-3">
        {fields.sets || fields.reps || quantity ? (
          <div className="flex flex-col gap-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {fields.sets ? numberField('sets', card.sets, EDITOR_COPY.sets, false) : null}
              {fields.reps ? numberField('reps', card.reps, EDITOR_COPY.reps, true) : null}
              {quantity ? numberField('value', card.value, quantity, true) : null}
              {groups.length ? (
                <div className="flex min-w-0 flex-col gap-1">
                  <FieldLabel htmlFor={unitFieldId(id)}>{EDITOR_COPY.unit}</FieldLabel>
                  <select
                    id={unitFieldId(id)}
                    value={card.unit ?? ''}
                    onChange={(event) => onUnit(event.target.value as Unit)}
                    className={FIELD_CLASS}
                  >
                    {card.unit ? null : (
                      <option value="" disabled>
                        {EDITOR_COPY.chooseUnit}
                      </option>
                    )}
                    {groups.length === 1
                      ? unitOptions(groups[0]![1])
                      : groups.map(([dimension, units]) => (
                          <optgroup
                            key={dimension}
                            label={UNIT_GROUP_LABELS[dimension] ?? dimension}
                          >
                            {unitOptions(units)}
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
          hint={EDITOR_COPY.instructionsHint}
          value={card.notes}
          max={FREE_TEXT_NOTE_MAX}
          onChange={(value) => onChange('notes', value)}
          error={errorOf('notes')?.message ?? null}
          optional
          multiline
          announce={false}
        />
      </div>

      <div className="flex flex-wrap items-center gap-1">
        {(['up', 'down'] as const).map((direction) => (
          <Button
            key={direction}
            ref={(node) => controlRef(direction, node)}
            type="button"
            variant="ghost"
            className={`min-w-11 ${PENDING_CLASS}`}
            aria-label={moveLabel(direction, item.itemName)}
            aria-disabled={(direction === 'up' ? isFirst : isLast) || undefined}
            onClick={() => onMove(direction)}
          >
            <span aria-hidden>{direction === 'up' ? '↑ ' : '↓ '}</span>
            {EDITOR_COPY[direction]}
          </Button>
        ))}
        <Button
          ref={(node) => controlRef('remove', node)}
          type="button"
          variant="ghost"
          className="text-destructive ml-auto min-w-11"
          aria-label={removeLabel(item.itemName)}
          // A held Enter repeats the click on the next card's Remove, which takes focus. Other
          // held keys (Tab, arrows) pass.
          onKeyDown={(event) => {
            if (event.repeat && event.key === 'Enter') event.preventDefault();
          }}
          onClick={(event) => onRemove(event.timeStamp)}
        >
          {EDITOR_COPY.remove}
        </Button>
      </div>

      {link ? (
        <div>
          <Button
            ref={(node) => controlRef('link', node)}
            type="button"
            variant="outline"
            className="min-w-11"
            aria-label={linkLabel(linkText(link), link.next)}
            onKeyDown={(event) => {
              if (event.repeat && event.key === 'Enter') event.preventDefault();
            }}
            onClick={(event) => onLink(event.timeStamp)}
          >
            {linkText(link)}
          </Button>
        </div>
      ) : null}

      {/* The group's rest, last in the card: what moves in and out of a card on a link sits
          below the tapped control, so the control never moves under the thumb. */}
      {restLetter ? (
        <NameField
          id={fieldId(id, 'rest')}
          label={
            <>
              {EDITOR_COPY.rest}
              <span className="sr-only"> {restForLabel(restLetter)}</span>
            </>
          }
          value={item.restAfter ?? ''}
          max={SLOT_LABEL_MAX}
          placeholder={EDITOR_COPY.restPlaceholder}
          onChange={onRest}
          error={errorOf('rest')?.message ?? null}
          optional
          announce={false}
        />
      ) : null}
    </li>
  );
}
