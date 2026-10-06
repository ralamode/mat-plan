import { z } from 'zod';

import { keyBySelf } from './enums';
import { QUANTITY_SLOT, QUANTITY_SLOT_DIMENSIONS_BY_CODE } from './quantity-slots';

/**
 * What KIND of quantity a unit measures — GAP-3 / [ADR 0004 §6](../../../docs/decisions/0004-typed-measurements.md).
 *
 * This is the column that makes `lb` in a box-jump height **unrepresentable** rather than merely
 * discouraged: a height field accepts only a `length` unit, enforced by the data rather than by review.
 *
 * ADR 0004 proposed four (`mass` / `length` / `time` / `count`), sized against the measurement cases it
 * had in front of it. That set is **incomplete for the codes already in use**: `bool` ("done / not done")
 * and `timing` ("point in time") are existing, seeded units that fit none of the four. They get their own
 * dimensions rather than a nullable column, because a nullable `dimension` would re-open the hole this
 * exists to close — the guard is only as good as its NOT NULL.
 *
 * `instant` is deliberately separate from `time`: a duration and a point in time are not the same
 * quantity and cannot be added. `sec`/`min` measure elapsed time; `timing` records a clock reading.
 */
export const UNIT_DIMENSIONS = ['mass', 'length', 'time', 'instant', 'count', 'boolean'] as const;

export type UnitDimension = (typeof UNIT_DIMENSIONS)[number];

export const unitDimensionSchema = z.enum(UNIT_DIMENSIONS);

/** Branch on a NAMED member (`UNIT_DIMENSION.mass`), never a bare string (constants convention). */
export const UNIT_DIMENSION = keyBySelf(UNIT_DIMENSIONS);

/**
 * Canonical unit codes — the single source of truth (AGENTS.md constants
 * convention). This one definition feeds three consumers with zero drift:
 *   1. the zod validator (`unitSchema`) used at app trust boundaries,
 *   2. the `Unit` TS type,
 *   3. the `units` reference-table seed in packages/db.
 * No native pgEnum: the DB stores `unit` as text with an FK → units(code).
 *
 * GAP-3 adds the five LENGTH codes. `UNIT_CODES` had **no length dimension at all** before this — which
 * is why a box-jump height (`30in`) and a sled distance (`50ft`) were unrepresentable and ended up
 * inside the free-text `load` string the census found them in.
 */
export const UNIT_CODES = [
  'lb',
  'kg',
  'count',
  'sec',
  'min',
  'bool',
  'timing',
  // GAP-3 — length. `in`/`ft` are US-customary (Ray's program authors in inches: `30in`, `36in`);
  // `cm`/`m`/`yd` round out the dimension so a metric household is representable from the start
  // rather than needing a second migration.
  'in',
  'cm',
  'ft',
  'm',
  'yd',
] as const;

export type Unit = (typeof UNIT_CODES)[number];

export const unitSchema = z.enum(UNIT_CODES);

export const UNIT_LABELS: Record<Unit, string> = {
  lb: 'Pounds',
  kg: 'Kilograms',
  count: 'Count / reps',
  sec: 'Seconds',
  min: 'Minutes',
  bool: 'Done / not done',
  timing: 'Point in time',
  in: 'Inches',
  cm: 'Centimetres',
  ft: 'Feet',
  m: 'Metres',
  yd: 'Yards',
};

/**
 * Every unit's dimension. A `Record<Unit, …>` on purpose: adding a code to `UNIT_CODES` without
 * assigning it a dimension is a **compile error**, which is the cheapest possible place to catch it —
 * before the seed, before the CHECK, before a row exists with no dimension.
 */
export const UNIT_DIMENSION_BY_CODE: Record<Unit, UnitDimension> = {
  lb: 'mass',
  kg: 'mass',
  count: 'count',
  sec: 'time',
  min: 'time',
  bool: 'boolean',
  timing: 'instant',
  in: 'length',
  cm: 'length',
  ft: 'length',
  m: 'length',
  yd: 'length',
};

/** Rows for the `units` reference-table seed (idempotent). */
export const UNITS = UNIT_CODES.map((code) => ({
  code,
  label: UNIT_LABELS[code],
  dimension: UNIT_DIMENSION_BY_CODE[code],
}));

/** The unit codes of one dimension — e.g. the set a height field may accept. */
export function unitsOfDimension(dimension: UnitDimension): Unit[] {
  return UNIT_CODES.filter((c) => UNIT_DIMENSION_BY_CODE[c] === dimension);
}

/**
 * The dimensions a MOVEMENT may be logged in, and the units that follow from them.
 *
 * DERIVED, never hand-listed (AGENTS.md constants rule). The authority is the `primary` slot's own
 * declared dimension set in `quantity-slots.ts` — so "every loggable unit is legal in the primary
 * slot" is true by construction rather than by a reviewer noticing. A fourth dimension added there
 * shows up here, in the form's picker and in the composite FK, with no second edit.
 *
 * Excludes `count`, `bool` and `timing` because no slot accepts them: a rep count is not a load, a
 * checkbox is not a measurement, and a clock reading is not a duration.
 */
export const LOGGABLE_DIMENSIONS: readonly UnitDimension[] =
  QUANTITY_SLOT_DIMENSIONS_BY_CODE[QUANTITY_SLOT.primary];

export const LOGGABLE_UNITS: readonly Unit[] = LOGGABLE_DIMENSIONS.flatMap(unitsOfDimension);

/**
 * The movement unit the write path accepts: exactly `LOGGABLE_UNITS`. zod 4 takes the widened
 * `readonly Unit[]` and still infers `Unit`. The chain test (`units.test.ts`) holds it to the form on
 * one side and the export on the other (docs/plans/v1-30-loggable-units.md).
 */
export const loggableUnitSchema = z.enum(LOGGABLE_UNITS);

/** The one "may a movement be logged in this?" predicate — a narrowing guard, no casts. */
export function isLoggableUnit(value: string): value is Unit {
  return loggableUnitSchema.safeParse(value).success;
}

/**
 * The units a movement measured in `dimension` may be logged in: what the form's Unit select offers.
 * Named so "offerable" is a code fact the chain test can iterate, rather than a re-derivation inside
 * a component.
 */
export function loggableUnitsOf(dimension: UnitDimension): Unit[] {
  return unitsOfDimension(dimension).filter(isLoggableUnit);
}

/**
 * What a movement's primary quantity is called, in words a parent or a ten-year-old reads without
 * translating. `mass` → "Weight", not "Mass"; `length` covers a box-jump HEIGHT and a broad-jump
 * DISTANCE, so it cannot be called either one alone.
 */
export const LOGGABLE_DIMENSION_LABELS: Record<string, string> = {
  mass: 'Weight',
  length: 'Height / distance',
  time: 'Time',
};

/**
 * The same dimensions as a noun for running copy ("…don't apply to a TIME"). Its own map, not the
 * label rewritten by string surgery, so respelling a label can't silently garble an error message.
 * `units.test.ts` requires a noun for every loggable dimension.
 */
export const LOGGABLE_DIMENSION_NOUNS: Partial<Record<UnitDimension, string>> = {
  mass: 'weight',
  length: 'height or distance',
  time: 'time',
};

/**
 * Decimal places a logged quantity may carry — ONE precision for every unit, read by the server's
 * format check (`strength.ts`) and by the number field's `step` (`set-fields.tsx`), so the browser
 * refuses exactly where the server would.
 *
 * 3, matching `numeric(8,3)` on `entry_sets.value_num`. It replaces a `step="0.5"` that was sized for
 * barbell plates and blocked `6.25 ft`, `1.25 min` and `61.25 kg` — 1.25 kg plates are real. A 0.5
 * step caught no typo a human noticed, and it also closed a blind spot: a `1.25` carried from Time
 * into Weight used to fail the step while the V1-27 summary said the card was ready.
 *
 * Cost, accepted: on desktop, ArrowUp on `135` now goes to `135.001` rather than `135.5`. Phones have
 * no spinner, and typing is the path there.
 */
export const QUANTITY_DECIMALS = 3;

/** Is this unit a weight? The one spelling of the check for a UNIT (`set-display.ts` checks a stored
 *  dimension instead, so it has no unit to pass). */
export function isMassUnit(unit: Unit): boolean {
  return UNIT_DIMENSION_BY_CODE[unit] === UNIT_DIMENSION.mass;
}
