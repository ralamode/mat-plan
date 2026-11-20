'use client';

import type { ReactNode } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
import { PENDING_CLASS } from '@/components/ui/pending-class';
import { AMEND_COPY, NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * A form sheet's footer: its own message, then the action and Cancel side by side, the action first
 * and Cancel last. Built for the program builder's Copy and Put on (FAM-1 step 10b), shared since
 * V1-9b B2-prep for Clear this day.
 *
 * - **`variant`** styles the action: `'destructive'` for an action that removes something. It stays
 *   `type="submit"` either way, so Enter in a field and the button still send the same form.
 * - **`cancel`** is Cancel's label, `AMEND_COPY.cancel` ("Cancel") unless a caller names it.
 *
 * - **The message is seen and heard**: a visible `Announcer`, mounted empty so a change is read,
 *   tied to the action with `aria-describedby`. The Sheet's own `status` is screen-reader only.
 * - **The action submits the form in the body** (`form=`): the Sheet renders its footer outside
 *   `children`, so Enter in a field and the button send the same form.
 * - **Inactive is `aria-disabled`**, reachable, and a tap says why through `message`.
 * - **Narrow columns stack**: below 20rem (a container query) the action sits above Cancel, so
 *   neither clips at 200% zoom on a phone; at 100% on a 360px phone they stay side by side.
 * - **`lead`**, when given, is a line above the message, in view with the action (Put on's
 *   "Starting: names", step 15), and describes the action before the message does. The action
 *   wraps a long unbroken name (`NAME_WRAP_CLASS`).
 */
export function SheetFormFooter({
  formId,
  messageId,
  message,
  action,
  inactive,
  onCancel,
  lead,
  variant = 'default',
  cancel = AMEND_COPY.cancel,
}: {
  formId: string;
  messageId: string;
  message: string;
  action: string;
  inactive: boolean;
  onCancel: () => void;
  lead?: ReactNode;
  variant?: 'default' | 'destructive';
  cancel?: string;
}) {
  const leadId = `${messageId}-lead`;
  return (
    <div className="@container flex flex-col gap-2">
      {lead ? <div id={leadId}>{lead}</div> : null}
      <Announcer
        id={messageId}
        message={message}
        // NAME_WRAP_CLASS: a message can name a program, up to its full length, at 360px.
        className={cn('text-sm font-medium', NAME_WRAP_CLASS, message ? 'min-h-5' : 'h-0')}
      />
      {/* Side by side while the column holds two 44px buttons; stacked, action first, below 20rem:
          at 200% zoom on a 390px phone (195 CSS px) two columns would clip "Cancel". 20rem is
          root-relative, so 100% text at 360px (a 328px column) stays side by side. */}
      <div className="grid grid-cols-2 gap-2 @max-xs:grid-cols-1">
        <Button
          type="submit"
          form={formId}
          variant={variant}
          size="lg"
          className={cn('w-full text-base', PENDING_CLASS, NAME_WRAP_CLASS)}
          aria-disabled={inactive || undefined}
          aria-describedby={lead ? `${leadId} ${messageId}` : messageId}
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
          {cancel}
        </Button>
      </div>
    </div>
  );
}
