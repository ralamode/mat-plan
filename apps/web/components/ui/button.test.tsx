import { describe, expect, it } from 'vitest';

import { buttonVariants } from './button';

// V1-12. These pin the two a11y properties that live in `buttonVariants`' BASE string — the place a
// shadcn component regeneration would silently revert them. Asserting the variant OUTPUT (rather than
// walking `:focus-visible` in a real browser) catches the same regression for ~1% of the cost: the thing
// at risk is a literal in one string, not runtime behaviour.

const SIZES = ['default', 'xs', 'sm', 'lg', 'icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const;

describe('buttonVariants — the ≥44px tap target is structural', () => {
  it.each(SIZES)('keeps min-h-11 at size=%s, including the small ones', (size) => {
    // The whole point of putting it in the base: `sm` (h-7 = 28px) and `xs` (h-6 = 24px) still clear
    // 44px, so a caller choosing a compact size can no longer ship a sub-target button by omission.
    expect(buttonVariants({ size })).toContain('min-h-11');
  });

  it.each(['icon', 'icon-xs', 'icon-sm', 'icon-lg'] as const)(
    'gives the square %s size a min WIDTH too',
    (size) => {
      // An icon button is square and sized by `size-*`; min-height alone would leave it 24–36px wide.
      expect(buttonVariants({ size })).toContain('min-w-11');
    },
  );

  it('survives a caller className (different tailwind-merge groups, so h-* cannot clobber min-h-*)', () => {
    expect(buttonVariants({ size: 'sm', className: 'w-full' })).toContain('min-h-11');
  });
});

describe('buttonVariants — focus-visible ring', () => {
  it.each(SIZES)('keeps a visible focus ring at size=%s', (size) => {
    // AGENTS.md: "keyboard-usable, focus-visible". Kept alongside the tap-target assertion because both
    // live in the same base string and would be lost by the same regeneration.
    const cls = buttonVariants({ size });
    expect(cls).toContain('focus-visible:ring-3');
    expect(cls).toContain('focus-visible:ring-ring/50');
  });
});
