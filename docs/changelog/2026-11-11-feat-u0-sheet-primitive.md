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

And the reopening itself took four attempts to get right, which is recorded here because each wrong
version looked finished. A mount-only check never fires on a **same-route** navigation, because Next
keeps the tree mounted; an always-on `popstate` listener never fires on a **cross-route** one,
because the component has been unmounted and there is nothing left listening. Both are present now —
and the entry records which **document** wrote it, so a reload does not resurrect a modal in a page
the user never opened it in.

## Six more defects a correctness review found after all of that

Every one was behaviour this PR's own contract documented and the code did not do, on a branch green
across `verify`, 1624 unit tests, 33/33 DB mutations and the Playwright smoke.

- 🔴 **The keyboard geometry never ran.** The hook read a ref that was still `null`: `Dialog.Portal`
  mounts Content in a second commit, and an effect keyed on a ref object never re-runs, because the
  object's identity does not change. So the custom properties were written on no real open, the
  sheet sized itself to the **layout** viewport — the exact defect the panel raised it to fix, with
  the pinned footer under the iOS keyboard — and the compact rule could never fire. A callback ref
  makes the node a dependency.
- 🔴 **A close by the consumer stranded its history entry.** The pop lived in Radix's `onOpenChange`,
  which only fires for closes Radix itself starts. Every real call site closes through its own state
  setter. The damage showed on the _next_ sheet: it stacked on the orphan, so dismissing it popped
  back onto the first and **reopened a sheet the user had already closed**.
- **The focus fallback was a no-op in the app.** `focus()` on a non-focusable element does nothing,
  and no `<main>` under `app/**` has a `tabIndex` — the unit test passed only because its harness
  added one. The component makes its own target focusable; the harness is bare so it cannot hide
  this again.
- **The capped dialog drifted right above 1040px.** `inset-0` leaves `right: 0` set, so a width plus
  `left: 1/2` plus `margin-inline: auto` is over-constrained with _auto_ margins, and CSS solves the
  margins inside the 50%→100% band instead of ignoring `right`.
- **The compact header lost its safe-area inset**, because `cn` runs `tailwind-merge` and a compact
  `py-2` conflicts with the base `pt-[max(1rem,env(safe-area-inset-top))]` and wins — tucking the
  title under the status bar on exactly the device compact exists for.
- **Two tests asserted nothing.** The outside-tap test rendered a dialog and checked it existed,
  which passed with the variant rule deleted or its branches swapped; and "a link, then back,
  restores the sheet" used a same-route link, so the sheet never closed and the assertion held with
  the whole restore mechanism removed. Both are replaced, and **every assertion added in this round
  was probed by reverting the behaviour it protects** — nine at the unit tier, five in a browser.

## Where it is proved

A cell on `/design/tokens`, because **U0 has no consumer until `PICK-1`** and its two riskiest
behaviours are browser-only. ⚠️ That host is temporary: `page.tsx` says the UI-3 PR deletes the
directory, so **UI-3 must not land before `PICK-1` PR 4** moves this coverage to the open picker —
recorded in the e2e and the roadmap.

The open-sheet scan measures overflow **on the dialog**, not the document: a `position: fixed` box
contributes nothing to `documentElement.scrollWidth`, and `RemoveScroll` sets `body{overflow:hidden}`
anyway — so the helper every other screen uses would pass a sheet that scrolls sideways.
