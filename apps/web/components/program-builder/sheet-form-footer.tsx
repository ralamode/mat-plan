'use client';

import type { ReactNode } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
import { NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { BUILDER_COPY, PENDING_CLASS } from './builder-text';

/**
 * A form sheet's footer (FAM-1 step 10b: Copy and Put on): its own message, then the action and
 * Cancel side by side, the action first and Cancel last.
 *
 * - **The message is seen and heard**: a visible `Announcer`, mounted empty so a change is read,
 *   tied to the action with `aria-describedby`. The Sheet's own `status` is screen-reader only.
 * - **The action submits the form in the body** (`form=`): the Sheet renders its footer outside
 *   `children`, so Enter in a field and the button send the same form.
 * - **Inactive is `aria-disabled`**, reachable, and a tap says why through `message`.
 * - **`lead`**, when given, is a line above the message, in view with the action (Put on's
 *   "Starting: names", step 15). The action wraps a long unbroken name (`NAME_WRAP_CLASS`).
 */
export function SheetFormFooter({
  formId,
  messageId,
  message,
  action,
  inactive,
  onCancel,
  lead,
}: {
  formId: string;
  messageId: string;
  message: string;
  action: string;
  inactive: boolean;
  onCancel: () => void;
  lead?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      {lead}
      <Announcer
        id={messageId}
        message={message}
        // NAME_WRAP_CLASS: a message can name a program, up to its full length, at 360px.
        className={cn('text-sm font-medium', NAME_WRAP_CLASS, message ? 'min-h-5' : 'h-0')}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="submit"
          form={formId}
          size="lg"
          className={cn('w-full text-base', PENDING_CLASS, NAME_WRAP_CLASS)}
          aria-disabled={inactive || undefined}
          aria-describedby={messageId}
        >
          {action}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="lg"
          className="w-full text-base"
          onClick={onCancel}
        >
          {BUILDER_COPY.cancel}
        </Button>
      </div>
    </div>
  );
}
