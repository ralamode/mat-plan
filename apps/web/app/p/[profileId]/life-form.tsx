'use client';

import { newId } from '@mat-plan/shared';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { LIFE_ACTIVITIES } from '@/lib/life/life-activities';

import { INITIAL_ACTION_STATE } from './action-state';
import { logLifeActivitiesAction } from './actions';

/**
 * One life-activity button (V1-7). Its OWN `<form>` so a single tap submits immediately (no batch
 * "Log" button). `client_id` is fixed per instance (`useState(newId)` — NO rotation, the
 * bodyweight-form idiom): log-once means a double-tap reuses it → `ON CONFLICT` dedupes. After a
 * successful log the parent renders this inert (the activity is in `loggedKeys`), and the detail
 * ("Wake — 6:52 AM") appears in the Logged-entries list below via `entryLabel`.
 */
function LifeButton({
  profileId,
  day,
  activityKey,
  label,
  logged,
}: {
  profileId: string;
  day: string;
  activityKey: string;
  label: string;
  logged: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    logLifeActivitiesAction,
    INITIAL_ACTION_STATE,
  );
  const [clientId] = useState(newId);

  if (logged) {
    return (
      <p className="text-muted-foreground flex h-11 items-center px-1 text-base">
        {label} · logged today
      </p>
    );
  }

  return (
    <form action={formAction} className="flex flex-col gap-1">
      <input type="hidden" name="profileId" value={profileId} readOnly />
      <input type="hidden" name="day" value={day} readOnly />
      <input type="hidden" name="clientId" value={clientId} readOnly />
      <input type="hidden" name="activityKey" value={activityKey} readOnly />
      <Button type="submit" size="lg" disabled={pending} className="h-11 text-base">
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
 * The "Life" one-tap section (V1-7) — two explicit buttons (not a registry `.map`, since the two
 * activities are heterogeneous and few). `loggedLifeKeys` are the life activities already logged
 * today (derived on the page from the day's entries), so each button renders inert once tapped.
 */
export function LifeForm({
  profileId,
  day,
  loggedLifeKeys,
}: {
  profileId: string;
  day: string;
  loggedLifeKeys: readonly string[];
}) {
  const logged = new Set(loggedLifeKeys);
  return (
    <div className="flex flex-wrap gap-3">
      {LIFE_ACTIVITIES.map((a) => (
        <LifeButton
          key={a.key}
          profileId={profileId}
          day={day}
          activityKey={a.key}
          label={a.label}
          logged={logged.has(a.key)}
        />
      ))}
    </div>
  );
}
