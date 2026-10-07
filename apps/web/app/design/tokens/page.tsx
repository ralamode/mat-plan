import type { Metadata } from 'next';

import { DAY_ROLES, type DayRole } from '@mat-plan/shared';

import { ProgramReference } from '@/app/p/[profileId]/program-reference';
import type { ProgramDayDTO } from '@/lib/programming/program-day';
import { ThemeToggle } from '@/components/theme/theme-toggle';
import { requireGatedPage } from '@/lib/dal/gate';

import { AA_LARGE, AA_NORMAL, formatRatio, ratioOf, toHex } from './contrast';
import { ButtonsCell, FieldsCell, SetCell, SurfacesCell } from './inventory';
import { SetRowDemo } from './set-row-demo';
import { PALETTE_TOKENS, SCOPED_SETS, TOKEN_SETS } from './token-sets';
import './token-sets.css';

/**
 * `/design/tokens` — the four candidate token sets, rendered side by side in whichever theme you are
 * viewing (UI-4, built to serve UI-3).
 *
 * ## Why a route and not Storybook
 *
 * Zero new dependencies — Storybook is a large devDependency tree with its own build and
 * supply-chain surface, in a repo that SHA-pins every GitHub Action and gates on `audit --prod`.
 * Every PR already gets a Vercel preview URL, so a route is previewable on a real phone for free.
 * And it renders the REAL components with the REAL tokens in the real app shell — same CSP, same
 * fonts, same `@theme inline` resolution, same `.dark` mechanism. Token and layout bugs hide in
 * isolation, and Storybook's iframe is exactly that isolation.
 *
 * ## Why `/design/tokens` and not `/theme`
 *
 * This PR also ships a user-facing theme switch. A gated user who wandered to `/theme` expecting
 * theme settings and found a token-comparison harness would be right to be confused, and the repo's
 * convention is that a path names what the page is for (`/gate`, `/p/[id]/routine`).
 *
 * ## Gating, and its lifetime
 *
 * Gated like every other page (`requireGatedPage()`, which `app/pages-are-gated.test.ts` enforces
 * statically), plus `noindex`. It is deliberately NOT excluded from production: the Vercel preview
 * IS a production build, so a `NODE_ENV` guard would delete the capability that justified choosing a
 * route in the first place. It holds **no data** — every value on this page is a literal in its own
 * module, there is no DAL read beyond the gate check — so there is nothing here to leak.
 *
 * ⚠️ **It has an end date.** The UI-3 PR that picks a set deletes this directory and its entry in
 * `e2e/a11y.spec.ts`'s `ROUTES`. A harness kept past its decision is a gate that costs forever for a
 * choice made once, which at ~4h/week is the wrong trade.
 */
export const metadata: Metadata = {
  title: 'Token sets',
  // Not indexable. Gated too, so this is belt and braces — but the gate is a stopgap, not authz.
  robots: { index: false, follow: false },
};

/**
 * The card's rows, covering `formatPrescription`'s three shapes: sets + reps, a movement-only
 * prescription, and one carrying a verbatim coach-authored load. Literals, not a DAL read — this page
 * holds no household data.
 */
const PROGRAM_ROWS: readonly ProgramDayDTO[] = [
  {
    idx: 0,
    movementName: 'Back Squat',
    sets: 4,
    targetReps: '5',
    load: '~75-85',
    isBodyweight: false,
    unitDefault: 'lb',
  },
  {
    idx: 1,
    movementName: 'Pull-Up',
    sets: 3,
    targetReps: 'AMRAP',
    load: 'BW',
    isBodyweight: true,
    unitDefault: null,
  },
  {
    idx: 2,
    movementName: 'Farmer Carry',
    sets: null,
    targetReps: null,
    load: null,
    isBodyweight: false,
    unitDefault: 'lb',
  },
];

/**
 * One day role per set, so `ProgramReference`'s internal `program-<role>-heading` id stays unique
 * across the four copies. Four identical ids would make every card's `aria-labelledby` resolve to the
 * first card's heading — invalid HTML, and a screen-reader user hearing one card's name four times.
 * The alternative was adding an id-prefix prop to a guide-owned component; using the roles it already
 * accepts costs nothing and shows the label slot varying, which is part of the card.
 */
const ROLE_FOR_SET: readonly DayRole[] = DAY_ROLES.slice(0, TOKEN_SETS.length) as DayRole[];

/** The text pairs whose ratio decides whether a set is usable. Same list the unit test asserts. */
const TEXT_PAIRS = [
  ['body text', 'foreground', 'background'],
  ['muted text', 'muted-foreground', 'background'],
  ['muted on muted', 'muted-foreground', 'muted'],
  ['button label', 'primary-foreground', 'primary'],
  ['link text', 'primary', 'background'],
  ['error text', 'destructive', 'background'],
] as const;

/** …and the non-text ones (SC 1.4.11, 3:1), which axe does not check at all. */
const NON_TEXT_PAIRS = [
  ['hairline', 'border', 'background'],
  ['field border', 'input', 'background'],
] as const;

export default async function TokenSetsPage() {
  await requireGatedPage(); // SEC-1: the proxy is not the boundary

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-8">
      <header className="flex flex-col gap-3">
        <h1 className="text-3xl font-semibold tracking-tight">Token sets</h1>
        <p className="text-muted-foreground max-w-prose">
          Four candidates for the reskin (UI-3), each applied to the app&rsquo;s real components.{' '}
          <strong className="text-foreground font-medium">Chalk is the control</strong> — it
          declares no tokens at all, so it is exactly what ships today. Switch the theme below and
          every set follows; the numbers are measured, not claimed.
        </p>
        <ThemeToggle />
        <nav aria-label="Sections">
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {[
              ['The sets', 'sets'],
              ['Contrast', 'contrast'],
              ['Buttons', 'buttons'],
              ['Form fields', 'fields'],
              ['Surfaces', 'surfaces'],
              ['Strength set row', 'set-row'],
              ['Day card', 'day-card'],
            ].map(([label, id]) => (
              <li key={id}>
                <a href={`#${id}`} className="text-primary underline-offset-4 hover:underline">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <section id="sets" aria-labelledby="sets-heading" className="flex flex-col gap-4">
        <h2 id="sets-heading" className="text-xl font-semibold tracking-tight">
          The sets
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {TOKEN_SETS.map((set) => (
            <li key={set.id} className="border-border flex flex-col gap-2 rounded-lg border p-3">
              <h3 className="font-medium">{set.name}</h3>
              <dl className="text-muted-foreground flex flex-wrap gap-x-4 text-xs">
                <div>
                  <dt className="inline">Accent: </dt>
                  <dd className="inline">{set.signature.accent}</dd>
                </div>
                <div>
                  <dt className="inline">Radius: </dt>
                  <dd className="inline">{set.signature.radius}</dd>
                </div>
                <div>
                  <dt className="inline">Density: </dt>
                  <dd className="inline">{set.signature.density}</dd>
                </div>
              </dl>
              <p className="text-sm">{set.rationale}</p>
              {set.tokens ? (
                <ul className="flex flex-wrap gap-1" aria-label={`${set.name} swatches`}>
                  {PALETTE_TOKENS.map((token) => (
                    <li key={token}>
                      {/* The swatch is decoration for a value the row already names in text, so the
                          colour is never the only carrier of meaning. */}
                      <span
                        className="border-border block size-6 rounded"
                        style={{ background: set.tokens!.light[token] }}
                        title={`${token}: ${toHex(set.tokens!.light[token]) ?? ''}`}
                      />
                      <span className="sr-only">
                        {token}: {toHex(set.tokens!.light[token])}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section id="contrast" aria-labelledby="contrast-heading" className="flex flex-col gap-4">
        <h2 id="contrast-heading" className="text-xl font-semibold tracking-tight">
          Contrast, measured
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">
          WCAG 2.x ratios computed from the OKLCH values themselves, so &ldquo;reads in a sunlit
          gym&rdquo; is a number rather than an adjective. Text needs {AA_NORMAL}:1, hairlines{' '}
          {AA_LARGE}:1 (SC 1.4.11, which axe does not check). The control is omitted here because it
          declares no values of its own — for the record, today&rsquo;s palette has three pairs
          under AA, listed in <code>token-sets.test.ts</code>.
        </p>
        {/* A table may be wider than the phone, in its OWN scroll container — the page body still
            never scrolls horizontally (AGENTS.md). `tabIndex={0}` + a `region` name is REQUIRED, not
            decoration: axe's `scrollable-region-focusable` is `wcag2a` and it failed this page on the
            first run, because a scroll container that only a pointer can reach is unusable from a
            keyboard. */}
        <div
          role="region"
          aria-label="Measured contrast ratios"
          tabIndex={0}
          className="focus-visible:ring-ring overflow-x-auto rounded outline-none focus-visible:ring-2"
        >
          <table className="w-full min-w-md border-collapse text-sm">
            <caption className="text-muted-foreground pb-2 text-left text-xs">
              Light / dark, per candidate set.
            </caption>
            <thead>
              <tr className="border-border border-b text-left">
                <th scope="col" className="py-2 pr-3 font-medium">
                  Pair
                </th>
                {SCOPED_SETS.map((set) => (
                  <th key={set.id} scope="col" className="py-2 pr-3 font-medium">
                    {set.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[...TEXT_PAIRS, ...NON_TEXT_PAIRS].map(([label, fg, bg]) => {
                const floor = (TEXT_PAIRS as readonly unknown[]).some(
                  (p) => (p as readonly string[])[0] === label,
                )
                  ? AA_NORMAL
                  : AA_LARGE;
                return (
                  <tr key={label} className="border-border/60 border-b">
                    <th scope="row" className="py-2 pr-3 text-left font-normal">
                      {label}
                    </th>
                    {SCOPED_SETS.map((set) => {
                      const t = set.tokens!;
                      const light = ratioOf(t.light[fg], t.light[bg], t.light.background);
                      const dark = ratioOf(t.dark[fg], t.dark[bg], t.dark.background);
                      const under = (r: number | null) => r !== null && r < floor;
                      return (
                        <td key={set.id} className="py-2 pr-3 tabular-nums">
                          <span className={under(light) ? 'text-destructive' : undefined}>
                            {light === null ? '—' : formatRatio(light)}
                            {under(light) ? ' (under)' : ''}
                          </span>
                          <span className="text-muted-foreground"> / </span>
                          <span className={under(dark) ? 'text-destructive' : undefined}>
                            {dark === null ? '—' : formatRatio(dark)}
                            {under(dark) ? ' (under)' : ''}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section id="buttons" aria-labelledby="buttons-heading" className="flex flex-col gap-4">
        <h2 id="buttons-heading" className="text-xl font-semibold tracking-tight">
          Buttons
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TOKEN_SETS.map((set) => (
            <li key={set.id}>
              <SetCell set={set}>
                <ButtonsCell setId={set.id} />
              </SetCell>
            </li>
          ))}
        </ul>
      </section>

      <section id="fields" aria-labelledby="fields-heading" className="flex flex-col gap-4">
        <h2 id="fields-heading" className="text-xl font-semibold tracking-tight">
          Form fields
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TOKEN_SETS.map((set) => (
            <li key={set.id}>
              <SetCell set={set}>
                <FieldsCell setId={set.id} />
              </SetCell>
            </li>
          ))}
        </ul>
      </section>

      <section id="surfaces" aria-labelledby="surfaces-heading" className="flex flex-col gap-4">
        <h2 id="surfaces-heading" className="text-xl font-semibold tracking-tight">
          Surfaces
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {TOKEN_SETS.map((set) => (
            <li key={set.id}>
              <SetCell set={set}>
                <SurfacesCell />
              </SetCell>
            </li>
          ))}
        </ul>
      </section>

      <section id="set-row" aria-labelledby="set-row-heading" className="flex flex-col gap-4">
        <h2 id="set-row-heading" className="text-xl font-semibold tracking-tight">
          Strength set row
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">
          The real <code>SetRepsWeightFields</code> and <code>SetModeToggles</code>, not a copy —
          the densest row in the app, and the one the density and radius axes actually act on.
          Stacked full width, because this row needs ~294px of the 328px a 360px phone has.
        </p>
        <ul className="flex flex-col gap-3">
          {TOKEN_SETS.map((set) => (
            <li key={set.id}>
              <SetCell set={set}>
                <SetRowDemo ariaLabel={`${set.name} set 1`} />
              </SetCell>
            </li>
          ))}
        </ul>
      </section>

      <section id="day-card" aria-labelledby="day-card-heading" className="flex flex-col gap-4">
        <h2 id="day-card-heading" className="text-xl font-semibold tracking-tight">
          Day card
        </h2>
        <p className="text-muted-foreground max-w-prose text-sm">
          The real <code>ProgramReference</code>, fed literal prescriptions. Each card carries a
          different day role so its heading id stays unique across the four copies.
        </p>
        <ul className="flex flex-col gap-3">
          {TOKEN_SETS.map((set, i) => (
            <li key={set.id}>
              <SetCell set={set}>
                <ProgramReference dayRole={ROLE_FOR_SET[i]!} rows={PROGRAM_ROWS} />
              </SetCell>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
