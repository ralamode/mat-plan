// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Sheet } from './sheet';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '');
});

/**
 * COMPONENT TIER for U0, the shared sheet. The contract is `docs/plans/u0-sheet-primitive.md`.
 *
 * ⚠️ **What jsdom cannot do, so nothing here pretends to:** it has no `visualViewport` (the compact
 * rule and the keyboard geometry), no layout (the 360px and 200%-zoom widths), and no real back
 * gesture from a browser chrome. Those are `e2e/a11y.spec.ts`'s open-sheet test. What this file
 * pins is the part that is pure DOM contract — and the part most likely to rot, because Radix
 * supplies none of it: **focus return**.
 */
function Harness({
  variant,
  footer,
  status,
  withLink,
}: {
  variant?: 'sheet' | 'dialog';
  footer?: React.ReactNode;
  status?: string;
  withLink?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <main tabIndex={-1}>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Sheet
        open={open}
        onOpenChange={setOpen}
        title="Pick a movement"
        returnFocusTo={trigger}
        variant={variant}
        footer={footer}
        status={status}
      >
        <p>Body</p>
        {withLink ? <a href="/elsewhere">Create a program</a> : null}
      </Sheet>
    </main>
  );
}

const dialog = () => screen.getByRole('dialog');

/**
 * ⚠️ **The trigger is captured BEFORE opening, and closing is flushed.** Two jsdom facts bite here,
 * and both are really the component working:
 *
 *  - once the sheet is open, Radix `aria-hidden`s every sibling of the portal, so `getByRole` can no
 *    longer see the trigger at all — the very mechanism criterion 46 relies on;
 *  - Radix returns focus from `FocusScope`'s cleanup behind a `setTimeout(0)`
 *    (`react-focus-scope@1.3.1:106-118`), so an assertion made synchronously after the click reads
 *    the state before the handler ran.
 */
function openAndCapture() {
  const trigger = screen.getByRole('button', { name: 'Open' });
  fireEvent.click(trigger);
  return trigger;
}

async function closeVia(fn: () => void) {
  await act(async () => {
    fn();
    await Promise.resolve();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

/** Both Closes are named "Close"; the header icon is first in the DOM. */
const headerClose = () => screen.getAllByRole('button', { name: /close/i })[0]!;

describe('Sheet — the frame', () => {
  it('names itself from the title, which is also the initial focus target', () => {
    render(<Harness />);
    openAndCapture();
    // Radix wires `aria-labelledby` to the Title; the name is what a screen reader announces on
    // open. No jest-dom in this repo, so the IDREF is resolved by hand — which also pins the
    // indirection rather than trusting a matcher to follow it.
    expect(dialog().getAttribute('aria-labelledby')).toBeTruthy();
    const titleId = dialog().getAttribute('aria-labelledby')!;
    expect(document.getElementById(titleId)?.textContent).toBe('Pick a movement');
  });

  it('renders an overlay even for the full-screen sheet — the scroll lock lives on it', () => {
    render(<Harness />);
    openAndCapture();
    // 🔴 `RemoveScroll` wraps the OVERLAY, not the content. A future "a full-screen sheet needs no
    // scrim" edit would silently remove the iOS touch interception.
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(true);
  });

  it('unlocks scroll when it closes', async () => {
    render(<Harness />);
    openAndCapture();
    await closeVia(() => fireEvent.click(headerClose()));
    expect(document.body.hasAttribute('data-scroll-locked')).toBe(false);
  });

  it('renders a Close in the FOOTER when the consumer passes none', () => {
    render(<Harness />);
    openAndCapture();
    // Not decoration: on a phone the header's top-right icon is the hardest one-handed target, and
    // an installed PWA has no edge-swipe to fall back on.
    expect(screen.getAllByRole('button', { name: /close/i }).length).toBeGreaterThanOrEqual(2);
  });

  it('uses the consumer’s footer when given one, and still keeps the header Close', () => {
    render(<Harness footer={<button type="button">Use as typed</button>} />);
    openAndCapture();
    expect(screen.getByRole('button', { name: 'Use as typed' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /close/i }).length).toBe(1);
  });
});

describe('Sheet — focus return, which Radix does NOT do for us', () => {
  /**
   * 🔴 `DialogContentModal` composes `onCloseAutoFocus` with `preventDefault()` and focuses
   * `triggerRef.current` — `null` here, because this design uses no `Dialog.Trigger`. The
   * `preventDefault()` also disables FocusScope's own fallback. Without the Sheet's handler, EVERY
   * close path lands on `<body>`.
   */
  it('returns focus to the trigger on Close', async () => {
    render(<Harness />);
    const trigger = openAndCapture();
    // Start state asserted, or this measures the end state twice (lessons.md → guards that pass
    // while guarding nothing).
    expect(document.activeElement).not.toBe(trigger);
    await closeVia(() => fireEvent.click(headerClose()));
    expect(document.activeElement).toBe(trigger);
  });

  it('returns focus on Escape too', async () => {
    render(<Harness />);
    const trigger = openAndCapture();
    expect(document.activeElement).not.toBe(trigger);
    await closeVia(() => fireEvent.keyDown(dialog(), { key: 'Escape' }));
    expect(document.activeElement).toBe(trigger);
  });

  it('falls back to main rather than <body> when the trigger has been detached', async () => {
    // The picker's trigger card can be re-rendered away by the very pick that closes the sheet.
    // `focus()` on a detached node is a SILENT no-op, which would leave a screen-reader user at the
    // top of the document with no indication anything happened.
    // ⚠️ **Genuinely DETACHED, not merely null.** A `createRef()` that was never attached has
    // `current === null`, which an `if (el)` check catches just as well — so a test built on one
    // would pass with the `isConnected` guard deleted, and prove nothing. This node is created,
    // attached, then removed, which is what the picker does to its own trigger card.
    const stale = document.createElement('button');
    document.body.appendChild(stale);
    const detached = { current: stale } as React.RefObject<HTMLElement | null>;
    stale.remove();
    expect(stale.isConnected).toBe(false);

    function Detached() {
      const [open, setOpen] = useState(true);
      return (
        <main tabIndex={-1}>
          <Sheet open={open} onOpenChange={setOpen} title="T" returnFocusTo={detached}>
            <p>Body</p>
          </Sheet>
        </main>
      );
    }
    render(<Detached />);
    await closeVia(() => fireEvent.click(headerClose()));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.tagName).toBe('MAIN');
  });
});

describe('Sheet — criterion 46, the live region', () => {
  it('puts the status region INSIDE the dialog', () => {
    render(<Harness status="3 matches" />);
    openAndCapture();
    // Radix `aria-hidden`s every sibling of the portal, so a page-level region is dropped by a
    // screen reader while this is open. Being a descendant is the whole point.
    const region = screen.getByRole('status');
    expect(dialog().contains(region)).toBe(true);
    expect(region.textContent).toBe('3 matches');
  });

  it('mounts the region with empty text, so the first message is announced', () => {
    render(<Harness />);
    openAndCapture();
    // A live region that mounts together with its text is never announced — `announcer.tsx` rule 1.
    expect(screen.getByRole('status').textContent).toBe('');
  });
});

describe('Sheet — the back gesture', () => {
  it('pushes one history entry on open and pops it on a normal close', async () => {
    const push = vi.spyOn(window.history, 'pushState');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(<Harness />);
    openAndCapture();
    expect(push).toHaveBeenCalledWith({ sheet: expect.any(String) }, '');

    await closeVia(() => fireEvent.click(headerClose()));
    expect(back).toHaveBeenCalledTimes(1);
    push.mockRestore();
    back.mockRestore();
  });

  it('a popstate close does NOT pop a second entry', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(<Harness />);
    openAndCapture();
    // The entry was popped FOR us. Calling `back()` again would leave the page.
    await closeVia(() => window.dispatchEvent(new PopStateEvent('popstate', { state: null })));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
  });

  /**
   * 🔴 The navigation case. A sheet may hold a route link (ASSIGN-1's "Create a program",
   * criterion 36): the link pushes a SECOND entry on top of ours, so an unconditional
   * `history.back()` would pop THAT one and bounce the parent back with the sheet shut.
   */
  it('does not pop when the top entry is no longer this sheet’s', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(<Harness withLink />);
    openAndCapture();
    // Stand in for the router pushing a route entry over ours.
    window.history.pushState({ some: 'route' }, '');
    await closeVia(() => fireEvent.click(headerClose()));
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
  });
});

describe('Sheet — the dialog variant', () => {
  it('closes on an outside tap, which the sheet variant refuses', () => {
    const onDialog = vi.fn();
    render(
      <Sheet
        open
        onOpenChange={onDialog}
        title="Clear Tuesday?"
        returnFocusTo={createRef()}
        variant="dialog"
      >
        <p>Every live entry is removed.</p>
      </Sheet>,
    );
    // A confirm loses nothing to a mis-tap, so dismissal is allowed; a sheet of unsaved toggles
    // loses everything with no undo, so it is not.
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
