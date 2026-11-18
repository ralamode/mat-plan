'use client';

import {
  EQUIPMENT_FILTER_SHOWN_FIRST,
  EQUIPMENT_LABELS,
  MUSCLES,
  MUSCLE_LABELS,
  equipmentFilterOrder,
  movementFiltersOn,
  type Equipment,
  type EquipmentChoice,
  type MovementFilterCounts,
  type MovementFilters,
  type Muscle,
} from '@mat-plan/shared';
import { useId, useState, type ReactNode, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { MOVEMENT_PICKER_COPY as COPY } from '@/lib/movements/movement-picker-copy';
import { cn } from '@/lib/utils';

/**
 * The movement picker's filter panel (CAT-3 P7, P15; B2-ii). **It replaces the sheet's body and
 * footer while open** (panel row 11), as the new-item form does, rather than opening a second modal
 * sheet: one sheet is open at a time (`sheet.tsx`), and the back gesture and the keyboard geometry
 * stay the sheet's. The picker owns the state; this file only draws it and reports each change.
 *
 * 🔴 **A choice that would leave nothing is greyed and cannot be ticked, unless it is already
 * ticked** (P7, `movementFilterCounts`), so a person can always undo what they did.
 */

/** One change, as the picker announces it: the choice's words, and whether it went on or off. */
export type FilterChange = {
  readonly next: MovementFilters;
  readonly choice: string;
  /** `null` for a radio or Clear filters, which say the choice alone. */
  readonly on: boolean | null;
};

/** What the panel's body needs from the picker. */
export type FilterPanelProps = {
  readonly filters: MovementFilters;
  /** Each choice's count under the filters as they are (`movementFilterCounts`). */
  readonly counts: MovementFilterCounts;
  /** "Any equipment" and "Uses at least one of…" as totals: the counts give the per-item numbers. */
  readonly choiceTotals: { readonly any: number; readonly chosen: number };
  readonly onChange: (change: FilterChange) => void;
  readonly onBack: () => void;
  readonly headingRef: RefObject<HTMLHeadingElement | null>;
  /**
   * Items shown beyond the first ten while the panel is open: a ticked one stays listed after it is
   * unticked, so the row under the person's thumb does not vanish (panel row 13). The picker
   * clears it when the panel closes.
   */
  readonly shownBeyond: ReadonlySet<Equipment>;
};

export function FilterPanelBody({
  filters,
  counts,
  choiceTotals,
  onChange,
  onBack,
  headingRef,
  shownBeyond,
}: FilterPanelProps) {
  const id = useId();
  const [showAll, setShowAll] = useState(false);
  const order = equipmentFilterOrder(counts);
  const listed = showAll
    ? order
    : order.filter(
        (item, index) =>
          index < EQUIPMENT_FILTER_SHOWN_FIRST ||
          filters.chosenEquipment.includes(item) ||
          shownBeyond.has(item),
      );
  const radio = (choice: EquipmentChoice, label: string, count: number, hint?: string) => (
    <Choice
      key={choice}
      type="radio"
      name={`${id}-equipment`}
      label={label}
      count={count}
      checked={filters.equipment === choice}
      hintId={hint ? `${id}-${choice}-hint` : undefined}
      hint={hint}
      onChange={() =>
        onChange({ next: { ...filters, equipment: choice }, choice: label, on: null })
      }
    />
  );
  const itemsId = `${id}-items`;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <h3 ref={headingRef} tabIndex={-1} className="text-lg font-semibold outline-none">
          {COPY.filtersHeading}
        </h3>
        <Button type="button" variant="ghost" size="lg" onClick={onBack} className="text-base">
          {COPY.filtersBack}
        </Button>
      </div>
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-2 font-semibold">{COPY.equipmentLegend}</legend>
        {radio('any', COPY.equipmentAny, choiceTotals.any)}
        {radio('none', COPY.emptyEquipment, counts.equipmentNone, COPY.equipmentNoneHint)}
        {radio('chosen', COPY.equipmentChosen, choiceTotals.chosen, COPY.equipmentChosenHint)}
        {filters.equipment === 'chosen' ? (
          <fieldset className="ml-9 flex flex-col gap-1">
            <legend className="sr-only">{COPY.equipmentItemsLegend}</legend>
            <div id={itemsId} className="flex flex-col gap-1">
              {listed.map((item) => (
                <Choice
                  key={item}
                  type="checkbox"
                  label={EQUIPMENT_LABELS[item]}
                  count={counts.equipment.get(item) ?? 0}
                  checked={filters.chosenEquipment.includes(item)}
                  onChange={(checked) =>
                    onChange({
                      next: {
                        ...filters,
                        chosenEquipment: checked
                          ? [...filters.chosenEquipment, item]
                          : filters.chosenEquipment.filter((x) => x !== item),
                      },
                      choice: EQUIPMENT_LABELS[item],
                      on: checked,
                    })
                  }
                />
              ))}
            </div>
            {order.length > EQUIPMENT_FILTER_SHOWN_FIRST ? (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                aria-expanded={showAll}
                aria-controls={itemsId}
                onClick={() => setShowAll((all) => !all)}
                className="self-start text-base underline"
              >
                {showAll ? COPY.showFewerEquipment : COPY.showAllEquipment(order.length)}
              </Button>
            ) : null}
          </fieldset>
        ) : null}
      </fieldset>
      <fieldset>
        <legend className="mb-2 font-semibold">{COPY.musclesLegend}</legend>
        {/* `auto-fill` with a rem minimum: two columns at 360 px, one at 200 % text (panel row 17). */}
        <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-x-4 gap-y-1">
          {MUSCLES.map((muscle: Muscle) => (
            <Choice
              key={muscle}
              type="checkbox"
              label={MUSCLE_LABELS[muscle]}
              count={counts.muscles.get(muscle) ?? 0}
              checked={filters.muscles.includes(muscle)}
              onChange={(checked) =>
                onChange({
                  next: {
                    ...filters,
                    muscles: checked
                      ? [...filters.muscles, muscle]
                      : filters.muscles.filter((x) => x !== muscle),
                  },
                  choice: MUSCLE_LABELS[muscle],
                  on: checked,
                })
              }
            />
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/**
 * The panel's footer: the count as plain text (the sheet's one region says it, panel row 12),
 * Clear filters, and the button that shows the list.
 */
export function FilterPanelFooter({
  filters,
  total,
  searching,
  onClear,
  onShow,
}: {
  readonly filters: MovementFilters;
  readonly total: number;
  readonly searching: boolean;
  readonly onClear: () => void;
  readonly onShow: () => void;
}) {
  const none = movementFiltersOn(filters) === 0;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">{COPY.panelCount(total)}</p>
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          // Focusable while inert, so focus never drops when it disables itself (panel row 13).
          aria-disabled={none || undefined}
          onClick={() => {
            if (!none) onClear();
          }}
          className="h-auto min-h-11 w-full whitespace-normal text-base aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        >
          {COPY.clearFilters}
        </Button>
        <Button
          type="button"
          size="lg"
          disabled={total === 0}
          onClick={onShow}
          className="h-auto min-h-11 w-full whitespace-normal text-base"
        >
          {total === 0 ? COPY.nothingFits : COPY.showResults(total, searching)}
        </Button>
      </div>
    </div>
  );
}

/**
 * One radio or checkbox with its count. The count is shown as digits and said as "12 movements"
 * after the label (panel row 17: "Lats 12" reads as one name). Zero greys it, unless it is ticked.
 */
function Choice({
  type,
  name,
  label,
  count,
  checked,
  hint,
  hintId,
  onChange,
}: {
  type: 'radio' | 'checkbox';
  name?: string;
  label: string;
  count: number;
  checked: boolean;
  hint?: string;
  hintId?: string;
  onChange: (checked: boolean) => void;
}): ReactNode {
  const inert = count === 0 && !checked;
  return (
    <div className="flex flex-col">
      <label
        className={cn(
          'flex min-h-11 items-center gap-3 text-base',
          inert ? 'text-muted-foreground cursor-not-allowed' : 'cursor-pointer',
        )}
      >
        <input
          type={type}
          name={name}
          checked={checked}
          disabled={inert}
          aria-describedby={hintId}
          onChange={(e) => onChange(e.target.checked)}
          className="size-6 shrink-0 accent-current"
        />
        <span className="min-w-0 flex-1 wrap-anywhere">
          {label}
          <span className="sr-only">, {COPY.choiceCount(count)}</span>
        </span>
        <span aria-hidden className="text-muted-foreground tabular-nums">
          {count}
        </span>
      </label>
      {hint ? (
        <p id={hintId} className="text-muted-foreground ml-9 text-sm">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
