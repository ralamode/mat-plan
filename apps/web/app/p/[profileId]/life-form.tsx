'use client';

import { ACTIVITY_TYPE_KEYS, newId, PRACTICE_UNIT, practiceMinutesProblem } from '@mat-plan/shared';
import { useActionState, useId, useRef, useState } from 'react';

import { INPUT_CLASS, PRACTICE_COPY } from '@/lib/constants';

import { type ActionState, INITIAL_ACTION_STATE } from './action-state';
import { logLifeActivitiesAction } from './actions';
import { DayField } from './day-field';
import { LogTick, TickedCopy } from './log-tick';
import { useSingleValueLive } from './single-value-live';

/** The browser's message for a typed entry, from the one classifier the action uses too. */
function problemMessage(text: string): string | null {
  const problem = practiceMinutesProblem(text);
  if (problem === 'blank') return PRACTICE_COPY.blankLog;
  if (problem === 'hours') return PRACTICE_COPY.hoursNotMinutes;
  if (problem === 'range') return PRACTICE_COPY.outOfRange;
  return null;
}

/**
 * The unlogged practice row (V1-24 3b-life-b B1–B5): `Wrestling practice` (a real label, the row's
 * biggest tap target), an empty minutes field, `min` and the ✓. One line at 360px (measured: the label
 * gets 160px and needs 137). **No prefill and no "Last time"** _(maintainer, 2026-11-15: practices
 * differ in length)_. Keyed `form-${day}` by the section.
 *
 * - **Checked before the request** with the action's own rule (`practiceMinutesProblem`), focus on the
 *   field, so the keypad stays up: empty, a number that reads as hours, or out of range.
 * - **Controlled:** React 19 resets an uncontrolled field inside `<form action>` even on a refusal.
 * - **The client id rotates on any refusal** (B4): every `ok: false` envelope means the server answered
 *   and wrote nothing, so a fresh id is safe, and "tap ✓ to try again" is true. A lost response throws
 *   to `error.tsx` instead, so this cannot discard an id that did write.
 * - **Reports through the section's `SingleValueLive`**, as the bodyweight row does: a log is spoken
 *   and hands focus to the row's Change; a refusal is an alert. This field is the island's `field`, so
 *   after a clear, focus lands here, and it lists the island's status so arriving focus reads it.
 */
export function PracticeForm({ profileId, day }: { profileId: string; day: string }) {
  const live = useSingleValueLive();
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData): Promise<ActionState> => {
      const result = await logLifeActivitiesAction(prev, formData);
      if (result.ok) {
        live.report({ message: PRACTICE_COPY.announcedLogged, tone: 'sr', focus: ['change'] });
      } else if (!result.fieldErrors && result.error) {
        // `day_taken` replaces this form with the other phone's row: focus goes to its Change.
        live.report({ message: result.error, tone: 'alert', focus: ['field', 'change'] });
      }
      return result;
    },
    INITIAL_ACTION_STATE,
  );
  const [clientId, setClientId] = useState(newId);
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (!state.ok && state.error) setClientId(newId());
  }
  const [minutes, setMinutes] = useState('');
  /** The browser's refusal, set before any request. Cleared by typing. */
  const [refused, setRefused] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const takeFocus = live.focusRef('field');
  const ids = { value: useId(), error: useId() };
  const minutesErr = refused ?? state.fieldErrors?.minutes?.[0];
  const describedBy =
    [minutesErr ? ids.error : null, live.statusId].filter(Boolean).join(' ') || undefined;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const message = problemMessage(minutes);
        if (message) {
          e.preventDefault();
          setRefused(message);
          inputRef.current?.focus();
        }
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="profileId" value={profileId} readOnly />
      <DayField day={day} />
      <input type="hidden" name="clientId" value={clientId} readOnly />
      <input
        type="hidden"
        name="activityKey"
        value={ACTIVITY_TYPE_KEYS.wrestling_practice}
        readOnly
      />
      <div className="flex items-center gap-2">
        <label htmlFor={ids.value} className="min-w-0 flex-1 text-base font-medium">
          {PRACTICE_COPY.label}
          <span className="sr-only"> minutes</span>
        </label>
        <input
          ref={(node) => {
            inputRef.current = node;
            return takeFocus(node);
          }}
          id={ids.value}
          name="minutes"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={minutes}
          onChange={(e) => {
            setMinutes(e.target.value);
            setRefused(null);
          }}
          aria-invalid={minutesErr ? true : undefined}
          aria-describedby={describedBy}
          className={`${INPUT_CLASS} w-18`}
        />
        <span aria-hidden="true" className="text-base">
          {PRACTICE_UNIT}
        </span>
        <LogTick label={PRACTICE_COPY.logLabel} pending={pending} ready={minutes.trim() !== ''} />
      </div>
      {minutesErr ? (
        <p id={ids.error} role="alert" className="text-destructive text-sm">
          {minutesErr === PRACTICE_COPY.blankLog ? (
            <TickedCopy text={minutesErr} buttonLabel={PRACTICE_COPY.logLabel} />
          ) : (
            minutesErr
          )}
        </p>
      ) : null}
    </form>
  );
}
