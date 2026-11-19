import { describe, expect, it } from 'vitest';

import { note, summarize } from './summary';

const last = (lines: string[]) => lines[lines.length - 1];

describe("the correction runner's summary counts changes, never notes", () => {
  it('🔴 a no-op run with a note says nothing will be written (the preview claim, 2026-11-19)', () => {
    const out = summarize([note('already claimed by this Clerk account — no change')], {
      isReport: false,
      apply: false,
    });
    expect(out).toContain('  – already claimed by this Clerk account — no change');
    expect(last(out)).toBe('No changes — nothing to write.');
    expect(out.join('\n')).not.toMatch(/would be made|--apply/);
  });

  it('the same note under --apply does not claim a write either', () => {
    const out = summarize([note('nothing to do')], { isReport: false, apply: true });
    expect(last(out)).toBe('No changes — nothing to write.');
    expect(out.join('\n')).not.toMatch(/applied/);
  });

  it('changes are counted, and a note beside them is not', () => {
    const lines = ['claim household H for U as owner', note('one household skipped')];
    expect(last(summarize(lines, { isReport: false, apply: false }))).toBe(
      '1 change(s) would be made. Re-run with --apply to write them.',
    );
    expect(last(summarize(lines, { isReport: false, apply: true }))).toBe('✓ applied 1 change(s).');
  });

  it('an empty result keeps its "already corrected, or the guard did not match" line', () => {
    expect(summarize([], { isReport: false, apply: false })).toEqual([
      'No matching rows — already corrected, or the guard did not match. Nothing to do.',
    ]);
  });

  it('a report counts its lines and never says --apply', () => {
    const out = summarize(['a: 0', 'b: 2'], { isReport: true, apply: false });
    expect(last(out)).toBe('2 line(s) reported. Nothing to apply — this entry only reads.');
    expect(summarize([], { isReport: true, apply: true })).toEqual([
      'Nothing to report — this census found no rows in any of the shapes it counts.',
    ]);
  });
});
