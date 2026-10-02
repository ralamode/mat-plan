import { ENTRY_STATUS, ENTRY_STATUS_LABELS } from '@mat-plan/shared';

import { AMEND_COPY } from '@/lib/constants';
import type { EntryDTO } from '@/lib/dal/entries';
import { entryLabel } from '@/lib/entries/entry-label';

import { EditableSet } from './editable-set';
import { formatSetLine, isEditableSet, movementLockedReason } from './set-display';

/**
 * A movement line as a nested session `<li>` item — shared by superset members and standalone
 * movements inside a session block (V1-8-3d), so the wrapper markup lives in ONE place and the two
 * can't drift. The flat `{kind:'entry'}` row keeps its own bordered wrapper (a different context).
 */
export function SessionMovementItem({ entry, profileId }: { entry: EntryDTO; profileId: string }) {
  return (
    <li className="flex flex-col gap-1">
      <MovementLine entry={entry} profileId={profileId} />
    </li>
  );
}

/**
 * One movement's display: its label + (non-done) status, then its sets. Shared (V1-8-3a) by the flat
 * `{kind:'entry'}` row and each movement inside a session block, so the reps × weight/label fallback
 * lives once. The caller supplies the `<li>` wrapper (flat = a bordered row; session = a nested item).
 */
export function MovementLine({ entry, profileId }: { entry: EntryDTO; profileId: string }) {
  const label = entryLabel(entry);
  const locked = movementLockedReason(entry.sets);
  return (
    <>
      <div className="flex items-center justify-between">
        <span className="font-medium">{label}</span>
        {entry.status !== ENTRY_STATUS.done ? (
          // GAP-1 P1-1c: humanized via the SHARED map, not the raw enum. `sub-failure` is the CSV
          // export byte (V1-13 D7), so the badge and the exporter must emit the same string.
          <span className="text-muted-foreground text-sm">{ENTRY_STATUS_LABELS[entry.status]}</span>
        ) : null}
      </div>
      {entry.sets.length > 0 ? (
        // A vertical list (was a horizontal wrap) so each set is a tappable row. V1-9: a numeric set gets
        // an inline Change affordance via the <EditableSet> CLIENT island; a read-only set (labeled/null)
        // stays SERVER-rendered here — so only editable sets hydrate (RSC-first). The read line format is
        // single-sourced in formatSetLine, shared by both branches.
        <ul className="text-muted-foreground flex flex-col gap-0.5 text-sm tabular-nums">
          {entry.sets.map((s) =>
            isEditableSet(s) ? (
              <EditableSet
                key={s.publicId}
                set={s}
                profileId={profileId}
                subject={`${label} set ${s.idx}`}
              />
            ) : (
              // GAP-1 P1-1c. The badge is a SIBLING of the read line, never inside `formatSetLine` —
              // a status is a distinct affordance, and folding it into the string would leak an
              // un-styleable blob into any future aria-label. `flex-wrap items-baseline` so a long
              // load (`12 × BW+8 (vest)`) plus a badge doesn't overflow at 360px.
              // NOTE only this read-only branch can carry a badge: `isEditableSet` requires
              // status === 'done', so <EditableSet> never receives a non-done set.
              <li key={s.publicId} className="flex flex-wrap items-baseline gap-2">
                <span>{formatSetLine(s)}</span>
                {s.status !== ENTRY_STATUS.done ? (
                  <span className="bg-muted rounded px-1.5 py-0.5 text-xs">
                    {ENTRY_STATUS_LABELS[s.status]}
                  </span>
                ) : null}
              </li>
            ),
          )}
        </ul>
      ) : null}
      {locked ? (
        // V1-24 3a-i: the parent plan's Locked state. A set with no Change says WHY (true for the
        // sets it labels, from `lockedReason`) and what to do. One line per movement (plan I4).
        <p className="text-muted-foreground text-sm">
          {AMEND_COPY.locked[locked] ? `${AMEND_COPY.locked[locked]} ` : ''}
          {AMEND_COPY.lockedRecovery}
        </p>
      ) : null}
    </>
  );
}
