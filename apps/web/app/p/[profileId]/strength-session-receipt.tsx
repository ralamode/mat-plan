import {
  DAY_ROLE_LABELS,
  DEFAULT_SESSION_TYPE,
  DEFAULT_SUPERSET_LABEL,
  ENTRY_STATUS,
  SESSION_TYPE_LABELS,
} from '@mat-plan/shared';

import {
  AMEND_COPY,
  movementCount,
  skippedCount,
  STRENGTH_COPY,
  strengthReceiptId,
  VALUE_JOINER,
} from '@/lib/constants';
import { sessionMovements, type SessionRow } from '@/lib/entries/activity-totals';
import { entryLabel } from '@/lib/entries/entry-label';

import { SessionMovementItem } from './movement-line';
import { LOCKED_REASON, movementLockedReason, type LockedReason } from './set-display';

/** The block heading's role/type label — the asserted day role ("Strength A") over the generic type. */
export function sessionTypeLabel(session: SessionRow['session']): string {
  // GAP-1 P0-1: prefer the ASSERTED programmed day over the generic session type. Surfacing it is what
  // makes the stored value auditable — a role nobody sees is one nobody can notice is wrong.
  return session.dayRole
    ? DAY_ROLE_LABELS[session.dayRole]
    : SESSION_TYPE_LABELS[session.type ?? DEFAULT_SESSION_TYPE];
}

/** The receipt's h3 ("Strength A session 2"); also what the save announcement leads with. */
export function sessionHeading(row: SessionRow, ordinal = 1): string {
  return `${sessionTypeLabel(row.session)} session${ordinal > 1 ? ` ${ordinal}` : ''}`;
}

/**
 * The ordinal of each session among the day's sessions with the SAME label (1, 2, …), so two
 * "Strength A" sessions read "Strength A session" and "Strength A session 2" (V1-24 3a-ii D4/D7).
 */
export function sessionOrdinals(sessions: readonly SessionRow[]): Map<string, number> {
  const seen = new Map<string, number>();
  const out = new Map<string, number>();
  for (const s of sessions) {
    const label = sessionTypeLabel(s.session);
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    out.set(s.session.id, n);
  }
  return out;
}

/**
 * One logged strength session (V1-8-3a; V1-24 3a-ii). ONE renderer for both places it appears, so the
 * two cannot disagree:
 * - `placement="section"`: the receipt in the strength section. It carries the focus id and
 *   `tabIndex={-1}` (the save focuses it), "Saved", and ONE Locked line for the whole session (J15:
 *   per-movement lines were wallpaper on a bodyweight-heavy day).
 * - `placement="list"`: the "Logged entries" row. No ids. Sets are read-only when `editable` is false,
 *   i.e. when the strength section is on the page, so every set has exactly one Change.
 *
 * No checkmark anywhere: the values stay editable (parent §The one model).
 */
export function StrengthSessionReceipt({
  row,
  profileId,
  placement,
  ordinal = 1,
  editable = true,
}: {
  row: SessionRow;
  profileId: string;
  placement: 'section' | 'list';
  ordinal?: number;
  editable?: boolean;
}) {
  const inSection = placement === 'section';
  const movements = sessionMovements(row);
  const skipped = movements.filter((m) => m.status === ENTRY_STATUS.skipped).length;
  const count = row.movementCount;
  const heading = sessionHeading(row, ordinal);
  const item = (entry: (typeof movements)[number]) => (
    <SessionMovementItem
      key={entry.id}
      entry={entry}
      profileId={profileId}
      editable={editable}
      lockedLine={!inSection}
    />
  );

  return (
    <div
      id={inSection ? strengthReceiptId(row.session.id) : undefined}
      tabIndex={inSection ? -1 : undefined}
      className={`flex flex-col gap-2 rounded-lg border px-4 py-3 ${inSection ? 'bg-muted/40' : ''}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="font-medium">{heading}</h3>
        <span className="text-muted-foreground text-sm">
          {inSection ? (
            <>
              {STRENGTH_COPY.saved}
              <span aria-hidden="true"> · </span>
            </>
          ) : null}
          {movementCount(count)}
          {skipped > 0 ? (
            <>
              <span aria-hidden="true"> · </span>
              {skippedCount(skipped)}
            </>
          ) : null}
        </span>
      </div>
      {row.session.feel ? (
        // V1-8-3b: the optional session feel, truthiness-guarded so an empty one never renders.
        <p className="text-muted-foreground text-sm italic">Felt: {row.session.feel}</p>
      ) : null}
      <ul className="flex flex-col gap-2">
        {row.items.map((it) =>
          it.kind === 'superset' ? (
            // V1-8-3d: a superset bracket — its members alternate, so they group under a labeled
            // sub-list (each member still via the shared <MovementLine>).
            <li
              key={`ss:${it.superset.id}`}
              className="border-foreground/25 flex flex-col gap-1.5 border-l-2 pl-3"
            >
              <span className="text-muted-foreground text-xs font-semibold tracking-wide uppercase">
                {DEFAULT_SUPERSET_LABEL}
              </span>
              <ul className="flex flex-col gap-1.5">{it.members.map(item)}</ul>
            </li>
          ) : (
            item(it.entry)
          ),
        )}
      </ul>
      {inSection && editable ? <SessionLockedLine movements={movements} /> : null}
    </div>
  );
}

/**
 * ONE Locked line per session (J15): each distinct reason once, naming its movements, then the
 * recovery route once. A status-only lock (sub-failure) has no sentence; the badge says it.
 */
function SessionLockedLine({ movements }: { movements: ReturnType<typeof sessionMovements> }) {
  const byReason = new Map<LockedReason, string[]>();
  for (const m of movements) {
    const r = movementLockedReason(m.sets);
    if (r === null) continue;
    byReason.set(r, [...(byReason.get(r) ?? []), entryLabel(m)]);
  }
  const sentences = [...byReason.entries()]
    .filter(([r]) => r !== LOCKED_REASON.status)
    .map(([r, names]) => AMEND_COPY.lockedFor(names.join(VALUE_JOINER), AMEND_COPY.locked[r]));
  // A status-only lock (sub-failure) is badge-only: a lone "Wrong? …" with no referent would read as
  // an accusation about a correctly logged set (3a-i acceptance 4).
  if (sentences.length === 0) return null;
  return (
    <p className="text-muted-foreground text-sm">
      {[...sentences, AMEND_COPY.lockedRecovery].join(' ')}
    </p>
  );
}
