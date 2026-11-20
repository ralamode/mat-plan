'use client';

import { Button } from '@/components/ui/button';
import { DoneTick } from '@/components/ui/done-tick';
import { LOGGED_ROW_CLASS, NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { DAY_COPY } from './day-copy';

/**
 * A finished part folded to one line (FAM-1 12c-iii, D38; plan §3): the filled tick, the name, a
 * detail (the slot's label, else the program on a two-program day, or Life's summary) and a count,
 * as one `<button>` inside the part's own heading, so a tap opens it. Not `Button`, which never wraps:
 * a long name or label wraps here and the line grows taller.
 *
 * **Its accessible name is its content**, with a hidden ", " between the parts ("Morning habits,
 * Morning, 10 of 10"); the tick, the "·" and the chevron are hidden. The name sits in its own span
 * (`nameId`), which the part's region is labelled by, so the region keeps its bare name folded or
 * open. The label and count take `done-muted-foreground`: the prototype's grey fails AA on the tint.
 */
export function CollapsedLine({
  name,
  nameId,
  detail,
  count,
  bodyId,
  lineRef,
  onOpen,
}: {
  name: string;
  nameId: string;
  detail: string | null;
  count: string | null;
  bodyId: string;
  lineRef: (node: HTMLButtonElement | null) => void;
  onOpen: () => void;
}) {
  return (
    <button
      ref={lineRef}
      type="button"
      aria-expanded={false}
      aria-controls={bodyId}
      onClick={onOpen}
      className={cn(
        LOGGED_ROW_CLASS,
        'flex min-h-12 w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left text-base font-semibold',
        'focus-visible:ring-ring outline-none focus-visible:ring-3',
      )}
    >
      <DoneTick />
      <span className="min-w-0 flex-1">
        <span id={nameId} className={NAME_WRAP_CLASS}>
          {name}
        </span>
        {detail ? (
          <>
            {/* The comma is for a screen reader, the space for both, the "·" for the eye. */}
            <span className="sr-only">,</span>{' '}
            <span aria-hidden="true" className="text-done-muted-foreground font-normal">
              {'· '}
            </span>
            <span className={cn('text-done-muted-foreground text-sm font-normal', NAME_WRAP_CLASS)}>
              {detail}
            </span>
          </>
        ) : null}
      </span>
      {count ? (
        <>
          <span className="sr-only">,</span>{' '}
          <span className="text-done-muted-foreground shrink-0 text-sm font-normal whitespace-nowrap">
            {count}
          </span>
        </>
      ) : null}
      <span aria-hidden="true" className="text-done-muted-foreground shrink-0 text-sm">
        ▾
      </span>
    </button>
  );
}

/**
 * "Collapse" on an open finished part (plan §4): a word, not an icon (D38). Named for its part
 * ("Collapse Morning habits"); shown only while the part is finished and not busy, so nothing typed,
 * pending or failed is ever behind a line.
 */
export function CollapseButton({
  name,
  bodyId,
  collapseRef,
  onCollapse,
}: {
  name: string;
  bodyId: string;
  collapseRef: (node: HTMLButtonElement | null) => void;
  onCollapse: () => void;
}) {
  return (
    <Button
      ref={collapseRef}
      type="button"
      variant="ghost"
      className="min-h-11 min-w-11"
      aria-expanded={true}
      aria-controls={bodyId}
      aria-label={DAY_COPY.collapseLabel(name)}
      onClick={onCollapse}
    >
      {DAY_COPY.collapse}
    </Button>
  );
}
