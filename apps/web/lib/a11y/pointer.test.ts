// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { prefersFineFocus } from './pointer';

describe('prefersFineFocus', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('is false where matchMedia is missing (jsdom, the server)', () => {
    vi.stubGlobal('matchMedia', undefined);
    expect(prefersFineFocus()).toBe(false);
  });

  it.each([
    [false, true],
    [true, false],
  ])('a coarse pointer (%s) gives %s', (coarse, fine) => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn((q: string) => ({ matches: q === '(pointer: coarse)' ? coarse : false })),
    );
    expect(prefersFineFocus()).toBe(fine);
  });
});
