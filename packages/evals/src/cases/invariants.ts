import { QUANTITY_SLOT, rowWriteSchema } from '@mat-plan/shared';

import type { EvalCase } from '../harness';

/**
 * The invariant class: **a prescribed load is not a performed record, and the write path refuses one
 * however it is phrased.**
 *
 * ⚠️ **Where the enforcement actually lives.**
 * [EVAL-0](../../../../docs/plans/eval-0-gate-before-model.md) says this rule is held by
 * `PRESCRIPTION_SHAPE` in `packages/shared/src/strength.ts`. That constant went with `parseLoad`
 * (GAP-3 PR 4a), and the set schema these cases parsed next went with the legacy strength writer
 * (LEGACY-1 C2b): no write had parsed it since FAM-1 12f. These cases now parse **`rowWriteSchema`**
 * (`packages/shared/src/program/day-shapes.ts`), the body the day page's ✓ sends and the row writer
 * stores. A logged quantity's `value` is a **number** there (`rowValuesSchema` in `program/pieces.ts`,
 * `0..MAX_STORABLE_QUANTITY`), so a prescription string is refused by the field's TYPE.
 *
 * That difference is the whole reason these cases are worth gating a build on. A regex blocklist
 * refuses the prescription shapes somebody remembered to enumerate. A typed field refuses everything
 * that is not a number, including the shapes nobody thought of — so the test passes because the
 * value is **unrepresentable**, not because the author's imagination was comprehensive.
 *
 * None of these call a model. They assert what the boundary does with a value, whatever produced it,
 * which is a stronger claim than "the model behaved" and the reason this class ships before AI-1.
 */

/** One valid ✓ body, so each case states only the quantity it is testing. Fixed ids: no clock. */
function rowWith(values: unknown): unknown {
  return {
    clientId: '019826b4-0000-7000-8000-0000000000e1',
    profilePublicId: '019826b4-0000-7000-8000-0000000000e2',
    day: '2026-11-26',
    workoutPublicId: '019826b4-0000-7000-8000-0000000000e3',
    prescriptionPublicId: '019826b4-0000-7000-8000-0000000000e4',
    set: 1,
    values,
  };
}

/** A set of 8 reps carrying one primary quantity in pounds, whose value is the case. */
function weightOf(value: unknown): unknown {
  return { reps: 8, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value }] };
}

function refuses(id: string, value: unknown, why: string): EvalCase {
  return {
    id,
    kind: 'invariant',
    assertion: `the write path refuses ${why}`,
    run: () => {
      const result = rowWriteSchema.safeParse(rowWith(weightOf(value)));
      if (result.success) {
        return {
          held: false,
          detail: `accepted ${JSON.stringify(value)} — it parsed instead of being refused`,
        };
      }
      // Refused for the RIGHT reason: the quantity, not a broken fixture. Without this, a typo in
      // `rowWith` would make every refusal hold while testing nothing (the controls catch it too).
      const elsewhere = result.error.issues.find((i) => i.path[0] !== 'values');
      return elsewhere
        ? { held: false, detail: `refused at ${elsewhere.path.join('.')}, not at the quantity` }
        : { held: true };
    },
  };
}

function accepts(id: string, values: unknown, why: string): EvalCase {
  return {
    id,
    kind: 'invariant',
    assertion: `the write path still accepts ${why}`,
    run: () => {
      const result = rowWriteSchema.safeParse(rowWith(values));
      return result.success
        ? { held: true }
        : {
            held: false,
            detail: `refused ${JSON.stringify(values)} — ${result.error.issues[0]?.message ?? 'no issue message'}`,
          };
    },
  };
}

/**
 * The refusals. Each is a way a prescription reaches a field that may only hold a performance.
 * Ordered roughly by how plausible it is that a model would emit it.
 */
const REFUSALS: EvalCase[] = [
  refuses('inv-approx', '~75', 'an approximation (`~75`)'),
  refuses('inv-range', '75-85', 'a range (`75-85`)'),
  refuses('inv-range-spaced', '75 - 85', 'a spaced range (`75 - 85`)'),
  refuses(
    'inv-percent-of-max',
    '95%',
    'a percentage of max (`95%`), the most common prescription idiom',
  ),
  refuses('inv-prose-number', 'seventy five', 'a number written as prose'),
  refuses(
    'inv-inline-unit',
    '75 lb',
    'a magnitude carrying its own unit, when unit is a separate field',
  ),
  refuses('inv-whole-prescription', '3x8 at 95', 'an entire prescription in one field'),
  refuses('inv-schedule', 'next week', 'scheduling language, which is not a quantity at all'),
  refuses('inv-plus-minus', '75+', 'an open-ended floor (`75+`)'),
  refuses('inv-negative', -75, 'a negative magnitude'),
];

/**
 * The positive controls, and they are not optional.
 *
 * A boundary that refused *everything* would pass all ten refusals above while the app was broken,
 * and the gate would be green. These are the cases that stop this class from being vacuously true —
 * the same concern the plan raises about a gate nobody has watched fail. Each is a row the day page
 * really writes.
 */
const REPRESENTABLE: EvalCase[] = [
  accepts('inv-control-integer', weightOf(75), 'a plain integer magnitude'),
  accepts(
    'inv-control-decimal',
    { reps: 5, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 62.5 }] },
    'a decimal magnitude',
  ),
  accepts(
    'inv-control-bodyweight',
    { reps: 12, quantities: [] },
    'a bodyweight set with no magnitude',
  ),
  accepts(
    'inv-control-distance',
    { quantities: [{ slot: QUANTITY_SLOT.distance, unit: 'm', value: 400 }] },
    'a distance with no reps',
  ),
  accepts(
    'inv-control-weighted-bodyweight',
    { reps: 6, quantities: [{ slot: QUANTITY_SLOT.vest, unit: 'lb', value: 8 }] },
    'bodyweight plus added load in the vest slot (`BW+8`)',
  ),
];

export const invariantCases: EvalCase[] = [...REFUSALS, ...REPRESENTABLE];
