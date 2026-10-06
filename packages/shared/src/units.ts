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

/**
 * The SINGULAR of the units whose history line is spelled out, for `value === 1` (V1-30b-ii).
 *
 * A TOTAL `Record` with explicit `null`, not a `Partial` — "deliberately a code" becomes a declared
 * fact, and a new unit code is a **compile error** here, the cheapest place to catch it (the same
 * reason `UNIT_DIMENSION_BY_CODE` and `CSV_UNIT_SUFFIX` are exhaustive). With a `Partial`, adding a
 * sixth length code would render a bare `30 mm` — re-creating the exact bug this map fixes, silently.
 * Only the five length codes are spelled: `lb`, `kg`, `sec` and `min` stay codes, because that is how
 * a lifter reads them. The plural is `UNIT_LABELS[u].toLowerCase()` — only the singular is new data,
 * so there is no second map to keep in sync with the labels.
 */
export const UNIT_SINGULAR_LABELS: Record<Unit, string | null> = {
  lb: null,
  kg: null,
  count: null,
  sec: null,
  min: null,
  bool: null,
  timing: null,
  in: 'inch',
  cm: 'centimetre',
  ft: 'foot',
  m: 'metre',
  yd: 'yard',
};

/**
 * A sanity bound on what a person TYPED — never a prescription. Nothing reads these to suggest a
 * load, so the "LLM never authors loads" rule is untouched.
 *
 * It catches the mistake the shared 2000 cap could not see: the same number in the WRONG UNIT. A
 * 2-mile run typed into Inches (`3219 in`) is refused while a real `3219 m` is not.
 *
 * ⚠️ **It is a STORAGE-SANITY bound, not a plausibility one, and the two are not the same.** `lb`/`kg`
 * are close to real use (2000 ≈ 2× the largest plausible lift) and `kg` is pinned there for log/edit
 * consistency — the edit path's ceiling is mass-only until V1-33. But `sec: 86400` is 24 hours against
 * a largest real use of ~2400, and `min`, `in` and `cm` are similarly loose. So a mis-typed `3000` for
 * a 30-second hold SAVES, and `isEditableSet` refuses a non-mass set, so the only recovery is a
 * `db:correct` run. Tightening them is a product decision, not a code one — the table is the
 * maintainer's (v1-30b plan, decision 2). Do not quietly narrow it here; raise it there.
 *
 * Every value is ≤ `numeric(8,3)`'s 99999.999, and `units.test.ts` requires a cap for every loggable
 * unit — a missing entry must REFUSE, never read as "no cap" (see `quantityCeiling`).
 */
/**
 * The largest value `entry_sets.value_num numeric(8,3)` can STORE. A structural bound, not a
 * plausibility one: past it the database raises `numeric field overflow` instead of the typed
 * envelope a human can act on.
 *
 * Distinct from `MAX_QUANTITY_BY_UNIT` on purpose — two bounds, two jobs. This one says "the column
 * can hold it"; that one says "a person plausibly did it". Every cap must be ≤ this.
 */
export const MAX_STORABLE_QUANTITY = 99_999.999;

export const MASS_QUANTITY_CEILING = 2000;

export const MAX_QUANTITY_BY_UNIT: Partial<Record<Unit, number>> = {
  lb: MASS_QUANTITY_CEILING,
  kg: MASS_QUANTITY_CEILING,
  sec: 86_400,
  min: 1_440,
  in: 1_200,
  cm: 3_000,
  ft: 5_280,
  yd: 5_280,
  m: 10_000,
};

/**
 * The ceiling for a unit, or `undefined` when none is declared.
 *
 * ⚠️ Callers must treat `undefined` as REFUSE, not as "no cap". `n > undefined` is `false` in JS, so
 * an unguarded comparison would silently disable the bound for exactly the unit nobody thought about.
 */
export function quantityCeiling(unit: Unit): number | undefined {
  return MAX_QUANTITY_BY_UNIT[unit];
}

/** Is this unit a weight? The one spelling of the check for a UNIT (`set-display.ts` checks a stored
 *  dimension instead, so it has no unit to pass). */
export function isMassUnit(unit: Unit): boolean {
  return UNIT_DIMENSION_BY_CODE[unit] === UNIT_DIMENSION.mass;
}
