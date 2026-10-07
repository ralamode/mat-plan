/**
 * The candidate token sets for the UI-3 reskin (authored under UI-4).
 *
 * The ask, in the maintainer's words, was that the app "feel less out of the box and cookie cutter",
 * and `docs/plan.md` row UI-3 names the measurable reason it currently does: **every colour token is
 * `oklch(L 0 0)` — chroma exactly zero — in both themes**, including `--primary`. That is shadcn's
 * stock neutral theme, unmodified. So each candidate below gets the three levers that row lists: a
 * **hue-biased neutral ramp** (chroma > 0, which is most of the effect), a **committed accent**, and
 * a stated **radius + density** signature.
 *
 * ## Two things about this file that are deliberate
 *
 * 1. **`chalk` declares no tokens.** The control is the *absence* of a `data-tokens` attribute, so it
 *    inherits `:root`/`.dark` by cascade and is byte-faithful to what ships BY CONSTRUCTION. Hand-
 *    copying 67 declarations to be "the control" would stop being the control the first time anyone
 *    edited `globals.css`, and nothing would fail. (Panel: scope + architecture, both independently.)
 *
 * 2. **The values live here AND in `token-sets.css`, and a test binds them.** The browser can only
 *    consume CSS, and generating CSS from TS would need a build step this repo does not have; writing
 *    the numbers only in CSS would leave the page's printed contrast figures unverifiable. So
 *    `token-sets.test.ts` parses the CSS and asserts it matches this record exactly, in both
 *    directions. The duplication is real; what makes it safe is that it cannot drift silently.
 *
 * Every ratio quoted in a rationale is computed by `contrast.ts`, asserted in `token-sets.test.ts`,
 * and printed on the preview page itself — not an adjective.
 */

/** The colour tokens a candidate set MUST declare in both themes. */
export const PALETTE_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'border',
  'input',
  'ring',
] as const;

/**
 * Theme-independent shape knobs, declared in the LIGHT block only — the same structure `globals.css`
 * already uses (`.dark` omits `--radius`). `--spacing` is Tailwind's own theme variable, not one of
 * ours: every spacing utility compiles to `calc(var(--spacing) * n)`, so overriding it for a subtree
 * is a real density knob that restyles no component.
 */
export const SHAPE_TOKENS = ['radius', 'spacing'] as const;

/**
 * `--brand` is NOT a candidate token. `globals.css` pins it to the mark's orange "for the mark ONLY:
 * 3.5:1 on white, enough for a graphic but not for text", so a set that recoloured it would be
 * repainting the logo, and a set that used it as text would be shipping a 3.5:1 label.
 */
export const EXCLUDED_TOKENS = ['brand'] as const;

export type PaletteToken = (typeof PALETTE_TOKENS)[number];
export type ShapeToken = (typeof SHAPE_TOKENS)[number];

export type TokenSet = {
  id: string;
  name: string;
  /** One line: why this set exists, with the fact that justifies it. */
  rationale: string;
  /** The stated signature, shown on the page beside the swatches. */
  signature: { accent: string; radius: string; density: string };
  /** `null` for the control, which declares nothing and inherits the live palette. */
  tokens:
    | null
    | ({
        light: Record<PaletteToken, string> & Partial<Record<ShapeToken, string>>;
        dark: Record<PaletteToken, string>;
      } & { shape: Record<ShapeToken, string> });
};

export const TOKEN_SETS: readonly TokenSet[] = [
  {
    id: 'chalk',
    name: 'Chalk',
    rationale:
      'The control: today’s palette, unmodified, so the other three are judged against what ships rather than against memory. Zero chroma everywhere — which is the thing UI-3 is answering.',
    signature: { accent: 'none (near-black)', radius: '0.625rem', density: '1.00×' },
    tokens: null,
  },
  {
    id: 'forge',
    name: 'Forge',
    rationale:
      'The mark’s own orange made load-bearing instead of decorative, over warm graphite neutrals; hard 6px corners read as equipment rather than as a template. Darker than the mark (which is 3.5:1 and graphic-only) so it carries a button label at 5.55:1.',
    signature: { accent: 'orange', radius: '0.375rem (hard)', density: '1.00×' },
    tokens: {
      shape: { radius: '0.375rem', spacing: '0.25rem' },
      light: {
        background: 'oklch(0.995 0.003 60)',
        foreground: 'oklch(0.2 0.015 45)',
        card: 'oklch(1 0.002 60)',
        'card-foreground': 'oklch(0.2 0.015 45)',
        primary: 'oklch(0.54 0.19 34)',
        'primary-foreground': 'oklch(1 0 0)',
        secondary: 'oklch(0.955 0.012 60)',
        'secondary-foreground': 'oklch(0.26 0.018 45)',
        muted: 'oklch(0.965 0.009 60)',
        'muted-foreground': 'oklch(0.48 0.025 50)',
        accent: 'oklch(0.945 0.018 55)',
        'accent-foreground': 'oklch(0.26 0.018 45)',
        destructive: 'oklch(0.5 0.21 27)',
        border: 'oklch(0.845 0.015 60)',
        input: 'oklch(0.8 0.018 60)',
        ring: 'oklch(0.54 0.19 34)',
      },
      dark: {
        background: 'oklch(0.165 0.012 45)',
        foreground: 'oklch(0.97 0.006 60)',
        card: 'oklch(0.215 0.015 45)',
        'card-foreground': 'oklch(0.97 0.006 60)',
        primary: 'oklch(0.74 0.15 42)',
        'primary-foreground': 'oklch(0.18 0.02 45)',
        secondary: 'oklch(0.285 0.016 45)',
        'secondary-foreground': 'oklch(0.97 0.006 60)',
        muted: 'oklch(0.285 0.016 45)',
        'muted-foreground': 'oklch(0.76 0.02 60)',
        accent: 'oklch(0.32 0.025 45)',
        'accent-foreground': 'oklch(0.97 0.006 60)',
        destructive: 'oklch(0.72 0.17 25)',
        border: 'oklch(0.36 0.018 45)',
        input: 'oklch(0.42 0.02 45)',
        ring: 'oklch(0.74 0.15 42)',
      },
    },
  },
  {
    id: 'tatami',
    name: 'Tatami',
    rationale:
      'Wrestling-mat blue over cool slate, soft 16px corners, and the roomiest density of the four (1.12×) — the one that is easiest to hit with a thumb between sets, which is the whole ergonomic argument of this app.',
    signature: { accent: 'mat blue', radius: '1rem (soft)', density: '1.12×' },
    tokens: {
      shape: { radius: '1rem', spacing: '0.28rem' },
      light: {
        background: 'oklch(0.995 0.003 250)',
        foreground: 'oklch(0.19 0.022 265)',
        card: 'oklch(1 0.002 250)',
        'card-foreground': 'oklch(0.19 0.022 265)',
        primary: 'oklch(0.49 0.17 262)',
        'primary-foreground': 'oklch(1 0 0)',
        secondary: 'oklch(0.955 0.012 250)',
        'secondary-foreground': 'oklch(0.25 0.025 265)',
        muted: 'oklch(0.965 0.01 250)',
        'muted-foreground': 'oklch(0.48 0.03 258)',
        accent: 'oklch(0.94 0.022 250)',
        'accent-foreground': 'oklch(0.25 0.025 265)',
        destructive: 'oklch(0.5 0.21 27)',
        border: 'oklch(0.85 0.018 250)',
        input: 'oklch(0.8 0.022 250)',
        ring: 'oklch(0.49 0.17 262)',
      },
      dark: {
        background: 'oklch(0.175 0.018 265)',
        foreground: 'oklch(0.97 0.007 250)',
        card: 'oklch(0.225 0.022 265)',
        'card-foreground': 'oklch(0.97 0.007 250)',
        primary: 'oklch(0.76 0.13 258)',
        'primary-foreground': 'oklch(0.19 0.025 265)',
        secondary: 'oklch(0.3 0.025 265)',
        'secondary-foreground': 'oklch(0.97 0.007 250)',
        muted: 'oklch(0.3 0.025 265)',
        'muted-foreground': 'oklch(0.77 0.025 250)',
        accent: 'oklch(0.34 0.035 265)',
        'accent-foreground': 'oklch(0.97 0.007 250)',
        destructive: 'oklch(0.72 0.17 25)',
        border: 'oklch(0.375 0.025 265)',
        input: 'oklch(0.43 0.03 265)',
        ring: 'oklch(0.76 0.13 258)',
      },
    },
  },
  {
    id: 'clinch',
    name: 'Clinch',
    rationale:
      'A single-hue green system with deliberately stronger hairlines — the only set whose borders clear SC 1.4.11’s 3:1 non-text bar in both themes (today’s are 1.26:1 and 2.69:1), which is what a sunlit gym floor actually costs you.',
    signature: { accent: 'deep green', radius: '0.5rem', density: '1.04×' },
    tokens: {
      shape: { radius: '0.5rem', spacing: '0.26rem' },
      light: {
        background: 'oklch(0.995 0.004 150)',
        foreground: 'oklch(0.185 0.02 160)',
        card: 'oklch(1 0.002 150)',
        'card-foreground': 'oklch(0.185 0.02 160)',
        primary: 'oklch(0.44 0.12 157)',
        'primary-foreground': 'oklch(1 0 0)',
        secondary: 'oklch(0.95 0.015 150)',
        'secondary-foreground': 'oklch(0.25 0.025 160)',
        muted: 'oklch(0.96 0.012 150)',
        'muted-foreground': 'oklch(0.47 0.03 158)',
        accent: 'oklch(0.935 0.025 152)',
        'accent-foreground': 'oklch(0.25 0.025 160)',
        destructive: 'oklch(0.5 0.21 27)',
        border: 'oklch(0.655 0.04 155)',
        input: 'oklch(0.6 0.045 155)',
        ring: 'oklch(0.44 0.12 157)',
      },
      dark: {
        background: 'oklch(0.16 0.018 160)',
        foreground: 'oklch(0.97 0.008 150)',
        card: 'oklch(0.21 0.022 160)',
        'card-foreground': 'oklch(0.97 0.008 150)',
        primary: 'oklch(0.78 0.14 152)',
        'primary-foreground': 'oklch(0.18 0.025 160)',
        secondary: 'oklch(0.28 0.025 160)',
        'secondary-foreground': 'oklch(0.97 0.008 150)',
        muted: 'oklch(0.28 0.025 160)',
        'muted-foreground': 'oklch(0.78 0.025 150)',
        accent: 'oklch(0.32 0.035 160)',
        'accent-foreground': 'oklch(0.97 0.008 150)',
        destructive: 'oklch(0.72 0.17 25)',
        border: 'oklch(0.52 0.035 157)',
        input: 'oklch(0.56 0.04 157)',
        ring: 'oklch(0.78 0.14 152)',
      },
    },
  },
] as const;

/** The control's id — the set that declares nothing and inherits `:root`/`.dark`. */
export const CONTROL_SET_ID = 'chalk';

/** The sets that carry a scoped CSS block (i.e. everything but the control). */
export const SCOPED_SETS = TOKEN_SETS.filter((s) => s.tokens !== null);
