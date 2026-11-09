import Link from 'next/link';

import { ADD_ATHLETE_COPY, ADD_ATHLETE_PATH } from '@/lib/constants';

/**
 * The picker's add-athlete tile (PROF-1 a-1u) — the app's first way to create an athlete.
 *
 * Colocated with `/p` (PROF-1 D9) rather than in `components/profiles/`, because it belongs to one
 * route: it is the picker's last `<li>` and the empty state's only control, both of which are `/p`.
 * `ProfileTile` lives in `components/` because `/settings` renders the same row shape; nothing else
 * renders this.
 *
 * ## It mirrors `ProfileTile`'s geometry, deliberately
 *
 * Same `min-h-24`, same `gap-4`, same `size-14` leading circle, same radius and padding — so the
 * tile sits in the list as a peer rather than as a control bolted underneath it. What differs is
 * exactly what should: a **dashed** avatar ring and no card background, which is the conventional
 * "add one of these" affordance and keeps it from reading as an athlete named "+".
 *
 * 🔴 **`border-muted-foreground`, an OPAQUE token — NOT `foreground/28`.** The prototype used a 28%
 * alpha, which measures **1.93:1** light and **2.35:1** dark against the page: a border a person with
 * low vision cannot find, and under SC 1.4.11's 3:1 floor for non-text contrast. `muted-foreground`
 * is 4.73:1 / 7.63:1. ⚠️ `token-sets.test.ts` pins that, because **nothing else measures it**: axe
 * has no non-text-contrast rule, so neither the `/design/tokens` scan nor the route scans would see a
 * regression here (UX lens 2, B3).
 *
 * The `+` is `aria-hidden`: the link's own text already says "Add athlete", and a screen reader
 * announcing "plus Add athlete" is noise.
 *
 * Pure sync Server Component — it only renders a link.
 */
export function AddAthleteTile() {
  return (
    <Link
      href={ADD_ATHLETE_PATH}
      className="group/add text-foreground border-muted-foreground hover:border-foreground focus-visible:ring-ring flex min-h-24 items-center gap-4 rounded-xl border-2 border-dashed px-5 py-4 outline-none transition-all focus-visible:ring-3"
    >
      <span
        aria-hidden="true"
        className="border-muted-foreground text-muted-foreground group-hover/add:border-foreground group-hover/add:text-foreground flex size-14 shrink-0 items-center justify-center rounded-full border-2 border-dashed text-2xl font-semibold"
      >
        +
      </span>
      {/* `min-w-0` for the same reason `ProfileTile` carries it: a row-flex item beside a
          `shrink-0` avatar floors at its content's min-content width without it. The copy here is
          short, but the constraint is the renderer's, not the string's. */}
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-lg font-medium">{ADD_ATHLETE_COPY.heading}</span>
        <span className="text-muted-foreground text-sm">{ADD_ATHLETE_COPY.subhead}</span>
      </span>
    </Link>
  );
}
