/**
 * The two gates, and why they are two.
 *
 * **S4 of [ai-1-nl-logging](../../../docs/plans/ai-1-nl-logging.md): a threshold may only average over
 * measurements that fail the same way.** `14/15 = 93.3%` cannot tell you whether a bodyweight entry
 * parsed slightly wrong or a model-authored load reached the database. Averaging those together is
 * not a rounding error in the metric — it is the metric answering a different question than the one
 * safety asks.
 *
 * So this file encodes the split that
 * [eval-0-gate-before-model](../../../docs/plans/eval-0-gate-before-model.md) calls for: two case
 * classes, two thresholds, and — the part that is easy to skip and load-bearing — **two failure modes
 * that a reader and a CI log can tell apart without knowing anything about this code.**
 */

/** The two classes a case can belong to. */
export const GATE_KINDS = ['accuracy', 'invariant'] as const;
export type GateKind = (typeof GATE_KINDS)[number];

/**
 * The accuracy class is **scalar**: a proportion measured against a threshold, where one failure is a
 * regression to investigate. Configurable because the right number depends on the model, the fixtures
 * and the field — none of which exist yet (EVAL-1 binds them).
 *
 * 1.0 today is not a claim that the model is perfect. It is the only honest setting while every
 * accuracy case is a placeholder: a threshold below 100% over trivially-true cases would be a gate
 * that cannot fail, which is the failure mode this whole plan exists to avoid.
 */
export const DEFAULT_ACCURACY_THRESHOLD = 1.0;

/**
 * The invariant class is **binary**. There is no threshold input because there is no threshold: one
 * breach is a breach. Named rather than inlined so that a future reader looking for "where is the
 * 100% enforced" finds a constant and not a `>= 1` buried in a comparison.
 */
export const INVARIANT_THRESHOLD = 1.0;

/**
 * Exit codes, because "different failure modes" has to mean something a machine can branch on and not
 * just different prose. A CI step, a bisect script or a future release gate can distinguish these
 * without parsing output.
 */
export const EXIT = {
  /** Every class met its bar. */
  ok: 0,
  /** The accuracy class fell below its threshold. A regression. */
  accuracyBelowThreshold: 1,
  /** The invariant class had at least one failure. A boundary breach. */
  invariantBreached: 2,
} as const;
export type ExitCode = (typeof EXIT)[keyof typeof EXIT];

/**
 * The two headlines.
 *
 * They are deliberately not parallel in tone. An accuracy dip is a number that moved; a breached
 * invariant is a claim about the system that has stopped being true. If both read like "eval failed",
 * the separation the gates buy is thrown away at the last step — the only step a human actually reads.
 */
export const ACCURACY_FAILURE_HEADLINE = 'ACCURACY BELOW THRESHOLD';
export const INVARIANT_FAILURE_HEADLINE = 'BOUNDARY CROSSED';

export function accuracyFailureMessage(score: number, threshold: number): string {
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return (
    `${ACCURACY_FAILURE_HEADLINE}: ${pct(score)} of accuracy cases passed, ` +
    `below the ${pct(threshold)} threshold. A measurement regressed — compare against the last green run.`
  );
}

export function invariantFailureMessage(failed: number, total: number): string {
  return (
    `${INVARIANT_FAILURE_HEADLINE}: ${failed} of ${total} invariant cases failed. ` +
    `This is not a threshold. An invariant that holds "almost always" is not an invariant, and the ` +
    `rule these cases encode is that the model can never emit a training load. Do not retune anything — ` +
    `find what made the value representable.`
  );
}
