import { describe, expect, it } from 'vitest';

import { accuracyCases } from './cases/accuracy';
import { invariantCases } from './cases/invariants';
import { nlInputFixtures } from './fixtures/nl-inputs';
import { ACCURACY_FAILURE_HEADLINE, EXIT, INVARIANT_FAILURE_HEADLINE } from './gates';
import { runEval, type EvalCase } from './harness';

/**
 * [EVAL-0](../../../docs/plans/eval-0-gate-before-model.md): *"A gate nobody has seen fail is an
 * untested gate, and the two failure modes being genuinely distinct is the whole claim of S4 — so it
 * gets verified, not asserted."*
 *
 * The plan discharges that with two deliberate-break pull requests. These tests discharge it
 * permanently and in-repo: a deliberate break proves the gate fired once, on one day; these prove it
 * still fires on every run, including the run where somebody "simplifies" the exit codes.
 */

const passing = (id: string, kind: EvalCase['kind']): EvalCase => ({
  id,
  kind,
  assertion: `${id} holds`,
  run: () => ({ held: true }),
});

const failing = (id: string, kind: EvalCase['kind']): EvalCase => ({
  id,
  kind,
  assertion: `${id} holds`,
  run: () => ({ held: false, detail: 'deliberately broken' }),
});

describe('the accuracy gate', () => {
  it('fails with the accuracy headline and exit 1, never the boundary one', () => {
    const report = runEval([passing('a1', 'accuracy'), failing('a2', 'accuracy')], [], 1.0);

    expect(report.exitCode).toBe(EXIT.accuracyBelowThreshold);
    const text = report.lines.join('\n');
    expect(text).toContain(ACCURACY_FAILURE_HEADLINE);
    expect(text).not.toContain(INVARIANT_FAILURE_HEADLINE);
  });

  it('honours a threshold below 1 — 1 of 2 passes at 0.5', () => {
    const cases = [passing('a1', 'accuracy'), failing('a2', 'accuracy')];
    expect(runEval(cases, [], 0.5).exitCode).toBe(EXIT.ok);
    expect(runEval(cases, [], 0.75).exitCode).toBe(EXIT.accuracyBelowThreshold);
  });
});

describe('the invariant gate', () => {
  it('fails with the boundary headline and exit 2, never the accuracy one', () => {
    const report = runEval([passing('i1', 'invariant'), failing('i2', 'invariant')]);

    expect(report.exitCode).toBe(EXIT.invariantBreached);
    const text = report.lines.join('\n');
    expect(text).toContain(INVARIANT_FAILURE_HEADLINE);
    expect(text).not.toContain(ACCURACY_FAILURE_HEADLINE);
  });

  it('has no threshold to lower — one breach in a hundred still fails', () => {
    const cases = [
      ...Array.from({ length: 99 }, (_, i) => passing(`i${i}`, 'invariant')),
      failing('i99', 'invariant'),
    ];

    // Passed explicitly to prove the accuracy threshold cannot be used to buy an invariant pass.
    expect(runEval(cases, [], 0.5).exitCode).toBe(EXIT.invariantBreached);
  });
});

describe('when both classes fail', () => {
  it('reports the boundary breach, because a breach dominates a regression', () => {
    const report = runEval([failing('a1', 'accuracy'), failing('i1', 'invariant')]);

    expect(report.exitCode).toBe(EXIT.invariantBreached);
    expect(report.lines.join('\n')).toContain(INVARIANT_FAILURE_HEADLINE);
  });
});

describe('the harness itself', () => {
  it('treats a throwing case as a failed case, not a crashed run', () => {
    const thrower: EvalCase = {
      id: 'i-throws',
      kind: 'invariant',
      assertion: 'does not throw',
      run: () => {
        throw new Error('fixture is broken');
      },
    };

    const report = runEval([thrower, passing('i-ok', 'invariant')]);

    expect(report.exitCode).toBe(EXIT.invariantBreached);
    expect(report.invariant.total).toBe(2);
    expect(report.invariant.failures[0]?.detail).toContain('fixture is broken');
  });

  it('scores an empty class as 1 — an absent class is not a failing one', () => {
    const report = runEval([passing('i1', 'invariant')]);

    expect(report.accuracy.total).toBe(0);
    expect(report.accuracy.score).toBe(1);
    expect(report.exitCode).toBe(EXIT.ok);
  });

  it('reports pending fixtures without scoring them', () => {
    const report = runEval([passing('i1', 'invariant')], nlInputFixtures);

    expect(report.pending).toHaveLength(15);
    expect(report.invariant.total).toBe(1);
    expect(report.lines.join('\n')).toContain('expectations unbound until EVAL-1');
  });
});

describe('the registered cases', () => {
  it('are green — this is the gate the CI script runs', () => {
    const report = runEval([...invariantCases, ...accuracyCases], nlInputFixtures);

    expect(report.exitCode).toBe(EXIT.ok);
    expect(report.invariant.failures).toEqual([]);
    expect(report.accuracy.failures).toEqual([]);
  });

  it('carries positive controls, so the invariant class cannot pass vacuously', () => {
    // If `strengthSetSchema` refused everything, all ten refusals would hold and the gate would be
    // green while the app was broken. These are the cases that make that impossible.
    const controls = invariantCases.filter((c) => c.id.startsWith('inv-control-'));

    expect(controls.length).toBeGreaterThanOrEqual(5);
    for (const c of controls) expect(c.run().held).toBe(true);
  });
});
