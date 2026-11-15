'use client';

import { newId } from '@mat-plan/shared';
import { useActionState, useState } from 'react';

import { Button } from '@/components/ui/button';
import { SAVED_STATE_COPY } from '@/lib/constants';
import { LIFE_ACTIVITIES } from '@/lib/life/life-activities';
import { lifeActivitiesForKeys } from '@/lib/routine/catalog';

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

  if (logged) {
    return (
      <p className="text-muted-foreground flex h-11 items-center px-1 text-base">
        {SAVED_STATE_COPY.lifeLogged(label)}
      </p>
    );
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
 * The "Life" one-tap section (V1-7) — two explicit buttons (not a registry `.map`, since the two
 * activities are heterogeneous and few). `loggedLifeKeys` are the life activities already logged
 * today (derived on the page from the day's entries), so each button renders inert once tapped.
 */
export function LifeForm({
  profileId,
  day,
  loggedLifeEntryIds,
  activityKeys,
}: {
  profileId: string;
  day: string;
  /** Life activity key → the `public_id` of the entry logging it on this day. See the page. */
  loggedLifeEntryIds: ReadonlyMap<string, string>;
  // V1-18: render only these life activities, in this order (a per-kid routine subset). Omitted → all of
  // them (the default routine + every pre-V1-18 caller are unchanged).
  activityKeys?: readonly string[];
}) {
  // Resolve a per-kid subset via the SHARED helper (single-sourced with the check-in path); omitted → all.
  const activities = activityKeys ? lifeActivitiesForKeys(activityKeys) : LIFE_ACTIVITIES;
  return (
    <div className="flex flex-wrap gap-3">
      {activities.map((a) => {
        const loggedEntryId = loggedLifeEntryIds.get(a.key);
        return (
          <LifeButton
            // 🔴 **The key carries the DAY and the row's identity, and that is a lost-write fix.**
            // Keyed on `a.key` alone, React kept one instance — and the `client_id` in its state —
            // across a day change, because the section around it is keyed by block index. So:
            // tap Wrestling practice today, press ‹, tap it again, and the second submit replays
            // TODAY's row (its `client_id` is still live) and writes NOTHING for yesterday, while
            // the action reports success. Two taps, no delete needed, and it is exactly the
            // "log yesterday's practice this evening" path this app is used for.
            key={`${day}:${a.key}:${loggedEntryId ?? 'open'}`}
            profileId={profileId}
            day={day}
            activityKey={a.key}
            label={a.label}
            logged={loggedEntryId !== undefined}
          />
        );
      })}
    </div>
  );
}
