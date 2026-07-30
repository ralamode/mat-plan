import { DAY_ROLE_LABELS, type DayRole } from '@mat-plan/shared';

import type { ProgramDayDTO } from '@/lib/dal/programming';

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
 * Server component — no `'use client'`, so the card ships zero client JS. `<dl>` per movement: the load is
 * genuinely a value described by its movement, and the sets×reps line is the prescription.
 */
export function ProgramReference({
  dayRole,
  rows,
}: {
  dayRole: DayRole;
  rows: readonly ProgramDayDTO[];
}) {
  return (
    <section
      aria-labelledby="program-today-heading"
      className="flex flex-col gap-3 rounded-lg border px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="program-today-heading" className="text-lg font-medium">
          Today&rsquo;s program
        </h2>
        <span className="text-muted-foreground text-sm">{DAY_ROLE_LABELS[dayRole]}</span>
      </div>
      <ul className="flex flex-col gap-2.5">
        {rows.map((r, i) => (
          // `idx` order is the coach's authored order; a movement may legitimately repeat within a day
          // (warm-up + working), so the key is the slot index, not the name.
          <li key={i} className="flex flex-col gap-0.5">
            <span className="font-medium">{r.movementName}</span>
            <span className="text-muted-foreground text-sm">
              {formatPrescription(r)}
              {r.load ? (
                <>
                  {' · '}
                  {/* The suggested load, verbatim. Explicitly labeled "suggested" so the card can never
                      read as a record of what was lifted. */}
                  <span className="text-foreground/80">{r.load}</span>{' '}
                  <span className="text-xs">suggested</span>
                </>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-muted-foreground text-xs">
        Reference only — log what you actually did below.
      </p>
    </section>
  );
}

/**
 * The prescription line: "4 × 5", or just the sets / just the reps when the other is unauthored (both are
 * nullable in the schema — a movement-only prescription is legal). Reps stay VERBATIM text ("8-12",
 * "40 yd, to grip failure"), never parsed to a number.
 */
function formatPrescription({ sets, targetReps }: ProgramDayDTO): string {
  if (sets !== null && targetReps !== null) return `${sets} × ${targetReps}`;
  if (sets !== null) return `${sets} ${sets === 1 ? 'set' : 'sets'}`;
  return targetReps ?? '';
}
