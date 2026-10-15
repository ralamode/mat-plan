import type { EvalCase } from '../harness';

/**
 * The accuracy class, as placeholders.
 *
 * [EVAL-0](../../../../docs/plans/eval-0-gate-before-model.md) asks for cases that are "trivially
 * true, so the mechanism is demonstrably working and green before any real case exists." That is the
 * entire job of this file, and it is a smaller job than it looks: the point is not to measure
 * anything, it is to prove the *accuracy path* through the harness is wired — scored, thresholded,
 * reported, and able to fail with its own message — before anything real depends on it.
 *
 * These are deliberately comparisons rather than `{ held: true }` literals. A placeholder that cannot
 * express a mismatch cannot demonstrate the failure path, and the acceptance step requires breaking
 * one on purpose and watching the accuracy message fire.
 *
 * **EVAL-1 deletes this file.** The real cases bind the natural-language fixtures to the typed
 * measurement columns GAP-3 landed. Nothing in the harness or the gates changes when they do.
 */

function compares(id: string, actual: unknown, expected: unknown, what: string): EvalCase {
  return {
    id,
    kind: 'accuracy',
    assertion: `placeholder: ${what}`,
    run: () => {
      const a = JSON.stringify(actual);
      const e = JSON.stringify(expected);
      return a === e ? { held: true } : { held: false, detail: `expected ${e}, got ${a}` };
    },
  };
}

export const accuracyCases: EvalCase[] = [
  compares('acc-placeholder-scalar', 8, 8, 'a scalar field compares equal'),
  compares(
    'acc-placeholder-array',
    [10, 10, 8],
    [10, 10, 8],
    'a per-set reps array compares equal',
  ),
  compares(
    'acc-placeholder-object',
    { reps: 5, weight: '62.5' },
    { reps: 5, weight: '62.5' },
    'a set-shaped object compares equal',
  ),
];
