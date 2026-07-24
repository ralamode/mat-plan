import { foldAggregation } from '@mat-plan/shared';
import { describe, expect, it } from 'vitest';

// Golden vectors for the shared `foldAggregation` kernel. Lives under apps/web (not
// packages/shared) so the required root `test` job runs it (the runner is `--filter web`).
// These vectors are the CONTRACT V1-6b's weekly SQL adherence and V1-13's CSV pivot must
// reproduce — if a SQL rollup disagrees with a row here, one of them is wrong.

describe('foldAggregation — golden vectors', () => {
  it('sum: Σ of all readings (the calisthenics counters)', () => {
    expect(foldAggregation('sum', [20, 30])).toBe(50);
    expect(foldAggregation('sum', [10, 10, 10])).toBe(30);
    expect(foldAggregation('sum', [7])).toBe(7);
  });

  it('max: the best single reading (vsit_skill_step)', () => {
    expect(foldAggregation('max', [3, 5, 4])).toBe(5);
    expect(foldAggregation('max', [5, 3, 4])).toBe(5); // order-independent
    expect(foldAggregation('max', [2])).toBe(2);
  });

  it('avg: mean of the readings', () => {
    expect(foldAggregation('avg', [10, 20])).toBe(15);
    expect(foldAggregation('avg', [4])).toBe(4);
  });

  it('last: the newest reading — values[0] under the desc(createdAt) precondition', () => {
    expect(foldAggregation('last', [7, 5, 3])).toBe(7); // newest first
    expect(foldAggregation('last', [9])).toBe(9);
  });
});
