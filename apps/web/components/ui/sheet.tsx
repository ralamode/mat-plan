'use client';

import { Dialog } from 'radix-ui';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import { Announcer } from '@/components/ui/announcer';
import { Button } from '@/components/ui/button';
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
 */
function useVisualViewport(open: boolean, el: RefObject<HTMLElement | null>): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const vv = typeof window === 'undefined' ? null : window.visualViewport;
    const node = el.current;
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
  }, [open, el]);

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
function useBackGesture(
  open: boolean,
  id: string,
  onOpenChange: (open: boolean) => void,
): { closeWithoutHistory: () => void } {
  useEffect(() => {
    if (!open) return;
    if (window.history.state?.sheet !== id) window.history.pushState({ sheet: id }, '');

    // 🔴 **Calls the consumer's `onOpenChange` DIRECTLY, not the Sheet's wrapper** — and that is
    // what makes a `closingViaHistory` flag unnecessary. The entry has already been popped by the
    // browser, so the close must not pop again; routing through the wrapper would reach
    // `closeWithoutHistory` and do exactly that. ⚠️ An earlier draft carried such a flag; a probe
    // showed removing it changed nothing, because this line never reaches the wrapper. Dead guards read
    // as protection, so it is gone rather than kept "just in case".
    const onPop = () => onOpenChange(false);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [open, id, onOpenChange]);

  const closeWithoutHistory = useCallback(() => {
    // Only our own entry. A close caused by a route change leaves the stack alone — see the docblock.
    if (window.history.state?.sheet === id) window.history.back();
  }, [id]);

  return { closeWithoutHistory };
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
        Close
      </Button>
    </Dialog.Close>
  );
}

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  returnFocusTo,
  variant = 'sheet',
  headerExtra,
  footer,
  status,
  dataTokens,
}: SheetProps) {
  const id = useId();
  const contentRef = useRef<HTMLDivElement>(null);

  const compact = useVisualViewport(open, contentRef);
  const { closeWithoutHistory } = useBackGesture(open, id, onOpenChange);

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

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next) closeWithoutHistory();
      onOpenChange(next);
    },
    [closeWithoutHistory, onOpenChange],
  );

  const isDialog = variant === 'dialog';

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
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
          ref={contentRef}
          data-tokens={dataTokens}
          aria-describedby={undefined}
          // A confirm loses nothing to a mis-tap; a sheet full of unsaved toggles loses everything,
          // and there is no undo. M12 chose full screen on phones so there is "no backdrop to
          // mis-tap" — above 600px a 520px dialog on an 820px tablet shows ~300px of scrim, so the
          // same reasoning has to be applied by hand.
          onPointerDownOutside={(e) => {
            if (!isDialog) e.preventDefault();
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
            const fallback = document.querySelector('main');
            if (fallback instanceof HTMLElement) fallback.focus();
          }}
          className={cn(
            // `inset-0` is the fallback floor — note 4.
            'bg-background fixed inset-0 z-50 flex flex-col',
            'focus-visible:outline-none',
            isDialog
              ? 'top-[calc(var(--sheet-vvt,0px)+16px)] bottom-auto left-1/2 mx-auto h-auto max-h-[calc(var(--sheet-vvh,100dvh)-32px)] w-[520px] max-w-[calc(100vw-32px)] -translate-x-1/2 rounded-xl border'
              : cn(
                  'top-[var(--sheet-vvt,0px)] h-[var(--sheet-vvh,100dvh)]',
                  // From 600px the SHEET variant becomes the same capped dialog — and it anchors to
                  // the visual viewport here too, or the pinned footer lands under an iPad keyboard.
                  'min-[600px]:top-[calc(var(--sheet-vvt,0px)+16px)] min-[600px]:bottom-auto min-[600px]:left-1/2 min-[600px]:h-auto min-[600px]:max-h-[calc(var(--sheet-vvh,100dvh)-32px)] min-[600px]:w-[520px] min-[600px]:max-w-[calc(100vw-32px)] min-[600px]:-translate-x-1/2 min-[600px]:rounded-xl min-[600px]:border',
                ),
          )}
        >
          {/* 🔴 **`headerExtra` stays pinned under compact, the TITLE collapses.** In 844×390
              landscape with the keyboard up the visual viewport is ~190px, and a pinned header plus
              a pinned footer leave about 30px of list — a kid typing "pu" sees no matches because
              there is nowhere to put them. ASSIGN-1's draft unpinned the header instead, which is
              wrong for the picker: its search box must stay at the visual-viewport top while typing.
              See `u0-sheet-primitive.md` A8, which settles the rule both plans specified differently. */}
          <div
            className={cn(
              'flex shrink-0 flex-col border-b p-4 pt-[max(1rem,env(safe-area-inset-top))]',
              compact ? 'gap-2 py-2' : 'gap-3',
            )}
          >
            <div className="flex items-start gap-2">
              <Dialog.Title
                tabIndex={-1}
                // The initial focus target, so on desktop this was the one moment a keyboard user
                // had no indicator at all. `outline-none` + `focus-visible:ring-3` is this repo's
                // idiom (`callout.tsx`, `INPUT_CLASS`).
                className={cn(
                  'focus-visible:ring-ring min-w-0 flex-1 rounded font-semibold outline-none focus-visible:ring-3',
                  compact ? 'truncate text-base' : 'text-lg',
                )}
              >
                {title}
              </Dialog.Title>
              <Dialog.Close asChild>
                <Button type="button" variant="ghost" size="icon" aria-label="Close">
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
          <Announcer message={status ?? ''} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
