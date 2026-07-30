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
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-3 rounded-lg border px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 id={headingId} className="text-base font-medium">
          Today&rsquo;s program
        </h3>
        <span className="text-muted-foreground text-sm">{DAY_ROLE_LABELS[dayRole]}</span>
      </div>
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
    </section>
  );
}
