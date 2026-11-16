'use client';

import type { DayActions, DayPlan, ProgramResult } from '@mat-plan/shared';
import { useEffect, useRef, useState, type RefObject } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
import { Sheet } from '@/components/ui/sheet';
import { NAME_WRAP_CLASS } from '@/lib/constants';
import { cn } from '@/lib/utils';

import { PROGRAM_COPY } from './day-copy';

type Program = DayPlan['currentPrograms'][number];
type Move = -1 | 1;

const SHEET_ID = 'program-order';

/**
 * The athlete's program order (FAM-1 step 13d; plan D8: the order is the author's, never a label's).
 *
 * ↑ and ↓ per program, as the week editor has (UX panel: drag fights the sheet's scroll lock). **Each
 * tap saves**, with the whole order at once (`ProgramOrder` is a permutation of `currentPrograms`);
 * there is no Cancel, so Escape and Done never discard.
 *
 * **Taps while a save is in flight** move the local list and are sent together when it settles,
 * so a revalidate from the first cannot undo the second. A refused or failed save puts the list back
 * to the last saved order and says "Couldn't save. Try again." inside the sheet. "Moved to 1 of 2"
 * is said after the save, not before.
 *
 * Focus stays on the arrow that was tapped, which moves with its program. An end arrow is
 * `aria-disabled` (still focusable, so focus never drops) and does nothing.
 */
export function ProgramOrderDialog({
  plan,
  reorder,
  open,
  onOpenChange,
  returnFocusTo,
}: {
  plan: DayPlan;
  reorder: NonNullable<DayActions['reorderPrograms']>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo: RefObject<HTMLElement | null>;
}) {
  const athlete = plan.athletes.find((a) => a.profilePublicId === plan.profilePublicId)?.name ?? '';
  const [order, setOrder] = useState<Program[]>(plan.currentPrograms);
  const [pending, setPending] = useState(false);
  /** The last order the server took: what a failed save puts back. Read only in handlers. */
  const saved = useRef<Program[]>(plan.currentPrograms);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const inFlight = useRef(false);
  const queued = useRef<{ order: Program[]; moved: Program } | null>(null);
  const arrows = useRef(new Map<string, HTMLButtonElement>());

  // Opening starts clean: an old failure or announcement no longer describes the list.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError('');
      setStatus('');
    }
  }

  // A new order from the page (another phone, a reload) is the truth when nothing is pending.
  const [seen, setSeen] = useState(plan.currentPrograms);
  if (seen !== plan.currentPrograms && !pending) {
    setSeen(plan.currentPrograms);
    setOrder(plan.currentPrograms);
  }

  useEffect(() => {
    if (!pending) saved.current = plan.currentPrograms;
  }, [plan.currentPrograms, pending]);

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
      result = { ok: false, reason: 'retry' };
    }
    inFlight.current = false;
    const waiting = queued.current;
    queued.current = null;
    if (!result.ok) {
      setPending(false);
      setOrder(saved.current);
      setError(PROGRAM_COPY.orderFailed);
      return;
    }
    saved.current = next;
    setError('');
    if (waiting) {
      await save(waiting.order, waiting.moved);
      return;
    }
    setPending(false);
    setStatus(PROGRAM_COPY.moved(moved.name, next.indexOf(moved) + 1, next.length));
  }

  function move(program: Program, by: Move) {
    const from = order.indexOf(program);
    const to = from + by;
    if (to < 0 || to >= order.length) return;
    const next = [...order];
    next.splice(from, 1);
    next.splice(to, 0, program);
    setOrder(next);
    setError('');
    // The tapped arrow moves with its program; keep focus on it after the list re-renders.
    const key = `${program.programPublicId}:${by}`;
    requestAnimationFrame(() => arrows.current.get(key)?.focus());
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
        onClick={() => {
          if (!end) move(program, by);
        }}
        className={cn('size-11', end && 'text-muted-foreground opacity-50')}
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
      title={PROGRAM_COPY.orderTitle(athlete)}
      returnFocusTo={returnFocusTo}
      status={status}
      footer={
        <Button type="button" className="w-full" onClick={() => onOpenChange(false)}>
          {PROGRAM_COPY.done}
        </Button>
      }
    >
      <p className="text-muted-foreground text-sm">{PROGRAM_COPY.orderExplainer}</p>
      <ol className="mt-3 flex flex-col gap-2">
        {order.map((program, index) => (
          <li
            key={program.programPublicId}
            className="flex items-center gap-1 rounded-lg border py-1 pr-1 pl-3"
          >
            {/* The <ol> already says the position to a screen reader; the typed number is for sight. */}
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
      <Announcer message={error} className="text-destructive mt-2 min-h-5 text-sm" />
    </Sheet>
  );
}
