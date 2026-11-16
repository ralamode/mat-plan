import { describe, expect, it } from 'vitest';

import { firstFreeSlug } from './program-name';

describe('firstFreeSlug (plan D9)', () => {
  it('keeps the base when it is free', () => {
    expect(firstFreeSlug('heavy_a', new Set(['light_a']))).toBe('heavy_a');
  });

  it('suffixes -2, then -3, past the slugs taken', () => {
    expect(firstFreeSlug('heavy_a', new Set(['heavy_a']))).toBe('heavy_a-2');
    expect(firstFreeSlug('heavy_a', new Set(['heavy_a', 'heavy_a-2']))).toBe('heavy_a-3');
  });

  it('fills the first gap rather than counting the taken ones', () => {
    expect(firstFreeSlug('heavy_a', new Set(['heavy_a', 'heavy_a-3']))).toBe('heavy_a-2');
  });
});
