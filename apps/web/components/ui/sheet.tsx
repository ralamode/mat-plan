'use client';

import { Dialog } from 'radix-ui';
import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
import { MAIN_CONTENT_ID } from '@/lib/constants';
import { cn } from '@/lib/utils';

/**
 * The shared modal surface: a full-screen sheet on a phone, a capped dialog on a tablet (U0, CRUD-1
 * step 6a). `PICK-1`'s picker, `ASSIGN-1`'s assignment sheet and every confirm mount inside it, so
 * the focus trap, the scroll lock, the keyboard geometry and the back gesture are solved **once**
 * (spec `FE-13`).
 *
 * The contract and the reasoning behind every decision below are in
 * `docs/plans/u0-sheet-primitive.md`. ⚠️ **That file supersedes the older bullets in
 * `pick-1-movement-picker.md`** — a pre-implementation UX panel found two BLOCKING defects in them.
 *
 * ## Four things a future edit will be tempted to "simplify", and must not
 *
 * 1. 🔴 **`Dialog.Overlay` is ALWAYS rendered, even when invisible.** `RemoveScroll` wraps the
 *    OVERLAY, not the content (`react-dialog@1.3.1:112-130`), and it is what intercepts `touchmove`
 *    on iOS. A full-screen sheet has no visual need for a scrim, so deleting it looks free — and
 *    silently lets a thumb swipe that misses the list scroll the form underneath.
 * 2. 🔴 **We supply our own `onCloseAutoFocus`, because Radix's is disabled here.**
 *    `DialogContentModal` composes it with `preventDefault(); triggerRef.current?.focus()`
 *    (`react-dialog@1.3.1:174-177`). This design uses no `Dialog.Trigger`, so that ref is `null` —
 *    and the `preventDefault()` has already switched off `FocusScope`'s own
 *    `previouslyFocusedElement ?? body` fallback. Without the handler below, **every** close path
 *    (Close, Escape, a pick, the back gesture) drops focus on `<body>`.
 * 3. 🔴 **Only the CUSTOM PROPERTIES are inline; the geometry is classes.** An inline `top`/`height`
 *    could never be overridden by the `min-[600px]:` variant.
 * 4. 🔴 **`fixed inset-0` is the fallback floor.** `h-[var(--sheet-vvh,100dvh)]` is invalid at
 *    computed-value time on a browser without `dvh` (iOS ≤ 15.3 — the hand-me-down phone a kid logs
 *    on), which resolves `height` to `auto`. Without `bottom: 0` the sheet becomes content-height,
 *    the body stops scrolling and the footer sits below the fold.
 *
 * ## What consumers owe
 *
 * - **`status` takes a SETTLED value.** It renders a polite live region; passing a raw per-keystroke
 *   value makes a screen reader re-read it ten times while a kid types "pull-up". Debounce, or pass
 *   the value after `useDeferredValue` resolves.
 * - ⚠️ **Do not announce the result on a PAGE-level region in the same tick as closing.** Radix
 *   `aria-hidden`s every sibling of the portal while the sheet is open (`hideOthers`,
 *   `react-dialog@1.3.1:163-166`), and the undo runs in an effect cleanup that `Presence` delays for
 *   the exit. Announce after `onCloseAutoFocus`, or put the result in the focus target's name.
 * - **One sheet at a time** (see `openSheets` below).
 */
export type SheetVariant = 'sheet' | 'dialog';

export type SheetProps = {
  /**
   * A STABLE name for this sheet — `'movement-picker'`, `'clear-day-confirm'`.
   *
   * 🔴 **It is persisted in `history.state`, so `useId()` cannot do this job**, and the first draft
   * tried: a generated id is regenerated on every mount, so after a navigation it never matches the
   * entry it wrote and the sheet cannot come back. The e2e caught it. Being caller-supplied is also
   * better design — a consumer always has a natural name, and two sheets then cannot collide.
   */
  id: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The accessible name. Rendered as the `h2` that `aria-labelledby` points at. */
  title: string;
  children: ReactNode;
  /**
   * 🔴 **Required, and it is the only way focus comes back** — see note 2 above. Radix cannot do it
   * for us without a `Dialog.Trigger`, and this design deliberately has none (a consumer's trigger
   * is often a card or a row, not a button Radix can own).
   */
  returnFocusTo: RefObject<HTMLElement | null>;
  /**
   * `'sheet'` (default) — full screen below 600px, capped dialog above. `'dialog'` — capped and
   * centred at EVERY width, for the short confirms `spec:1121` (M12) keeps small.
   */
  variant?: SheetVariant;
  /** Pinned under the title. The picker's search box lives here; it stays pinned under compact. */
  headerExtra?: ReactNode;
  /** Pinned actions. When omitted, a full-width Close is rendered — see `FooterFallback`. */
  footer?: ReactNode;
  /** A polite live region INSIDE the sheet (criterion 46). Pass a settled value. */
  status?: string;
  /**
   * Where focus goes when the sheet OPENS. Defaults to the title.
   *
   * 🔴 **Added at PICK-1 PR 3, the first consumer that needs it — and the default is what makes this
   * file's own claim true.** The title has carried the comment *"the initial focus target"* since U0
   * shipped, and `sheet.test.tsx` had a case NAMED for it, but nothing wired `onOpenAutoFocus`:
   * Radix's `FocusScope` picks the first candidate it finds and the title is `tabIndex={-1}`, so the
   * title was never it. ⚠️ **Where focus landed instead is deliberately not recorded, because jsdom
   * would not settle it** — probes ruled out the search box, the header Close and `document.body`
   * without agreeing on an answer. That is a browser question and `PICK-1` PR 4's e2e owns it; what
   * this prop fixes is that the target is now the consumer's choice with a stated default.
   *
   * ⚠️ **A consumer must not point this at a text input on touch.** Focusing a field raises the
   * on-screen keyboard over the list the sheet exists to show (criterion 18). The picker passes its
   * search ref only when `matchMedia('(pointer: coarse)')` is false, and leaves the default on a
   * phone.
   */
  initialFocus?: RefObject<HTMLElement | null>;
  /**
   * The design-inventory page scopes a candidate palette with `[data-tokens]` on a wrapper, but
   * `Dialog.Portal` mounts under `document.body` — outside every cell. Forwarded so the portaled
   * surface carries the palette it is demonstrating.
   */
  dataTokens?: string;
};

/**
 * ⚠️ **One open sheet at a time, enforced in development.** Two mounted-open sheets would both close
 * on a single `popstate` and a per-instance guard cannot help, because the event is global. No
 * consumer stacks sheets (ASSIGN-1 switches mode *inside* one), so the constraint is cheaper than a
 * stack — but it has to fail loudly, or the second one ships and the back gesture goes strange.
 */
let openSheets = 0;

/**
 * The sheet chrome's own words — **the primitive owns them, because the primitive renders them.**
 *
 * `Close` was written out three times: the header's ✕ `aria-label`, `FooterFallback`'s button, and
 * the picker's own copy module. A consumer that passes its own `footer` still has to end it with
 * Close (panel 2 · 7), so it needs the same word this file uses, and "the same word" is a constant,
 * not a coincidence. ⚠️ `STRENGTH_COPY.close` in `lib/constants.ts` is a DIFFERENT control — an open
 * toggle whose own docblock explains why it says Close and not Cancel — and stays where it is.
 */
export const SHEET_COPY = { close: 'Close' } as const;

/**
 * The id of a sheet's in-sheet live region, derived from the sheet's own id so a consumer can point
 * `aria-describedby` at it without reaching into this file's markup (PICK-1 PR 3, criterion 46).
 *
 * Exported as a FUNCTION rather than left to each consumer to interpolate, for the usual reason: the
 * suffix is a value two files must agree on, and the second place to write `${id}-status` by hand is
 * where they stop agreeing (AGENTS.md → constants).
 */
export function sheetStatusId(sheetId: string): string {
  return `${sheetId}-status`;
}

/**
 * 🔴 **Which DOCUMENT wrote the history entry — the discriminator the restore needs, and the e2e
 * found it missing.** `history.state` survives a reload, so a mount-time restore keyed on the sheet
 * id alone reopens a sheet in a document the user never opened it in: refresh the page and a modal
 * is sitting there, emptied of whatever had been typed into it. The first version did exactly that,
 * and the e2e caught it by visiting the same URL twice — the second visit came back with the sheet
 * already open and the trigger unclickable behind it.
 *
 * A module constant is per document load by construction, which is precisely the line we want:
 * Next's App Router navigates client-side, so a cross-route link and the back press after it stay in
 * ONE document and the token matches (A10's case restores); a reload, or a return from a foreign
 * origin, is a NEW document with a new token, so the stale entry is correctly ignored.
 */
const DOCUMENT_TOKEN = Math.random().toString(36).slice(2);

/** Below this, `visualViewport.height` means there is no room for both pinned bars. */
const COMPACT_VIEWPORT_HEIGHT = 480;

/**
 * The footer's own layout, shared by the pinned and the compact (scrolled) placements so the two
 * cannot drift.
 *
 * ⚠️ **`[&_[data-slot=button]]` forces wrapping on whatever a consumer passes.** `Button` is
 * `whitespace-nowrap` (`button.tsx`), and at 200% zoom on a 390px phone — 195 CSS px — a long action
 * overflows. That overflow is INVISIBLE to `expectNoHorizontalOverflow`, which measures the
 * document: a `position: fixed` box contributes nothing to its scrollable width, and `RemoveScroll`
 * sets `body { overflow: hidden }` while open anyway. So it has to be prevented, not detected.
 */
const FOOTER_CLASS =
  'flex flex-col gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] ' +
  '[&_[data-slot=button]]:h-auto [&_[data-slot=button]]:min-h-11 ' +
  '[&_[data-slot=button]]:whitespace-normal';

/**
 * Writes the VISUAL viewport's height and top offset as custom properties while the sheet is open.
 *
 * ⚠️ **The layout viewport does not shrink when the iOS keyboard opens**, so a sheet sized to it ends
 * up with its pinned footer underneath the keyboard. Both widths use these — the ≥600px dialog needs
 * it just as much, which the first contract missed: on an iPad with a keyboard up, a dialog centred
 * on the layout viewport puts Save under the keys.
 *
 * Set on the CONTENT element rather than `:root`, so a style recalc on every scroll frame stays
 * inside the portal subtree.
 *
 * 🔴 **It takes the NODE, not a ref, and that is the whole bug it was shipped with.** A `useRef`
 * version read `ref.current === null` and never ran: `Dialog.Portal` renders `null` on its first
 * commit (`react-portal@1.2.1` mounts after a layout effect sets its container), so Content arrives
 * in a SECOND commit — by which time an effect keyed on `[open, ref]` has already fired and will not
 * fire again, because a ref object's identity never changes. The custom properties were therefore
 * never written on any real open, the sheet silently fell back to the LAYOUT viewport (exactly the
 * defect A2 exists to fix) and `compact` could never flip, making A8's branch dead code. A callback
 * ref through `useState` re-renders when the node arrives, so the node itself is a dependency.
 * `e2e/a11y.spec.ts` now asserts the property is non-empty, which is the only tier that can.
 */
function useVisualViewport(open: boolean, node: HTMLElement | null): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const vv = typeof window === 'undefined' ? null : window.visualViewport;
    if (!open || !vv || !node) return;

    const write = () => {
      node.style.setProperty('--sheet-vvh', `${vv.height}px`);
      node.style.setProperty('--sheet-vvt', `${vv.offsetTop}px`);
      // 🔴 **STATE, not just an attribute, because the compact rule MOVES the footer.** Under
      // compact the footer scrolls at the end of the body rather than pinning, which is a DOM
      // change no class can make. `setState` with the same boolean is a no-op in React, so this
      // does not re-render on every scroll frame — only when the flag actually flips.
      setCompact(vv.height < COMPACT_VIEWPORT_HEIGHT);
    };

    write();
    vv.addEventListener('resize', write);
    vv.addEventListener('scroll', write);
    return () => {
      vv.removeEventListener('resize', write);
      vv.removeEventListener('scroll', write);
    };
  }, [open, node]);

  // A closed sheet has no geometry; reset so the next open starts from the pinned layout.
  return open && compact;
}

/**
 * The back gesture: one history entry per open sheet, so the system back button closes it instead of
 * leaving the page (`pick-1-movement-picker.md`'s hazard — "the back gesture navigates away and loses
 * the form").
 *
 * ⚠️ **The "closed by navigation" case is why `back()` is conditional.** A sheet may hold a route
 * link (ASSIGN-1's "Create a program", criterion 36). Tapping it pushes a second entry on top of
 * ours; an unconditional `history.back()` would then pop THAT one and bounce the parent back with the
 * sheet shut, so the tap appears to do nothing. Checking the state first means a navigation-close
 * calls nothing — and because the entry survives, pressing back from the destination lands on it and
 * the sheet **reopens**, which is the Android convention.
 *
 * ⚠️ **Next integration, verified rather than assumed:** `app-router.js` patches `pushState` to copy
 * `__NA` into foreign state (`:98-100`), and its `popstate` handler full-reloads only when the
 * landed-on entry LACKS `__NA` (`:61-72`) — which Next's own entry does not. An earlier plan called
 * this "unverified on Next 16.4"; it is verified by source, and the e2e asserts no `load` fired.
 */
function useBackGesture(open: boolean, id: string, onOpenChange: (open: boolean) => void): void {
  /**
   * One definition of "the top entry is mine", so the four call sites below cannot drift apart.
   *
   * ⚠️ **`useCallback` so the four dependency arrays can be honest.** As a plain function it was
   * recreated every render, and `react-hooks/exhaustive-deps` warned four times that it was missing
   * from the arrays — the only `react-hooks` warnings in the app. The arrays were already *correct*
   * in substance (its one reactive input is `id`, which every array listed), so this is not a
   * behaviour change: memoised on `[id]`, the callback's identity changes exactly when `id` does,
   * which is exactly when those effects re-ran before. What it buys is that a future author who
   * gives this function a second input gets a warning instead of a silently stale closure.
   *
   * ⚠️ **The `[id]` dependency is correct by reasoning, NOT by test — probed, and the probe reported
   * GREEN.** Replacing it with `[]` leaves every case passing, because a sheet's `id` is a module
   * constant at each call site (`SHEET_ID = 'movement-picker'`) and nothing re-renders a mounted
   * sheet under a different one. Writing a test for that would pin a scenario no consumer produces.
   * Recorded here so nobody reads the dependency as covered: if a consumer ever makes `id` dynamic,
   * it needs a case, and this comment is the warning.
   */
  const isOurEntry = useCallback(() => {
    const state = window.history.state;
    return state?.sheet === id && state?.doc === DOCUMENT_TOKEN;
  }, [id]);

  /**
   * 🔴 **The cross-route restore, which the same-route listener below cannot do.** A link inside the
   * sheet that leaves the route unmounts this component, so there is no listener left to hear the
   * back press — the page is built fresh from `open = false` while `history.state` still says the
   * sheet was open. A10 specified this and the first implementation did not have it, leaving
   * ASSIGN-1's real case (criterion 36, "Create a program") with a dead back press.
   *
   * ⚠️ **Both halves are needed, which is why the first draft's single check kept being wrong in one
   * direction or the other.** Same-route navigation keeps the tree mounted → only the `popstate`
   * listener fires. Cross-route navigation remounts → only this runs. The one-shot flag keeps a
   * consumer-driven close from being undone: without it, closing would re-run this on the next
   * render and reopen the sheet.
   */
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if (!open && isOurEntry()) onOpenChange(true);
  }, [open, isOurEntry, onOpenChange]);

  /**
   * 🔴 **One ALWAYS-ON listener, syncing both directions** — and the first draft got this wrong in a
   * way only the e2e could show. It checked the history state on MOUNT, which never fires: Next
   * keeps the tree mounted across a same-route navigation, so returning from a link inside the sheet
   * ran no effect at all and the sheet stayed shut. The entry was there the whole time (verified:
   * `history.state` reads `{sheet: '…', __NA: true, …}` after the back) — nothing was listening.
   *
   * Back ONTO our entry reopens; back OFF it closes. The listener cannot be scoped to `open`, or the
   * reopening half can never run.
   */
  useEffect(() => {
    const sync = () => {
      const isOurs = isOurEntry();
      if (isOurs && !open) onOpenChange(true);
      else if (!isOurs && open) onOpenChange(false);
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [open, isOurEntry, onOpenChange]);

  useEffect(() => {
    if (!open) return;
    if (!isOurEntry()) window.history.pushState({ sheet: id, doc: DOCUMENT_TOKEN }, '');
  }, [open, id, isOurEntry]);

  /**
   * 🔴 **The pop is keyed on the open→closed TRANSITION, not on `onOpenChange`.** It lived in the
   * `Dialog.Root` handler, which meant it only ran for closes Radix itself initiated (the ✕, Escape,
   * an outside tap). Every real consumer closes the other way — `setOpen(false)` from its own
   * handler, the way this sheet's own footer button does — and that path pushed an entry and never
   * popped it. The visible damage was not the dead back press but the one after: the next sheet
   * pushed on top of the stranded entry, so closing THAT one popped back onto the first and
   * **reopened a sheet the user had already dismissed.**
   *
   * The `state.sheet === id` guard makes the two close paths that must NOT pop self-evident: a
   * `popstate` close has already left our entry, and a navigation close has a route entry on top.
   */
  const wasOpen = useRef(open);
  useEffect(() => {
    const closed = wasOpen.current && !open;
    wasOpen.current = open;
    if (closed && isOurEntry()) window.history.back();
  }, [open, isOurEntry]);
}

/**
 * When a consumer passes no `footer`, this is what it gets.
 *
 * ⚠️ **Not decoration.** On a full-screen sheet the header's top-right Close is the hardest point on
 * a 6.1" phone for a one-handed thumb, and the back gesture is not a universal fallback — an
 * installed PWA in standalone mode has no edge-swipe, and Android's back button reaches us through
 * `CloseWatcher` only on newer Chrome. Without this a kid has one small, far target.
 */
function FooterFallback() {
  return (
    <Dialog.Close asChild>
      <Button type="button" variant="outline" size="lg" className="w-full text-base">
        {SHEET_COPY.close}
      </Button>
    </Dialog.Close>
  );
}

export function Sheet({
  id,
  open,
  onOpenChange,
  title,
  children,
  returnFocusTo,
  variant = 'sheet',
  headerExtra,
  footer,
  status,
  initialFocus,
  dataTokens,
}: SheetProps) {
  // 🔴 A callback ref, NOT `useRef` — `useVisualViewport`'s docblock has the reason, and it is the
  // difference between the keyboard geometry running and silently doing nothing.
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  // The default `initialFocus` target. A plain `useRef` is right here: nothing measures the title, so
  // no effect needs to re-run when it mounts.
  const titleRef = useRef<HTMLHeadingElement>(null);

  const compact = useVisualViewport(open, content);
  useBackGesture(open, id, onOpenChange);

  useEffect(() => {
    if (!open) return;
    openSheets += 1;
    if (process.env.NODE_ENV !== 'production' && openSheets > 1) {
      throw new Error(
        'Two sheets are open at once. One `popstate` closes both and the history model stops ' +
          'holding — open one at a time (docs/plans/u0-sheet-primitive.md, A11).',
      );
    }
    return () => {
      openSheets -= 1;
    };
  }, [open]);

  const isDialog = variant === 'dialog';

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* ALWAYS rendered — it carries the scroll lock. See note 1 in the module docblock. */}
        <Dialog.Overlay
          data-tokens={dataTokens}
          className={cn(
            'fixed inset-0 z-50',
            isDialog ? 'bg-foreground/40' : 'min-[600px]:bg-foreground/40',
          )}
        />
        <Dialog.Content
          ref={setContent}
          data-tokens={dataTokens}
          aria-describedby={undefined}
          // A confirm loses nothing to a mis-tap; a sheet full of unsaved toggles loses everything,
          // and there is no undo. M12 chose full screen on phones so there is "no backdrop to
          // mis-tap" — above 600px a 520px dialog on an 820px tablet shows ~300px of scrim, so the
          // same reasoning has to be applied by hand.
          onPointerDownOutside={(e) => {
            if (!isDialog) e.preventDefault();
          }}
          onOpenAutoFocus={(e) => {
            // See `initialFocus`. Radix would otherwise pick the first tabbable candidate, which is
            // never the `tabIndex={-1}` title this file has always claimed is the target.
            e.preventDefault();
            (initialFocus?.current ?? titleRef.current)?.focus();
          }}
          onCloseAutoFocus={(e) => {
            // See note 2: Radix's own return is disabled for us, so this is the whole mechanism.
            e.preventDefault();
            const el = returnFocusTo.current;
            if (el?.isConnected) {
              el.focus();
              // Radix focuses with `preventScroll: true` (`react-focus-scope@1.3.1:239-245`), so
              // after a full-screen sheet on a long form the target can be off-screen.
              el.scrollIntoView?.({ block: 'nearest' });
              return;
            }
            // The trigger can be re-rendered away by the very action that closed the sheet (a pick
            // replaces the card it was on). `focus()` on a detached node is a SILENT no-op, which
            // would leave a screen-reader user at the top of the document.
            const fallback =
              document.getElementById(MAIN_CONTENT_ID) ?? document.querySelector('main');
            if (!(fallback instanceof HTMLElement)) return;
            // 🔴 **The `tabIndex` is set here when the landmark does not already carry one.**
            // `focus()` on an element that is not focusable is another silent no-op, and this used
            // to do nothing in the real app while its unit test passed, because the harness had
            // added one that no page had.
            //
            // ✅ **`UI-5` changed that: `AppShell` sets `id` and `tabIndex={-1}` on the one
            // `<main>` it declares**, so every authenticated app screen is now focusable by
            // construction and this branch is the fallback for the pages OUTSIDE the shell — the
            // root error boundary and `/design/tokens` (`OWN_MAIN` in
            // `app/pages-need-a-session.test.ts`). Hence `getElementById` first: the shell's id is
            // the precise target, and `querySelector('main')` stays as the fallback's fallback.
            if (!fallback.hasAttribute('tabindex')) fallback.tabIndex = -1;
            fallback.focus();
          }}
          className={cn(
            // `inset-0` is the fallback floor — note 4.
            'bg-background fixed inset-0 z-50 flex flex-col',
            'focus-visible:outline-none',
            // 🔴 **`right-auto` and no `mx-auto`.** `inset-0` leaves `right: 0` set, so a box with a
            // width, `left: 1/2` AND `margin-inline: auto` is over-constrained with AUTO margins —
            // CSS then solves the margins inside the 50%→100% band instead of ignoring `right`, so
            // the dialog drifted right by (viewport − 1040)/4: ~40px at 1200px, ~85px at 1360px.
            // Releasing `right` makes `left: 50%` + `-translate-x-1/2` the only centring mechanism.
            isDialog
              ? 'top-[calc(var(--sheet-vvt,0px)+16px)] right-auto bottom-auto left-1/2 h-auto max-h-[calc(var(--sheet-vvh,100dvh)-32px)] w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl border'
              : cn(
                  'top-[var(--sheet-vvt,0px)] h-[var(--sheet-vvh,100dvh)]',
                  // From 600px the SHEET variant becomes the same capped dialog — and it anchors to
                  // the visual viewport here too, or the pinned footer lands under an iPad keyboard.
                  'min-[600px]:top-[calc(var(--sheet-vvt,0px)+16px)] min-[600px]:right-auto min-[600px]:bottom-auto min-[600px]:left-1/2 min-[600px]:h-auto min-[600px]:max-h-[calc(var(--sheet-vvh,100dvh)-32px)] min-[600px]:w-[520px] min-[600px]:max-w-[calc(100vw-32px)] min-[600px]:-translate-x-1/2 min-[600px]:rounded-xl min-[600px]:border',
                ),
          )}
        >
          {/* 🔴 **`headerExtra` stays pinned under compact, the TITLE collapses.** In 844×390
              landscape with the keyboard up the visual viewport is ~190px, and a pinned header plus
              a pinned footer leave about 30px of list — a kid typing "pu" sees no matches because
              there is nowhere to put them. ASSIGN-1's draft unpinned the header instead, which is
              wrong for the picker: its search box must stay at the visual-viewport top while typing.
              See `u0-sheet-primitive.md` A8, which settles the rule both plans specified differently. */}
          {/* ⚠️ **`pt-…` is re-stated under compact, not left to the base class.** `cn` runs
              `tailwind-merge` (`lib/utils.ts:5`), so a compact `py-2` is a CONFLICT with the base
              `pt-[max(1rem,env(safe-area-inset-top))]` and wins — dropping the notch inset and
              tucking the title under the status bar on exactly the device the compact rule is for
              (a phone in landscape with the keyboard up). Tightening the top inset is intentional;
              losing it is not. */}
          <div
            className={cn(
              'flex shrink-0 flex-col border-b p-4 pt-[max(1rem,env(safe-area-inset-top))]',
              compact ? 'gap-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-2' : 'gap-3',
            )}
          >
            <div className="flex items-start gap-2">
              <Dialog.Title
                ref={titleRef}
                tabIndex={-1}
                // The initial focus target — and since PICK-1 PR 3 that is WIRED (`initialFocus`'s
                // default) rather than asserted. On desktop this is the one moment a keyboard user
                // would otherwise have no indicator at all, which is why it is focusable but not
                // tabbable. `outline-none` + `focus-visible:ring-3` is this repo's idiom
                // (`callout.tsx`, `INPUT_CLASS`).
                className={cn(
                  'focus-visible:ring-ring min-w-0 flex-1 rounded font-semibold outline-none focus-visible:ring-3',
                  compact ? 'truncate text-base' : 'text-lg',
                )}
              >
                {title}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" size="icon" aria-label={SHEET_COPY.close}>
                  <span aria-hidden="true">✕</span>
                </Button>
              </Dialog.Close>
            </div>
            {headerExtra}
          </div>

          {/* `min-h-0` is what lets this shrink inside the flex column; without it the body refuses
              to scroll and pushes the footer off instead. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">
            {children}
            {compact ? <div className={FOOTER_CLASS}>{footer ?? <FooterFallback />}</div> : null}
          </div>

          {/* ⚠️ `[&_[data-slot=button]]` forces wrapping on whatever a consumer passes: `Button` is
              `whitespace-nowrap`, and at 200% zoom on a 390px phone (195 CSS px) a long action
              overflows — INVISIBLY to the document-level overflow helper, because a `fixed` box
              contributes nothing to the document's scrollable width. */}
          {compact ? null : (
            <div className={cn('shrink-0 border-t', FOOTER_CLASS)}>
              {footer ?? <FooterFallback />}
            </div>
          )}

          {/* Criterion 46. INSIDE the content, because Radix `aria-hidden`s every sibling of the
              portal while this is open, so a page-level region is dropped by a screen reader.
              `Announcer` rather than a fifth hand-rolled `<p role="status">` — see its docblock. */}
          <Announcer id={sheetStatusId(id)} message={status ?? ''} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
