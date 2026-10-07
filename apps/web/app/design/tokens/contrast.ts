/**
 * OKLCH → sRGB → WCAG contrast, in pure TypeScript (UI-4).
 *
 * WHY THIS EXISTS, and why it is not "just run axe": the four candidate token sets are judged by a
 * human who has to answer "does this read in a sunlit gym?", and the only honest answer is a number.
 * axe gives a pass/fail on the pairs a page happens to render, in a 3-minute Playwright job, with no
 * margin — and it is tagged `wcag2aa`, so a candidate that is 0.01 under the line reddens the `e2e`
 * job, which is not even a required check until PR 28. Two of the plan's first-draft accents were
 * under 4.5:1 and the panel found them by doing this arithmetic by hand.
 *
 * So the ratios are computed HERE, in a sub-second unit test that runs in the required `quality` job
 * (`token-sets.test.ts`) and printed on the preview page itself, from ONE implementation. No new
 * dependency: the conversion is 30 lines of matrix algebra.
 *
 * Method (and the sanity check that proves it): Oklab → linear sRGB with the inverse LMS matrices
 * from Björn Ottosson's reference implementation, then WCAG 2.x relative luminance and
 * `(L1 + 0.05) / (L2 + 0.05)`. Fractional alpha is composited over an opaque backdrop in LINEAR
 * light. Running this on `--brand: oklch(0.654 0.212 34.36)` over white returns 3.5:1, which is
 * exactly what `globals.css`'s own comment records for the mark — that agreement is the check that
 * the matrices are right, not a coincidence.
 */

/** WCAG 2.x AA floor for normal-size text (and the bar `docs/design.md` commits to). */
export const AA_NORMAL = 4.5;
/** WCAG 2.x AA floor for large text (≥18.66px bold or ≥24px) and for SC 1.4.11 non-text contrast. */
export const AA_LARGE = 3;

export type Rgb = { r: number; g: number; b: number };
/** An opaque colour plus the alpha it was declared with (1 when the declaration had none). */
export type ParsedColor = { rgb: Rgb; alpha: number };

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** sRGB transfer function, linear → encoded (not needed for contrast, kept for hex output). */
function encode(c: number): number {
  const v = clamp01(c);
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/**
 * `oklch(L C H)` / `oklch(L C H / 10%)` → LINEAR sRGB in 0..1, plus alpha.
 *
 * L is taken as written (0..1 or a percentage), H in degrees. Out-of-gamut components are clamped,
 * which is what a browser does when it rasterises the colour, so the ratio matches what is on screen.
 */
export function parseOklch(value: string): ParsedColor | null {
  const m = /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/i.exec(
    value.trim(),
  );
  if (!m) return null;
  const [, rawL, rawC, rawH, rawA] = m;
  const L = rawL!.endsWith('%') ? Number.parseFloat(rawL!) / 100 : Number.parseFloat(rawL!);
  const C = Number.parseFloat(rawC!);
  const H = (Number.parseFloat(rawH!) * Math.PI) / 180;
  const alpha = rawA
    ? rawA.endsWith('%')
      ? Number.parseFloat(rawA) / 100
      : Number.parseFloat(rawA)
    : 1;

  const a = C * Math.cos(H);
  const b = C * Math.sin(H);

  // Oklab → LMS' → LMS (cube) → linear sRGB (Ottosson's matrices).
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ * l_ * l_;
  const mm = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    alpha,
    rgb: {
      r: clamp01(4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s),
      g: clamp01(-1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s),
      b: clamp01(-0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s),
    },
  };
}

/** Composite a possibly-translucent colour over an opaque backdrop, in linear light. */
export function over(fg: ParsedColor, bg: Rgb): Rgb {
  const a = fg.alpha;
  if (a >= 1) return fg.rgb;
  return {
    r: fg.rgb.r * a + bg.r * (1 - a),
    g: fg.rgb.g * a + bg.g * (1 - a),
    b: fg.rgb.b * a + bg.b * (1 - a),
  };
}

/** WCAG 2.x relative luminance from LINEAR sRGB. */
export function luminance(c: Rgb): number {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

/** WCAG 2.x contrast ratio between two opaque linear-sRGB colours. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The ratio between two OKLCH declarations, compositing the foreground (and, if it is also
 * translucent, the background) over `base` — which is the opaque surface they ultimately sit on.
 * Returns `null` when either value is not parseable OKLCH, so a caller can report that distinctly
 * from a failing ratio rather than silently scoring it 1.
 */
export function ratioOf(fg: string, bg: string, base = 'oklch(1 0 0)'): number | null {
  const f = parseOklch(fg);
  const b = parseOklch(bg);
  const z = parseOklch(base);
  if (!f || !b || !z) return null;
  const backdrop = over(b, z.rgb);
  return contrastRatio(over(f, backdrop), backdrop);
}

/**
 * Add an alpha channel to an OKLCH declaration — `oklch(0.577 0.245 27)` + 10% →
 * `oklch(0.577 0.245 27 / 10%)`. Exists because the tint variants in `buttonVariants` and
 * `ErrorState` are written in Tailwind as `bg-destructive/10`, i.e. the token at a fraction, and the
 * ratio of text on such a tint is only computable if the alpha can be applied to the declared value.
 * A naive string concat gets the `)` wrong, which is how a "measured" ratio becomes a made-up one.
 */
export function withAlpha(value: string, percent: number): string {
  return value.trim().replace(/\s*\)\s*$/, ` / ${percent}%)`);
}

/** `4.49` — one decimal is the resolution a human judges a palette at. */
export const formatRatio = (ratio: number): string => `${ratio.toFixed(2)}:1`;

/** `#d33f1d`, for printing a swatch's value next to it on the preview page. */
export function toHex(value: string): string | null {
  const parsed = parseOklch(value);
  if (!parsed) return null;
  const hex = (c: number) =>
    Math.round(encode(c) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${hex(parsed.rgb.r)}${hex(parsed.rgb.g)}${hex(parsed.rgb.b)}`;
}
