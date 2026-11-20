import { describe, expect, it } from 'vitest';

import { contrastRatio, over, parseOklch } from './contrast';

/**
 * `over()` composites as a browser draws a translucent colour: in gamma-ENCODED sRGB (CSS Compositing
 * and Blending Level 1), then back to linear for luminance. White at 50% over black is therefore the
 * encoded midpoint, #808080 (luminance ≈ 0.216, ≈ 5.3:1 against black), never the linear midpoint
 * (luminance 0.5, ≈ 11:1), which is what the helper answered until 2026-11-20 — and not in a safe
 * direction: it over-stated a translucent colour's contrast on a dark surface.
 */
describe('over(): alpha is composited as a browser draws it', () => {
  const black = parseOklch('oklch(0 0 0)')!.rgb;

  it('white at 50% over black is the gamma-encoded midpoint', () => {
    const mixed = over(parseOklch('oklch(1 0 0 / 50%)')!, black);
    expect(mixed.r).toBeCloseTo(0.214, 2);
    expect(contrastRatio(mixed, black)).toBeCloseTo(5.28, 1);
  });

  it('an opaque colour is itself, whatever it sits on', () => {
    const red = parseOklch('oklch(0.577 0.245 27)')!;
    expect(over(red, black)).toEqual(red.rgb);
  });
});
