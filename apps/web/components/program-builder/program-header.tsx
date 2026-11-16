'use client';

import { PROGRAM_NAME_MAX, type ProgramActions } from '@mat-plan/shared';
import { useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import { Button } from '@/components/ui/button';
import { NAME_WRAP_CLASS } from '@/lib/constants';

import { BUILDER_COPY, nameRefusal } from './builder-text';
import { NameField } from './name-field';

const NAME_ID = 'program-name';

/**
 * A program's `<h1>` and Rename (FAM-1 step 8a; the prototype's `pname`).
 *
 * Rename swaps the heading's row for a stacked form: at 360px a field beside its buttons would show
 * about 20 of the name's 60 characters. Beyond the prototype it has Cancel and Escape, and the
 * counter plan §8 asks of every name. On a save, the heading comes back, focus returns to Rename
 * and `onStatus` reports it; an unchanged name just closes. A refusal keeps the form open, says
 * why under the field and focuses it.
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
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const renameRef = useRef<HTMLButtonElement>(null);

  const refuse = (message: string) => {
    setError(message);
    fieldRef.current?.focus();
  };

  function close() {
    setEditing(false);
    setError(null);
    requestAnimationFrame(() => renameRef.current?.focus());
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const trimmed = draft.trim();
    if (!trimmed) return refuse(nameRefusal('invalid'));
    if (trimmed === name) return close();
    setPending(true);
    const result = await renameProgram({ programPublicId, name: trimmed });
    setPending(false);
    if (!result.ok) return refuse(nameRefusal(result.reason));
    close();
    onStatus(BUILDER_COPY.renamed);
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
          aria-label={`${BUILDER_COPY.rename} ${name}`}
          onClick={() => {
            onStatus('');
            // Focus inside the tap, so iOS raises the keyboard: the form must exist by then.
            flushSync(() => {
              setDraft(name);
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
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') close();
      }}
      className="flex flex-col gap-3"
      aria-label={`${BUILDER_COPY.rename} ${name}`}
    >
      {/* The page keeps its one <h1> while the form is open; the field says what it renames. */}
      <h1 className="sr-only">{name}</h1>
      <NameField
        ref={fieldRef}
        id={NAME_ID}
        label={BUILDER_COPY.programName}
        value={draft}
        max={PROGRAM_NAME_MAX}
        onChange={(value) => {
          setDraft(value);
          setError(null);
        }}
        error={error}
      />
      <div className="flex gap-2">
        <Button type="submit" aria-disabled={pending || undefined} className="flex-1">
          {pending ? BUILDER_COPY.saving : BUILDER_COPY.save}
        </Button>
        <Button type="button" variant="ghost" onClick={close}>
          {BUILDER_COPY.cancel}
        </Button>
      </div>
    </form>
  );
}
