import type { DayRole } from '@mat-plan/shared';

import { STRENGTH_COPY } from '@/lib/constants';
import { movementNames, sessionMovements, type SessionRow } from '@/lib/entries/activity-totals';
import type { ProgramDayDTO } from '@/lib/programming/program-day';

import { ProgramReference } from './program-reference';
import { StrengthForm } from './strength-form';
import {
  sessionHeading,
  sessionOrdinals,
  StrengthSessionReceipt,
} from './strength-session-receipt';

/**
 * The strength section of Today (V1-24 3a-ii): the day's strength RECORD, not just a form. A server
 * component, mirroring `bodyweight-section.tsx`:
 *
 * 1. the h2;
 * 2. a receipt per logged session (`placement="section"`, focusable, Change on every day: the amend has
 *    no day bound, parent Decision 5);
 * 3. on a writable day, the `StrengthForm` island: open when nothing is logged, otherwise collapsed
 *    behind "Log more strength", with "Already saved for this day" and the program card inside it.
 *
 * On a closed day there is no form and no toggle; the program card renders here, as before.
 */
export function StrengthSection({
  headingId,
  profileId,
  day,
  writable,
  dayRole,
  programDay,
  sessions,
}: {
  headingId: string;
  profileId: string;
  day: string;
  writable: boolean;
  dayRole: DayRole | null;
  programDay: readonly ProgramDayDTO[];
  /** Today's strength sessions, oldest first (from `todayRows`). */
  sessions: readonly SessionRow[];
}) {
  const ordinals = sessionOrdinals(sessions);
  const programCard =
    dayRole && programDay.length > 0 ? (
      // V1-10: today's programmed movements, read-only. Inside the routine's strength gate.
      <ProgramReference dayRole={dayRole} rows={programDay} />
    ) : null;
  const logged = sessions.map((s) => ({
    id: s.session.id,
    heading: sessionHeading(s, ordinals.get(s.session.id)),
    names: movementNames(sessionMovements(s)),
  }));
  const alreadySaved =
    sessions.length > 0 ? movementNames(sessions.flatMap(sessionMovements)) : null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-medium">
        {STRENGTH_COPY.heading}
      </h2>
      {sessions.map((s) => (
        <StrengthSessionReceipt
          key={`receipt-${s.session.id}`}
          row={s}
          profileId={profileId}
          placement="section"
          ordinal={ordinals.get(s.session.id)}
        />
      ))}
      {writable ? (
        <StrengthForm
          // Keyed on the day: the island's open/collapsed state starts fresh on a day change (V1-28).
          key={`strength-${day}`}
          profileId={profileId}
          day={day}
          defaultDayRole={dayRole}
          // V1-19 — NARROWED on purpose: `ProgramDayDTO` also carries this kid's prescribed `load`, and
          // the one invariant the scaffold exists to protect is that no authored load reaches an input.
          // V1-26 PR-A widens it by exactly the movement's declaration (`isBodyweight`, `unitDefault`).
          // Structure crosses; a number does not.
          programDay={programDay.map(({ idx, movementName, sets, isBodyweight, unitDefault }) => ({
            idx,
            movementName,
            sets,
            isBodyweight,
            unitDefault,
          }))}
          logged={logged}
          alreadySaved={alreadySaved}
          programCard={programCard}
        />
      ) : (
        programCard
      )}
    </section>
  );
}
