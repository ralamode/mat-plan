import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AA_LARGE, AA_NORMAL, ratioOf } from './design/tokens/contrast';
import { blockOf } from './design/tokens/css-block';

/**
 * The `done` tokens (a logged row on the day page, FAM-1), measured from `globals.css` itself, so a
 * later edit to a value fails here rather than in a screenshot. docs/design.md → Tokens has the rules.
 *
 * ⚠️ `contrast.ts` and `css-block.ts` live in the temporary `/design/tokens` harness; the PR that
 * deletes that directory (docs/design.md → Reskinning) moves them, and re-measures these pairs against
 * the palette it picks.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const globals = readFileSync(join(HERE, 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function tokensOf(selector: string): Record<string, string> {
  const block = blockOf(globals, selector);
  if (!block) throw new Error(`no ${selector} block in globals.css`);
  return block;
}

const DONE_TOKENS = ['done', 'done-foreground', 'done-surface', 'done-muted-foreground'] as const;

describe('the done tokens are Tailwind utilities', () => {
  it('each is mapped in @theme inline, so bg-done, border-done and the rest exist', () => {
    const theme = tokensOf('@theme inline');
    for (const token of DONE_TOKENS) expect(theme[`color-${token}`]).toBe(`var(--${token})`);
  });
});

describe.each([
  ['light', ':root', { tintOnCard: 1.11 }],
  ['dark', '.dark', { tintOnCard: 1.34 }],
] as const)('the done tokens, %s', (_theme, selector, measured) => {
  const t = tokensOf(selector);
  // Composited over the theme's own background, so a token with an alpha is measured where it sits.
  const ratio = (fg: string, bg: string): number => ratioOf(t[fg]!, t[bg]!, t['background']!)!;

  it('declares all four', () => {
    for (const token of DONE_TOKENS) {
      expect(t, `${selector} is missing --${token}`).toHaveProperty(token);
    }
  });

  // AA for normal text: a row prints numbers and hints on the tint, and a ✓ is small.
  it.each([
    ['the glyph on a filled ✓', 'done-foreground', 'done'],
    ['a filled ✓ against the card', 'done', 'card'],
    ['a ✓ or a done edge on a logged row', 'done', 'done-surface'],
    ['ordinary text on a logged row', 'card-foreground', 'done-surface'],
    ['secondary text on a logged row', 'done-muted-foreground', 'done-surface'],
  ] as const)('%s is AA (%s on %s)', (_what, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('a ticked ✓ differs from an un-ticked one by luminance, not hue alone (SC 1.4.1, 1.4.11)', () => {
    // The glyph is the same in both states; the fill is what a sighted reader sees change.
    expect(ratio('done', 'muted')).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it.each(['done-surface', 'card'] as const)(
    'a focus ring in foreground, outside the ✓, is at least 3:1 on %s (SC 1.4.11)',
    (bg) => {
      expect(ratio('foreground', bg)).toBeGreaterThanOrEqual(AA_LARGE);
    },
  );

  it('the tint is decoration: about as light as the card, so a done card needs its done edge', () => {
    expect(ratio('done-surface', 'card')).toBeCloseTo(measured.tintOnCard, 1);
    expect(ratio('done-surface', 'card')).toBeLessThan(AA_LARGE);
  });
});

describe('pinned, so a reskin cannot separate them', () => {
  // `ring` on the tint was pinned UNDER 3:1 here until the focus-ring fix made it 4.27 light and
  // 5.16 dark; `app/focus-ring.test.ts` now pins it at or above 3:1 on every ground, the tint
  // included. The ✓ keeps `foreground` for the offset-over-the-fill reason in docs/design.md.
  it.each([
    ['light', ':root'],
    ['dark', '.dark'],
  ] as const)(
    '%s: done-foreground on the tint is under 3:1, so the tint is never a fill',
    (_t, sel) => {
      const t = tokensOf(sel);
      expect(ratioOf(t['done-foreground']!, t['done-surface']!, t['background']!)!).toBeLessThan(
        AA_LARGE,
      );
    },
  );

  it('dark secondary text on the tint is the theme’s own muted-foreground', () => {
    const dark = tokensOf('.dark');
    expect(dark['done-muted-foreground']).toBe(dark['muted-foreground']);
  });

  it('a ring of foreground INSIDE the dark fill is about 2:1, which is why the ring sits outside', () => {
    const dark = tokensOf('.dark');
    const r = ratioOf(dark['foreground']!, dark['done']!, dark['background']!)!;
    expect(r).toBeCloseTo(2.01, 1);
    expect(r).toBeLessThan(AA_LARGE);
  });
});

/**
 * Pairs a logged row must NOT use, pinned at their measured values so the reason survives. If a
 * palette change makes one pass, this fails and tells whoever did it to delete the row.
 */
describe('pairs that miss AA on the done tint (light), so a row uses something else', () => {
  const t = tokensOf(':root');
  it('muted-foreground on done-surface is 4.27:1: use done-muted-foreground', () => {
    const r = ratioOf(t['muted-foreground']!, t['done-surface']!)!;
    expect(r).toBeCloseTo(4.27, 1);
    expect(r).toBeLessThan(AA_NORMAL);
  });
  it('destructive on done-surface is 4.30:1: a failed ✓ un-ticks first (D24), so it never sits there', () => {
    const r = ratioOf(t['destructive']!, t['done-surface']!)!;
    expect(r).toBeCloseTo(4.3, 1);
    expect(r).toBeLessThan(AA_NORMAL);
  });
});
