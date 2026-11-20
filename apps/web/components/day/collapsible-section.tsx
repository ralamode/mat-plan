'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

import { FOCUS_TARGET_CLASS } from '@/lib/constants';

import { CollapseButton, CollapsedLine } from './collapsed-line';
import { useCollapse } from './use-collapse';

/** The section's busy count: each caller passing `true` adds one while it does. */
const SectionBusyContext = createContext<((delta: number) => void) | null>(null);

/**
 * Report that part of a section is busy (FAM-1 12c-iii §5): an editor open, a save in flight, an
 * alert shown. While anything is, "Collapse" is held, so nothing typed, pending or failed is ever
 * behind a line. Counted in an effect with a cleanup, so a caller that unmounts while busy takes its
 * count back off (StrictMode's second run nets to one). Outside a `CollapsibleSection` it does nothing.
 */
export function useSectionBusy(busy: boolean): void {
  const report = useContext(SectionBusyContext);
  useEffect(() => {
    if (!busy || !report) return;
    report(1);
    return () => report(-1);
  }, [busy, report]);
}

/**
 * Bodyweight's and Life's shell (FAM-1 12c-iii §5, D38): the `<section>`, its `<h2>` and its body,
 * folded to one line when the section was finished when the person arrived (`useCollapse`, as a
 * workout card). The rows are the server-rendered `children`, inside a body that is **hidden, never
 * unmounted**, so the section's live island keeps its region and any focus claim.
 *
 * - **`summary` null:** the section cannot fold on this visit (nothing logged, a read-only day, two
 *   weights to resolve). Today's markup: the `<h2>` carries `headingId`, and no "Collapse" slot.
 * - **`summary` set:** "Collapse" keeps its slot in the heading row, held (in place, unusable) while
 *   the section is not `finished` or is busy (`useSectionBusy`), so it never comes or goes under a
 *   thumb. Folded, the line reads "Bodyweight, 84.5 lb" (the summary in the count's place).
 *
 * The region is labelled by the name alone in every state ("Bodyweight"). The caller keys this on
 * athlete and day: the page does not remount on a change of day, and a new day is a new visit.
 */
export function CollapsibleSection({
  headingId,
  heading,
  summary,
  finished,
  children,
}: {
  headingId: string;
  heading: string;
  /** What the folded line shows after the name; `null` when the section cannot fold. */
  summary: string | null;
  /** Logged in full, on a day that can be logged. Read once, when the section mounts. */
  finished: boolean;
  children: ReactNode;
}) {
  const [busyCount, setBusyCount] = useState(0);
  const report = useCallback((delta: number) => setBusyCount((n) => n + delta), []);
  const done = finished && summary !== null;
  const held = busyCount > 0 || !done;
  const { folded, bodyId, lineRef, collapseRef, nameRef, open, collapse } = useCollapse(done, held);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      {/* One element in this place in every state, so the body beside it never remounts. */}
      {summary === null ? (
        <h2 id={headingId} className="text-lg font-medium">
          {heading}
        </h2>
      ) : folded ? (
        <h2 className="text-lg font-medium">
          <CollapsedLine
            name={heading}
            nameId={headingId}
            detail={null}
            count={summary}
            bodyId={bodyId}
            lineRef={lineRef}
            onOpen={open}
          />
        </h2>
      ) : (
        // 44px tall while "Collapse" has a slot, so its coming never moves the rows below.
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3">
          <h2 className="text-lg font-medium">
            {/* The focus target when the line or "Collapse" goes by itself (`useCollapse`). */}
            <span id={headingId} ref={nameRef} tabIndex={-1} className={FOCUS_TARGET_CLASS}>
              {heading}
            </span>
          </h2>
          <CollapseButton
            name={heading}
            bodyId={bodyId}
            collapseRef={collapseRef}
            onCollapse={collapse}
            held={held}
          />
        </div>
      )}
      <SectionBusyContext.Provider value={report}>
        <div id={bodyId} hidden={folded} className="flex flex-col gap-3">
          {children}
        </div>
      </SectionBusyContext.Provider>
    </section>
  );
}
