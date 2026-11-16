import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AA_LARGE, AA_NORMAL, ratioOf } from './design/tokens/contrast';

/**
 * The `done` tokens (a logged row on the day page, FAM-1), measured from `globals.css` itself, so a
 * later edit to a value fails here rather than in a screenshot. docs/design.md → Tokens has the rules.
 *
 * ⚠️ `contrast.ts` lives in the temporary `/design/tokens` harness; the PR that deletes that
 * directory (docs/design.md → Reskinning) moves the helper and this import with it, and re-measures
 * these pairs against the palette it picks.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const globals = readFileSync(join(HERE, 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** The custom properties declared directly in the block whose selector is exactly `selector`. */
function tokensOf(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const block = new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`).exec(globals);
  if (!block) throw new Error(`no ${selector} block in globals.css`);
  return Object.fromEntries(
    [...block[1]!.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

const DONE_TOKENS = ['done', 'done-foreground', 'done-surface', 'done-muted-foreground'] as const;

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
] as const)('the done tokens, %s', (_theme, selector) => {
  const t = tokensOf(selector);
  const ratio = (fg: string, bg: string): number => ratioOf(t[fg]!, t[bg]!)!;

  it('declares all four', () => {
    for (const token of DONE_TOKENS) {
      expect(t, `${selector} is missing --${token}`).toHaveProperty(token);
    }
  });

  // AA for normal text: a row prints numbers and hints on the tint, and a ✓ is small.
  it.each([
    ['the glyph on a filled ✓', 'done-foreground', 'done'],
    ['a filled ✓ against the card', 'done', 'card'],
    ['a ✓ or its border on a logged row', 'done', 'done-surface'],
    ['ordinary text on a logged row', 'card-foreground', 'done-surface'],
    ['secondary text on a logged row', 'done-muted-foreground', 'done-surface'],
  ] as const)('%s is AA (%s on %s)', (_what, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(AA_NORMAL);
  });

  it('a ticked ✓ differs from an un-ticked one by luminance, not hue alone (SC 1.4.1, 1.4.11)', () => {
    // The glyph is the same in both states; the fill is what a sighted reader sees change.
    expect(ratio('done', 'muted')).toBeGreaterThanOrEqual(AA_LARGE);
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
  it('done-foreground on done-surface is invisible: the tint is never a fill', () => {
    expect(ratioOf(t['done-foreground']!, t['done-surface']!)!).toBeLessThan(AA_LARGE);
  });
});
