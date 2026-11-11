'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Sheet, type SheetVariant } from '@/components/ui/sheet';

/**
 * The inventory's sheet cell (U0). A client island because the rest of `inventory.tsx` is a Server
 * Component and a modal needs state.
 *
 * ## Why a design-reference page hosts an interactive modal
 *
 * 🔴 **U0 has no consumer until `PICK-1` (step 6b), and its two riskiest behaviours are
 * browser-only.** jsdom has no `visualViewport` and no real history gesture, so without a mounted
 * sheet on a real route the keyboard geometry and the back gesture would ship with nothing able to
 * prove them — the shape `a-1d-add` deleted a parameter over ("a promise nothing keeps and nothing
 * can test"). This page is already a route, already axe-scanned, and already renders the app's real
 * components, so it is the cheapest honest host.
 *
 * ⚠️ **It is a temporary one.** `page.tsx` says the UI-3 PR that picks a set deletes this directory.
 * When that happens the open-sheet coverage must already have moved to `PICK-1` PR 4's open picker —
 * `docs/roadmap.md` carries the ordering, and `e2e/a11y.spec.ts` repeats it where the test lives.
 *
 * ## `dataTokens` is the whole reason this is not three lines
 *
 * `Dialog.Portal` mounts under `document.body`, **outside** every `[data-tokens]` cell. Without
 * forwarding, all four cells would render the CONTROL palette and the page would audit the candidate
 * palettes zero times — the one thing it exists to do.
 */
export function SheetDemo({ tokens, variant }: { tokens?: string; variant?: SheetVariant }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);

  const label = variant === 'dialog' ? 'Open dialog' : 'Open sheet';

  return (
    <>
      <Button ref={trigger} type="button" variant="outline" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Sheet
        id={variant === 'dialog' ? 'inventory-dialog' : 'inventory-sheet'}
        open={open}
        onOpenChange={setOpen}
        title={variant === 'dialog' ? 'Clear Tuesday?' : 'Pick a movement'}
        returnFocusTo={trigger}
        variant={variant}
        dataTokens={tokens}
        status={status}
        footer={
          <Button type="button" onClick={() => setOpen(false)}>
            {variant === 'dialog' ? 'Clear the day' : 'Use as typed'}
          </Button>
        }
      >
        <p className="text-sm">
          {variant === 'dialog'
            ? 'Every live entry on that day is removed. You can restore it afterwards.'
            : 'The body scrolls while the title and the actions stay pinned.'}
        </p>
        {/* Exercises the live region from a control INSIDE the sheet, so the e2e can watch the
            status text change while the sheet is open — which is criterion 46's actual claim. */}
        <Button
          type="button"
          variant="secondary"
          className="mt-3"
          onClick={() => setStatus((s) => (s ? '' : '3 matches'))}
        >
          Toggle the status message
        </Button>
        {/* A route link, so the e2e can leave the sheet by navigation and press back from the
            destination. That is the case an unconditional `history.back()` on close gets wrong. */}
        <p className="mt-3 text-sm">
          <Link href="/design/tokens?from=sheet" className="underline">
            Go somewhere else
          </Link>
        </p>
        {/* Long enough to scroll, so "only the middle scrolls" is observable rather than asserted. */}
        <div className="mt-3 flex flex-col gap-2" aria-hidden>
          {Array.from({ length: 12 }, (_, i) => (
            <p key={i} className="text-muted-foreground text-sm">
              Filler row {i + 1}
            </p>
          ))}
        </div>
      </Sheet>
    </>
  );
}
