'use client';

import { METRIC_VALUE_TYPE, newId } from '@mat-plan/shared';
import { useActionState, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  clientIdInputName,
  isCheckbox,
  valueInputName,
  type CheckinField,
} from '@/lib/checkins/checkin-fields';

import { logCheckinsAction, type ActionState } from './actions';

const initialState: ActionState = { ok: false, error: null };

const numberInputClass =
  'border-input bg-background focus-visible:ring-ring h-11 w-24 rounded-lg border px-3 text-base outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive';

// A padded label row gives the >=44px tap target; the focus ring must live on the ROW,
// not the ~16px native checkbox, or we meet the tap-target rule and fail focus-visible.
const rowClass =
  'has-[:focus-visible]:ring-ring flex min-h-11 items-center gap-3 rounded-lg px-2 py-2 has-[:focus-visible]:ring-3';

/**
 * The check-ins form (V1-5). Fields arrive as a PROP from the RSC page — this component
 * imports only the TYPE, so the seeded catalog crosses as JSON and never lands in the
 * client bundle (RSC-first; the catalog modules are ~1k lines).
 *
 * `fields` is server-derived and therefore trusted for RENDERING only; the Server Action
 * re-walks its own copy of the registry and ignores anything else in the POST.
 */
export function CheckinForm({
  profileId,
  day,
  fields,
  loggedFieldKeys,
}: {
  profileId: string;
  /** The day the page rendered — submitted so the write lands where the user saw it. */
  day: string;
  fields: readonly CheckinField[];
  /** Field keys already logged today → rendered checked + inert. */
  loggedFieldKeys: readonly string[];
}) {
  const [state, formAction, pending] = useActionState(logCheckinsAction, initialState);

  // Idempotency keys, one per field. Held in STATE (not `defaultValue`) and regenerated
  // after a successful write: a stale id would make the next submit a silent ON CONFLICT
  // no-op — the "my tap did nothing" failure.
  const [idSeed, setIdSeed] = useState(0);
  const clientIds = useMemo(
    () => Object.fromEntries(fields.map((f) => [f.key, newId()])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- idSeed is the rotation trigger
    [fields, idSeed],
  );

  const logged = useMemo(() => new Set(loggedFieldKeys), [loggedFieldKeys]);

  // Checked state is CONTROLLED. `defaultChecked` is not reconciled after mount, so a
  // just-logged habit would render inert-but-unchecked once revalidation pushed new
  // `loggedFieldKeys`. Cleared after each successful write (the server's
  // `loggedFieldKeys` then carries the checked state).
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  // V1-6a: accumulating number inputs (calisthenics) are CONTROLLED so they can be cleared
  // after a bout is logged, ready for the next one. Cleared on success — safe because the
  // input is `disabled` while `pending` (see below), so nothing can be typed into the
  // slow submit window and then clobbered. (V1-5's log-once number inputs stay uncontrolled.)
  const [numberValues, setNumberValues] = useState<Record<string, string>>({});

  // Reset on a new action result by ADJUSTING STATE DURING RENDER, not in an effect —
  // an effect here would cause a cascading re-render (and trips react-hooks lint).
  // https://react.dev/learn/you-might-not-need-an-effect
  const [seenState, setSeenState] = useState(state);
  if (state !== seenState) {
    setSeenState(state);
    if (state.ok) {
      setChecked({});
      setNumberValues({});
      setIdSeed((n) => n + 1); // rotate idempotency keys; a stale one = a silent no-op
    }
  }

  const groups = fields.reduce<Map<string, CheckinField[]>>((acc, f) => {
    acc.set(f.groupLabel, [...(acc.get(f.groupLabel) ?? []), f]);
    return acc;
  }, new Map());

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <input type="hidden" name="profileId" value={profileId} readOnly />
      <input type="hidden" name="day" value={day} readOnly />

      {[...groups].map(([groupLabel, groupFields]) => (
        <fieldset key={groupLabel} className="flex flex-col gap-1">
          <legend className="text-muted-foreground mb-1 text-sm font-medium">{groupLabel}</legend>
          <ul className="flex flex-col gap-0.5">
            {groupFields.map((f) => {
              const id = `checkin-${f.key}`;
              const isLogged = logged.has(f.key);
              const err = state.fieldErrors?.[f.key]?.[0];
              const describedBy = err ? `${id}-error` : isLogged ? `${id}-logged` : undefined;

              // A logged log-once field submits NO NAME → it's display-only, not re-submitted.
              // `aria-disabled`/`readOnly` do NOT stop a control from being submitted, so a
              // still-checked "already logged" checkbox would re-insert a DUPLICATE row on every
              // later submit (the accumulate flow submits repeatedly). Dropping the name is the fix
              // that keeps it focusable + announced (unlike real `disabled`). Accumulating fields
              // are never `isLogged`, so they keep their name.
              const submitName = isLogged ? undefined : valueInputName(f.key);

              const checkbox = isCheckbox(f);
              const control = checkbox ? (
                <input
                  id={id}
                  name={submitName}
                  type="checkbox"
                  value="1"
                  className="size-5 shrink-0"
                  // aria-disabled, NOT disabled: a disabled control leaves the tab
                  // order, so its "already logged" explanation is unreachable.
                  checked={isLogged || (checked[f.key] ?? false)}
                  aria-disabled={isLogged || undefined}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={describedBy}
                  onChange={(e) => {
                    if (isLogged) return; // inert, but still focusable + announced
                    setChecked((c) => ({ ...c, [f.key]: e.target.checked }));
                  }}
                />
              ) : f.accumulates ? (
                // Accumulating (calisthenics): controlled + disabled while pending so a
                // value typed during the slow submit can't be clobbered by clear-on-success.
                // Never `isLogged` (page.tsx excludes accumulating fields), so no readOnly.
                <input
                  id={id}
                  name={valueInputName(f.key)}
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min={f.min}
                  max={f.max}
                  autoComplete="off"
                  disabled={pending}
                  value={numberValues[f.key] ?? ''}
                  onChange={(e) => setNumberValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={describedBy}
                  className={numberInputClass}
                />
              ) : (
                <input
                  id={id}
                  name={submitName}
                  type="number"
                  inputMode="numeric"
                  step="1"
                  min={f.min}
                  max={f.max}
                  autoComplete="off"
                  readOnly={isLogged}
                  aria-disabled={isLogged || undefined}
                  aria-invalid={err ? true : undefined}
                  aria-describedby={describedBy}
                  className={numberInputClass}
                />
              );

              const labelEl = (
                <label htmlFor={id} className={checkbox ? 'flex-1 text-base' : 'text-base'}>
                  {f.label}
                  {f.valueType === METRIC_VALUE_TYPE.scale_10 ? (
                    <span className="text-muted-foreground text-sm">
                      {' '}
                      ({f.min}–{f.max})
                    </span>
                  ) : null}
                </label>
              );

              return (
                <li key={f.key}>
                  {/* A checkbox reads [box] [label]; a numeric field reads [label] [input],
                      so the question always precedes the answer it takes. */}
                  <div className={checkbox ? rowClass : `${rowClass} justify-between`}>
                    {checkbox ? control : labelEl}
                    {checkbox ? labelEl : control}
                    {isLogged ? (
                      <span id={`${id}-logged`} className="text-muted-foreground text-sm">
                        Already logged today
                      </span>
                    ) : null}
                    {/* No client id for a logged log-once field — it doesn't submit (see submitName). */}
                    {isLogged ? null : (
                      <input
                        type="hidden"
                        name={clientIdInputName(f.key)}
                        value={clientIds[f.key]}
                        readOnly
                      />
                    )}
                  </div>
                  {err ? (
                    <p id={`${id}-error`} role="alert" className="text-destructive px-2 text-sm">
                      {err}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </fieldset>
      ))}

      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={pending} className="h-11 text-base">
          {pending ? 'Logging…' : 'Log check-ins'}
        </Button>
        {/* Results render further down the page, so announce them for screen readers. */}
        <p aria-live="polite" className="text-muted-foreground text-sm">
          {state.ok ? 'Check-ins logged.' : ''}
        </p>
      </div>

      {state.error ? (
        <p role="alert" className="text-destructive text-sm">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
