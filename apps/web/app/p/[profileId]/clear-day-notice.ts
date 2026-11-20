import { CLEAR_DAY_COPY } from '@/lib/constants';
import type { RestoreDeadline } from '@/lib/entries/restore-deadline';

/**
 * The cleared sentence the page's one notice box carries as its second paragraph (V1-9b B2-ii), or
 * none. Pure, so the three branches are tested here rather than only through an async page.
 *
 * - **Archived, the day still open for Restore all** (`deadline` non-null): how to get it back.
 * - **Archived after the window, or a closed day**: that the entries are kept, not erased.
 * - **No clear, or another notice** (coming up, none): nothing.
 */
export function clearedNoticeLine(args: {
  notice: 'archived' | 'comingUp' | 'closed' | null;
  clearedTotal: number;
  deadline: RestoreDeadline | null;
  athleteName: string;
}): string | null {
  if (args.clearedTotal <= 0) return null;
  if (args.notice === 'archived') {
    return args.deadline
      ? CLEAR_DAY_COPY.archivedCleared(
          args.athleteName,
          args.clearedTotal,
          CLEAR_DAY_COPY.deadline[args.deadline],
        )
      : CLEAR_DAY_COPY.closedCleared(args.clearedTotal);
  }
  if (args.notice === 'closed') return CLEAR_DAY_COPY.closedCleared(args.clearedTotal);
  return null;
}
