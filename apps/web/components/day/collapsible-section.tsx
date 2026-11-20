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

/** What the folded line shows after the name: `detail` wraps (Life's summary), `count` never does. */
export type SectionLine = { detail: string | null; count: string | null };

type Props = {
  headingId: string;
  heading: string;
  /** What the folded line shows; `null` when the section cannot fold on this visit. */
  line: SectionLine | null;
  /** Logged in full, on a day that can be logged. Read once, when the section mounts. */
  finished: boolean;
  children: ReactNode;
};

/**
 * Bodyweight's and Life's shell (FAM-1 12c-iii §5, D38): the `<section>`, its `<h2>` and its body,
 * folded to one line when the section was finished when the person arrived (`useCollapse`, as a
 * workout card). The rows are the server-rendered `children`, inside a body that is **hidden, never
 * unmounted**, so the section's live island keeps its region and any focus claim.
 *
 * **Keyed on athlete and day here, so no caller can forget it:** the page does not remount on a
 * change of day (`page.tsx`), and a new day or athlete is a new visit (§1).
 *
 * - **`line` null:** the section cannot fold on this visit (nothing logged, a read-only day, two
 *   weights to resolve). Today's heading, with no "Collapse" slot.
 * - **`line` set:** "Collapse" has a slot in a 44px heading row, held (in place, unusable) while the
 *   section is not `finished` or is busy (`useSectionBusy`). Folded, the line reads "Bodyweight,
 *   84.5 lb" or "Life, Wrestling practice 90 min".
 *
 * ⚠️ **So the slot comes and goes during a visit**, unlike a workout's: it comes with the section's
 * first log (the heading row grows to 44px, about 16px) and goes with a clear. Accepted (lane C,
 * 2026-11-20): at that same moment the form becomes the receipt, or the receipt the form, which
 * changes the section's height anyway; a slot reserved on every unlogged section would cost each a
 * taller heading on every visit for nothing.
 */
export function CollapsibleSection({
  profileId,
  day,
  ...props
}: Props & { profileId: string; day: string }) {
  return <Section key={`fold-${profileId}/${day}`} {...props} />;
}

function Section({ headingId, heading, line, finished, children }: Props) {
  const [busyCount, setBusyCount] = useState(0);
  const report = useCallback((delta: number) => setBusyCount((n) => n + delta), []);
  const done = finished && line !== null;
  const held = busyCount > 0 || !done;
  const { folded, bodyId, lineRef, collapseRef, nameRef, open, collapse } = useCollapse(done, held);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      {/* One element in this place in every state, so the body beside it never remounts. */}
      {line === null ? (
        // The focus target too, so a control that leaves never drops focus to the page.
        <h2
          id={headingId}
          ref={nameRef}
          tabIndex={-1}
          className={`text-lg font-medium ${FOCUS_TARGET_CLASS}`}
        >
          {heading}
        </h2>
      ) : folded ? (
        <h2 className="text-lg font-medium">
          <CollapsedLine
            name={heading}
            nameId={headingId}
            detail={line.detail}
            count={line.count}
            bodyId={bodyId}
            lineRef={lineRef}
            onOpen={open}
          />
        </h2>
      ) : (
        // 44px tall while the section can fold: the slot came with its first log (see above).
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
