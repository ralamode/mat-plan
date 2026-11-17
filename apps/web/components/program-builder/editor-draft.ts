import {
  FREE_TEXT_NOTE_MAX,
  isPlainDecimal,
  isWholeNumber,
  quantityCeiling,
  saveWorkoutSchema,
  SLOT_LABEL_MAX,
  TRACKING_TYPE_FIELDS,
  unitsForTrackingType,
  wholeReps,
  workoutDraftItemSchema,
  type TrackingType,
  type Unit,
  type WorkoutDraft,
  type WorkoutDraftItem,
  slotQuantity,
} from '@mat-plan/shared';

import { cleanName, EDITOR_ERRORS, quantityLabel } from './builder-text';

/**
 * The workout editor's draft as typed, and the one step that turns it back into a `WorkoutDraft`
 * (FAM-1 step 8). Pure, so every refusal is tested without a screen.
 *
 * A card keeps the item it was loaded from (its ids, its type, its superset) and holds each field
 * as the text typed, so a half-typed value survives a move and a refusal names its field. The
 * group's rest is the exception: it is the item's `restAfter`, because the superset rules move it
 * from item to item.
 */
export type EditorCard = {
  item: WorkoutDraftItem;
  sets: string;
  reps: string;
  value: string;
  /**
   * The quantity's unit: the type's fixed one, else the one loaded, else `null` until the person
   * chooses. Never a default the machine picks: the unit is what a kid logs in (plan D27).
   */
  unit: Unit | null;
  notes: string;
  /**
   * A loaded quantity whose unit its type cannot hold (a Duration stored in seconds, a Count in
   * `bool`): shown on the card as what it was, never put in the field and never converted (the
   * machine never authors a load, plan D27). Cleared on the first edit of the number or the unit.
   */
  dropped: { value: number | null; unit: Unit } | null;
};

/** A field of a card, or of the workout, that can be refused. */
export type EditorField =
  'name' | 'description' | 'sets' | 'reps' | 'value' | 'unit' | 'notes' | 'rest';

/** One refusal: which card (`null` for the workout's own fields), which field, what to say. */
export type EditorError = { card: string | null; field: EditorField; message: string };

/**
 * A loaded item's quantity: its type's slot (`slotQuantity`), kept only in a unit the type can hold
 * (`unitsForTrackingType`). A fixed-unit type always starts in its own unit, since it has no unit
 * select to fix; any other starts unset when the stored unit is not one it offers, so Save's unit
 * refusal lands on the select. Either way a number in a unit the card cannot hold is not shown in
 * the field: it is `dropped`, and the card says what it was.
 */
function loadedQuantity(item: WorkoutDraftItem): Pick<EditorCard, 'value' | 'unit' | 'dropped'> {
  const fields = TRACKING_TYPE_FIELDS[item.trackingType];
  if (!fields.slot) return { value: '', unit: null, dropped: null };
  const stored = slotQuantity(item, item.quantities);
  const holds = !!stored && unitsForTrackingType(item.trackingType).includes(stored.unit);
  return {
    value: holds && stored.value != null ? String(stored.value) : '',
    unit: fields.unit ?? (holds ? stored.unit : null),
    dropped: stored && !holds ? { value: stored.value, unit: stored.unit } : null,
  };
}

export function toCards(draft: WorkoutDraft): EditorCard[] {
  return draft.items.map((item) => ({
    item,
    sets: item.sets === null ? '' : String(item.sets),
    reps: item.targetReps ?? '',
    ...loadedQuantity(item),
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

  // Sets: required on a set-based type when saving (the contract owner, 2026-11-16), within the
  // contract's own bound.
  let sets: number | null = null;
  if (fields.sets) {
    const typed = card.sets.trim();
    const parsed = workoutDraftItemSchema.shape.sets.safeParse(Number(typed));
    if (!isWholeNumber(typed) || !parsed.success || parsed.data === null) {
      refuse('sets', EDITOR_ERRORS.sets);
    } else sets = parsed.data;
  }

  // Reps: a whole number or blank _(maintainer, 2026-11-16)_.
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
  const label = quantityLabel(card.item.trackingType) ?? '';
  if (fields.slot) {
    const typed = card.value.trim();
    // A quantity needs its unit, number or not: without one no ✓ can ever be stored (C16;
    // `itemUnit`'s note). The refusal is the unit select's, so focus goes where the fix is.
    if (!card.unit) refuse('unit', EDITOR_ERRORS.unit(label));
    let value: number | null = null;
    if (typed && !isPlainDecimal(typed)) refuse('value', EDITOR_ERRORS.value(label));
    else if (typed && card.unit) {
      // With no unit the refusal above is the unit's, said once. A unit with no declared ceiling
      // refuses: no bound is not "no cap" (`quantityCeiling`).
      const ceiling = quantityCeiling(card.unit);
      if (ceiling === undefined) refuse('value', EDITOR_ERRORS.value(label));
      else if (Number(typed) > ceiling) {
        refuse('value', EDITOR_ERRORS.ceiling(label, ceiling, card.unit));
      } else value = Number(typed);
    }
    // A blank value under its unit: "log in this unit, no target" (plan D2).
    if (card.unit) quantities.push({ slot: fields.slot, unit: card.unit, value });
  }

  const notes = cleanNote(card.notes);
  if (notes && notes.length > FREE_TEXT_NOTE_MAX) refuse('notes', EDITOR_ERRORS.tooLong);

  // The group's rest, cleaned as notes are; only a superset's last item holds one.
  const restAfter = card.item.superset ? cleanNote(card.item.restAfter ?? '') : null;
  if (restAfter && restAfter.length > SLOT_LABEL_MAX) refuse('rest', EDITOR_ERRORS.rest);

  return { item: { ...card.item, sets, targetReps, quantities, notes, restAfter }, errors };
}

/**
 * What Save sends, or every refusal in screen order, except that a card's unit refusal comes
 * before its number's, so Save focuses the select (the number's keypad would cover it). The writer refuses the same things
 * (`invalid`), so a refusal here is what keeps `invalid` from being the normal path. The result is
 * parsed by `saveWorkoutSchema` last: a draft the contract would refuse is never sent, and comes
 * back with no field to blame (`errors: []`).
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
  const out = { ...draft, name, description, items };
  if (!saveWorkoutSchema.safeParse(out).success) return { ok: false, errors: [] };
  return { ok: true, draft: out };
}

/** The id of one field's input, so a refusal can focus it. */
export const fieldId = (card: string | null, field: EditorField) =>
  card ? `card-${card}-${field}` : `workout-${field}`;

/** The id of a card's heading: the item picker focuses the first card it added. */
export const cardHeadingId = (card: string) => `card-${card}-heading`;

/** The id of a card's unit select. */
export const unitFieldId = (card: string) => fieldId(card, 'unit');

/**
 * A new card for an item picked in the item picker (FAM-1 step 9): a fresh `prescriptionClientId`
 * (D19: the editor mints it), and **no numbers** (the machine never authors a load). Its unit is the
 * type's fixed one, else the item's own declared unit when the type allows it, else none until the
 * person chooses _(maintainer, 2026-11-16)_.
 */
export function newCard(
  option: { publicId: string; name: string; trackingType: TrackingType; unitDefault: Unit | null },
  prescriptionClientId: string,
): EditorCard {
  const fields = TRACKING_TYPE_FIELDS[option.trackingType];
  const declared =
    option.unitDefault && unitsForTrackingType(option.trackingType).includes(option.unitDefault)
      ? option.unitDefault
      : null;
  return {
    item: {
      prescriptionClientId,
      itemPublicId: option.publicId,
      itemName: option.name,
      trackingType: option.trackingType,
      sets: null,
      targetReps: null,
      quantities: [],
      notes: null,
      superset: null,
      restAfter: null,
    },
    sets: '',
    reps: '',
    value: '',
    unit: fields.slot ? (fields.unit ?? declared) : null,
    notes: '',
    dropped: null,
  };
}
