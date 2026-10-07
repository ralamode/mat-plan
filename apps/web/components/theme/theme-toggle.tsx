'use client';

import { useSyncExternalStore } from 'react';
import { useTheme } from 'next-themes';

import { THEME_CHOICES, THEME_COPY, type ThemeChoice } from '@/lib/constants';

/**
 * The theme switch (UI-4): Auto / Light / Dark, as three native radios in a `<fieldset>`.
 *
 * ## Why radios, and why not the alternatives
 *
 * - **Not one button that cycles.** The viewer cannot see what the next tap will do, and the control
 *   has to name both its current state and its next one. Three radios state the whole model at once.
 * - **Not a dropdown.** It would hide a three-item choice behind a tap and needs a Radix primitive
 *   this app does not vendor.
 * - **Native radios, not `aria-pressed` buttons.** Three mutually exclusive values IS a radio group:
 *   one tab stop with arrow-key movement, state announced by the platform, and no live region needed
 *   (adding one would double-announce). It is the same argument `set-mode-toggles.tsx` records for
 *   using real checkboxes for two independent booleans.
 *
 * ## It must NOT look like the logging chips
 *
 * The `sr-only`-input-inside-a-`min-h-11`-label construction is borrowed from
 * `app/p/[profileId]/set-mode-toggles.tsx` — that part is right and it is why the a11y gate measures
 * the **label** as the tap target (`e2e/a11y.spec.ts`'s `LABEL_MEASURED` path). The *skin* is
 * deliberately different: those chips are filled `bg-secondary` pills that record what was actually
 * lifted, and a theme control that looked identical would read as another logging control (UX panel,
 * lens 3). So this is one bordered segmented group whose selected item INVERTS
 * (`bg-foreground text-background`) — unmistakably not a chip, and 19:1 in both themes by
 * construction, since the two tokens are each other's contrast pair.
 *
 * ## No flash, and no layout shift either
 *
 * `theme` is `undefined` during SSR — the server cannot know a `localStorage` value. The three
 * possible pre-mount renders each give up something, and returning `null` is the worst of them: the
 * bar would grow by ~44px on hydration, on every page, which is a CLS regression against the
 * budget in `docs/decisions/0001-observability-and-web-vitals.md`. So the server renders the
 * **default** (`Auto`) as checked, which is correct for every viewer who has not chosen otherwise,
 * the client's first render does the same (so hydration matches exactly), and the effect reconciles
 * to the stored choice immediately afterwards. The *theme itself* never flashes regardless — that is
 * the provider's pre-paint script, not this component.
 */
/**
 * "Have we hydrated yet?", without a `setState` in an effect.
 *
 * `useSyncExternalStore` is the idiomatic way to read a value that legitimately differs between
 * server and client: the server snapshot is `false`, the client's is `true`, and React swaps them
 * after hydration with no extra render pass. The `useState` + `useEffect` version of this is what
 * `react-hooks/set-state-in-effect` exists to reject, and the rule is right — so the fix is the
 * correct hook, not a disable comment. `subscribe` is module-level and never fires: the value
 * changes exactly once, at hydration, which React already handles.
 */
const NEVER_CHANGES = () => () => {};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const hydrated = useSyncExternalStore(
    NEVER_CHANGES,
    () => true,
    () => false,
  );

  // Pre-hydration (server AND the client's first render) → the documented default, so the markup
  // agrees across hydration and the control is never drawn with nothing selected.
  const current: ThemeChoice = hydrated && theme ? (theme as ThemeChoice) : 'system';

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-muted-foreground mb-1 text-sm font-medium">
        {THEME_COPY.legend}
      </legend>
      {/* `flex-wrap`: at 200% text size (WCAG 1.4.4) the three segments are ~390px against ~296px of
          usable width at 360px, so they must be allowed to stack rather than overflow. The landing's
          CTA does the same thing for the same reason (`app/page.tsx`). */}
      <div className="border-input bg-background inline-flex flex-wrap items-center gap-0.5 rounded-lg border p-0.5">
        {THEME_CHOICES.map((choice) => {
          const selected = current === choice;
          return (
            // `min-h-11` on the LABEL, not the input: a visually-hidden radio has no box of its own,
            // and the label is both what a thumb hits and what the browser activates.
            <label
              key={choice}
              className={`has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-background inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md px-3 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-offset-2 ${
                selected
                  ? 'bg-foreground text-background font-semibold'
                  : 'text-muted-foreground hover:bg-muted hover:text-foreground'
              }`}
            >
              {/* `sr-only`, NOT `hidden` — it stays in the tab order and operable by keyboard and AT.
                  `has-[:focus-visible]`, not `focus-within`: `focus-within` also matches a POINTER
                  tap, which would leave a ring stuck on the control after every thumb press. */}
              <input
                type="radio"
                name="theme"
                value={choice}
                checked={selected}
                onChange={() => setTheme(choice)}
                className="sr-only"
                // The visible word is a substring of the accessible name (WCAG 2.5.3 Label in Name).
                aria-label={THEME_COPY.option(choice)}
              />
              {THEME_COPY.labels[choice]}
            </label>
          );
        })}
      </div>
      <p className="text-muted-foreground text-xs">{THEME_COPY.hint}</p>
    </fieldset>
  );
}
