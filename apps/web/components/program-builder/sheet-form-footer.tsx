'use client';

import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
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
 */
export function SheetFormFooter({
  formId,
  messageId,
  message,
  action,
  inactive,
  onCancel,
}: {
  formId: string;
  messageId: string;
  message: string;
  action: string;
  inactive: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Announcer
        id={messageId}
        message={message}
        className={cn('text-sm font-medium', message ? 'min-h-5' : 'h-0')}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button
          type="submit"
          form={formId}
          size="lg"
          className={`w-full text-base ${PENDING_CLASS}`}
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
