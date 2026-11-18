import { X } from 'lucide-react';
import type * as React from 'react';

import { Button } from '@/components/ui/button';
import { TickButton } from '@/components/ui/tick-button';
import { cn } from '@/lib/utils';

/** What the ✕ passes through untouched: lane C's Safari tap-order fix rides on these. */
export type InlineEditCancelHandlers = Pick<
  React.ComponentProps<'button'>,
  'onPointerDown' | 'onPointerCancel'
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
 * - **The ✓ stays filled whether it saves or clears**; its NAME says which (`confirm.label`). It is
 *   `TickButton`, so its pending spinner keeps the name, with `aria-busy`.
 * - **Pending hides the ✕** (`invisible`: out of the tab order and the accessibility tree, its 44px
 *   kept so nothing shifts), and `pointer-events-none` + `transition-none` make that immediate: the
 *   base `transition-all` would otherwise keep it painted and clickable for ~150ms. A Cancel could
 *   not stop the write in flight. The caller still guards its own cancel on `pending` too.
 * - **Without `confirm`, the ✕ renders alone**, for a row whose own ✓ is already the save. The
 *   ✕-alone form may sit on the line under that row, directly under its ✓ (day page, maintainer
 *   2026-11-17).
 * - Both are 44×44 (`icon-lg` + the base `min-h-11`); `focusClassName` swaps the focus ring on a
 *   tinted surface, so the pair focuses like the ✓ beside it (docs/design.md).
 */
export function InlineEditActions({
  confirm,
  cancelLabel,
  onCancel,
  cancelHandlers,
  pending = false,
  describedBy,
  focusClassName,
}: {
  /** The ✓, a `submit` for the caller's `<form>`; omitted for a row whose own ✓ already saves. */
  confirm?: {
    /** The ✓'s accessible name: the glyph alone says nothing to a screen reader. */
    label: string;
  };
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
        <TickButton
          type="submit"
          label={confirm.label}
          pending={pending}
          aria-describedby={describedBy}
          className={focusClassName}
        />
      ) : null}
      <Button
        type="button"
        variant="outline"
        size="icon-lg"
        aria-label={cancelLabel}
        aria-describedby={describedBy}
        {...cancelHandlers}
        onClick={onCancel}
        className={cn(pending && 'pointer-events-none invisible transition-none', focusClassName)}
      >
        <X aria-hidden="true" className="size-5" />
      </Button>
    </div>
  );
}
