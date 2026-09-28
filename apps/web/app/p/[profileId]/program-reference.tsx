import { DAY_ROLE_LABELS, type DayRole } from '@mat-plan/shared';

import { formatPrescription, type ProgramDayDTO } from '@/lib/programming/program-day';

/**
 * "Today's program" — a READ-ONLY reference card above the strength form (V1-10 slice 2). The coach reads
 * today's programmed movements (sets × reps + this kid's suggested load, VERBATIM) and types what was
 * actually performed into the form below.
 *
 * WHY READ-ONLY, not a prefill (the plan's panel reframe): ~90% of the authored loads are text ("BW",
 * "band", "~75-85", "35-45/hand") that a `type="number"` field cannot hold, and pre-filling the required
 * weight field would let a PRESCRIBED load be submitted as a PERFORMED one without an affirmative human
 * entry — a data-integrity hole and, for loads, an injury-safety one (AGENTS.md: the LLM never authors
 * loads; these are Ray-authored, and they still require a human to confirm by typing). Displaying the text
 * verbatim also carries the coach's AMRAP / to-failure / per-side cues, which a number field would drop.
 *
 * Server component — no `'use client'`, so the card ships zero client JS. Its heading is an `<h3>`: the
 * card nests INSIDE the "Log strength" `<section>` (whose heading is the `<h2>`), so a second `<h2>` would
 * announce the program as a sibling of the logging section rather than part of it.
 *
 * V1-23 PR 3 — COLLAPSIBLE, as a native `<details open>`. On a phone this card is a screenful ABOVE the
 * first input, and the athlete only needs it until they have read it; shutting it puts the form on screen.
 * It ships `open` because reading the day IS the point of the screen before you start.
 *
 * WHY NATIVE `<details>` and not "pass this card as `children` into `StrengthForm`" (the alternative the
 * plan's panels rejected): the form remounts on `key={gen}` after every logged session, so a React-state
 * disclosure inside it would RE-EXPAND on every log — re-creating the exact complaint. `<details>` keeps
 * this a Server Component, crosses no client boundary, ships zero JS, and the collapse survives a log.
 * Same idiom as `components/duals/day-sheet.tsx`.
 *
 * ⚠️ The note in `strength-form.tsx` that the collapsed MOVEMENT cards are "NOT a native `<details>`" does
 * NOT apply here, and the difference is worth stating so the next reader does not infer a blanket rule:
 * that reason is `required`-INPUT-specific (a hidden-but-present `required` input deadlocks the native
 * submit with an invisible "not focusable" error). This card contains NO form controls at all.
 *
 * Two build-breakers the panels caught, both handled below:
 *
 *  1. **`aria-labelledby` must not dangle.** The `<h3 id=…>` lives in the `<summary>`, which the browser
 *     renders in BOTH states — so the id the `<section>` points at always resolves. Move the heading into
 *     the collapsible body and a closed card fails axe's `aria-valid-attr-value`, which `e2e/a11y.spec.ts`
 *     scans this route for (including the scaffolded state) and FAILS THE BUILD on.
 *  2. **The trigger must not submit.** This card renders inside the "Log strength" `<section>`; a
 *     `<button>` with no `type` defaults to `type="submit"`. A `<summary>` is not a submitter at all, so
 *     the failure mode cannot occur (a button trigger here would need an explicit `type="button"`).
 *
 * NOT preserved when closed, deliberately: nothing. For the live `PROGRAM_SEED`, 11 of 13 prescriptions are
 * `open()` (no sets, no reps, no load), so most rows are a bare movement name and there is nothing to keep.
 * Surfacing `targetReps` on the form's own movement cards is a separate backlog row — and `load` never
 * reaches an input, which is the invariant, not a preference.
 */
export function ProgramReference({
  dayRole,
  rows,
}: {
  dayRole: DayRole;
  rows: readonly ProgramDayDTO[];
}) {
  // Keyed off the day role, not a positional index: at most one card can render (the routine dedupes the
  // `strength` key), and this stays unique and self-describing without depending on that invariant.
  const headingId = `program-${dayRole}-heading`;
  return (
    <section aria-labelledby={headingId} className="rounded-lg border">
      <details open className="group">
        {/* `list-none` kills the marker in Chrome/Firefox; `::-webkit-details-marker` is still needed for
            Safari < 17, which ignores `list-style` on a summary. Without both, a stray disclosure triangle
            sits left of the heading. `min-h-11` = 44px, the tap-target bar — a summary is not matched by
            `a11y.spec.ts`'s `INTERACTIVE` selector (that is an attribute match on `[role="button"]`, and
            `<summary>`'s button role is implicit), so CI would NOT catch a short one here. */}
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-x-3 px-4 py-2 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <h3 id={headingId} className="text-base font-medium">
              Today&rsquo;s program
            </h3>
            <span className="text-muted-foreground text-sm">
              {/* The separator is decoration: `aria-hidden` keeps "middle dot" out of the announcement,
                  which is the whole summary's accessible name. */}
              <span aria-hidden>·</span> {DAY_ROLE_LABELS[dayRole]}
            </span>
          </span>
          <span
            aria-hidden
            className="text-muted-foreground/60 shrink-0 transition-transform group-open:rotate-90"
          >
            ›
          </span>
        </summary>
        {/* The body's padding lives here, not on the `<section>`: a closed card must collapse to the
            summary's 44px, and a `py-3` on the outer box would leave 24px of dead space below it. */}
        <div className="flex flex-col gap-3 px-4 pt-1 pb-3">
          <ul className="flex flex-col gap-2.5">
            {rows.map((r) => {
              // Both `sets` and `target_reps` are nullable (a movement-only prescription is legal), so the
              // prescription line can legitimately be empty — in which case the load must NOT be prefixed with
              // a dangling " · ".
              const prescription = formatPrescription(r);
              return (
                // `idx` is the prescription's slot within the day — its stable identity, and unique even when a
                // movement legitimately repeats (warm-up + working).
                <li key={r.idx} className="flex flex-col gap-0.5">
                  <span className="font-medium">{r.movementName}</span>
                  <span className="text-muted-foreground text-sm">
                    {prescription}
                    {r.load ? (
                      <>
                        {prescription ? ' · ' : null}
                        {/* The suggested load, verbatim. The word "suggested" is in the DOM (not colour alone)
                        so the card can never read as a record of what was actually lifted. */}
                        <span className="text-foreground/80">{r.load}</span>{' '}
                        <span className="text-xs">suggested</span>
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-muted-foreground text-xs">
            Reference only — log what you actually did below.
          </p>
        </div>
      </details>
    </section>
  );
}
