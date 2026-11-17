import { Check, LoaderCircle, X } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** What the ✕ passes through untouched: lane C's Safari tap-order fix rides on these. */
export type InlineEditCancelHandlers = Pick<
  React.ComponentProps<'button'>,
  'onPointerDown' | 'onPointerCancel' | 'onFocus'
>;

/**
 * The ✓ (save) and ✕ (cancel) of an inline Change, icon-only, on the field's own line (maintainer,
 * 2026-11-16). The caller owns the field and every piece of state; this is only the pair.
 *
 * - **Order: ✓ then ✕, ✕ at the far right.** A ✕ right after a field reads as "clear this field", and
 *   a thumb that misses at the edge should cancel, not save or clear.
 * - **✕ is a neutral outline, never red** (maintainer, 2026-11-16): an empty ✓ is what clears, so a
 *   red ✕ would be the only destructive-looking control on the line and would be tapped to remove a
 *   value, which it does not do.
 * - **The ✓ stays filled whether it saves or clears**; its NAME says which (`confirm.label`). Its
 *   pending spinner keeps the name, with `aria-busy`, as `LogTick` does.
 * - **Pending hides the ✕** (`invisible`: out of the tab order and the accessibility tree, its 44px
 *   kept so nothing shifts): a Cancel could not stop the write in flight.
 * - **Without `confirm`, the ✕ renders alone**, for a row whose own ✓ is already the save.
 * - Both are 44×44 (`icon-lg` + the base `min-h-11`); `focusClassName` swaps the focus ring on a
 *   tinted surface, where the default ring is under 3:1.
 */
export function InlineEditActions({
  confirm,
  confirmRef,
  cancelLabel,
  onCancel,
  cancelHandlers,
  pending = false,
  describedBy,
  focusClassName,
}: {
  confirm?: {
    /** The ✓'s accessible name: the glyph alone says nothing to a screen reader. */
    label: string;
    /** `submit` inside a `<form>`; `button` with `onConfirm` where a row saves by other means. */
    type: 'submit' | 'button';
    onConfirm?: () => void;
  };
  /** The ✓ itself, for a caller that moves focus to it (a prop of its own: a ref inside `confirm`
   *  would make every read of `confirm` a ref read during render). */
  confirmRef?: React.Ref<HTMLButtonElement>;
  /** From shared copy (`AMEND_COPY.cancelLabel`), naming what is being changed. */
  cancelLabel: string;
  onCancel: () => void;
  cancelHandlers?: InlineEditCancelHandlers;
  pending?: boolean;
  /** An id list describing both buttons (which row's ✓ or ✕ this is). */
  describedBy?: string;
  focusClassName?: string;
}) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      {confirm ? (
        <Button
          ref={confirmRef}
          type={confirm.type}
          size="icon-lg"
          disabled={pending}
          aria-busy={pending || undefined}
          aria-label={confirm.label}
          aria-describedby={describedBy}
          onClick={confirm.onConfirm}
          className={focusClassName}
        >
          {pending ? (
            <LoaderCircle aria-hidden="true" className="size-5 animate-spin" />
          ) : (
            <Check aria-hidden="true" className="size-5" />
          )}
        </Button>
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        aria-label={cancelLabel}
        aria-describedby={describedBy}
        {...cancelHandlers}
        onClick={onCancel}
        className={cn(pending && 'invisible', focusClassName)}
      >
        <X aria-hidden="true" className="size-5" />
      </Button>
    </div>
  );
}
