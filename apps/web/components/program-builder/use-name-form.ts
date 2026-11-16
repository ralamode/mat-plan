'use client';

import { PROGRAM_REFUSAL, type ProgramResult } from '@mat-plan/shared';
import { useRef, useState, type FormEvent } from 'react';

import { cleanName, nameRefusal } from './builder-text';
import { focusField, useAttempt } from './use-attempt';

/**
 * One name form's state and submit (FAM-1 lane B: Create, Rename). The workout editor shares its
 * parts (`useAttempt`, `focusField`, `cleanName`), not the hook: its Save has many fields.
 *
 * - **An attempt belongs to the form that made it.** `reset()` (Cancel, Escape, a fresh open)
 *   starts a new attempt, and a result that arrives for an older one is dropped: a Cancel mid-save
 *   neither navigates nor leaves an alert on a form opened later, and nor does leaving the screen.
 *   ⚠️ Dropping the answer does not cancel the write: a create or rename sent before Cancel may
 *   still land. The page shows what the server holds once it reloads.
 * - An empty name is refused here, with no call. A refusal focuses the field and scrolls it into
 *   view: on a phone the keyboard covers the bottom of the screen.
 * - `pending` stays set after a success: the caller navigates or closes, and the button must not
 *   read as ready again in between.
 */
export function useNameForm<T extends object>({
  initial,
  submit,
  onSaved,
}: {
  initial: string;
  /** `null`: nothing to save (an unchanged name), so the form just reports success. */
  submit: (name: string) => Promise<ProgramResult<T>> | null;
  /** `called` is false when `submit` answered `null`, so nothing was written. */
  onSaved: (result: { ok: true } & T, called: boolean) => void;
}) {
  const [name, setName] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const { begin, isCurrent, cancel } = useAttempt();
  const fieldRef = useRef<HTMLInputElement>(null);

  const refuse = (message: string) => {
    setError(message);
    focusField(fieldRef.current);
  };

  /** A fresh form: drops any answer still in flight. */
  const reset = (value = initial) => {
    cancel();
    setName(value);
    setError(null);
    setPending(false);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const cleaned = cleanName(name);
    if (!cleaned) return refuse(nameRefusal(PROGRAM_REFUSAL.invalid));
    const call = submit(cleaned);
    if (!call) return onSaved({ ok: true } as { ok: true } & T, false);
    const mine = begin();
    setPending(true);
    const result = await call;
    if (!isCurrent(mine)) return;
    if (result.ok) return onSaved(result, true);
    setPending(false);
    refuse(nameRefusal(result.reason));
  };

  const onChange = (value: string) => {
    setName(value);
    setError(null);
  };

  return { name, error, pending, fieldRef, onChange, onSubmit, reset };
}
