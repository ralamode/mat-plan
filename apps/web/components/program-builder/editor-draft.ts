import {
  FREE_TEXT_NOTE_MAX,
  MAX_SETS_PER_MOVEMENT,
  QUANTITY_DECIMALS,
  quantityCeiling,
  TRACKING_TYPE_FIELDS,
  UNIT_LABELS,
  unitsForTrackingType,
  wholeReps,
  type Unit,
  type WorkoutDraft,
  type WorkoutDraftItem,
} from '@mat-plan/shared';

import { QUANTITY_LABELS } from './builder-text';
import { cleanName } from './use-name-form';

/**
 * The workout editor's draft as typed, and the one step that turns it back into a `WorkoutDraft`
 * (FAM-1 step 8). Pure, so every refusal is tested without a screen.
 *
 * A card keeps the item it was loaded from (its ids, its type, its superset) and holds each field
 * as the text typed, so a half-typed value survives a move and a refusal names its field.
 */
export type EditorCard = {
  item: WorkoutDraftItem;
  sets: string;
  reps: string;
  value: string;
  /** The quantity's unit: the type's fixed one, the loaded one, or the first the type allows. */
  unit: Unit | null;
  notes: string;
};

/** A field of a card, or of the workout, that can be refused. */
export type EditorField = 'name' | 'description' | 'sets' | 'reps' | 'value' | 'notes';

/** One refusal: which card (`null` for the workout's own fields), which field, what to say. */
export type EditorError = { card: string | null; field: EditorField; message: string };

export const EDITOR_ERRORS = {
  name: 'Give the workout a name, then Save.',
  sets: `Sets: a whole number from 1 to ${MAX_SETS_PER_MOVEMENT}.`,
  reps: 'Reps: a whole number, or leave it blank.',
  value: (label: string) => `${label}: a number like 22.5, or leave it blank.`,
  ceiling: (label: string, ceiling: number, unit: string) =>
    `${label}: at most ${ceiling} ${unit}.`,
  tooLong: `At most ${FREE_TEXT_NOTE_MAX} characters.`,
} as const;

/**
 * A plain decimal with at most `QUANTITY_DECIMALS` places: `5`, `5.5`, `.5`; not `-5`, `1e3` or
 * `5 lb`. ⚠️ The same rule as the day page's `PLAIN_DECIMAL` (`components/day/row-values.ts`),
 * which is lane C's and not exported; both belong in `@mat-plan/shared` (raised with the contract
 * owner, 2026-11-16).
 */
const PLAIN_DECIMAL = new RegExp(
  `^(\\d+(\\.\\d{1,${QUANTITY_DECIMALS}})?|\\.\\d{1,${QUANTITY_DECIMALS}})$`,
);

/** The unit a card starts in. */
function startingUnit(item: WorkoutDraftItem): Unit | null {
  const { slot, unit } = TRACKING_TYPE_FIELDS[item.trackingType];
  if (!slot) return null;
  return unit ?? item.quantities[0]?.unit ?? unitsForTrackingType(item.trackingType)[0] ?? null;
}

export function toCards(draft: WorkoutDraft): EditorCard[] {
  return draft.items.map((item) => ({
    item,
    sets: item.sets === null ? '' : String(item.sets),
    reps: item.targetReps ?? '',
    value: item.quantities[0]?.value == null ? '' : String(item.quantities[0].value),
    unit: startingUnit(item),
    notes: item.notes ?? '',
  }));
}

/**
 * Optional text as the contract stores it: one line (a pasted or typed line break becomes a space;
 * `freeTextNoteSchema` refuses it), trimmed, blank as `null`.
 */
export const cleanNote = (raw: string) => cleanName(raw) || null;

/** The card's draft item, or the refusals that stop it. */
function readCard(card: EditorCard): { item: WorkoutDraftItem; errors: EditorError[] } {
  const id = card.item.prescriptionClientId;
  const fields = TRACKING_TYPE_FIELDS[card.item.trackingType];
  const errors: EditorError[] = [];
  const refuse = (field: EditorField, message: string) => errors.push({ card: id, field, message });

  let sets: number | null = null;
  if (fields.sets) {
    const typed = card.sets.trim();
    const n = Number(typed);
    if (!/^\d+$/.test(typed) || n < 1 || n > MAX_SETS_PER_MOVEMENT)
      refuse('sets', EDITOR_ERRORS.sets);
    else sets = n;
  }

  let targetReps: string | null = null;
  if (fields.reps) {
    const typed = card.reps.trim();
    if (typed) {
      const n = wholeReps(typed);
      if (n === null) refuse('reps', EDITOR_ERRORS.reps);
      else targetReps = String(n);
    }
  }

  const quantities: WorkoutDraftItem['quantities'] = [];
  if (fields.slot && card.unit) {
    const typed = card.value.trim();
    let value: number | null = null;
    if (typed) {
      const ceiling = quantityCeiling(card.unit);
      const n = Number(typed);
      const label = QUANTITY_LABELS[card.item.trackingType] ?? '';
      if (!PLAIN_DECIMAL.test(typed)) refuse('value', EDITOR_ERRORS.value(label));
      // A unit with no declared ceiling refuses: no bound is not "no cap" (`quantityCeiling`).
      else if (ceiling === undefined || n > ceiling) {
        const unitName = UNIT_LABELS[card.unit].toLowerCase();
        refuse('value', EDITOR_ERRORS.ceiling(label, ceiling ?? 0, unitName));
      } else value = n;
    }
    // A blank value: "log in this unit, no target" (plan D2).
    quantities.push({ slot: fields.slot, unit: card.unit, value });
  }

  const notes = cleanNote(card.notes);
  if (notes && notes.length > FREE_TEXT_NOTE_MAX) refuse('notes', EDITOR_ERRORS.tooLong);

  return { item: { ...card.item, sets, targetReps, quantities, notes }, errors };
}

/**
 * What Save sends, or every refusal in screen order. The writer refuses the same things
 * (`invalid`), so a refusal here is what keeps `invalid` from being the normal path.
 */
export function readDraft(
  draft: WorkoutDraft,
  typed: { name: string; description: string; cards: readonly EditorCard[] },
): { ok: true; draft: WorkoutDraft } | { ok: false; errors: EditorError[] } {
  const errors: EditorError[] = [];
  const name = cleanName(typed.name);
  if (!name) errors.push({ card: null, field: 'name', message: EDITOR_ERRORS.name });
  const description = cleanNote(typed.description);
  if (description && description.length > FREE_TEXT_NOTE_MAX) {
    errors.push({ card: null, field: 'description', message: EDITOR_ERRORS.tooLong });
  }
  const items = typed.cards.map((card) => {
    const read = readCard(card);
    errors.push(...read.errors);
    return read.item;
  });
  if (errors.length) return { ok: false, errors };
  return { ok: true, draft: { ...draft, name, description, items } };
}

/** The id of one field's input, so a refusal can focus it. */
export const fieldId = (card: string | null, field: EditorField) =>
  card ? `card-${card}-${field}` : `workout-${field}`;
