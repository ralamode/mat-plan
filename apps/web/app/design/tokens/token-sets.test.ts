import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MIN_TAP_TARGET_PX } from '@/lib/constants';

import { AA_LARGE, AA_NORMAL, parseOklch, ratioOf, withAlpha } from './contrast';
import {
  CONTROL_SET_ID,
  EXCLUDED_TOKENS,
  PALETTE_TOKENS,
  SCOPED_SETS,
  SHAPE_TOKENS,
  TOKEN_SETS,
} from './token-sets';

/**
 * The candidate token sets, checked in the FAST tier (UI-4).
 *
 * Why these live here and not in the axe scan: axe's `color-contrast` is text-only, pass/fail, runs on
 * whichever pairs a page happens to render, and lives in the `e2e` job — which is not a required check
 * until PR 28 and is skippable by label. A reviewer choosing a palette needs numbers with margin, and
 * the key-set and density rules are not things axe can see at all. All of this is arithmetic, so it
 * belongs in the sub-second `quality` job. The e2e dark scan is still added, on top — these are
 * complementary, not alternatives.
 *
 * This file is also the binding between `token-sets.ts` (the numbers the page prints) and
 * `token-sets.css` (the numbers the browser renders). Without it the page could confidently display a
 * contrast figure for a colour it is not showing.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_DIR = join(HERE, '..', '..');

/** Comments stripped — the CSS is data a future author will annotate, and a commented-out block must
 *  not satisfy an assertion (the same trick `pages-are-gated.test.ts` uses on source). */
const css = readFileSync(join(HERE, 'token-sets.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const globals = readFileSync(join(APP_DIR, 'globals.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/**
 * Every `--token: value;` declaration inside the first RULE whose selector is `selector`.
 *
 * "Whose selector is", not "which contains the text": `globals.css:5` is
 * `@custom-variant dark (&:is(.dark *));`, so a naive `indexOf('.dark')` finds that line and then
 * parses the `@theme inline` block that follows it — scoring the dark palette against the wrong
 * values while looking perfectly green. So the match requires the next non-space character to be `{`.
 */
function blockOf(source: string, selector: string): Record<string, string> | null {
  let start = -1;
  for (let i = source.indexOf(selector); i >= 0; i = source.indexOf(selector, i + 1)) {
    if (/^\s*\{/.test(source.slice(i + selector.length))) {
      start = i;
      break;
    }
  }
  if (start < 0) return null;
  const open = source.indexOf('{', start);
  const close = source.indexOf('}', open);
  if (open < 0 || close < 0) return null;
  const body = source.slice(open + 1, close);
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) {
    out[name!] = value!.trim();
  }
  return out;
}

const lightBlock = (id: string) => blockOf(css, `[data-tokens='${id}']`);
const darkBlock = (id: string) => blockOf(css, `.dark [data-tokens='${id}']`);

describe('the fixture itself is not vacuous', () => {
  it('found the CSS and the app palette', () => {
    expect(css.length).toBeGreaterThan(500);
    expect(Object.keys(blockOf(globals, ':root') ?? {}).length).toBeGreaterThan(20);
  });

  it('has a control and at least three scoped candidates', () => {
    // UI-3 asks for "more than one option, reviewed side by side" and names three.
    expect(SCOPED_SETS.length).toBeGreaterThanOrEqual(3);
    expect(TOKEN_SETS.find((s) => s.id === CONTROL_SET_ID)?.tokens).toBeNull();
  });
});

describe('the control declares nothing, so it cannot drift from what ships', () => {
  it('has no CSS block of its own', () => {
    // The whole point: it inherits `:root` / `.dark`. A hand-copied "control" would stop being the
    // control the first time anyone edited globals.css, and nothing would fail.
    expect(lightBlock(CONTROL_SET_ID)).toBeNull();
    expect(darkBlock(CONTROL_SET_ID)).toBeNull();
  });
});

describe.each(SCOPED_SETS.map((s) => [s.name, s] as const))('%s', (_name, set) => {
  const light = lightBlock(set.id);
  const dark = darkBlock(set.id);
  const tokens = set.tokens!;

  it('has both a light and a dark block', () => {
    expect(light, `no [data-tokens='${set.id}'] block`).not.toBeNull();
    expect(dark, `no .dark [data-tokens='${set.id}'] block`).not.toBeNull();
  });

  it('declares every palette token in BOTH themes', () => {
    // Not a style nit: `[data-tokens='x']` and `.dark` have EQUAL specificity (0,1,0), so a token
    // declared light-only is resolved by SOURCE ORDER in dark mode — the light value wins and the
    // set silently shows a light-mode colour on a dark page.
    for (const token of PALETTE_TOKENS) {
      expect(light, `light block is missing --${token}`).toHaveProperty(token);
      expect(dark, `dark block is missing --${token}`).toHaveProperty(token);
    }
  });

  it('declares the shape knobs once, in the light block only', () => {
    // Mirrors globals.css's own structure, where `.dark` omits `--radius`: radius and density are
    // theme-independent, so declaring them twice would invite the two copies to disagree.
    for (const token of SHAPE_TOKENS) {
      expect(light).toHaveProperty(token);
      expect(dark).not.toHaveProperty(token);
    }
  });

  it('declares NOTHING beyond the palette and the shape knobs', () => {
    // An extra knob is allowed — but only as a deliberate edit to this list, not as a surprise in a
    // 150-line CSS file. `--brand` in particular is the mark's colour and must not be repainted.
    const allowed = new Set<string>([...PALETTE_TOKENS, ...SHAPE_TOKENS]);
    expect(Object.keys(light!).filter((k) => !allowed.has(k))).toEqual([]);
    expect(Object.keys(dark!).filter((k) => !allowed.has(k))).toEqual([]);
    for (const excluded of EXCLUDED_TOKENS) {
      expect(light).not.toHaveProperty(excluded);
      expect(dark).not.toHaveProperty(excluded);
    }
  });

  it('matches token-sets.ts exactly, in both directions', () => {
    // The page prints contrast figures computed from the TS record; the browser renders the CSS. If
    // they disagree, the page lies to the person making the decision.
    const expectedLight = { ...tokens.shape, ...tokens.light };
    expect(light).toEqual(expectedLight);
    expect(dark).toEqual(tokens.dark);
  });

  it('keeps the neutral ramp OFF zero chroma — the whole point of the reskin', () => {
    // "Every colour token is oklch(L 0 0) — chroma exactly zero" is the measured reason the app reads
    // as a template (docs/plan.md, UI-3). A candidate that repeated that would be a fourth grey.
    const chromas = PALETTE_TOKENS.map((t) => parseOklch(tokens.light[t])).map((c) => c);
    expect(chromas.every((c) => c !== null)).toBe(true);
    const neutrals = (['background', 'foreground', 'card', 'muted', 'border'] as const).map(
      (t) => /oklch\(\s*[\d.]+%?\s+([\d.]+)/.exec(tokens.light[t])![1]!,
    );
    expect(
      neutrals.filter((c) => Number.parseFloat(c) > 0).length,
      `${set.name}'s neutral ramp has zero-chroma members: ${neutrals.join(', ')}`,
    ).toBe(neutrals.length);
  });

  it('keeps density at or above the 44px floor', () => {
    // `min-h-11` is `calc(var(--spacing) * 11)` (verified by compiling this app's CSS with
    // tailwindcss 4.3.3), and `min-h-11` is what makes every button and input clear the tap-target
    // bar. Derived from MIN_TAP_TARGET_PX rather than typed as 0.25rem, so raising the bar to 48px
    // moves this floor with it.
    const floorRem = MIN_TAP_TARGET_PX / 11 / 16;
    const spacing = Number.parseFloat(tokens.shape.spacing);
    expect(tokens.shape.spacing.endsWith('rem')).toBe(true);
    expect(
      spacing,
      `--spacing ${tokens.shape.spacing} makes min-h-11 ${(spacing * 16 * 11).toFixed(1)}px, under the ${MIN_TAP_TARGET_PX}px bar`,
    ).toBeGreaterThanOrEqual(floorRem);
  });

  describe.each(['light', 'dark'] as const)('%s theme meets WCAG AA', (theme) => {
    const t = tokens[theme];
    const base = t.background;
    const pair = (fg: string, bg: string) => ratioOf(t[fg as never], t[bg as never], base)!;

    /** Every pair the inventory actually renders as TEXT. 4.5:1, no exceptions, no allowlist. */
    const TEXT: readonly (readonly [string, string, string])[] = [
      ['foreground', 'background', 'body text'],
      ['card-foreground', 'card', 'text on a card'],
      ['muted-foreground', 'background', 'muted text'],
      ['muted-foreground', 'muted', 'muted text on a muted surface'],
      ['primary-foreground', 'primary', 'a label on the primary button'],
      ['secondary-foreground', 'secondary', 'a label on the secondary button'],
      ['accent-foreground', 'accent', 'a label on an accent surface'],
      ['destructive', 'background', 'error text'],
      ['primary', 'background', 'link text (buttonVariants.link)'],
    ];

    it.each(TEXT.map(([fg, bg, label]) => [label, fg, bg]))('%s', (label, fg, bg) => {
      const ratio = pair(fg, bg);
      expect(
        ratio,
        `${set.name}/${theme}: ${label} is ${ratio.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(AA_NORMAL);
    });

    it('focus ring clears the non-text bar', () => {
      // SC 1.4.11: a focus indicator is a non-text contrast case (3:1). axe checks none of this.
      expect(pair('ring', 'background')).toBeGreaterThanOrEqual(AA_LARGE);
    });
  });
});

/**
 * Two AA failures that exist in the palette shipping TODAY, pinned with their measured ratios.
 *
 * ⚠️ This is a **characterization test, not an endorsement.** AGENTS.md's rule for this PR was
 * "report a contrast failure, do not loosen the test", and the honest report is a number that fails
 * loudly if anyone changes it. Neither pair is rendered by any route today, which is the only reason
 * `e2e/a11y.spec.ts` has been green: the `destructive` button variant has zero call sites
 * (`grep -rn 'variant="destructive"'` → nothing), and no screen puts `text-muted-foreground` on
 * `bg-muted`. The preview page deliberately does NOT render either pair — rendering them would
 * redden the gate over a pre-existing defect this PR is not allowed to fix (changing `--destructive`
 * or `--muted` would change the live app's appearance, which UI-4 promised not to do).
 *
 * These are UI-3's inputs. When UI-3 fixes them, this test fails and tells whoever did it to delete
 * the row — which is the point: a finding recorded as a test cannot be quietly lost.
 */
describe('known AA failures in the live palette (UI-3 inputs, not this PR’s to fix)', () => {
  const root = blockOf(globals, ':root')!;
  const dark = blockOf(globals, '.dark')!;

  it('muted text on a muted surface is 4.34:1 in light mode (needs 4.5)', () => {
    const ratio = ratioOf(root['muted-foreground']!, root['muted']!, root['background']!)!;
    expect(ratio).toBeCloseTo(4.34, 1);
    expect(ratio).toBeLessThan(AA_NORMAL);
  });

  it('the destructive BUTTON variant is 4.39:1 in light mode (needs 4.5)', () => {
    // `buttonVariants.destructive` is `bg-destructive/10 text-destructive` — the text sits on a 10%
    // tint of itself over the page background.
    const ratio = ratioOf(
      root['destructive']!,
      withAlpha(root['destructive']!, 10),
      root['background']!,
    )!;
    expect(ratio).toBeCloseTo(4.39, 1);
    expect(ratio).toBeLessThan(AA_NORMAL);
  });

  it('…and 3.04:1 in dark mode, on a card', () => {
    const ratio = ratioOf(
      dark['destructive']!,
      withAlpha(dark['destructive']!, 20),
      dark['card']!,
    )!;
    expect(ratio).toBeLessThan(AA_NORMAL);
  });

  it('hairlines miss SC 1.4.11 (3:1) in both themes — 1.26:1 light, 2.69:1 dark', () => {
    // Non-text contrast, which axe does not check at all. Recorded because "the dark palette passed
    // axe" must not be read as "the dark palette is fine".
    expect(ratioOf(root['border']!, root['background']!)!).toBeLessThan(AA_LARGE);
    expect(ratioOf(dark['border']!, dark['card']!, dark['background']!)!).toBeLessThan(AA_LARGE);
  });
});
