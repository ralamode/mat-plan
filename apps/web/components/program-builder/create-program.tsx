'use client';

import { newId, PROGRAM_NAME_MAX, type ProgramActions } from '@mat-plan/shared';
import { useRouter } from 'next/navigation';
import { useRef, useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/button';
import { CTA_CLASS } from '@/lib/constants';

import { BUILDER_COPY, nameRefusal } from './builder-text';
import { NameField } from './name-field';
import { programPath } from './routes';

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
 *   is not made twice (`createProgramSchema`).
 * - A refusal shows under the field, takes focus back to it and scrolls it into view: on a phone
 *   the keyboard covers the bottom of the list, which is where this form is.
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
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const clientId = useRef(newId());
  const fieldRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);

  const refuse = (message: string) => {
    setError(message);
    fieldRef.current?.focus();
    fieldRef.current?.scrollIntoView?.({ block: 'center' });
  };

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;
    const trimmed = name.trim();
    if (!trimmed) return refuse(nameRefusal('invalid'));
    setPending(true);
    const result = await createProgram({ clientId: clientId.current, name: trimmed });
    setPending(false);
    if (result.ok) {
      router.push(programPath(result.programPublicId));
      return;
    }
    refuse(nameRefusal(result.reason));
  }

  if (!open) {
    return (
      <Button
        ref={openerRef}
        variant="outline"
        className={CTA_CLASS}
        onClick={() => {
          clientId.current = newId();
          setOpen(true);
          // After the form mounts.
          requestAnimationFrame(() => fieldRef.current?.focus());
        }}
      >
        {BUILDER_COPY.createProgram}
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !startOpen) close();
      }}
      className="flex flex-col gap-3 rounded-lg border p-4"
      aria-label="Create a program"
    >
      <NameField
        ref={fieldRef}
        id={NAME_ID}
        label={BUILDER_COPY.programName}
        placeholder={BUILDER_COPY.programNamePlaceholder}
        value={name}
        max={PROGRAM_NAME_MAX}
        onChange={(value) => {
          setName(value);
          setError(null);
        }}
        error={error}
      />
      <div className="flex gap-2">
        {/* `aria-disabled`, not `disabled`: a disabled button drops focus to <body> mid-save. */}
        <Button type="submit" aria-disabled={pending || undefined} className="flex-1">
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

  function close() {
    setOpen(false);
    setName('');
    setError(null);
    requestAnimationFrame(() => openerRef.current?.focus());
  }
}
