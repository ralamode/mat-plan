'use client';

import type { Ref } from 'react';

import { INPUT_CLASS } from '@/lib/constants';

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
}: {
  ref?: Ref<HTMLInputElement>;
  id: string;
  label: string;
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
}) {
  const counterId = `${id}-count`;
  const errorId = `${id}-error`;
  const common = {
    value,
    maxLength: max,
    placeholder,
    enterKeyHint: 'done' as const,
    onChange: (event: { target: { value: string } }) => onChange(event.target.value),
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${counterId} ${errorId}` : counterId,
  };
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
        {optional ? <span className="text-muted-foreground font-normal"> (optional)</span> : null}
      </label>
      {multiline ? (
        <textarea
          id={id}
          rows={2}
          {...common}
          className={`${INPUT_CLASS} h-auto w-full resize-y py-2`}
        />
      ) : (
        <input
          ref={ref}
          id={id}
          type="text"
          autoComplete="off"
          {...common}
          className={`${INPUT_CLASS} w-full`}
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
