import { CLOSED_DAY_NOTICE, NOTICE_CLASS } from '@/lib/constants';

/**
 * The notice on a past closed day (`dayPageView`'s `'closed'`): "Past days are locked. Today and
 * yesterday stay open.", then the day's cleared line when it was cleared. Its own component so a
 * test can render it; the page decides WHEN (`dayPageFlags`' `showClosedNotice`).
 */
export function ClosedDayNotice({ clearedLine }: { clearedLine: string | null }) {
  return (
    <div className={`${NOTICE_CLASS} flex flex-col gap-2`}>
      <p>{CLOSED_DAY_NOTICE}</p>
      {clearedLine ? <p>{clearedLine}</p> : null}
    </div>
  );
}
