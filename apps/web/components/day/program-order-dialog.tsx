'use client';

import {
  PROGRAM_REFUSAL,
  programsByStay,
  type DayActions,
  type DayPlan,
  type ProgramResult,
} from '@mat-plan/shared';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
import { lastDayText } from '@/components/program-builder/builder-text';
import { Sheet } from '@/components/ui/sheet';
import { NAME_WRAP_CLASS } from '@/lib/constants';
import { moveDown, moveUp } from '@/lib/routine/editor';
import { cn } from '@/lib/utils';

import { athleteNameOf, PROGRAM_COPY } from './day-copy';
import { PROGRAM_ORDER_SHEET_ID } from './program-order-id';

type Program = DayPlan['currentPrograms'][number];
type Move = -1 | 1;
type Reorder = NonNullable<DayActions['reorderPrograms']>;

/** Refusals that mean the athlete's programs changed elsewhere: retrying cannot help, re-reading can. */
const STALE_REFUSALS: readonly string[] = [PROGRAM_REFUSAL.invalid, PROGRAM_REFUSAL.not_found];

/**
 * The athlete's program order (plan D8: the order is the author's, never a label's).
 *
 * **Loaded on demand** by `ProgramOrderButton` (`program-order-button.tsx`), so nothing imports this
 * module eagerly; its sheet id lives in `program-order-id.ts` for that reason.
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
 * focus never drops, and it does nothing. **When that arrow no longer exists** (its program now ends
 * today, after a re-read or a revert), focus goes to Done, which the error line describes.
 *
 * **A program ending today** (D47, contract C37's `endsToday`) is listed below the movable ones,
 * under a note, with no number and no arrows, and is not counted in "N of M". The order sent is
 * still the whole list, the ending ones last (`programsByStay`, the contract's one split).
 *
 * **When nothing stays** (a re-read while it is open: off every program, or every program ends today)
 * one sentence is the whole body: `orderEmpty` or `orderAllEnding`, in place of the explainer and
 * both lists, and over any error line. It describes Done, and is announced when it changes while
 * open, except when that change moved focus to Done (the description already says it).
 */
export function ProgramOrderDialog({
  plan,
  reorder,
  open,
  onOpenChange,
  returnFocusTo,
  canOrder,
}: {
  plan: DayPlan;
  reorder: Reorder;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo: RefObject<HTMLElement | null>;
  /** Whether the page still offers Program order. False, Forward does not bring a closed dialog back. */
  canOrder: boolean;
}) {
  const router = useRouter();
  const errorId = useId();
  const [order, setOrder] = useState<Program[]>(plan.currentPrograms);
  const [pending, setPending] = useState(false);
  /** The sheet's announcement; `n` re-announces the same sentence (`statusKey`). */
  const [status, setStatus] = useState({ text: '', n: 0 });
  const [error, setError] = useState('');

  /** The last order the server took: what a failed save puts back. Read and written in handlers. */
  const saved = useRef<Program[]>(plan.currentPrograms);
  const inFlight = useRef(false);
  const queued = useRef<{ order: Program[]; moved: Program } | null>(null);
  const arrows = useRef(new Map<string, HTMLButtonElement>());
  const lastTapped = useRef<string | null>(null);
  /** Set by a move or a revert: the next list render puts focus back on the last arrow tapped. */
  const refocus = useRef(false);
  const done = useRef<HTMLButtonElement>(null);
  /**
   * Set by the focus effect when it put focus on Done this commit. Done is described by the empty
   * sentence, so the announce effect (declared after it, so it runs after) skips the status line
   * rather than have the sentence heard twice.
   */
  /** The arrow that last had focus: if it goes while the dialog holds focus nowhere, Done takes it. */
  const focusedArrow = useRef<string | null>(null);
  /** The page's latest order, and whether one arrived while a save was in flight. */
  const latest = useRef<Program[]>(plan.currentPrograms);
  const arrivedMidSave = useRef(false);

  // Opening starts clean: an old failure or announcement no longer describes the list.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setError('');
      setStatus((was) => ({ text: '', n: was.n + 1 }));
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
    latest.current = plan.currentPrograms;
    if (inFlight.current) arrivedMidSave.current = true;
    else saved.current = plan.currentPrograms;
  }, [plan.currentPrograms]);

  // After a move or a revert, the arrow last tapped keeps focus; Done, when that arrow is gone (its
  // program ends today now). Only then: a re-read of the page that happens to re-render the list
  // must not pull focus from wherever it is now, unless it removed the arrow that had it.
  useEffect(() => {
    // A refocus asked for while the dialog is closed (a save that failed after Done) is dropped:
    // the next open's focus is the sheet's, not an old arrow's.
    if (!open) {
      refocus.current = false;
      return;
    }
    if (refocus.current) {
      refocus.current = false;
      const key = lastTapped.current;
      const target = key ? (arrows.current.get(key) ?? done.current) : null;
      target?.focus();
      return;
    }
    const had = focusedArrow.current;
    const dialog = done.current?.closest('[role="dialog"]');
    const active = document.activeElement;
    // Lost: outside the dialog, or on the dialog itself, where the sheet's focus trap puts focus when
    // the focused node is removed (Radix FocusScope), before this effect runs in a browser.
    if (had && !arrows.current.has(had) && (!dialog?.contains(active) || active === dialog)) {
      focusedArrow.current = null;
      done.current?.focus();
    }
  }, [order, open]);

  // Each announcement is a new node, so the same sentence twice is still read (the sheet's
  // `statusKey`, Announcer's `messageKey`).
  const announce = (next: string) => setStatus((was) => ({ text: next, n: was.n + 1 }));

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
      // An order the page re-read during the save is the server's, so it is what to put back; and
      // it is not marked as accounted for, so the list adopts it.
      if (arrivedMidSave.current) saved.current = latest.current;
      arrivedMidSave.current = false;
      setPending(false);
      refocus.current = true;
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
    arrivedMidSave.current = false;
    // Every order seen so far is older than this save: none of it may be adopted over it later.
    settle();
    setError('');
    if (waiting) {
      await save(waiting.order, waiting.moved);
      return;
    }
    setPending(false);
    // The order is this save's; which programs end today is the page's latest word (a re-read during
    // the save may have marked one), so the list shows it under the note at once.
    // A program the re-read no longer has is gone, not kept: a re-read that empties the list then
    // shows the empty sentence (15c follow-up).
    const shown = next.flatMap((p) => {
      const now = latest.current.find((q) => q.programPublicId === p.programPublicId);
      return now ? [now] : [];
    });
    setOrder(shown);
    // "N of M" counts the programs that stay: the ending ones cannot move, and are a list of their own.
    const { staying: settled } = programsByStay(shown);
    const place = settled.findIndex((p) => p.programPublicId === moved.programPublicId);
    if (place >= 0) announce(PROGRAM_COPY.moved(moved.name, place + 1, settled.length));
  }

  function move(program: Program, by: Move) {
    const from = staying.indexOf(program);
    const moved = by === -1 ? moveUp(staying, from) : moveDown(staying, from);
    if (moved.every((p, i) => p === staying[i])) return;
    // The whole list is sent, the ending programs last, as the writer keeps them.
    const next = [...moved, ...ending];
    refocus.current = true;
    setOrder(next);
    setError('');
    void save(next, program);
  }

  const { staying, ending } = programsByStay(order);
  const endingNoteId = `${errorId}-ending`;
  const emptyId = `${errorId}-empty`;
  /**
   * Nothing stays to order (15c follow-up): a re-read while the dialog is open took the athlete off
   * every program, or left only programs ending today. One sentence replaces the explainer and both
   * lists, and it wins over any error line, so one message shows.
   */
  const athlete = athleteNameOf(plan);
  const emptyText =
    staying.length > 0
      ? null
      : ending.length > 0
        ? PROGRAM_COPY.orderAllEnding(athlete)
        : PROGRAM_COPY.orderEmpty(athlete);

  // Said when the sentence changes while open (a list to none, or one empty sentence to the other):
  // the deps keep a re-read with the same sentence silent. Said even when this commit moved focus
  // to Done, which the sentence also describes: iOS VoiceOver reads a description only as a delayed
  // hint that a person can turn off, so a possible second reading is the safer cost (UX pass).
  // Starts at the sentence shown on mount: a dialog that opens already empty says it as its body.
  const lastSaid = useRef<string | null>(emptyText);
  useEffect(() => {
    if (!open) return;
    if (emptyText !== null && emptyText !== lastSaid.current) announce(emptyText);
    lastSaid.current = emptyText;
  }, [emptyText, open]);

  const arrow = (program: Program, by: Move, index: number) => {
    const end = by === -1 ? index === 0 : index === staying.length - 1;
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
        onFocus={() => {
          focusedArrow.current = key;
        }}
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
      id={PROGRAM_ORDER_SHEET_ID}
      variant="dialog"
      open={open}
      onOpenChange={onOpenChange}
      title={PROGRAM_COPY.orderTitle(athleteNameOf(plan))}
      returnFocusTo={returnFocusTo}
      // Its button hidden (fewer than two stay), Forward must not reopen it (15c follow-up).
      reopenFromHistory={canOrder}
      status={status.text}
      statusKey={status.n}
      footer={
        <Button
          ref={done}
          type="button"
          className="w-full"
          // The error, and the note on what cannot move: focus lands here when a re-read takes away
          // the arrow it was on, and the note says why.
          aria-describedby={
            (emptyText !== null
              ? [emptyId]
              : [error ? errorId : null, ending.length > 0 ? endingNoteId : null]
            )
              .filter(Boolean)
              .join(' ') || undefined
          }
          onClick={() => onOpenChange(false)}
        >
          {PROGRAM_COPY.done}
        </Button>
      }
    >
      {emptyText !== null ? (
        <p id={emptyId} className="text-sm">
          {emptyText}
        </p>
      ) : (
        <>
          <p className="text-muted-foreground text-sm">{PROGRAM_COPY.orderExplainer}</p>
          {/* `role="list"`: Safari drops list semantics from a list styled without markers. */}
          <ol role="list" className="mt-3 flex flex-col gap-2">
            {staying.map((program, index) => (
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
          {ending.length > 0 ? (
            <>
              <p id={endingNoteId} className="text-muted-foreground mt-4 text-sm">
                {PROGRAM_COPY.endingNote(ending.length)}
              </p>
              {/* A list of its own, named by the note: no number, no arrows, never counted in N of M. */}
              <ul role="list" aria-labelledby={endingNoteId} className="mt-2 flex flex-col gap-2">
                {ending.map((program) => (
                  <li
                    key={program.programPublicId}
                    className="flex min-h-11 items-center rounded-lg border py-1 pr-3 pl-3"
                  >
                    <span className={cn('min-w-0', NAME_WRAP_CLASS)}>
                      {/* The break before "·" stays outside the one-line suffix, so a long last word
                          moves down whole rather than splitting mid-word. */}
                      {program.name}{' '}
                      <span className="text-muted-foreground whitespace-nowrap">
                        <span aria-hidden="true">· </span>
                        <span className="sr-only">, </span>
                        {lastDayText(plan.today, plan.today)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
      {/* Mounted before it has text, so a failure is announced (announcer.tsx rule 1). Silent while
          nothing stays: the empty sentence is the one message. */}
      <Announcer
        id={errorId}
        message={emptyText !== null ? '' : error}
        className="text-destructive mt-2 min-h-5 text-sm"
      />
    </Sheet>
  );
}
