import {
  DEFAULT_ACCURACY_THRESHOLD,
  EXIT,
  INVARIANT_THRESHOLD,
  accuracyFailureMessage,
  invariantFailureMessage,
  type ExitCode,
  type GateKind,
} from './gates';

/**
 * The runner. Pure by construction — it takes cases and returns a report, and touches neither the
 * console nor `process`. `scripts/run.ts` owns both.
 *
 * That split is not ceremony: the acceptance step of
 * [EVAL-0](../../../docs/plans/eval-0-gate-before-model.md) requires proving that each gate fails
 * with its own message and its own exit code. A runner that printed and exited could only be tested
 * by running a subprocess and matching stdout. This one is asserted directly, in the same vitest run
 * as everything else.
 */

/** What a case reports back. `detail` is the diagnostic a failure needs; it is unused when held. */
export interface CaseOutcome {
  held: boolean;
  detail?: string;
}

export interface EvalCase {
  id: string;
  kind: GateKind;
  /**
   * What must be true, in prose, stated so it survives the schema it currently tests. The fixtures
   * EVAL-1 binds will change; "a prescribed range is not a performed record" will not.
   */
  assertion: string;
  run: () => CaseOutcome;
}

/**
 * A natural-language input whose expected output is not bound yet.
 *
 * These are registered rather than run. The sentences are durable — a parent types them regardless of
 * what schema stores the result — but what they should extract into depends on the typed-measurement
 * columns, so EVAL-1 binds them and EVAL-2 points a model at them. Carrying them now means the
 * fixture is reviewed once, in daylight, instead of being written under deadline beside the model.
 */
export interface PendingFixture {
  id: string;
  input: string;
  assertion: string;
}

export interface CaseFailure {
  id: string;
  assertion: string;
  detail?: string;
}

export interface ClassReport {
  kind: GateKind;
  total: number;
  passed: number;
  /** passed / total. 1 when the class is empty — an absent class is not a failing one. */
  score: number;
  failures: CaseFailure[];
}

export interface HarnessReport {
  accuracy: ClassReport;
  invariant: ClassReport;
  pending: PendingFixture[];
  exitCode: ExitCode;
  /** The rendered report, one line per element, for the caller to print. */
  lines: string[];
}

function scoreClass(kind: GateKind, cases: EvalCase[]): ClassReport {
  const mine = cases.filter((c) => c.kind === kind);
  const failures: CaseFailure[] = [];
  for (const c of mine) {
    let outcome: CaseOutcome;
    try {
      outcome = c.run();
    } catch (err) {
      // A case that throws is a failed case, never a crashed run. The alternative — letting the
      // exception reach the top — turns one broken fixture into a gate that reports nothing about
      // the other fourteen.
      outcome = {
        held: false,
        detail: `threw: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
    if (!outcome.held) failures.push({ id: c.id, assertion: c.assertion, detail: outcome.detail });
  }
  const total = mine.length;
  const passed = total - failures.length;
  return { kind, total, passed, score: total === 0 ? 1 : passed / total, failures };
}

export function runEval(
  cases: EvalCase[],
  pending: PendingFixture[] = [],
  accuracyThreshold: number = DEFAULT_ACCURACY_THRESHOLD,
): HarnessReport {
  const accuracy = scoreClass('accuracy', cases);
  const invariant = scoreClass('invariant', cases);

  const invariantBreached = invariant.score < INVARIANT_THRESHOLD;
  const accuracyBelow = accuracy.score < accuracyThreshold;

  // Precedence is deliberate and not alphabetical: when both classes fail, the run exits as a
  // boundary breach. An accuracy regression alongside a breach is still a breach, and the louder
  // signal is the one that should survive into the exit code a human or a script reads first.
  const exitCode: ExitCode = invariantBreached
    ? EXIT.invariantBreached
    : accuracyBelow
      ? EXIT.accuracyBelowThreshold
      : EXIT.ok;

  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const lines: string[] = [
    'EVAL-0 — two gates, scored separately',
    '',
    `  invariant  ${invariant.passed}/${invariant.total} (${pct(invariant.score)}) — required 100%`,
    `  accuracy   ${accuracy.passed}/${accuracy.total} (${pct(accuracy.score)}) — threshold ${pct(accuracyThreshold)}`,
  ];

  if (pending.length > 0) {
    lines.push(
      `  pending    ${pending.length} natural-language fixtures registered, expectations unbound until EVAL-1`,
    );
  }

  for (const report of [invariant, accuracy]) {
    if (report.failures.length === 0) continue;
    lines.push('', `  ${report.kind} failures:`);
    for (const f of report.failures) {
      lines.push(`    ✗ ${f.id} — ${f.assertion}`);
      if (f.detail) lines.push(`        ${f.detail}`);
    }
  }

  lines.push('');
  if (invariantBreached) {
    lines.push(invariantFailureMessage(invariant.failures.length, invariant.total));
  } else if (accuracyBelow) {
    lines.push(accuracyFailureMessage(accuracy.score, accuracyThreshold));
  } else {
    lines.push('Both gates green.');
  }

  return { accuracy, invariant, pending, exitCode, lines };
}
