---
id: U0
pr: pending
---

## One sheet component, so the picker, the assignment sheet and every confirm stop each building a modal

`apps/web/components/ui/sheet.tsx` (CRUD-1 step 6a) — full screen on a phone, a capped dialog on a
tablet, pinned title and actions with only the middle scrolling. `PICK-1`, `ASSIGN-1` and `CLONE-1`
mount inside it, so the focus trap, the scroll lock, the keyboard geometry and the back gesture are
solved once (`spec` FE-13).

🔴 **Focus return is ours, and without it every close path lands on `<body>`.** Radix's
`DialogContentModal` composes `onCloseAutoFocus` with `preventDefault()` and focuses
`triggerRef.current` — `null` here, because this design has no `Dialog.Trigger` — and that
`preventDefault()` has already disabled `FocusScope`'s own fallback. Probed: deleting our handler
fails three tests. A detached trigger (the picker's card can be re-rendered away by the very pick
that closes the sheet) falls back to `main` rather than silently doing nothing.

## What a later edit will want to undo, and must not

- **The overlay is always rendered**, even invisible: `RemoveScroll` wraps the _overlay_, not the
  content, and it is what intercepts `touchmove` on iOS. Dropping the scrim from a full-screen sheet
  looks free and silently lets a thumb swipe scroll the form underneath.
- **Only custom properties are inline; the geometry is classes.** An inline `top`/`height` could
  never be overridden by the `min-[600px]:` variant.
- **`fixed inset-0` is the fallback floor.** `h-[var(--sheet-vvh,100dvh)]` is invalid at
  computed-value time on a browser without `dvh` — the hand-me-down phone a kid logs on — which
  resolves `height` to `auto`: the sheet becomes content-height, the body stops scrolling and the
  footer sits below the fold.

## Two BLOCKING defects the pre-implementation panel found in the written contract

- **There was no small-dialog variant**, though `spec:1121` requires one: _"the short confirms stay
  small dialogs"_. One sentence stretched to 100dvh with its buttons pinned 600px below is the wrong
  judgement, and rolling a second modal is what U0 exists to prevent.
- **Above 600px the dialog centred on the LAYOUT viewport.** On an iPad with the keyboard up, a
  600px-tall sheet spans past the visual viewport and the pinned Save sits **under the keyboard**.
  Both widths anchor to `--sheet-vvt` now.

Eleven more amendments are in [the contract](../plans/u0-sheet-primitive.md), which supersedes the
older bullets in `pick-1-movement-picker.md` — including that **criterion 46's mechanism is
`aria-hidden` via Radix's `hideOthers`, not `inert`**. Right in effect (a page-level `role="status"`
really is dropped while the sheet is open), wrong in the word, which would send the next reader
hunting for the wrong API.

## Three defects the probes and the e2e found in my own build

- **Dead code.** A `closingViaHistory` ref guarded a double history pop; removing it changed nothing,
  because the `popstate` path calls the consumer's `onOpenChange` directly and never reaches the
  wrapper that pops.
- **A test that could not fail.** The detached-trigger case used a ref that was never attached —
  `current === null`, which a plain `if (el)` catches just as well. It now attaches a node and
  removes it.
- 🔴 **`useId()` was the wrong key for history.** It regenerates on every mount, so after a
  navigation it could never match the entry it wrote. The id is caller-supplied and stable now
  (`'movement-picker'`, `'clear-day-confirm'`), which also stops two sheets colliding.

And the reopening itself was wrong twice: a mount-only check never fires, because Next keeps the tree
mounted across a same-route navigation. One always-on `popstate` listener syncs both ways — back onto
our entry reopens, back off it closes. Without it, returning from a link inside the sheet left the
parent on an unchanged-looking page needing a second back press, which on a phone reads as stuck.

## Where it is proved

A cell on `/design/tokens`, because **U0 has no consumer until `PICK-1`** and its two riskiest
behaviours are browser-only. ⚠️ That host is temporary: `page.tsx` says the UI-3 PR deletes the
directory, so **UI-3 must not land before `PICK-1` PR 4** moves this coverage to the open picker —
recorded in the e2e and the roadmap.

The open-sheet scan measures overflow **on the dialog**, not the document: a `position: fixed` box
contributes nothing to `documentElement.scrollWidth`, and `RemoveScroll` sets `body{overflow:hidden}`
anyway — so the helper every other screen uses would pass a sheet that scrolls sideways.
