import type { ReactNode } from 'react';

import { BODYWEIGHT_COPY, LOGGED_ROW_CLASS } from '@/lib/constants';

/**
 * ONE logged single value, in the done style (V1-24 3b-bw W4; shared with practice at 3b-life A2):
 * the filled tick with `sr-only` "Logged", the value, and the Change control on the right.
 *
 * A SERVER component: the row is read state on every day, read-only ones included, with zero client
 * JS. The section passes the `'use client'` Change control into `control`; the live region and the
 * focus hand-off are the section's `SingleValueLive`.
 *
 * ⚠️ The OPEN editor is `w-full`, so `flex-wrap` drops it onto its own line beneath the value,
 * deterministically: load-bearing at 360px (why: `single-value-amend.tsx`). Keeping the saved value
 * above it shows what you are changing FROM. `min-h-11` is the one row height both rows share.
 * The tint drops while the editor is open (`LOGGED_ROW_CLASS`), so its hint and Clear sit on the plain
 * surface they were measured on.
 */
export function LoggedValueRow({
  children,
  control,
}: {
  children: ReactNode;
  control?: ReactNode;
}) {
  return (
    <div className={`flex flex-col gap-1 rounded-lg border px-4 py-3 ${LOGGED_ROW_CLASS}`}>
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-base font-medium tabular-nums">
          <span
            aria-hidden="true"
            className="bg-done text-done-foreground inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm"
          >
            ✓
          </span>
          <span className="sr-only">{BODYWEIGHT_COPY.logged} </span>
          {children}
        </p>
        {control ?? null}
      </div>
    </div>
  );
}
