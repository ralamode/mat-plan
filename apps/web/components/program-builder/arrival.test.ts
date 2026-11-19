import { describe, expect, it } from 'vitest';

import { ARRIVAL_MS, noteArrival, takeArrival } from './arrival';

const PROGRAM = '019826b4-0000-7000-8000-0000000000a1';
const OTHER = '019826b4-0000-7000-8000-0000000000a2';

describe('the editor’s message to the program page after a Save', () => {
  it('is taken once, by the program it names', () => {
    noteArrival(PROGRAM, 'Heavy A saved.', 1_000);
    expect(takeArrival(OTHER, 1_100)).toBeNull();
    expect(takeArrival(PROGRAM, 1_100)).toBe('Heavy A saved.');
    expect(takeArrival(PROGRAM, 1_200)).toBeNull();
  });

  it('🔴 a message older than ARRIVAL_MS is dropped: a page opened later moves nothing', () => {
    noteArrival(PROGRAM, 'Heavy A saved.', 1_000);
    expect(takeArrival(PROGRAM, 1_000 + ARRIVAL_MS + 1)).toBeNull();
    // Dropped, not kept for a later page.
    expect(takeArrival(PROGRAM, 1_000)).toBeNull();
    noteArrival(PROGRAM, 'Heavy A saved.', 1_000);
    expect(takeArrival(PROGRAM, 1_000 + ARRIVAL_MS)).toBe('Heavy A saved.');
  });
});
