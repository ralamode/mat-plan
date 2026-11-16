'use client';

import type { ReactNode, Ref } from 'react';

import { INPUT_CLASS } from '@/lib/constants';

import { FieldLabel } from './field-label';

/**
 * A field's input styling here: the app's `INPUT_CLASS`, with a placeholder at the muted text's
 * contrast (the default grey measured 3.74:1 on white).
 */
export const FIELD_CLASS = `${INPUT_CLASS} placeholder:text-muted-foreground w-full min-w-0`;

/**
 * A short text field with its counter and its refusal (FAM-1 lane B): a program's or a workout's
 * name, and, `multiline`, a workout's description or an item's instructions. Still one line of text
 * as stored (the contract refuses a line break): `multiline` only lets a long one wrap.
 *
 * The counter sits **outside the label** and is linked by `aria-describedby` (plan §5, "Rules every
 * screen step carries"), so the field's name stays "Program name" and the count is read as its
 * description. It is a plain paragraph, never a live region: announcing every keystroke would drown
 * the field. A refusal is `role="alert"`, and joins the description while it shows.
 */
export function NameField({
  ref,
  id,
  label,
  value,
  max,
  onChange,
  error,
  placeholder,
  optional = false,
  multiline = false,
  announce = true,
  hint,
}: {
  ref?: Ref<HTMLInputElement>;
  id: string;
  label: ReactNode;
  value: string;
  max: number;
  onChange: (value: string) => void;
  error: string | null;
  placeholder?: string;
  /** Says "(optional)" beside the label. */
  optional?: boolean;
  /** A two-row textarea, for a note. */
  multiline?: boolean;
  /**
   * `false` where a screen already says the refusal in its own alert and moves focus to the field
   * (the workout editor's save bar): one announcement per Save, not two.
   */
  announce?: boolean;
  /** A sentence that says what the field is for, read with it (never only a placeholder). */
  hint?: string;
}) {
  const counterId = `${id}-count`;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const described = [hint ? hintId : null, counterId, error ? errorId : null].filter(Boolean);
  const common = {
    value,
    maxLength: max,
    placeholder,
    enterKeyHint: 'done' as const,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    'aria-invalid': error ? true : undefined,
    'aria-describedby': described.join(' '),
  };
  return (
    <div className="flex flex-col gap-1">
      <FieldLabel htmlFor={id} optional={optional}>
        {label}
      </FieldLabel>
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
      {multiline ? (
        <textarea id={id} rows={2} {...common} className={`${FIELD_CLASS} h-auto resize-y py-2`} />
      ) : (
        <input
          ref={ref}
          id={id}
          type="text"
          autoComplete="off"
          {...common}
          className={FIELD_CLASS}
        />
      )}
      <p id={counterId} className="text-muted-foreground text-xs">
        {value.length}/{max}
      </p>
      {error ? (
        <p id={errorId} role={announce ? 'alert' : undefined} className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
