import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { buttonVariants } from '@/components/ui/button';
import { ON_TINT_BUTTON_FOCUS_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { AA_LARGE, AA_NORMAL, ratioOf } from './design/tokens/contrast';
import { blockOf } from './design/tokens/css-block';

/**
 * The solid `destructive` button (V1-9b B2-prep), measured from `globals.css` itself, the way
 * `done-tokens.test.ts` measures the ✓: the palette that ships, not the `/design/tokens` candidates.
 *
 * ⚠️ `contrast.ts` and `css-block.ts` live in the temporary `/design/tokens` harness; the PR that
 * deletes it moves them (docs/design.md → Reskinning).
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const globals = readFileSync(join(HERE, 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function tokensOf(selector: string): Record<string, string> {
  const block = blockOf(globals, selector);
  if (!block) throw new Error(`no ${selector} block in globals.css`);
  return block;
}

describe('the destructive label is a Tailwind utility', () => {
  it('is mapped in @theme inline, so text-destructive-foreground exists', () => {
    // Without this line Tailwind drops the class silently, and the label falls back to body text,
    // 4.15:1 on the light fill and 2.77:1 on the dark one.
    expect(tokensOf('@theme inline')['color-destructive-foreground']).toBe(
      'var(--destructive-foreground)',
    );
  });
});

describe.each([
  ['light', ':root', 4.76],
  ['dark', '.dark', 6.19],
] as const)('the solid destructive button, %s', (_theme, selector, label) => {
  const t = tokensOf(selector);
  const ratio = (fg: string, bg: string) => ratioOf(t[fg]!, t[bg]!, t['background']!)!;

  it(`its label is ${label}:1 on the fill (AA text)`, () => {
    expect(ratio('destructive-foreground', 'destructive')).toBeCloseTo(label, 1);
    expect(ratio('destructive-foreground', 'destructive')).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it.each(['background', 'card', 'popover'] as const)(
    'the fill clears 3:1 against %s (SC 1.4.11)',
    (ground) => {
      expect(ratio('destructive', ground)).toBeGreaterThanOrEqual(AA_LARGE);
    },
  );

  it('its focus outline (foreground, offset onto the surface) clears 3:1', () => {
    expect(ratio('foreground', 'background')).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe('the solid destructive button focuses outside its fill', () => {
  it('a ring of foreground INSIDE the dark fill is under 3:1, which is why the outline is offset', () => {
    const dark = tokensOf('.dark');
    const r = ratioOf(dark['foreground']!, dark['destructive']!, dark['background']!)!;
    expect(r).toBeCloseTo(2.77, 1);
    expect(r).toBeLessThan(AA_LARGE);
  });

  it("the variant uses the ✓'s offset outline and turns the base ring off", () => {
    // Through `cn`, as `Button` renders it: tailwind-merge drops the base ring the variant turns off.
    const cls = cn(buttonVariants({ variant: 'destructive' }));
    for (const c of ON_TINT_BUTTON_FOCUS_CLASS.split(' ')) expect(cls).toContain(c);
    expect(cls).not.toMatch(/(^|\s)focus-visible:ring-3(\s|$)/);
  });
});
