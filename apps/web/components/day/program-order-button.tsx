'use client';

import type { DayActions, DayPlan } from '@mat-plan/shared';
import { useEffect, useId, useRef, useState } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';

import { PROGRAM_COPY } from './day-copy';
import { PROGRAM_ORDER_SHEET_ID } from './program-order-id';

type OrderDialog = (typeof import('./program-order-dialog'))['ProgramOrderDialog'];
type Reorder = NonNullable<DayActions['reorderPrograms']>;

/** Where `requestIdleCallback` is missing (Safari), the prefetch waits this long after mount. */
const IDLE_FALLBACK_MS = 1000;

/** One load per document, shared by the prefetch and the tap. A failure clears it, so a tap retries. */
let loading: Promise<OrderDialog> | null = null;
/** The loaded dialog, read synchronously so a tap after a prefetch opens in the same frame. */
let loaded: OrderDialog | null = null;

/**
 * Loads the dialog's chunk (15c follow-up). Exported for the tests, which load it up front so a
 * tap opens synchronously, as it does in the browser once the idle prefetch has run.
 */
export function loadProgramOrderDialog(): Promise<OrderDialog> {
  loading ??= import('./program-order-dialog').then(
    (module) => (loaded = module.ProgramOrderDialog),
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** A prefetch that fails says nothing: the tap that needs the dialog tries again and reports. */
function prefetch() {
  loadProgramOrderDialog().catch(() => {});
}

/**
 * The Program order button (FAM-1 step 13d), the client half of `ProgramLine`: the line renders on
 * the server, and **the dialog's code loads only when it can be used** (15c follow-up). It is
 * prefetched on idle while `canOrder` is true, and on the button's pointerdown or focus; a tap
 * mounts it.
 *
 * **Latched:** once mounted, the dialog stays mounted for the life of this component, whatever
 * `canOrder` does. `canOrder` false (fewer than two programs stay, D47) hides the button, **never
 * the dialog**: a re-read that leaves one staying while the dialog is open keeps it up with its
 * message, and Done then returns focus through the sheet's fallback (15c plan, UX-B1).
 *
 * **A chunk that fails to load never reaches `error.tsx`**: the load is caught, the button stays,
 * and a line under it says so (`orderOpenFailed`), described from the button. A tap retries.
 *
 * **The sheet's cross-route restore needs the dialog mounted**, so when the page mounts onto
 * Program order's own history entry (Back across routes, then Forward) the dialog is loaded at once
 * and mounted shut; the sheet then decides, by its document token and `reopenFromHistory`, whether
 * it reopens.
 */
export function ProgramOrderButton({
  plan,
  reorder,
  canOrder,
}: {
  plan: DayPlan;
  reorder: Reorder;
  canOrder: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [Dialog, setDialog] = useState<OrderDialog | null>(null);
  /** How many taps failed to load the dialog; a new number says the line again. 0: none. */
  const [failures, setFailures] = useState(0);
  const failedId = useId();
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!canOrder) return;
    const state = window.history.state as { sheet?: unknown } | null;
    if (state?.sheet === PROGRAM_ORDER_SHEET_ID) {
      loadProgramOrderDialog().then(
        (dialog) => setDialog(() => dialog),
        () => {},
      );
      return;
    }
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(prefetch);
      return () => window.cancelIdleCallback(id);
    }
    const id = window.setTimeout(prefetch, IDLE_FALLBACK_MS);
    return () => window.clearTimeout(id);
  }, [canOrder]);

  function show(dialog: OrderDialog) {
    setDialog(() => dialog);
    setFailures(0);
    setOpen(true);
  }

  async function openDialog() {
    if (Dialog) return setOpen(true);
    if (loaded) return show(loaded);
    try {
      show(await loadProgramOrderDialog());
    } catch {
      setFailures((n) => n + 1);
    }
  }

  return (
    <>
      {canOrder ? (
        <div className="flex flex-col items-start">
          <Button
            ref={button}
            type="button"
            variant="outline"
            aria-describedby={failures > 0 ? failedId : undefined}
            onPointerDown={prefetch}
            onFocus={prefetch}
            onClick={() => void openDialog()}
          >
            {PROGRAM_COPY.order}
          </Button>
          {/* Mounted before it has text (announcer.tsx rule 1). The key only once there is a line,
              so the empty region has no child and `not-empty:` adds no space under the button. */}
          <Announcer
            id={failedId}
            message={failures > 0 ? PROGRAM_COPY.orderOpenFailed : ''}
            messageKey={failures > 0 ? failures : undefined}
            className="text-destructive text-sm not-empty:mt-1"
          />
        </div>
      ) : null}
      {Dialog ? (
        <Dialog
          plan={plan}
          reorder={reorder}
          open={open}
          onOpenChange={setOpen}
          returnFocusTo={button}
          canOrder={canOrder}
        />
      ) : null}
    </>
  );
}
