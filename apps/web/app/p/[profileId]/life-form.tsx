'use client';

import {
  ACTIVITY_TYPE_KEYS,
  isBlankEntry,
  newId,
  PRACTICE_UNIT,
  practiceMinutesProblem,
} from '@mat-plan/shared';
import { useActionState, useId, useRef, useState } from 'react';

import { INPUT_CLASS, PRACTICE_COPY, PRACTICE_PROBLEM_COPY } from '@/lib/constants';

import { type ActionState, INITIAL_ACTION_STATE } from './action-state';
import { logLifeActivitiesAction } from './actions';
import { DayField } from './day-field';
import { LogTick, TickedCopy } from './log-tick';
import { useSingleValueLive } from './single-value-live';

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
      } else if (result.fieldErrors) {
        // A refusal under the field (the server's own check): the tap blurred it, so hand it back.
        live.claimFocus(['field']);
      } else if (result.error) {
        // `day_taken` replaces this form with the other phone's row: focus goes to its Change.
        live.report({
          message: result.error,
          tone: 'alert',
          focus: ['field', 'change'],
          // "Tap ✓ to try again." is read as "Tap Log wrestling practice to try again."
          tickLabel: PRACTICE_COPY.logLabel,
          keepOnOpen: result.dayTaken,
        });
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
    // The island's shown alert and status too: a refusal that leaves this field mounted is read with
    // it when focus arrives, and so is the "cleared" line.
    [minutesErr ? ids.error : null, live.alertId, live.statusId].filter(Boolean).join(' ') ||
    undefined;

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const problem = practiceMinutesProblem(minutes);
        const message = problem ? PRACTICE_PROBLEM_COPY[problem](minutes) : null;
        if (message) {
          e.preventDefault();
          // An earlier island alert ("That wasn't saved…") is about a try this one replaces.
          live.dismiss();
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
        {/* Stretched to the row's 44px, so the words are a full-height tap target (B1). */}
        <label
          htmlFor={ids.value}
          className="flex min-h-11 min-w-0 flex-1 items-center self-stretch text-base font-medium"
        >
          {PRACTICE_COPY.label}
          <span className="sr-only">{PRACTICE_COPY.fieldLabelSuffix}</span>
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
        <LogTick label={PRACTICE_COPY.logLabel} pending={pending} ready={!isBlankEntry(minutes)} />
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
