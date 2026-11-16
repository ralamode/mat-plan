'use client';

import { useCallback, useState } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { NAME_WRAP_CLASS } from '@/lib/constants';

export type StatusTone = 'status' | 'alert';
export type Status = { message: string; tone: StatusTone };

/**
 * A screen's one status line (FAM-1 lane B): the program page's, and the workout editor's in its
 * save bar. `report('')` clears it.
 *
 * Cleared first and set a frame later, so the same message twice is announced twice and the
 * banner blinks.
 */
export function useStatusLine() {
  const [status, setStatus] = useState<Status>({ message: '', tone: 'status' });
  const report = useCallback((message: string, tone: StatusTone = 'status') => {
    setStatus({ message: '', tone });
    if (message) requestAnimationFrame(() => setStatus({ message, tone }));
  }, []);
  return { status, report };
}

/** The prototype's banner, once there is a message. Names in it may be long. */
const BANNER_CLASS = `rounded-lg px-3 py-2 text-sm font-medium ${NAME_WRAP_CLASS}`;

/**
 * The line itself: a polite `Announcer` and a `role="alert"`, both always mounted and with no
 * height while empty (as `Announcer` asks). A refusal the person must act on is the alert.
 */
export function StatusLine({ status, alertId }: { status: Status; alertId?: string }) {
  const shown = (tone: StatusTone) => (status.tone === tone ? status.message : '');
  // One box, so a column's gap is paid once for both regions.
  return (
    <div className="flex flex-col">
      <Announcer
        message={shown('status')}
        className={shown('status') ? `${BANNER_CLASS} bg-muted` : 'h-0'}
      />
      <p
        id={alertId}
        role="alert"
        className={shown('alert') ? `${BANNER_CLASS} bg-destructive/10 text-destructive` : 'h-0'}
      >
        {shown('alert')}
      </p>
    </div>
  );
}
