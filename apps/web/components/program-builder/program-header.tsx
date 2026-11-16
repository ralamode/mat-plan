'use client';

import { PROGRAM_NAME_MAX, type ProgramActions } from '@mat-plan/shared';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { Button } from '@/components/ui/button';
import { NAME_WRAP_CLASS, SAVING_LABEL } from '@/lib/constants';

import { BUILDER_COPY, PENDING_CLASS, renameLabel } from './builder-text';
import { NameField } from './name-field';
import { useNameForm } from './use-name-form';

const NAME_ID = 'program-name';

/**
 * A program's `<h1>` and Rename (FAM-1 step 8a; the prototype's `pname`).
 *
 * Rename swaps the heading's row for a stacked form: at 360px a field beside its buttons would show
 * about 20 of the name's 60 characters. Beyond the prototype it has Cancel and Escape, and the
 * counter plan §8 asks of every name. On a save, the heading comes back, focus returns to Rename
 * and `onStatus` reports it; an unchanged name just closes. The name, its refusals and a Cancel
 * mid-save are `useNameForm`'s.
 */
export function ProgramHeader({
  programPublicId,
  name,
  renameProgram,
  onStatus,
}: {
  programPublicId: string;
  name: string;
  renameProgram: ProgramActions['renameProgram'];
  /** Reports to the page's status line; `''` clears it. */
  onStatus: (message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const renameRef = useRef<HTMLButtonElement>(null);
  const {
    name: draft,
    error,
    pending,
    fieldRef,
    onChange,
    onSubmit,
    reset,
  } = useNameForm({
    initial: name,
    submit: (cleaned) =>
      cleaned === name ? null : renameProgram({ programPublicId, name: cleaned }),
    onSaved: (_result, called) => {
      close();
      if (called) onStatus(BUILDER_COPY.renamed);
    },
  });

  /** Back to the heading, focus on Rename. Synchronous, so Rename exists when it is focused. */
  function close() {
    flushSync(() => {
      reset(name);
      setEditing(false);
    });
    renameRef.current?.focus();
  }

  if (!editing) {
    return (
      <div className="flex items-start gap-2">
        <h1 className={`flex-1 py-1.5 text-2xl font-semibold tracking-tight ${NAME_WRAP_CLASS}`}>
          {name}
        </h1>
        <Button
          ref={renameRef}
          variant="ghost"
          className="shrink-0"
          aria-label={renameLabel(name)}
          onClick={() => {
            onStatus('');
            // Focus inside the tap, so iOS raises the keyboard: the form must exist by then.
            flushSync(() => {
              reset(name);
              setEditing(true);
            });
            fieldRef.current?.focus();
          }}
        >
          {BUILDER_COPY.rename}
        </Button>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
      className="flex flex-col gap-3"
      aria-label={renameLabel(name)}
    >
      {/* The page keeps its one <h1> while the form is open; the field says what it renames. */}
      <h1 className={`sr-only ${NAME_WRAP_CLASS}`}>{name}</h1>
      <NameField
        ref={fieldRef}
        id={NAME_ID}
        label={BUILDER_COPY.programName}
        value={draft}
        max={PROGRAM_NAME_MAX}
        onChange={onChange}
        error={error}
      />
      <div className="flex gap-2">
        <Button
          type="submit"
          aria-disabled={pending || undefined}
          className={`flex-1 ${PENDING_CLASS}`}
        >
          {pending ? SAVING_LABEL : BUILDER_COPY.save}
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          {BUILDER_COPY.cancel}
        </Button>
      </div>
    </form>
  );
}
