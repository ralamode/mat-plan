'use client';

import type { Ref } from 'react';

import { INPUT_CLASS } from '@/lib/constants';

/**
 * A name input with its counter and its refusal (FAM-1 lane B: a program's name here; a workout's
 * at step 8).
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
}: {
  ref?: Ref<HTMLInputElement>;
  id: string;
  label: string;
  value: string;
  max: number;
  onChange: (value: string) => void;
  error: string | null;
  placeholder?: string;
}) {
  const counterId = `${id}-count`;
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        type="text"
        autoComplete="off"
        value={value}
        maxLength={max}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${counterId} ${errorId}` : counterId}
        className={`${INPUT_CLASS} w-full`}
      />
      <p id={counterId} className="text-muted-foreground text-xs">
        {value.length}/{max}
      </p>
      {error ? (
        <p id={errorId} role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
