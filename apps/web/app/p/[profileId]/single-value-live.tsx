'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import { useSectionBusy } from '@/components/day/collapsible-section';
import { Announcer } from '@/components/ui/announcer';

import { TickedCopy } from './log-tick';

/**
 * Where focus goes after a single value's action settles (V1-24 3b-bw, plan W6). `change` is the
 * logged row's Change; `field` is the row's input, the create form's or the open editor's.
 */
export type FocusTarget = 'change' | 'field';

export type Report = {
  message: string;
  /**
   * How the message shows. `sr`: spoken only (a log or a save, where the row itself shows the new
   * value). `status`: spoken AND shown, muted (a clear, which leaves nothing on screen to show it).
   * `alert`: a refusal whose form has unmounted (`dayTaken`, `notFound`, stale, read-only), shown in
   * `text-destructive` as `role="alert"`.
   */
  tone: 'sr' | 'status' | 'alert';
  /** Targets in order of preference: the first of them to be mounted takes focus. */
  focus: readonly FocusTarget[];
  /**
   * An alert whose copy names the ✓ ("Tap ✓ to try again."): the button's accessible name, read in
   * place of the glyph (`TickedCopy`, V1-24 3b-life-b), so a screen reader never says "check mark".
   */
  tickLabel?: string;
  /**
   * Keep this alert when the row's Change opens (V1-24 3b-life-b): an "already logged" refusal names
   * the number that was not saved, and the editor opens on the other phone's. Cancel and the next
   * report still drop it.
   */
  keepOnOpen?: boolean;
};

type Live = {
  report: (r: Report) => void;
  /** A focus claim with no message: Cancel hands focus back to Change. */
  claimFocus: (targets: readonly FocusTarget[]) => void;
  /** A ref callback that registers an element as `target`, and takes a pending claim for it. */
  focusRef: (target: FocusTarget) => (node: HTMLElement | null) => (() => void) | void;
  /** Drop a shown refusal: the editor was cancelled, so it no longer describes the screen. */
  dismiss: () => void;
  /** Drop a shown refusal as Change opens, unless it was reported `keepOnOpen`. */
  dismissOnOpen: () => void;
  /**
   * The status line's id while it is SHOWN (a clear), for the field to list in `aria-describedby` so
   * arriving focus reads it. `undefined` otherwise: a spoken-only "Bodyweight logged" left in the
   * region must not describe a field that a different event emptied.
   */
  statusId: string | undefined;
  /**
   * The shown refusal's id, for the field to list in `aria-describedby` (V1-24 3b-life-b): when focus
   * lands on a field the refusal left mounted, the alert is read with it. `undefined` with no alert.
   */
  alertId: string | undefined;
};

const LiveContext = createContext<Live | null>(null);

/**
 * The island's API. ⚠️ It THROWS outside a `SingleValueLive`: a row mounted without one would lose
 * its announcement and focus hand-off silently, which no test would notice.
 */
export function useSingleValueLive(): Live {
  const live = useContext(LiveContext);
  if (!live) throw new Error('useSingleValueLive: render the row inside <SingleValueLive>');
  return live;
}

/**
 * The live region and the focus hand-off for ONE single-value section (bodyweight; practice from
 * 3b-life), wrapping the section's rows so it is mounted in BOTH states (V1-24 3b-bw, plan W6).
 *
 * ## Why one island owns this, and not the form or the editor
 *
 * The thing to announce is almost always about a row that has just UNMOUNTED: a log replaces the form
 * with the logged row, a clear replaces the row with the form, a refused log whose day was already
 * taken replaces the form with the other phone's row. A region inside the form would be gone before
 * it spoke. So the form and the editor call `report` from their action wrapper, with the RESULT (never
 * a value appearing, which another phone's save also produces), and this renders it.
 *
 * ## Focus is a single-use claim, not "focus on the next commit"
 *
 * The wrapper's `report` runs after an `await`, outside the action's transition, so its state update
 * can commit BEFORE the revalidated tree mounts the target, or after it. Either order works: the
 * target is focused at once if it is mounted, else the claim waits for the target's ref callback. A
 * claim is used once, and it expires on the next `report`, on a day change (the island is keyed on the
 * day), or as soon as the person moves focus or taps themselves: a late mount must never steal focus
 * from someone who has moved on.
 *
 * ⚠️ The one region renders with a VISIBLE class when the message is a status, and never hides while
 * empty (`components/ui/announcer.tsx`, rule 3). A refusal is a separate `role="alert"` element, which
 * the announcer's rule 2 asks for.
 */
export function SingleValueLive({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<{ text: string; visible: boolean; n: number }>({
    text: '',
    visible: false,
    n: 0,
  });
  const [alert, setAlert] = useState<{
    text: string;
    n: number;
    tickLabel?: string;
    keepOnOpen?: boolean;
  } | null>(null);
  // A shown alert holds the section's "Collapse": a refusal never sits behind a line (12c-iii §5).
  useSectionBusy(alert !== null);
  const statusId = useId();
  const alertId = useId();
  /** The island's own subtree (`display: contents`, so it adds no box to the section's layout). */
  const root = useRef<HTMLDivElement>(null);
  const claim = useRef<readonly FocusTarget[] | null>(null);
  /**
   * The node a claim was last handed to. If it unmounts while it still has focus (the result was
   * reported while the old row was still on screen, and the revalidated tree then replaced it), the
   * claim is re-armed for whatever mounts next: a field focused a moment before it vanished is focus
   * dropped to `<body>`.
   */
  const handoff = useRef<{ node: HTMLElement; targets: readonly FocusTarget[] } | null>(null);
  const mounted = useRef(new Map<FocusTarget, HTMLElement>());

  const focusNode = useCallback((node: HTMLElement, targets: readonly FocusTarget[]) => {
    claim.current = null;
    node.focus(); // its `focusin` runs the expiry below, synchronously, so set the handoff after
    handoff.current = { node, targets };
  }, []);

  const take = useCallback(
    (targets: readonly FocusTarget[]) => {
      claim.current = null;
      handoff.current = null;
      // A result that arrives after the person has moved on (tapped a Life button, a nav link) must
      // not pull them back: only take focus if it is nowhere, or still inside this island.
      const active = document.activeElement;
      if (active && active !== document.body && !root.current?.contains(active)) return;
      for (const t of targets) {
        const node = mounted.current.get(t);
        if (node) return focusNode(node, targets);
      }
      claim.current = targets;
    },
    [focusNode],
  );

  const report = useCallback(
    ({ message, tone, focus, tickLabel, keepOnOpen }: Report) => {
      if (tone === 'alert') {
        // A refusal does not replace a visible "cleared" line: the clear still happened.
        setAlert((a) => ({ text: message, n: (a?.n ?? 0) + 1, tickLabel, keepOnOpen }));
      } else {
        setAlert(null);
        // A new key per report, so a repeated message is a new text node and is read again.
        setStatus((s) => ({ text: message, visible: tone === 'status', n: s.n + 1 }));
      }
      take(focus);
    },
    [take],
  );

  const focusRef = useCallback(
    (target: FocusTarget) => (node: HTMLElement | null) => {
      if (!node) return;
      mounted.current.set(target, node);
      const pending = claim.current;
      // `take` already used any target mounted when the claim was made, so the first to mount now
      // is the right one.
      if (pending && pending.includes(target)) focusNode(node, pending);
      return () => {
        if (mounted.current.get(target) === node) mounted.current.delete(target);
        if (handoff.current?.node === node && document.activeElement === node) {
          claim.current = handoff.current.targets;
          handoff.current = null;
        }
      };
    },
    [focusNode],
  );

  // The person's own focus or tap ends any claim still waiting. Our own `node.focus()` clears the
  // claim BEFORE it focuses, so this never cancels the hand-off it is about to make.
  useEffect(() => {
    const expire = () => {
      claim.current = null;
      handoff.current = null;
    };
    document.addEventListener('focusin', expire);
    document.addEventListener('pointerdown', expire);
    return () => {
      document.removeEventListener('focusin', expire);
      document.removeEventListener('pointerdown', expire);
    };
  }, []);

  const dismiss = useCallback(() => setAlert(null), []);
  const dismissOnOpen = useCallback(() => setAlert((a) => (a?.keepOnOpen ? a : null)), []);
  const live: Live = {
    report,
    claimFocus: take,
    focusRef,
    dismiss,
    dismissOnOpen,
    statusId: status.visible ? statusId : undefined,
    alertId: alert ? alertId : undefined,
  };

  return (
    <LiveContext.Provider value={live}>
      <div ref={root} className="contents">
        {children}
        <Announcer
          id={statusId}
          message={status.text}
          messageKey={status.n}
          className={status.visible ? 'text-muted-foreground text-sm' : 'sr-only'}
        />
        {/* Keyed, so a repeated refusal is a new element and is read again. Rendered only while there
            is one: an `alert` is read when it is inserted, and an empty second alert region would
            sit beside the form's own field-error alert. */}
        {alert ? (
          <p key={alert.n} id={alertId} role="alert" className="text-destructive text-sm">
            {alert.tickLabel ? (
              <TickedCopy text={alert.text} buttonLabel={alert.tickLabel} />
            ) : (
              alert.text
            )}
          </p>
        ) : null}
      </div>
    </LiveContext.Provider>
  );
}
