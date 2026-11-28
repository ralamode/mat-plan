import { QUANTITY_SLOT, rowAmendSchema, rowWriteSchema } from '@mat-plan/shared';
import type { z } from 'zod';

import type { EvalCase } from '../harness';

/**
 * The invariant class: **a prescribed load is not a performed record, and the write path refuses one
 * however it is phrased.**
 *
 * ⚠️ **Where the enforcement actually lives.**
 * [EVAL-0](../../../../docs/plans/eval-0-gate-before-model.md) says this rule is held by
 * `PRESCRIPTION_SHAPE` in `packages/shared/src/strength.ts`. That constant went with `parseLoad`
 * (GAP-3 PR 4a), and the set schema these cases parsed next went with the legacy strength writer
 * (LEGACY-1 C2b): no write had parsed it since FAM-1 12f. These cases now parse **both schemas that
 * carry a logged row's values** (`packages/shared/src/program/day-shapes.ts`): `rowWriteSchema`, the
 * body the day page's ✓ sends, and `rowAmendSchema`, the body its Change sends. Every case runs over
 * each, so a schema that stops refusing a prescription fails its own cases. A logged quantity's
 * `value` is a **number** there (`rowValuesSchema` in `program/pieces.ts`,
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

/** Fixed ids, so no case depends on the clock. */
const PROFILE_ID = '019826b4-0000-7000-8000-0000000000e2';

/** A write path that stores a logged row's values, with one valid body around `values`. */
interface WritePath {
  /** Names the path in every case id: `inv-write-…`, `inv-control-amend-…`. */
  id: string;
  name: string;
  schema: z.ZodType;
  body: (values: unknown) => unknown;
}

const WRITE_PATHS: WritePath[] = [
  {
    id: 'write',
    name: 'the ✓ (rowWriteSchema)',
    schema: rowWriteSchema,
    body: (values) => ({
      clientId: '019826b4-0000-7000-8000-0000000000e1',
      profilePublicId: PROFILE_ID,
      day: '2026-11-26',
      workoutPublicId: '019826b4-0000-7000-8000-0000000000e3',
      prescriptionPublicId: '019826b4-0000-7000-8000-0000000000e4',
      set: 1,
      values,
    }),
  },
  {
    id: 'amend',
    name: 'Change (rowAmendSchema)',
    schema: rowAmendSchema,
    body: (values) => ({
      profilePublicId: PROFILE_ID,
      entryPublicId: '019826b4-0000-7000-8000-0000000000e5',
      values,
    }),
  },
];

/** A set of 8 reps carrying one primary quantity in pounds, whose value is the case. */
function weightOf(value: unknown): unknown {
  return { reps: 8, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value }] };
}

function refuses(path: WritePath, id: string, value: unknown, why: string): EvalCase {
  return {
    id: `inv-${path.id}-${id}`,
    kind: 'invariant',
    assertion: `${path.name} refuses ${why}`,
    run: () => {
      const result = path.schema.safeParse(path.body(weightOf(value)));
      if (result.success) {
        return {
          held: false,
          detail: `accepted ${JSON.stringify(value)} — it parsed instead of being refused`,
        };
      }
      // Refused for the RIGHT reason: the quantity, not a broken fixture. Without this, a typo in a
      // body would make every refusal hold while testing nothing (the controls catch it too).
      const elsewhere = result.error.issues.find((i) => i.path[0] !== 'values');
      return elsewhere
        ? { held: false, detail: `refused at ${elsewhere.path.join('.')}, not at the quantity` }
        : { held: true };
    },
  };
}

function accepts(path: WritePath, id: string, values: unknown, why: string): EvalCase {
  return {
    id: `inv-control-${path.id}-${id}`,
    kind: 'invariant',
    assertion: `${path.name} still accepts ${why}`,
    run: () => {
      const result = path.schema.safeParse(path.body(values));
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
const REFUSED: [id: string, value: unknown, why: string][] = [
  ['approx', '~75', 'an approximation (`~75`)'],
  ['range', '75-85', 'a range (`75-85`)'],
  ['range-spaced', '75 - 85', 'a spaced range (`75 - 85`)'],
  ['percent-of-max', '95%', 'a percentage of max (`95%`), the most common prescription idiom'],
  ['prose-number', 'seventy five', 'a number written as prose'],
  ['inline-unit', '75 lb', 'a magnitude carrying its own unit, when unit is a separate field'],
  ['whole-prescription', '3x8 at 95', 'an entire prescription in one field'],
  ['schedule', 'next week', 'scheduling language, which is not a quantity at all'],
  ['plus-minus', '75+', 'an open-ended floor (`75+`)'],
  ['negative', -75, 'a negative magnitude'],
];

/**
 * The positive controls, and they are not optional.
 *
 * A boundary that refused *everything* would pass all ten refusals above while the app was broken,
 * and the gate would be green. These are the cases that stop this class from being vacuously true —
 * the same concern the plan raises about a gate nobody has watched fail. Each is a row the day page
 * really writes.
 */
const REPRESENTABLE: [id: string, values: unknown, why: string][] = [
  ['integer', weightOf(75), 'a plain integer magnitude'],
  [
    'decimal',
    { reps: 5, quantities: [{ slot: QUANTITY_SLOT.primary, unit: 'lb', value: 62.5 }] },
    'a decimal magnitude',
  ],
  ['bodyweight', { reps: 12, quantities: [] }, 'a bodyweight set with no magnitude'],
  [
    'distance',
    { quantities: [{ slot: QUANTITY_SLOT.distance, unit: 'm', value: 400 }] },
    'a distance with no reps',
  ],
  [
    'weighted-bodyweight',
    { reps: 6, quantities: [{ slot: QUANTITY_SLOT.vest, unit: 'lb', value: 8 }] },
    'bodyweight plus added load in the vest slot (`BW+8`)',
  ],
];

/** Every refusal and every control, over each write path. */
export const invariantCases: EvalCase[] = WRITE_PATHS.flatMap((path) => [
  ...REFUSED.map(([id, value, why]) => refuses(path, id, value, why)),
  ...REPRESENTABLE.map(([id, values, why]) => accepts(path, id, values, why)),
]);
