'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';

/**
 * One part of the day that folds to one line once finished (FAM-1 12c-iii; D38, plan
 * `fam-1-12c-iii-collapse.md` §1 and §4): a workout card here, Bodyweight and Life in PR 2.
 *
 * **Folded only when the person arrives to it finished.** `useState(finished)` is read once, when the
 * part mounts: a new visit (opening the page, a reload, another day or athlete and back). What is
 * finished during a visit stays open, so nothing moves under a thumb. After that, the part opens by
 * itself when it stops being finished (another phone's un-tick, a `closed_day`), opens on a tap on
 * its line, and folds on "Collapse". Nothing is stored.
 *
 * **Focus** (§4): after a tap on the line it goes to "Collapse" (or the part's name, when "Collapse"
 * is not offered because the part is busy); after "Collapse", to the line. Moved by one counter per
 * target, bumped in the tap's handler, and an effect that lists only that counter: so it runs after a
 * tap and never after a change the data caused, and a mount (or StrictMode's second run) moves none.
 * When a control goes **by itself** while it holds focus, the open part's name takes it. Decided
 * after the commit, not in the ref cleanup: a cleanup also runs for StrictMode's simulated detach in
 * development, where the node stays connected, so only a node that has really left (and taken focus
 * with it) hands focus on.
 */
export function useCollapse(finished: boolean) {
  const [folded, setFolded] = useState(finished);
  // Unfinished now (an un-tick arrived, the day closed): open for the rest of the visit.
  if (folded && !finished) setFolded(false);
  const bodyId = useId();

  const line = useRef<HTMLButtonElement | null>(null);
  const collapseButton = useRef<HTMLButtonElement | null>(null);
  const name = useRef<HTMLElement | null>(null);
  /** A tap is moving focus itself: a control that leaves now hands nothing on. */
  const tapping = useRef(false);

  const [toCollapse, setToCollapse] = useState(0);
  const [toLine, setToLine] = useState(0);
  useEffect(() => {
    if (toCollapse === 0) return;
    tapping.current = false;
    (collapseButton.current ?? name.current)?.focus();
  }, [toCollapse]);
  useEffect(() => {
    if (toLine === 0) return;
    tapping.current = false;
    // The workout may have stopped being finished in the same moment: no line, so its name.
    (line.current ?? name.current)?.focus();
  }, [toLine]);

  /**
   * A control's ref: kept, and when it goes while focused and no tap moved focus, the open name
   * takes focus once the commit is done, if the node really left and focus fell to the page.
   */
  const watched = useCallback(
    (slot: { current: HTMLElement | null }) => (node: HTMLElement | null) => {
      if (!node) return;
      slot.current = node;
      return () => {
        if (slot.current === node) slot.current = null;
        if (tapping.current || document.activeElement !== node) return;
        queueMicrotask(() => {
          if (node.isConnected) return; // StrictMode's simulated detach: it never left
          const active = document.activeElement;
          if (active && active !== document.body) return; // focus is somewhere on purpose
          name.current?.focus();
        });
      };
    },
    [],
  );
  const lineRef = useCallback((node: HTMLButtonElement | null) => watched(line)(node), [watched]);
  const collapseRef = useCallback(
    (node: HTMLButtonElement | null) => watched(collapseButton)(node),
    [watched],
  );
  /** The open part's name span: the focus target when a control leaves by itself. */
  const nameRef = useCallback((node: HTMLElement | null) => {
    if (!node) return;
    name.current = node;
    return () => {
      if (name.current === node) name.current = null;
    };
  }, []);

  return {
    folded,
    bodyId,
    lineRef,
    collapseRef,
    nameRef,
    open: () => {
      tapping.current = true;
      setFolded(false);
      setToCollapse((n) => n + 1);
    },
    collapse: () => {
      tapping.current = true;
      setFolded(true);
      setToLine((n) => n + 1);
    },
  };
}
