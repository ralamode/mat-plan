---
id: PROF-1 a-1u
pr: pending
---

## Adding an athlete is now something you do in the app

`a-1w` shipped the write path with no way to reach it. This is the screen: a **+ Add athlete** tile
at the bottom of the athlete list, and a form at `/p/new` that asks two questions and opens the new
athlete's day page. The README section that explained how to edit `seed.ts` and re-seed is gone,
because that is no longer how an athlete arrives.

## The two questions, and why they are in that order

**The kind fieldset sits ABOVE the name.** `enterKeyHint="go"` means the return key submits a text
field, so with the radios below it a parent's first experience of this screen would be the refusal
"Choose Child or Adult." — they would type a name, reach for Go, and be told about a control they had
not scrolled to. Putting the one-way choice first also means it is read before the thing under the
thumb.

🔴 **Nothing is pre-checked, and that is the whole point.** `kind` is set once and the app cannot
change it afterwards _(maintainer, 2026-11-07, on a unanimous UX BLOCKING: one radio served both "I
picked wrong" and "they turned 18", and the form could not tell those apart)_. A default radio is
invisible state with no undo — a parent who never looked at the fieldset would create an athlete of
whichever kind we guessed. So the form refuses instead, and says the consequence **before** the
choice: _"Set once — the app can't change it afterwards. If it's wrong, archive them in Household
settings and add them again."_ A one-way door explained underneath the control is explained too late,
and a warning with no named exit is just an alarm.

Each option carries its own consequence rather than a paragraph under both — "Child — on the
household's program", "Adult — logs their own training" — because someone choosing between two things
needs the difference at the point of choice. ⚠️ The program clause renders **only when the household
actually programs something**: a first-run household has no program, and claiming one would be false.
`a-g`'s day page already branches on the same boolean.

## The geometry is the a11y

**44px belongs on the LABEL, not the radio.** `INPUT_CLASS` on an `<input type="radio">` yields a
44px-tall, 13px-wide bordered dot; the tappable thing is the label, so the label carries the height —
the theme toggle's precedent. And the options use `flex-wrap` + `min-w-32`, never two fixed grid
tracks: at 200% text two tracks need ≈384px against 328px usable at 360px, and the page would scroll
sideways. Wrapping stacks them.

🔴 **`aria-invalid` lives on the fieldset as a `radiogroup`, never on the radios.** A single radio is
not individually valid or invalid — the group is, and `aria-invalid` is not a supported attribute of
`role="radio"`. The first draft of the form put it on both the input and the label; lint caught it.

The add tile's dashed border uses an **opaque** token (4.73:1 light, 7.63:1 dark), not the
prototype's 28% alpha (1.93:1 / 2.35:1, under SC 1.4.11's 3:1 floor for non-text contrast). ⚠️
**Nothing else measures that** — axe has no non-text-contrast rule — so `token-sets.test.ts` pins it
by reading the border token **out of the component's own source**, which means switching the tile back
to a translucent border fails the test by name. A pin that re-typed `muted-foreground` would have
stayed green through exactly that change.

## The empty state loses its detour

`PickerEmptyState` ended in a GitHub button — "How athletes get added — on GitHub" — because adding
an athlete was not in the app. It is now, so that button pointed away from the button that works. The
component keeps its two explanatory paragraphs and gains no control of its own: the add tile is the
list's final `<li>` in **both** resolved states, so the one control a first-run household needs is in
the place it will be forever rather than moving once they have an athlete. The test that pinned the
GitHub link is **inverted, not deleted** — a future author who adds a second control to that screen
fails it and has to argue for it.

`PICKER_EMPTY_COPY.notYet`, `setupCta` and `setupAnchor` are deleted with it. ⚠️ `SIGN_IN_COPY.notYet`
is a different key with the same name and stays; two comments that cited the picker's are re-pointed.

## Reuse, at the ninth copy

`PAGE_SHELL_CLASS` is extracted because this PR would have written the shell class a **ninth** time.
It was verbatim in eight places; the landing page appends `md:justify-center` to the base rather than
forking it.

## What is NOT here

- **No birthdate field.** `ID-1` owns `profiles.birthdate`, because the age policy derived from it is
  what makes it meaningful, and writing it needs a notice and inventory update. `docs/plan.md` already
  records the rule. An add form is exactly where a birthdate would have been convenient to slip in,
  so the privacy inventory now says it was considered and declined.
- **No 200% text gate.** Nothing in the suite zooms, so the radio geometry at 200% is a hand check.
  Overflow at **360px** _is_ covered, for the add screen and for a max-length name originating in the
  app — the case `a-r` explicitly handed to this chunk.
