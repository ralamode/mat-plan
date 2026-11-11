# U0 — the shared sheet primitive

## Where this sits

- **Pillar:** Product & Spec (the design system) with the component in `apps/web/components/ui/`.
- **Milestone:** [CRUD-1](../milestones/crud-1-fix-it-yourself.md), **step 6a**. `PICK-1` (6b) is its
  first real consumer; `ASSIGN-1` and every confirm follow.
- **What gates it:** nothing. It is the milestone's one free step.

**Roadmap alignment (2026-11-11):** checked against the private roadmap; nothing to add — a modal
primitive foreclosing no feature there. Public rows it serves: `PICK-1`, `ASSIGN-1`, `CLONE-1`.

## Why this document exists

🔴 **U0's design already lived in [`pick-1-movement-picker.md`](./pick-1-movement-picker.md)** (the
"Layout", "back gesture" and "Keyboard-up geometry" bullets), and that plan is merged. A
pre-implementation UX panel on 2026-11-11 found **two BLOCKING defects and eleven SHOULD/NIT items**
in it — including one that contradicts the spec and one that breaks focus return on _every_ close
path. AGENTS.md says to follow a merged plan and record deviations rather than edit it, so this file
is the amended contract. **PICK-1 and ASSIGN-1 should import from here**, not from the older bullets.

## The amendments

### A1 · Two variants, because the spec already asked for two (BLOCKING, lens 1)

`SheetProps` gains `variant?: 'sheet' | 'dialog'` (default `'sheet'`). The old contract was
full-screen-below-600px **unconditionally**, but `spec:1121` (M12) says _"The short confirms (clear a
day, merge) stay small dialogs (criterion 37)"_. Without a variant the first confirm either stretches
one sentence to 100dvh with its buttons pinned 600px below it, or rolls its own modal — which is the
thing `FE-13` created U0 to prevent.

`'dialog'` is the ≥600px capped-and-centred layout **at every width**; same header/footer/status/focus
contract, no keyboard anchoring needed (a confirm has no text field).

### A2 · The ≥600px dialog anchors to the VISUAL viewport too (BLOCKING, lens 2)

The old contract anchored to the visual viewport below 600px only, and centred on the **layout**
viewport above it. On an iPad (820px — the repo's mandated tablet width) with a ~400px keyboard up, a
600px-tall sheet centred on the layout viewport spans y≈290–890 while the visual viewport ends at
780: **the pinned Save/Cancel sits under the keyboard.** Criterion 37 asks for "the same pinned
actions" from 600px, and the plan's own premise says the layout viewport does not shrink for the
keyboard — it just never applied it at the second width. Both widths now anchor via `--sheet-vvt`.

### A3 · Geometry is CLASSES with an `inset-0` fallback, never inline `top`/`height` (lens 2)

Only the **custom properties** are written inline (on `Dialog.Content`, not `:root`, so a recalc
stays in the portal subtree). The geometry is Tailwind classes, or the `min-[600px]:` variant could
never override an inline declaration.

⚠️ **And the fallback must survive a browser without `dvh`.** `height: var(--sheet-vvh, 100dvh)` on
iOS ≤ 15.3 — the hand-me-down phone a kid logs on — is invalid at computed-value time, so `height`
falls back to `auto`: with `fixed inset-x-0 top-0` and no `bottom`, the sheet becomes content-height,
the body never scrolls and the footer is below the fold with the scroll lock fighting the user. Base
is therefore `fixed inset-0 flex flex-col` so `bottom: 0` is the floor, then `h-[var(--sheet-vvh,100dvh)]`
on top (an over-constrained fixed box ignores `bottom` when `height` resolves, so both paths pin the
footer).

### A4 · `Dialog.Overlay` is ALWAYS rendered — the scroll lock lives on it (lens 2)

`RemoveScroll` wraps `DialogOverlayImpl` (`react-dialog@1.3.1:112-130`), **not** `Content`. A
full-screen sheet has no visual need for a scrim and the obvious simplification is to drop the
overlay — which silently removes the iOS touch interception, so a thumb swipe that misses the list
scrolls the form behind the sheet. Transparent below 600px, a scrim above. Named in the docblock
because a future "simplify this" would delete it.

### A5 · Focus return is the SHEET's job, and it is broken without us (BLOCKING in effect, lens 2)

`DialogContentModal` composes `onCloseAutoFocus` with `preventDefault(); triggerRef.current?.focus()`
(`react-dialog@1.3.1:174-177`). This design uses no `Dialog.Trigger`, so `triggerRef.current` is
`null` — and the `preventDefault()` has already disabled `FocusScope`'s own
`previouslyFocusedElement ?? body` fallback. **Every close path therefore lands on `<body>` unless the
Sheet supplies its own handler.**

Ours: `preventDefault()`, then focus `returnFocusTo.current` **if `isConnected`** (the picker's
trigger card can be re-rendered away by the pick), else a `main` fallback; and `scrollIntoView({block:
'nearest'})`, because Radix focuses with `preventScroll: true` (`react-focus-scope@1.3.1:239-245`) and
after a full-screen sheet the target can be off-screen.

### A6 · `status` renders `Announcer`, and criterion 46's mechanism is `aria-hidden`, not `inert` (both lenses)

Criterion 46 is **right in effect, wrong in mechanism**. Radix uses neither a native `<dialog>` nor
`inert`: `hideOthers()` (`react-dialog@1.3.1:163-166` → `aria-hidden@1.2.6:38-90`) sets
`aria-hidden="true"` on every sibling up to `<body>`. So a page-level `role="status"` really is
dropped while the sheet is open — but the wording sends the next reader looking for `inert`.

The region renders `<Announcer message={status ?? ''} />` **inside** `Dialog.Content` — a fifth
hand-rolled `<p role="status">` is the exact duplication `announcer.tsx` was created to stop, and
`announcer.test.tsx` scans consumers for the `empty:hidden` trap a bespoke copy would escape.

⚠️ **Two consequences for consumers, in the docblock:** a page-level announcer set in the same tick
as `onOpenChange(false)` is still inside the `aria-hidden` subtree (the undo runs in cleanup, and
`Presence` delays unmount), so announce **after** `onCloseAutoFocus` or via the focus target's name.
And `status` takes a **settled** value — a match count after `useDeferredValue`, never the raw
per-keystroke one, or a polite region re-reads ten times while a kid types "pull-up".

### A7 · The footer wraps, and there is always a reachable way out (lens 2)

`Button` is `whitespace-nowrap` (`button.tsx:21`). At 200% zoom on a 390px phone the viewport is 195
CSS px, and a long action ("Use "Bulgarian split squat" as typed") overflows — **invisibly to
`expectNoHorizontalOverflow`**, because a `position: fixed` box contributes nothing to the document's
scrollable overflow and `RemoveScroll` sets `body{overflow:hidden}` anyway. The footer slot forces
`whitespace-normal h-auto min-h-11` on its buttons via `[&_[data-slot=button]]`.

And when `footer` is omitted the Sheet renders a **full-width Close** there. On a 6.1" phone held
one-handed the header's top-right icon is the hardest point to reach, and the back gesture is not
universal — an installed PWA in standalone mode has no edge-swipe. The header Close stays for
keyboard and screen-reader users.

### A8 · Compact mode, settled once (lens 1)

Two plans specified it differently: PICK-1 _"the header drops its padding"_; ASSIGN-1 _"the header
scrolls with the body instead of pinning"_ — and ASSIGN-1 anticipated U0 shipping without it. In
844×390 landscape with the keyboard up, `visualViewport.height` ≈ 190px: a pinned header (~100px) and
footer (~60px) leave **~30px of list**, so a kid typing "pu" sees no matches because there is no room
for them. ASSIGN-1's remedy is wrong for the picker, whose search box must stay at the visual-viewport
top.

**The rule:** under `data-compact` the title row collapses to one line, `headerExtra` (the search)
**stays pinned**, and the **footer** unpins and scrolls at the end of the body. ASSIGN-1 imports this
rather than patching it. Fires when `visualViewport.height < 480`, which also catches 200%-zoom
portrait (422 CSS px) — correct, and the zoom case is asserted through that path.

### A9 · Outside-tap dismissal depends on the variant (lens 1)

M12 chose full screen on phones so there is "no backdrop to mis-tap" — but from 600px a 520px dialog
on an 820px tablet shows ~300px of scrim, and Radix closes on `onPointerDownOutside` by default. A
parent holding the tablet one-handed loses six weekday toggles with no undo. `dismissOnOutsideTap`
defaults **`false` for `'sheet'`**, **`true` for `'dialog'`** (a confirm loses nothing). Escape, Close
and the back gesture close either.

### A10 · The back gesture gains a "closed by navigation" case (BLOCKING, lens 1)

The old contract closed with an unconditional `history.back()`. The assignment sheet is specified to
hold a **route link** ("Create a program", criterion 36): base → sheet pushes `S` → the link pushes
`R`. Closing with `back()` then pops `R` and bounces the parent back with the sheet shut — the tap
"did nothing"; skipping it strands `S` under `R`, so the first back press from the new page is a
**dead press**, which on a phone reads as the app being stuck.

**The rule:** `history.back()` only when the top entry is this sheet's. And on mount, if it is, the
sheet opens — so back from the destination **restores** it, the Android convention.

🔴 **Amended after implementation (2026-11-11), because the first version of this rule was wrong in
three ways that only running it could show.** The amendments are in the review-response log below;
the rule as it now stands:

1. **The pop is keyed on the open→closed TRANSITION, not on Radix's `onOpenChange`.** The handler
   only fires for closes Radix initiates (✕, Escape, outside tap). Every real consumer closes through
   its own state setter, and that path pushed an entry and never popped it — so the sheet _after_
   stacked on the orphan, and dismissing it popped back onto the first and reopened a sheet the user
   had already closed.
2. **BOTH restore directions exist, because they are different mechanisms and each is invisible to
   the other's test.** A same-route link keeps the component mounted → only a `popstate` listener can
   act. A cross-route link unmounts it → only a mount-time read of `history.state` can, and nothing
   is listening when the press happens. The first implementation had only the listener, leaving
   criterion 36's actual case with a dead press.
3. **An entry is only restorable by the document that wrote it.** `history.state` outlives the
   document, so the id alone resurrected the sheet after a refresh — a modal in a document the user
   never opened it in, emptied of what had been typed. The entry carries a per-document token;
   Next's client-side routing keeps a cross-route round trip inside one document, so A10's case still
   restores while a reload does not.

**`id` is therefore the history key and must be unique per INSTANCE, not per variant** — the demo
keyed it on the variant, so every palette's sheet shared a name and one back press matched them all.

⚠️ **The plan's "unverified on Next 16.4" is now verified by source:** `app-router.js` patches
`pushState` to copy `__NA` into foreign state (`:98-100`), and `handlePopState` reloads only when the
landed-on entry **lacks** `__NA` (`:61-72`) — which Next's own entry does not. The e2e remains the
proof, and asserts no `load` event fired rather than only that typed values survived.

### A11 · One open sheet at a time (lens 1)

Two mounted-open sheets would both close on one `popstate`, and a per-instance `closingViaHistory` ref
cannot help. No plan stacks sheets. A module counter throws in development on a second open; the
docblock states the constraint.

### A12 · The demo cell must carry the real palette (both lenses)

`Dialog.Portal` mounts Content under `document.body`, **outside** every `[data-tokens]` cell
(`inventory.tsx:60-62`). A "sheet per set" would render the control palette four times and audit the
candidate palettes **zero** times — the one thing that page exists to do. The Sheet forwards a
`data-tokens` prop onto Content and Overlay.

⚠️ **And the host has an end date:** `design/tokens/page.tsx` says the UI-3 PR that picks a set deletes
the directory. The e2e comment and the roadmap must say the back-gesture and geometry coverage moves
to PICK-1 PR 4 before UI-3 lands, or it vanishes with the harness.

### A13 · Smaller corrections (both lenses)

- `Dialog.Title` keeps `outline-none` but gains `focus-visible:ring-3 focus-visible:ring-ring` — it is
  the initial focus target, so on desktop it was the one moment a keyboard user had no indicator.
  `callout.tsx:52-55` records the house idiom.
- `w-[min(520px,calc(100vw-32px))]` → `w-[520px]`: the `calc` branch is dead at every width the
  variant applies to (`100vw - 32 ≥ 568`), and a dead branch reads as a decision.
- `aria-describedby={undefined}` is a no-op — Radix 1.3.1 already omits it without a `Description`
  (`react-dialog:262`). Harmless, but the docblock must not claim it suppresses a warning.

## Acceptance

- Both variants render, with the pinned header / scrolling body / pinned footer frame.
- Focus returns to `returnFocusTo` on **every** close path, including `popstate`; a detached target
  falls back rather than throwing; the test moves focus away first, so it cannot measure the end
  state twice (`lessons.md` → guards that pass while guarding nothing).
- The status region is an `Announcer` **inside** `[role=dialog]`.
- Opening locks body scroll; closing unlocks it.
- The open sheet passes axe, has ≥44px targets, and does not overflow **measured on the dialog
  itself** — the document-level helper cannot see a fixed box.
- The inventory cell's sheet carries its cell's `data-tokens`.

## Out of scope

- A sheet **stack**. One at a time (A11).
- `PICK-1`'s picker content, `ASSIGN-1`'s form — consumers, not this.
- Deleting `design/tokens`; UI-3 owns that, and A12 records the dependency.

## Review-response log — UX panel (2026-11-11, pre-implementation)

| #            | Lens            | Critique                                                                                                         | Verdict      | Resolution                                                                    |
| ------------ | --------------- | ---------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------- |
| L1-B1        | 1 (interaction) | **BLOCKING:** a Link inside the sheet orphans a history entry; the close path has no "closed by navigation" case | **accepted** | A10                                                                           |
| L1-B2        | 1               | **BLOCKING:** no small-dialog variant, though `spec:1121` requires one                                           | **accepted** | A1. Verified at the spec line.                                                |
| L2-B1        | 2 (a11y)        | **BLOCKING:** ≥600px centres on the layout viewport → the pinned footer is under the keyboard on a tablet        | **accepted** | A2                                                                            |
| L2-2         | 2               | Focus return is broken on **every** path without our own `onCloseAutoFocus`                                      | **accepted** | A5. Verified at `react-dialog@1.3.1:174-177`. The most consequential finding. |
| L2-1         | 2               | Criterion 46's mechanism is `aria-hidden`, not `inert`                                                           | **accepted** | A6, incl. the two consumer consequences.                                      |
| L1-S5 / L2-8 | both            | `status` would be a fifth hand-rolled `role="status"`                                                            | **accepted** | A6 — `Announcer`. Found independently by both lenses.                         |
| L1-S1 / L2-7 | both            | Radix's portal escapes the inventory cell's `data-tokens`                                                        | **accepted** | A12. Found independently by both lenses.                                      |
| L2-2b        | 2               | The scroll lock rides on `Overlay`; a full-screen sheet might skip it                                            | **accepted** | A4                                                                            |
| L2-3         | 2               | Inline `top`/`height` cannot be overridden; the no-`dvh` fallback collapses                                      | **accepted** | A3                                                                            |
| L2-5         | 2               | `whitespace-nowrap` buttons overflow at 200% zoom, invisibly to the helper                                       | **accepted** | A7                                                                            |
| L2-6         | 2               | The only guaranteed close is out of one-handed thumb reach                                                       | **accepted** | A7                                                                            |
| L1-S3        | 1               | Compact mode specified two ways by two plans                                                                     | **accepted** | A8                                                                            |
| L1-S4        | 1               | An outside tap above 600px discards unsaved toggles                                                              | **accepted** | A9                                                                            |
| L1-N1        | 1               | Two open sheets are unmodelled                                                                                   | **accepted** | A11                                                                           |
| L1-S2        | 1               | The only e2e host is scheduled for deletion by UI-3                                                              | **accepted** | A12                                                                           |
| L2-8b        | 2               | Title `outline-none` removes the indicator at the moment focus lands                                             | **accepted** | A13                                                                           |
| L2-also      | 2               | The `calc` width branch is dead; `aria-describedby={undefined}` is a no-op                                       | **accepted** | A13                                                                           |

Nothing was rejected: every critique either cited a spec line this contract contradicted, or a
behaviour verified in the pinned dependency source.

## Review-response log — correctness review (2026-11-11, post-implementation)

A single correctness lens, run on the pushed branch. **Every finding was real**, which is the part
worth recording: the implementation was green on `verify`, 1616 unit tests, 33/33 DB mutations and a
94-test `e2e:local` run, and all six P1s describe behaviour that was _documented in this plan and
inert in the code_. Two of them had tests that passed while asserting nothing.

| #   | Critique (short)                                                          | Verdict      | Resolution                                                                            |
| --- | ------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------- |
| R1  | The keyboard geometry never runs — the effect reads a null ref            | **accepted** | Callback ref via `useState`; A2's properties now written. Unit + e2e assertions added |
| R2  | A consumer-driven close strands its history entry                         | **accepted** | Pop keyed on the open→closed transition; A10 point 1                                  |
| R3  | Four demo cells share one history `id`                                    | **accepted** | `id` is per cell; A10's closing note                                                  |
| R4  | A10's mount-time restore was specified, not implemented                   | **accepted** | Implemented; A10 point 2                                                              |
| R5  | The `main` focus fallback is a no-op — no app `<main>` is focusable       | **accepted** | The component sets `tabIndex` itself; the harness is bare so it cannot hide it again  |
| R6  | The outside-tap test asserts nothing about A9                             | **accepted** | Both variants driven and compared; it failed with the branches swapped before passing |
| R7  | The dialog variant drifts right above 1040px (`mx-auto` + `inset-0`)      | **accepted** | `right-auto`, no `mx-auto`; e2e measures the centre at 1360px                         |
| R8  | `cn` **is** `tailwind-merge`, so compact's `py-2` drops the safe-area top | **accepted** | Re-stated `pt-…` under compact; a test watches for the dropped class                  |

**Two further defects were found by running the result, not by the review:**

- **A reload resurrected the sheet** (A10 point 3). The geometry e2e visits one URL twice; the second
  visit arrived with the sheet already open and the trigger unclickable behind it.
- **The "link, then back restores the sheet" e2e was vacuous.** The link was same-route, so Next
  preserved the component's state and the sheet never closed — the assertion held with the whole
  restore mechanism deleted. Same-route now pins the opposite property (landing back on its own entry
  must not spuriously close it) and a cross-route link carries the restore.

**Every assertion added in this round was probed by reverting the behaviour it protects** — nine at
the unit tier, five in the browser. One probe round reported a false GREEN because the probe script's
`git checkout` reverted to a commit that predated the fix it was mutating; the mutation was verified
to produce a diff before the result was believed. _(maintainer, 2026-11-11)_
