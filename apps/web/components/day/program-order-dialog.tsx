'use client';

import {
  PROGRAM_REFUSAL,
  type DayActions,
  type DayPlan,
  type ProgramResult,
} from '@mat-plan/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { NAME_WRAP_CLASS } from '@/lib/constants';
import { moveDown, moveUp } from '@/lib/routine/editor';
import { cn } from '@/lib/utils';

import { athleteNameOf, PROGRAM_COPY } from './day-copy';

type Program = DayPlan['currentPrograms'][number];
type Move = -1 | 1;
type Reorder = NonNullable<DayActions['reorderPrograms']>;

const SHEET_ID = 'program-order';

/** Refusals that mean the athlete's programs changed elsewhere: retrying cannot help, re-reading can. */
const STALE_REFUSALS: readonly string[] = [PROGRAM_REFUSAL.invalid, PROGRAM_REFUSAL.not_found];

/**
 * The Program order button and its dialog (FAM-1 step 13d). The client half of `ProgramLine`, so the
 * line itself renders on the server and the dialog's code loads only where it can be used.
 */
export function ProgramOrderButton({ plan, reorder }: { plan: DayPlan; reorder: Reorder }) {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Button ref={button} type="button" variant="outline" onClick={() => setOpen(true)}>
        {PROGRAM_COPY.order}
      </Button>
      <ProgramOrderDialog
        plan={plan}
        reorder={reorder}
        open={open}
        onOpenChange={setOpen}
        returnFocusTo={button}
      />
    </>
  );
}

/**
 * The athlete's program order (plan D8: the order is the author's, never a label's).
 *
 * ↑ and ↓ per program, as the week editor has (UX panel: drag fights the sheet's scroll lock). **Each
 * tap saves**, with the whole order at once (`ProgramOrder` is a permutation of `currentPrograms`);
 * there is no Cancel, so Escape and Done never discard.
 *
 * **While a save is in flight** the list is this dialog's own: further taps move it, and the latest
 * order is sent when the save settles; the page's data is not adopted until nothing is pending, so a
 * revalidate cannot undo a tap. A refused or failed save puts the list back to the last order the
 * server took and says so; a refusal that means the programs changed elsewhere re-reads the page.
 * "Moved to 1 of 2" is said after the save.
 *
 * **Focus stays on the arrow last tapped**, through a move and through a revert (a moved node can
 * lose focus when the browser re-inserts it). An end arrow is `aria-disabled`: still focusable, so
 * focus never drops, and it does nothing.
 */
export function ProgramOrderDialog({
  plan,
  reorder,
  open,
  onOpenChange,
  returnFocusTo,
}: {
  plan: DayPlan;
  reorder: Reorder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const router = useRouter();
  const errorId = useId();
  const [order, setOrder] = useState<Program[]>(plan.currentPrograms);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  /** The last order the server took: what a failed save puts back. Read and written in handlers. */
  const saved = useRef<Program[]>(plan.currentPrograms);
  const inFlight = useRef(false);
  const queued = useRef<{ order: Program[]; moved: Program } | null>(null);
  const arrows = useRef(new Map<string, HTMLButtonElement>());
  const lastTapped = useRef<string | null>(null);

  // Opening starts clean: an old failure or announcement no longer describes the list.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError('');
      setStatus('');
    }
  }

  // The page's order. `seen` always follows it; it is adopted into the list only when nothing is
  // pending and it is newer than what the saves accounted for: a save that settles marks every
  // order seen so far as accounted for, so an order that arrived mid-queue (from an earlier save)
  // can never undo a later one. An order that arrives after is the server's, and is adopted.
  const [page, setPage] = useState({
    seen: plan.currentPrograms,
    adopted: plan.currentPrograms,
  });
  if (page.seen !== plan.currentPrograms) setPage({ ...page, seen: plan.currentPrograms });
  if (!pending && page.adopted !== page.seen) {
    setPage({ ...page, adopted: page.seen });
    setOrder(page.seen);
  }
  const settle = () => setPage((was) => ({ ...was, adopted: was.seen }));
  useEffect(() => {
    if (!inFlight.current) saved.current = plan.currentPrograms;
  }, [plan.currentPrograms]);

  // After the list re-renders, the arrow last tapped keeps focus.
  useEffect(() => {
    const key = lastTapped.current;
    if (open && key) arrows.current.get(key)?.focus();
  }, [order, open]);

  // The same sentence twice is silent in a live region; a no-break space makes it a change.
  const announce = (next: string) => setStatus((was) => (was === next ? `${next} ` : next));

  async function save(next: Program[], moved: Program) {
    if (inFlight.current) {
      queued.current = { order: next, moved };
      return;
    }
    inFlight.current = true;
    setPending(true);
    let result: ProgramResult;
    try {
      result = await reorder({
        profilePublicId: plan.profilePublicId,
        programPublicIds: next.map((p) => p.programPublicId),
      });
    } catch {
      result = { ok: false, reason: PROGRAM_REFUSAL.retry };
    }
    inFlight.current = false;
    const waiting = queued.current;
    queued.current = null;
    if (!result.ok) {
      settle();
      setPending(false);
      setOrder(saved.current);
      if (STALE_REFUSALS.includes(result.reason)) {
        setError(PROGRAM_COPY.orderStale);
        router.refresh();
      } else {
        setError(PROGRAM_COPY.orderFailed);
      }
      return;
    }
    saved.current = next;
    setError('');
    if (waiting) {
      await save(waiting.order, waiting.moved);
      return;
    }
    settle();
    setPending(false);
    announce(PROGRAM_COPY.moved(moved.name, next.indexOf(moved) + 1, next.length));
  }

  function move(program: Program, by: Move) {
    const from = order.indexOf(program);
    const next = by === -1 ? moveUp(order, from) : moveDown(order, from);
    if (next.every((p, i) => p === order[i])) return;
    setOrder(next);
    setError('');
    void save(next, program);
  }

  const arrow = (program: Program, by: Move, index: number) => {
    const end = by === -1 ? index === 0 : index === order.length - 1;
    const key = `${program.programPublicId}:${by}`;
    return (
      <Button
        ref={(el) => {
          if (el) arrows.current.set(key, el);
          else arrows.current.delete(key);
        }}
        type="button"
        variant="ghost"
        size="icon"
        aria-label={(by === -1 ? PROGRAM_COPY.moveUp : PROGRAM_COPY.moveDown)(program.name)}
        aria-disabled={end || undefined}
        aria-describedby={error ? errorId : undefined}
        onClick={() => {
          lastTapped.current = key;
          if (!end) move(program, by);
        }}
        className={cn(
          'size-11',
          // An end arrow looks and feels inert: no hover fill, no press nudge.
          'aria-disabled:text-muted-foreground aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:active:translate-y-0',
        )}
      >
        <span aria-hidden="true">{by === -1 ? '↑' : '↓'}</span>
      </Button>
    );
  };

  return (
    <Sheet
      id={SHEET_ID}
      variant="dialog"
      open={open}
      onOpenChange={onOpenChange}
      title={PROGRAM_COPY.orderTitle(athleteNameOf(plan))}
      returnFocusTo={returnFocusTo}
      status={status}
      footer={
        <Button type="button" className="w-full" onClick={() => onOpenChange(false)}>
          {PROGRAM_COPY.done}
        </Button>
      }
    >
      <p className="text-muted-foreground text-sm">{PROGRAM_COPY.orderExplainer}</p>
      {/* `role="list"`: Safari drops list semantics from a list styled without markers. */}
      <ol role="list" className="mt-3 flex flex-col gap-2">
        {order.map((program, index) => (
          <li
            key={program.programPublicId}
            className="flex items-center gap-1 rounded-lg border py-1 pr-1 pl-3"
          >
            {/* The list says the position to a screen reader; the typed number is for sight. */}
            <span className={cn('min-w-0 flex-1', NAME_WRAP_CLASS)}>
              <span aria-hidden="true">{index + 1}. </span>
              {program.name}
            </span>
            {arrow(program, -1, index)}
            {arrow(program, 1, index)}
          </li>
        ))}
      </ol>
      {/* Mounted before it has text, so a failure is announced (announcer.tsx rule 1). */}
      <Announcer id={errorId} message={error} className="text-destructive mt-2 min-h-5 text-sm" />
    </Sheet>
  );
}
