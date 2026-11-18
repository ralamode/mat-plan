'use client';

import { newId, PROGRAM_NAME_MAX, type ProgramActions } from '@mat-plan/shared';
import { useRouter } from 'next/navigation';
import { useRef, useState } from 'react';
import { flushSync } from 'react-dom';

import { Button } from '@/components/ui/button';
import { CTA_CLASS } from '@/lib/constants';

import { BUILDER_COPY, PENDING_CLASS } from './builder-text';
import { NameField } from './name-field';
import { programPath } from './routes';
import { useNameForm } from './use-name-form';

const NAME_ID = 'new-program-name';

/**
 * "+ Create a program", on the Programs list (FAM-1 step 8a). **A program is created by naming
 * it** (plan §4 "As built"), so the button opens a name field in place, and Create makes the
 * program and opens its page.
 *
 * - With no programs yet the form is open from the start, without taking focus, so the first
 *   program is one field and one tap away. Otherwise the button opens it and focuses the field;
 *   Cancel closes it and returns focus to the button.
 * - **One `clientId` per opened form**: a retry after `retry` reuses it, so a create that did land
 *   is not made twice (`createProgramSchema`); opening the form again mints a new one.
 * - The name, its refusals and a Cancel mid-save are `useNameForm`'s.
 */
export function CreateProgram({
  createProgram,
  startOpen,
}: {
  createProgram: ProgramActions['createProgram'];
  startOpen: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(startOpen);
  const clientId = useRef(newId());
  const openerRef = useRef<HTMLButtonElement>(null);
  const {
    name: draft,
    error,
    pending,
    fieldRef,
    onChange,
    onSubmit,
    reset,
  } = useNameForm({
    initial: '',
    submit: (name) => createProgram({ clientId: clientId.current, name }),
    // `pending` stays set: the button must not read "Create" again while the page changes.
    onSaved: (result) => router.push(programPath(result.programPublicId)),
  });

  function close() {
    reset();
    setOpen(false);
    requestAnimationFrame(() => openerRef.current?.focus());
  }

  if (!open) {
    return (
      <Button
        ref={openerRef}
        variant="outline"
        className={CTA_CLASS}
        onClick={() => {
          clientId.current = newId();
          reset();
          // Focus inside the tap, so iOS raises the keyboard: the form must exist by then.
          flushSync(() => setOpen(true));
          fieldRef.current?.focus();
        }}
      >
        {BUILDER_COPY.createProgram}
      </Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !startOpen) close();
      }}
      className="flex flex-col gap-3 rounded-lg border p-4"
      aria-label={BUILDER_COPY.createProgramForm}
    >
      <NameField
        ref={fieldRef}
        id={NAME_ID}
        label={BUILDER_COPY.programName}
        placeholder={BUILDER_COPY.programNamePlaceholder}
        value={draft}
        max={PROGRAM_NAME_MAX}
        hint={BUILDER_COPY.createHint}
        onChange={onChange}
        error={error}
      />
      <div className="flex gap-2">
        {/* `aria-disabled`, not `disabled`: a disabled button drops focus to <body> mid-save. */}
        <Button
          type="submit"
          aria-disabled={pending || undefined}
          className={`flex-1 ${PENDING_CLASS}`}
        >
          {pending ? BUILDER_COPY.creating : BUILDER_COPY.create}
        </Button>
        {startOpen ? null : (
          <Button type="button" variant="ghost" onClick={close}>
            {BUILDER_COPY.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}
