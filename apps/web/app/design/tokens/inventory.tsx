import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { INPUT_CLASS } from '@/lib/constants';

import type { TokenSet } from './token-sets';

/**
 * The component inventory, as cells that each render the app's vocabulary under ONE token set.
 *
 * ## Why these are cells and not whole pages
 *
 * The page is laid out **component-major**: one section per component family, four cells side by side
 * inside it. Set-major (one long section per set) was the first draft, and two UX lenses independently
 * killed it with the same arithmetic — a full inventory is roughly 3,000px per set at 360px, so
 * comparing Forge's button with Tatami's would have been a 3,000px scroll, i.e. comparison by memory.
 * The criterion this page exists to serve says "reviewed **side by side**", and at 2-up on a phone it
 * literally is.
 *
 * ## Every id is namespaced, and that is load-bearing
 *
 * Four copies of a `<label htmlFor="reps">` resolve, via `getElementById`, to the FIRST `#reps` in the
 * document — so three of the four inputs end up with no accessible name (axe `label`, `select-name`,
 * both `wcag2a` and both inside `e2e/a11y.spec.ts`'s scanned tag set), and on a phone tapping the
 * fourth cell's label focuses the first cell's input. `duplicate-id` would NOT have warned us: it is
 * deprecated and `wcag2a-obsolete` in axe 4.13, so it is excluded from the scan. Hence `setId` is a
 * required prop, not a convenience.
 *
 * ## What is deliberately NOT rendered, and why that is a report rather than a dodge
 *
 * `buttonVariants.destructive` (`bg-destructive/10 text-destructive`) measures **4.39:1** in light
 * mode and 3.04:1 in dark on a card, and `text-muted-foreground` on `bg-muted` measures **4.34:1** in
 * light — all under AA, all in the palette shipping TODAY, and all invisible to CI because no route
 * renders them (`variant="destructive"` has zero call sites). Rendering them here would redden the
 * a11y gate over a pre-existing defect this PR cannot fix without changing the live app's appearance,
 * which UI-4 promised not to do. So they are pinned with their measured ratios in
 * `token-sets.test.ts` and handed to UI-3 as inputs. The destructive *state* is still shown, the way
 * the app actually ships it: `text-destructive` error copy and an `aria-invalid` field.
 */

/** The wrapper that applies a set's palette to its subtree. */
export function SetCell({
  set,
  children,
  className = '',
}: {
  set: TokenSet;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      // The CONTROL declares no tokens: no attribute at all, so it inherits `:root`/`.dark` and is
      // byte-faithful to what ships. `undefined` and not `''` — `[data-tokens='']` would match a
      // block that does not exist and read as "a set with no tokens", which is a different claim.
      data-tokens={set.tokens ? set.id : undefined}
      // `bg-background text-foreground` so the cell PAINTS its own palette. Without the background,
      // every cell would sit on the page's own surface and the contrast a reviewer sees would not be
      // the contrast the test computed.
      className={`bg-background text-foreground border-border flex flex-col gap-3 rounded-lg border p-3 ${className}`}
    >
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {set.name}
      </p>
      {children}
    </div>
  );
}

const BUTTON_VARIANTS = ['default', 'secondary', 'outline', 'ghost', 'link'] as const;

/**
 * Buttons: the five variants a reviewer can tell apart, at ONE size.
 *
 * The size axis is left out on purpose. `min-h-11` lives in `buttonVariants`' BASE, so all eight
 * sizes render at 44px tall and differ only in horizontal padding and text size — 6 variants × 8
 * sizes would have been 48 near-identical buttons per set, 192 across the page, and the single
 * largest contributor to a scroll nobody reads. `destructive` is omitted for the contrast reason in
 * the file header.
 */
export function ButtonsCell({ setId }: { setId: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {BUTTON_VARIANTS.map((variant) => (
        <Button key={`${setId}-${variant}`} variant={variant}>
          {variant}
        </Button>
      ))}
    </div>
  );
}

/** Form fields: a labelled numeric input, an invalid one, a select, a checkbox and a radio pair. */
export function FieldsCell({ setId }: { setId: string }) {
  const id = (suffix: string) => `${setId}-${suffix}`;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor={id('weight')} className="text-sm font-medium">
          Weight (lb)
        </label>
        {/* `INPUT_CLASS` is the app's single source for field styling — the h-11 that clears the tap
            target, the focus ring, and the aria-invalid border all come from it. */}
        <input
          id={id('weight')}
          type="number"
          inputMode="numeric"
          defaultValue="135"
          className={`${INPUT_CLASS} w-28`}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={id('bad')} className="text-sm font-medium">
          Reps
        </label>
        <input
          id={id('bad')}
          type="number"
          inputMode="numeric"
          defaultValue="0"
          aria-invalid
          aria-describedby={id('bad-error')}
          className={`${INPUT_CLASS} w-28`}
        />
        {/* The destructive token as the app actually ships it: error copy, not a filled button. */}
        <p id={id('bad-error')} className="text-destructive text-sm">
          Reps must be at least 1.
        </p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={id('unit')} className="text-sm font-medium">
          Measuring
        </label>
        <select id={id('unit')} defaultValue="lb" className={`${INPUT_CLASS} w-28`}>
          <option value="lb">Pounds</option>
          <option value="kg">Kilograms</option>
          <option value="sec">Seconds</option>
        </select>
      </div>

      {/* Checkbox and radio in the app's shipped idiom: the input is `sr-only` and the `min-h-11`
          label is both the visible control and the activatable region the a11y gate measures. */}
      <label className="has-[:focus-visible]:ring-ring border-input inline-flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-[:focus-visible]:ring-2">
        <input type="checkbox" defaultChecked className="size-4" />
        Sub-failure
      </label>

      <fieldset className="flex flex-col gap-1">
        <legend className="text-sm font-medium">Session</legend>
        <div className="flex flex-wrap gap-2">
          {['A', 'B'].map((letter) => (
            <label
              key={id(`day-${letter}`)}
              className="has-[:focus-visible]:ring-ring border-input inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-[:focus-visible]:ring-2"
            >
              <input
                type="radio"
                // Namespaced: four cells sharing one `name` would be ONE radio group across the
                // whole page, so choosing in the fourth cell would clear the first.
                name={id('day')}
                value={letter}
                defaultChecked={letter === 'A'}
                className="size-4"
              />
              Day {letter}
            </label>
          ))}
        </div>
      </fieldset>
    </div>
  );
}

/** Surfaces: a card, an empty state and a loading skeleton — the three the app really uses. */
export function SurfacesCell() {
  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader>
          <CardTitle>This week</CardTitle>
          <CardDescription>3 of 5 sessions logged</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          Monday · Wednesday · Friday
          <span className="text-muted-foreground"> — Thursday open</span>
        </CardContent>
      </Card>
      <EmptyState>Nothing logged yet.</EmptyState>
      <div className="flex flex-col gap-2" aria-hidden>
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  );
}
