- **2026-10-06** — **The log form stops offering shapes the server refuses (V1-30b-i).** A time or
  distance card still showed the **BW** and **band** chips — which the server's refine 6 then refused,
  leaving a kid with a rejection they could not act on — still labelled its number field "weight", and
  still blocked `6.25 ft` in the browser. Four changes, each derived from the one unit so none can
  disagree with it: the chips are **unmounted** on a non-mass card (not CSS-hidden — a hidden checkbox
  left in the tab order is the "form appears dead" trap); a **Measuring** change clears every set's load
  modes **in the same state update** that changes the unit, which is where the guarantee lives, while
  lb → kg clears nothing because it never crosses a dimension; the field word is per dimension
  (`weight` / `time` / `length`), with mass output **byte-identical** so every existing locator holds;
  and `QUANTITY_DECIMALS = 3` feeds both the field's `step` and the server's format check, so the
  browser refuses exactly where the server would — replacing a `step="0.5"` sized for barbell plates
  that blocked `6.25 ft`, `1.25 min` and `61.25 kg`. The V1-30 **U5 mis-tap** case also gets its
  advisory line, now directly under the Measuring row rather than ~350px below it, carried by
  `aria-describedby` on the control that caused it; V1-26's note moves to the same mechanism, because
  both were mount-with-text `role="status"` regions, which may never be announced at all. The clear can
  legitimately **un-touch** a set — a BW-only scaffolded card switched to Time becomes droppable and
  the summary loses a movement — so every such shape is pinned by a case-table test, and filtering at
  serialization instead was tried and **rejected** (state would count the set as touched while the wire
  carried a blank the server refuses). Nine new tests, all six planned mutations killed.
