'use client';

import { newId } from '@mat-plan/shared';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { LIFE_COPY } from '@/lib/constants';

import { type ActionState, INITIAL_ACTION_STATE } from './action-state';
import { logLifeActivitiesAction } from './actions';
import { useSingleValueLive } from './single-value-live';

/**
 * One life-activity button (V1-7). Its OWN `<form>` so a single tap submits immediately (no batch
 * "Log" button). `client_id` is fixed per instance (`useState(newId)` — NO rotation, the
 * bodyweight-form idiom): log-once means a double-tap reuses it → `ON CONFLICT` dedupes. After a
 * successful log `LifeSection` stops rendering this and shows the logged row in its place.
 *
 * Since V1-24 3b-life it reports through the section's `SingleValueLive`, as the bodyweight row does:
 * a log is spoken and hands focus to the logged row's Change; a refusal is an alert; and this button
 * is the island's `field`, so after a clear focus lands on the button that comes back.
 */
function LifeButton({
  profileId,
  day,
  activityKey,
  label,
}: {
  profileId: string;
  day: string;
  activityKey: string;
  label: string;
}) {
  const live = useSingleValueLive();
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData): Promise<ActionState> => {
      const result = await logLifeActivitiesAction(prev, formData);
      if (result.ok) {
        live.report({ message: LIFE_COPY.announced(label), tone: 'sr', focus: ['change'] });
      } else if (result.error) {
        live.report({ message: result.error, tone: 'alert', focus: ['field', 'change'] });
      }
      return result;
    },
    INITIAL_ACTION_STATE,
  );
  const takeField = live.focusRef('field');
  const [clientId, setClientId] = useState(newId);
  // 🔴 **Rotate the id on a refusal, or the recovery the copy promises is a dead end.** The key
  // above changes when the row behind the button changes — but a REFUSED submit changes nothing, so
  // the same instance would re-submit the same dead `client_id` forever and `HIDE_COPY
  // .loggedThenDeleted`'s "tap again to log it now" would be false. A UX panel caught it.
  //
  // ⚠️ Safe to mint on any `ok: false`: an envelope means the server answered and wrote nothing. A
  // lost response throws to `error.tsx` instead, so this cannot discard an id that did write.
  // The during-render idiom (not an effect) is the one `use-on-action-success.ts` documents.
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (!state.ok && state.error) setClientId(newId());
  }

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="profileId" value={profileId} readOnly />
      <input type="hidden" name="day" value={day} readOnly />
      <input type="hidden" name="clientId" value={clientId} readOnly />
      <input type="hidden" name="activityKey" value={activityKey} readOnly />
      <Button ref={takeField} type="submit" size="lg" disabled={pending} className="text-base">
        {pending ? 'Logging…' : label}
      </Button>
    </form>
  );
}

/**
 * The one-tap buttons for the life activities that are NOT yet logged on this day (V1-7). The
 * logged rows, and which activities the day page shows at all, belong to `LifeSection`.
 */
export function LifeForm({
  profileId,
  day,
  activities,
}: {
  profileId: string;
  day: string;
  activities: readonly { key: string; label: string }[];
}) {
  return (
    <div className="flex flex-wrap gap-3">
      {activities.map((a) => (
        <LifeButton
          // 🔴 **The key carries the DAY, and that is a lost-write fix.** Keyed on `a.key` alone,
          // React kept one instance — and the `client_id` in its state — across a day change. So:
          // tap Wrestling practice today, press ‹, tap it again, and the second submit replays
          // TODAY's row (its `client_id` is still live) and writes NOTHING for yesterday, while
          // the action reports success. It is exactly the "log yesterday's practice this evening"
          // path this app is used for. A logged activity unmounts its button, so a later re-open
          // (after a delete) mounts a new instance with a new id.
          key={`${day}:${a.key}`}
          profileId={profileId}
          day={day}
          activityKey={a.key}
          label={a.label}
        />
      ))}
    </div>
  );
}
