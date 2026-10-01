import { describe, expect, it } from 'vitest';

import { blockedSummary, SUMMARY_NAME_MAX } from './constants';

describe('blockedSummary — the summary names the first blocker (V1-27)', () => {
  it('a set: "<name> set N needs finishing."', () => {
    expect(blockedSummary({ kind: 'set', index: 0, setIndex: 1, movementName: 'Back squat' })).toBe(
      'Back squat set 2 needs finishing.',
    );
  });
  it('an unnamed card falls back to its on-screen number', () => {
    expect(blockedSummary({ kind: 'set', index: 2, setIndex: 0, movementName: '  ' })).toBe(
      'Movement 3 set 1 needs finishing.',
    );
    expect(blockedSummary({ kind: 'name', index: 0 })).toBe('Movement 1 needs a name.');
  });
  it('a long name is truncated so the line fits one row at 360px', () => {
    const out = blockedSummary({
      kind: 'set',
      index: 0,
      setIndex: 19,
      movementName: 'Single-leg Romanian deadlift with pause',
    });
    expect(out.endsWith('… set 20 needs finishing.')).toBe(true);
    expect(out.indexOf('…')).toBeLessThanOrEqual(SUMMARY_NAME_MAX);
  });
});
