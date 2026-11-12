// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef, useRef, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Sheet, sheetStatusId } from './sheet';

afterEach(() => {
  // The geometry tests install a stub; leave it behind and an unrelated test inherits a viewport.
  Reflect.deleteProperty(window, 'visualViewport');
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
  consumerClose,
}: {
  variant?: 'sheet' | 'dialog';
  footer?: React.ReactNode;
  status?: string;
  withLink?: boolean;
  consumerClose?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // Bare `<main>` on purpose — see the detached-trigger test. No `<main>` in the app has a
  // `tabIndex`, so a harness that adds one hides a fallback that does nothing.
  return (
    <main>
      <button ref={trigger} type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <Sheet
        id="test-sheet"
        open={open}
        onOpenChange={setOpen}
        title="Pick a movement"
        returnFocusTo={trigger}
        variant={variant}
        footer={
          consumerClose ? (
            // 🔴 The shape EVERY real consumer uses: its own state setter, never Radix's
            // `onOpenChange`. `sheet-demo.tsx`'s own footer does exactly this.
            <button type="button" onClick={() => setOpen(false)}>
              Use as typed
            </button>
          ) : (
            footer
          )
        }
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
  // ⚠️ **Renamed at PICK-1 PR 3.** It was called "names itself from the title, which is also the
  // initial focus target" and asserted only the name — nothing in it looked at focus, and nothing in
  // `sheet.tsx` wired `onOpenAutoFocus`, so the second half of the name was a claim no test made and
  // no code kept. The name now says what it checks; the focus target has its own case below.
  it('names itself from the title', () => {
    render(<Harness />);
    openAndCapture();
    // Radix wires `aria-labelledby` to the Title; the name is what a screen reader announces on
    // open. No jest-dom in this repo, so the IDREF is resolved by hand — which also pins the
    // indirection rather than trusting a matcher to follow it.
    expect(dialog().getAttribute('aria-labelledby')).toBeTruthy();
    const titleId = dialog().getAttribute('aria-labelledby')!;
    expect(document.getElementById(titleId)?.textContent).toBe('Pick a movement');
  });

  it('focuses what `initialFocus` names, and the title when it names nothing', () => {
    // 🔴 What this CAN and CANNOT prove, stated so the next reader does not over-read it. It proves
    // the sheet calls `focus()` on the right element — the wiring PICK-1 PR 3 added, which did not
    // exist before. It does NOT prove where a real browser leaves focus: jsdom's focus handling
    // under Radix's `FocusScope` would not settle that (four probes disagreed), so the question
    // belongs to PR 4's e2e. A test that cannot answer a question should not be named for it.
    const focused: string[] = [];
    const Spy = () => {
      const target = useRef<HTMLButtonElement>(null);
      const trigger = useRef<HTMLButtonElement>(null);
      const [open, setOpen] = useState(false);
      return (
        <main>
          <button ref={trigger} type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Sheet
            id="spy"
            open={open}
            onOpenChange={setOpen}
            title="Pick a movement"
            returnFocusTo={trigger}
            initialFocus={target}
          >
            <button ref={target} type="button" onFocus={() => focused.push('named target')}>
              Named target
            </button>
          </Sheet>
        </main>
      );
    };
    render(<Spy />);
    act(() => {
      screen.getByRole('button', { name: 'Open' }).click();
    });
    expect(focused).toContain('named target');
  });

  it('gives the in-sheet status region the id `sheetStatusId` derives, so a control can describe from it', () => {
    render(<Harness status="3 matches" />);
    openAndCapture();
    const region = dialog().querySelector('[role="status"]');
    // The suffix is a value two files must agree on; the helper is the single source and this is the
    // contract test that pins it (AGENTS.md → constants).
    expect(region?.id).toBe(sheetStatusId('test-sheet'));
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
      // 🔴 **A BARE `<main>`, no `tabIndex`** — and that is the point of this harness. The first
      // version wrote `<main tabIndex={-1}>`, which no `<main>` in `apps/web/app/**` actually has,
      // so the test asserted focus landing on an element the real app leaves unfocusable. It passed
      // while the fallback was a silent no-op in production. Keep this bare: it is what proves the
      // component makes its own target focusable.
      return (
        <main>
          <Sheet
            id="detached"
            open={open}
            onOpenChange={setOpen}
            title="T"
            returnFocusTo={detached}
          >
            <p>Body</p>
          </Sheet>
        </main>
      );
    }
    render(<Detached />);
    await closeVia(() => fireEvent.click(headerClose()));
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.tagName).toBe('MAIN');
    expect((document.activeElement as HTMLElement).tabIndex).toBe(-1);
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

/**
 * 🔴 **This tier can prove the properties are WRITTEN; only the e2e can prove they are right.**
 * jsdom has no visual viewport, but a stub is enough for the defect that shipped: the effect read a
 * ref that was still `null`, because `Dialog.Portal` mounts Content in a second commit, so nothing
 * was ever written and the sheet fell back to the layout viewport — the exact thing A2 exists to
 * prevent. A stub cannot catch a wrong `calc()`; it catches the hook not running at all, which is
 * what happened. The real geometry is `e2e/a11y.spec.ts`.
 */
describe('Sheet — the keyboard geometry', () => {
  function withVisualViewport(height: number, offsetTop = 0) {
    const vv = Object.assign(new EventTarget(), { height, offsetTop });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    return vv;
  }

  it('writes the visual viewport onto the content element on open', () => {
    withVisualViewport(640, 12);
    render(<Harness />);
    openAndCapture();
    expect(dialog().style.getPropertyValue('--sheet-vvh')).toBe('640px');
    expect(dialog().style.getPropertyValue('--sheet-vvt')).toBe('12px');
  });

  it('re-writes them when the keyboard opens, and flips to the compact layout', () => {
    const vv = withVisualViewport(640);
    render(<Harness footer={<button type="button">Use as typed</button>} />);
    openAndCapture();
    // Pinned: the footer is a sibling of the scrolling body, not inside it.
    const body = dialog().querySelector('.overflow-y-auto')!;
    expect(body.contains(screen.getByRole('button', { name: 'Use as typed' }))).toBe(false);

    // 844×390 landscape with the keyboard up: ~190px of visual viewport. Two pinned bars would
    // leave about 30px of list, so under COMPACT_VIEWPORT_HEIGHT the footer scrolls with the body.
    act(() => {
      Object.assign(vv, { height: 190 });
      vv.dispatchEvent(new Event('resize'));
    });
    expect(dialog().style.getPropertyValue('--sheet-vvh')).toBe('190px');
    expect(body.contains(screen.getByRole('button', { name: 'Use as typed' }))).toBe(true);
  });

  /**
   * 🔴 **Asserts the CLASS, not the pixel, and that is deliberate.** jsdom resolves neither
   * `env(safe-area-inset-top)` nor a breakpoint, so the rendered inset is unobservable here. The
   * defect is not a wrong value: it is `cn` running `tailwind-merge` (`lib/utils.ts:5`) and
   * silently DROPPING the base `pt-…` because a compact `py-2` conflicts with it — leaving the
   * title under the status bar on a notched phone in landscape, the one device compact exists for.
   * A dropped class is visible in the class string, so that is what this watches.
   */
  it('keeps the safe-area top inset under compact, which tailwind-merge would drop', () => {
    const vv = withVisualViewport(190);
    render(<Harness />);
    openAndCapture();
    act(() => {
      vv.dispatchEvent(new Event('resize'));
    });
    const header = dialog().querySelector('.border-b');
    expect(header?.className).toContain('safe-area-inset-top');
  });
});

describe('Sheet — the back gesture', () => {
  it('pushes one history entry on open and pops it on a normal close', async () => {
    const push = vi.spyOn(window.history, 'pushState');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(<Harness />);
    openAndCapture();
    // The entry carries the sheet's id AND the token of the document that wrote it — see the
    // "previous document" test for what the second field is load-bearing for.
    expect(push).toHaveBeenCalledWith({ sheet: 'test-sheet', doc: expect.any(String) }, '');

    await closeVia(() => fireEvent.click(headerClose()));
    expect(back).toHaveBeenCalledTimes(1);
    push.mockRestore();
    back.mockRestore();
  });

  it('a popstate close does NOT pop a second entry', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(<Harness />);
    openAndCapture();
    // ⚠️ **The history state must actually MOVE first.** A bare `dispatchEvent` leaves
    // `window.history.state` reading `{sheet: …}`, so the component correctly concludes it is still
    // on its own entry and stays open — the test would then be asserting against a back press that
    // never happened. `replaceState` stands in for the browser having popped to another entry.
    await closeVia(() => {
      window.history.replaceState({ other: true }, '');
      window.dispatchEvent(new PopStateEvent('popstate', { state: { other: true } }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(back).not.toHaveBeenCalled();
    back.mockRestore();
  });

  /**
   * 🔴 **The path every real consumer takes, and the one that shipped broken.** The pop used to live
   * in the `Dialog.Root` handler, so it only ran for closes Radix initiated (✕, Escape, outside
   * tap). A consumer closing through its own `setOpen(false)` — the shape of every call site,
   * including this sheet's own demo footer — pushed an entry and never popped it. The next sheet
   * then stacked on the orphan, so dismissing THAT one popped back onto the first and reopened a
   * sheet the user had already closed.
   */
  it('pops the entry when the CONSUMER closes it, not only when Radix does', async () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    render(<Harness consumerClose />);
    openAndCapture();
    await closeVia(() => fireEvent.click(screen.getByRole('button', { name: 'Use as typed' })));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(back).toHaveBeenCalledTimes(1);
    back.mockRestore();
  });

  /**
   * 🔴 **The cross-route half of A10.** A link that leaves the route unmounts the component, so no
   * `popstate` listener survives to hear the back press: the page is rebuilt from `open = false`
   * while the entry still says the sheet was open. Reading history on mount is the only thing that
   * can restore it, and the first implementation did not have it — leaving ASSIGN-1's real case
   * (criterion 36) with a back press that did nothing.
   */
  it('restores itself on MOUNT when the landed-on entry is its own', () => {
    // 🔴 **The entry is written by the component, not hand-rolled.** It carries a per-document
    // token as well as the id, so a literal `{ sheet: 'test-sheet' }` would not match — and a test
    // that hand-rolls the shape stops testing the shape. Opening once and remounting is also the
    // faithful sequence: a cross-route link unmounts this component while the entry stays put.
    const { unmount } = render(<Harness />);
    openAndCapture();
    const entry = window.history.state;
    expect(entry?.sheet).toBe('test-sheet');

    unmount();
    window.history.replaceState(entry, ''); // the browser is still sitting on that entry
    render(<Harness />);
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('does NOT restore on mount for another sheet’s entry', () => {
    const { unmount } = render(<Harness />);
    openAndCapture();
    const entry = window.history.state;
    unmount();
    // Ids are the history keys; a stale entry from a different sheet must not open this one.
    window.history.replaceState({ ...entry, sheet: 'some-other-sheet' }, '');
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  /**
   * 🔴 **The reload, which the e2e found and the id alone could not distinguish.** `history.state`
   * outlives the document, so a restore keyed on the id reopened the sheet after a refresh — a
   * modal sitting there in a document the user never opened it in, emptied of whatever had been
   * typed. The entry records which document wrote it; a new document has a new token.
   */
  it('does NOT restore from an entry written by a previous document', () => {
    window.history.replaceState({ sheet: 'test-sheet', doc: 'a-previous-document' }, '');
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
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
  /**
   * ⚠️ **The first version of this test rendered the dialog and asserted it existed** — it passed
   * identically with A9 deleted, with `variant` ignored, and with the two branches swapped. The
   * asymmetry IS the behaviour, so both variants have to be driven and the two results compared.
   *
   * `pointerdown` on `document.body`: Radix's `DismissableLayer` listens on the document and treats
   * a target the layer does not contain as outside. The portal mounts *into* body, so body itself is
   * outside the content — which is what a tap on the scrim is.
   *
   * ⚠️ **Two timing details, both read from the pinned source rather than guessed.** The
   * `pointerdown` listener is attached inside a `setTimeout(0)`
   * (`react-dismissable-layer@1.2.1`), so a press fired straight after render hits nothing; and a
   * primary-button press can be deferred to the following `click`, so both are dispatched.
   */
  async function tapOutside(variant: 'sheet' | 'dialog') {
    const onOpenChange = vi.fn();
    render(
      <Sheet
        id={`tap-${variant}`}
        open
        onOpenChange={onOpenChange}
        title="Clear Tuesday?"
        returnFocusTo={createRef()}
        variant={variant}
      >
        <p>Every live entry is removed.</p>
      </Sheet>,
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await act(async () => {
      fireEvent.pointerDown(document.body);
      fireEvent.click(document.body);
      await new Promise((r) => setTimeout(r, 0));
    });
    return onOpenChange;
  }

  it('the dialog variant closes on an outside tap — a confirm loses nothing to a mis-tap', async () => {
    expect(await tapOutside('dialog')).toHaveBeenCalledWith(false);
  });

  it('the sheet variant REFUSES an outside tap — unsaved toggles with no undo', async () => {
    // M12 chose full screen on phones so there is "no backdrop to mis-tap"; above 600px the same
    // sheet shows ~300px of scrim on a tablet, so the intent has to be re-applied by hand.
    expect(await tapOutside('sheet')).not.toHaveBeenCalled();
  });
});
