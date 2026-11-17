'use client';

import {
  BODYWEIGHT_UNITS,
  type BodyweightUnit,
  DEFAULT_BODYWEIGHT_UNIT,
  isBlankEntry,
  newId,
} from '@mat-plan/shared';
import { useActionState, useId, useLayoutEffect, useRef, useState } from 'react';

import { BODYWEIGHT_COPY, INPUT_CLASS } from '@/lib/constants';

import { type ActionState, INITIAL_ACTION_STATE } from './action-state';
import { logBodyweightAction } from './actions';
import { DayField } from './day-field';
import { LogTick, TickedCopy } from './log-tick';
import { useSingleValueLive } from './single-value-live';

/**
 * The unlogged bodyweight row (V1-24 PR 1a; the prototype's ✓ row since 3b-bw, plan W1–W3).
 *
 * ## One row that cannot wrap, at 360px
 *
 * The field's wrapper is `min-w-[72px] flex-1` and the input `w-full min-w-0`, beside the unit select
 * and a 44px ✓. Measured at 328px of content: field 200, select 60, ✓ 44. Without the min-width the
 * input's intrinsic width (~256px) pushes the ✓ onto a second line, which no gate sees, so the row has
 * no `flex-wrap`: a regression is horizontal overflow instead, which `e2e/a11y.spec.ts` catches.
 */
export function BodyweightForm({
  profileId,
  day,
  lastTime,
  initialUnit,
}: {
  profileId: string;
  day: string;
  /** The "Last time" line, already formatted (`Last time 72.5 lb · Tue`), or `null` for none. */
  lastTime: string | null;
  /** The last weigh-in's unit, so a kg athlete is not shown `Last time 38 kg` over an `lb` select. */
  initialUnit?: BodyweightUnit;
}) {
  const live = useSingleValueLive();
  const [state, formAction, pending] = useActionState(
    async (prev: ActionState, formData: FormData): Promise<ActionState> => {
      const result = await logBodyweightAction(prev, formData);
      // Reported from the RESULT, never from a value appearing (another phone's save makes one too).
      // A field error stays in this form's own alert: the form is still mounted to show it.
      if (result.ok) {
        live.report({ message: BODYWEIGHT_COPY.announcedLogged, tone: 'sr', focus: ['change'] });
      } else if (!result.fieldErrors && result.error) {
        live.report({ message: result.error, tone: 'alert', focus: ['field', 'change'] });
      }
      return result;
    },
    INITIAL_ACTION_STATE,
  );
  /**
   * Client-stamped idempotency key, minted once per MOUNT and **never rotated** (V1-24 PR 1a). The
   * section keys this form on the day, and unmounts it while a value shows, so re-entering after a
   * clear mounts a fresh one: the hidden row's key is never replayed (plan D2).
   */
  const [clientId] = useState(newId);
  /**
   * CONTROLLED, and that is load-bearing (round 2 on #180, probed): React 19 resets an uncontrolled
   * field inside `<form action>` when the action settles — **including a rejected one** — so a refused
   * `845` would come back empty and the unit snap back to `lb`. `e2e/a11y.spec.ts` pins that both
   * survive a rejection.
   */
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<BodyweightUnit>(initialUnit ?? DEFAULT_BODYWEIGHT_UNIT);
  /** The empty ✓'s refusal, set in the browser before any request. Cleared by typing. */
  const [blank, setBlank] = useState(false);
  /**
   * ⚠️ Controlling the `<select>` is NOT enough on its own (verified in the e2e). The reset is a native
   * `form.reset()`, and React never sets `defaultSelected` for a controlled `<select>`, so the reset
   * reselects the first option while `unit` still says `kg`. Re-assert it after every commit: a layout
   * effect runs after the reset and before paint, so the wrong unit is never shown.
   */
  const unitRef = useRef<HTMLSelectElement>(null);
  useLayoutEffect(() => {
    if (unitRef.current && unitRef.current.value !== unit) unitRef.current.value = unit;
  });
  const inputRef = useRef<HTMLInputElement | null>(null);
  const takeFocus = live.focusRef('field');

  const ids = { value: useId(), unit: useId(), hint: useId(), error: useId() };
  const valueErr = blank ? BODYWEIGHT_COPY.blankLog : state.fieldErrors?.value?.[0];
  // The island's status is in it too: after a clear, focus lands here, and arriving focus reads
  // "Bodyweight cleared. It was 84.5 lb." even if it pre-empted the live region's announcement.
  const describedBy = [
    lastTime ? ids.hint : null,
    valueErr ? ids.error : null,
    live.alertId,
    live.statusId,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        // An empty ✓ is refused here, synchronously, so focus lands on the field inside the same tap
        // and the phone opens its keypad. No request is sent.
        if (isBlankEntry(value)) {
          e.preventDefault();
          setBlank(true);
          inputRef.current?.focus();
        }
      }}
      className="flex flex-col gap-2"
    >
      <input type="hidden" name="profileId" value={profileId} readOnly />
      <DayField day={day} />
      <input type="hidden" name="clientId" value={clientId} readOnly />
      {lastTime ? (
        <p id={ids.hint} className="text-muted-foreground text-sm tabular-nums">
          {lastTime}
        </p>
      ) : null}
      <div className="flex items-end gap-3">
        <div className="flex min-w-[72px] flex-1 flex-col gap-1.5">
          <label htmlFor={ids.value} className="text-sm font-medium">
            Weight
          </label>
          <input
            ref={(node) => {
              inputRef.current = node;
              return takeFocus(node);
            }}
            id={ids.value}
            name="value"
            // Text, not `number` (plan W3): `type="number"` hands an unparseable entry to the form as
            // an empty string, so `84..5` would read as blank. The schema parses it instead.
            type="text"
            inputMode="decimal"
            autoComplete="off"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setBlank(false);
            }}
            aria-invalid={valueErr ? true : undefined}
            aria-describedby={describedBy}
            className={`${INPUT_CLASS} w-full min-w-0`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={ids.unit} className="text-sm font-medium">
            Unit
          </label>
          <select
            id={ids.unit}
            name="unit"
            ref={unitRef}
            value={unit}
            onChange={(e) => setUnit(e.target.value as BodyweightUnit)}
            className={INPUT_CLASS}
          >
            {BODYWEIGHT_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        {/* Outline while empty, filled while a weight waits to be sent (`log-tick.tsx`). */}
        <LogTick label={BODYWEIGHT_COPY.logLabel} pending={pending} ready={!isBlankEntry(value)} />
      </div>

      {valueErr ? (
        <p id={ids.error} role="alert" className="text-destructive text-sm">
          {/* The copy names the ✓; the glyph is hidden from a screen reader, which hears the
              button's own name in its place. */}
          {valueErr === BODYWEIGHT_COPY.blankLog ? (
            <TickedCopy text={valueErr} buttonLabel={BODYWEIGHT_COPY.logLabel} />
          ) : (
            valueErr
          )}
        </p>
      ) : null}
    </form>
  );
}
