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
 * The movement unit the write path accepts (V1-30). Exactly `LOGGABLE_UNITS`, so "every unit the
 * form offers is one the server accepts" holds by construction. Before V1-30 the session schema used
 * `BODYWEIGHT_UNITS` (lb/kg) and rejected the other 7 units the form offered. zod 4 takes the
 * widened `readonly Unit[]` and still infers `Unit`. The chain test (`units.test.ts`) also requires
 * every option to be exportable.
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
