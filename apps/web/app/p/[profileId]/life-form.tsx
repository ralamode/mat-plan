'use client';

import { newId } from '@mat-plan/shared';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';

import { INITIAL_ACTION_STATE } from './action-state';
import { logLifeActivitiesAction } from './actions';

/**
 * One life-activity button (V1-7). Its OWN `<form>` so a single tap submits immediately (no batch
 * "Log" button). `client_id` is fixed per instance (`useState(newId)` — NO rotation, the
 * bodyweight-form idiom): log-once means a double-tap reuses it → `ON CONFLICT` dedupes. After a
 * successful log `LifeSection` stops rendering this and shows the logged row in its place.
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
  const [state, formAction, pending] = useActionState(
    logLifeActivitiesAction,
    INITIAL_ACTION_STATE,
  );
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
      <Button type="submit" size="lg" disabled={pending} className="text-base">
        {pending ? 'Logging…' : label}
      </Button>
      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
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
