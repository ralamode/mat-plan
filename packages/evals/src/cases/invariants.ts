import { strengthSetSchema } from '@mat-plan/shared';

import type { EvalCase } from '../harness';

/**
 * The invariant class: **a prescribed load is not a performed record, and the write path refuses one
 * however it is phrased.**
 *
 * ⚠️ **Where the enforcement actually lives.**
 * [EVAL-0](../../../../docs/plans/eval-0-gate-before-model.md) says this rule is held by
 * `PRESCRIPTION_SHAPE` in `packages/shared/src/strength.ts`. **That constant no longer exists** —
 * GAP-3 PR 4a deleted it along with `parseLoad`, and
 * [ai-1-nl-logging](../../../../docs/plans/ai-1-nl-logging.md) flagged the stale anchor for this
 * implementation to correct. The claim survived the deletion and got cheaper: refusal is now the job
 * of the **format check** on `strengthSetSchema`'s `weight` field (`strength.ts:75`), which admits
 * `^\d+(\.\d{1,N})?$` and nothing else.
 *
 * That difference is the whole reason these cases are worth gating a build on. A regex blocklist
 * refuses the prescription shapes somebody remembered to enumerate. A format check refuses everything
 * that is not a plain number, including the shapes nobody thought of — so the test passes because the
 * value is **unrepresentable**, not because the author's imagination was comprehensive.
 *
 * None of these call a model. They assert what the boundary does with a value, whatever produced it,
 * which is a stronger claim than "the model behaved" and the reason this class ships before AI-1.
 */

/** A set body with the fields every case shares, so each case states only what it is testing. */
function setWith(weight: unknown): unknown {
  return { reps: 8, weight };
}

function refuses(id: string, weight: unknown, why: string): EvalCase {
  return {
    id,
    kind: 'invariant',
    assertion: `the write path refuses ${why}`,
    run: () => {
      const result = strengthSetSchema.safeParse(setWith(weight));
      return result.success
        ? {
            held: false,
            detail: `accepted ${JSON.stringify(weight)} — it parsed instead of being refused`,
          }
        : { held: true };
    },
  };
}

function accepts(id: string, body: unknown, why: string): EvalCase {
  return {
    id,
    kind: 'invariant',
    assertion: `the write path still accepts ${why}`,
    run: () => {
      const result = strengthSetSchema.safeParse(body);
      return result.success
        ? { held: true }
        : {
            held: false,
            detail: `refused ${JSON.stringify(body)} — ${result.error.issues[0]?.message ?? 'no issue message'}`,
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
  refuses('inv-negative', '-75', 'a negative magnitude'),
];

/**
 * The positive controls, and they are not optional.
 *
 * A boundary that refused *everything* would pass all ten refusals above while the app was broken,
 * and the gate would be green. These are the cases that stop this class from being vacuously true —
 * the same concern the plan raises about a gate nobody has watched fail.
 */
const REPRESENTABLE: EvalCase[] = [
  accepts('inv-control-integer', { reps: 8, weight: '75' }, 'a plain integer magnitude'),
  accepts('inv-control-decimal', { reps: 5, weight: '62.5' }, 'a decimal magnitude'),
  accepts(
    'inv-control-bodyweight',
    { reps: 12, isBodyweight: true },
    'a bodyweight set with no magnitude',
  ),
  accepts('inv-control-band', { reps: 10, isBand: true }, 'a band set with no magnitude'),
  accepts(
    'inv-control-weighted-bodyweight',
    { reps: 6, weight: '8', isBodyweight: true },
    'bodyweight plus added load (`BW+8`)',
  ),
];

export const invariantCases: EvalCase[] = [...REFUSALS, ...REPRESENTABLE];
