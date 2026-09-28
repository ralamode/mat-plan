# V1-23 — Today, focused

> Backlog: [plan.md](../plan.md) row V1-23. Delivers **V1-20's discoverability half** (D3).
> **Three PRs, sequenced below.** Panelled 2026-09-26 (3 engineering lenses + the 2 required UX
> lenses); the review-response log is at the bottom and the panels **changed the shape of this plan**.

## Goal

From Ray using the app on 2026-09-26: **on a phone, on the gym floor, you scroll past a screenful of
reference material to reach the first input, and you cannot tell which day it is without hunting.**

## What the panels changed

The plan as drafted made the session **longer**, not shorter. Tap count for one real Day B session,
counted against the live seed: **~53 before, ~55 after.** The four requested items saved scroll, not
taps, and one of them cost two.

The cause is a fact none of the four items touched. `PROGRAM_SEED` — the Youth Daily Program, the
only seeded block — is `open()` on **11 of its 13 prescriptions**: `sets: null, targetReps: null,
load: null` ([programming.ts:153-156](../../packages/shared/src/programming.ts)). And
`clampSetCount(null)` returns **1**
([strength-form-scaffold.ts:77-80](../../apps/web/app/p/[profileId]/strength-form-scaffold.ts)).

So every open movement scaffolds with **one** set row. Day B is 5 such movements × 2 "Add set" taps =
**~10 taps per session, ~20% of the total** — and the `filled/total` counter reads `0/1 → 1/1` while
two sets remain, lying about progress on the signal the code itself calls _"the only 'where am I'
signal across a 7-movement day"_ ([strength-form.tsx:484-487](../../apps/web/app/p/[profileId]/strength-form.tsx)).

**Ray's decision (2026-09-26): that becomes PR 1**, ahead of everything he originally asked for.

## The three PRs

| PR       | Scope                                                | Why this order                                                     |
| -------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| **PR 1** | Null-prescription set count → **3** rows, not 1      | ~10 taps back per session — more than the other three combined     |
| **PR 2** | Day badge on the date line + the routine-editor link | Two ~5-line header changes, one concern: orienting the header      |
| **PR 3** | The program card collapses after scaffolding         | The largest, and the one whose premise the panels partly falsified |
| ~~D4~~   | **CUT** — check-in accordion                         | Ships a data-loss bug; see below                                   |

---

## PR 1 — a null prescription scaffolds 3 set rows

`clampSetCount(sets: number | null)` returns `1` when `sets == null`. The `?? 1` is deliberate and
its comment is correct about what it was defending — _"never 0: a card with zero sets is the
vacuous-truth shape BUG-2(b) had to fix"_ — but `1` was chosen as a floor, not as a default for a
program that prescribes no sets at all. The YDP is that program.

**Change:** a **null** prescription scaffolds `DEFAULT_SCAFFOLD_SETS = 3`. An explicit `sets` value
is still honoured exactly as today, and the `< 1` floor stays `1`.

- The constant is named and shared, not a literal — it appears in the scaffold and in its test.
- **Not a prescribed value.** Three blank rows is form _structure_, the same category as the movement
  names V1-19 already scaffolds; `ScaffoldRow` still carries no `load` and no reps, and the blankness
  test that pins V1-19's invariant is unchanged and must stay green.
- The `0/3` counter now tells the truth for the common case.

Why 3 and not "remember last session": remembering is better and is a real follow-up, but it needs a
query and a decision about which session counts. 3 is one constant and ships now. Recorded as a
backlog note rather than smuggled in.

## PR 2 — orient the header

**D1 (revised).** Render the day on the existing date line — `Today · Fri, Sep 26 · Day B` — and
**leave the select where it is.** Ray chose this over moving the control, against his own first
instinct, once the panels showed what the move cost.

The select is a **zero-tap control**: `resolveDayRole(day: string): DayRole` is **total** (every
calendar day is A or B — [day-role-schedule.ts:41](../../apps/web/lib/programming/day-role-schedule.ts))
and it pre-selects the answer, so on the live program the correct value is always the one already
selected. Moving it would have cost ~78px above the fold for a control nobody touches, on a screen
whose complaint is that the first input is too far down.

Three further reasons, each from a different panel, recorded so this is not revisited:

1. **It would have weakened the GAP-1 P0-1 provenance contract, not preserved it.** What makes the
   assertion real is not visibility — it is **position**. The select sits after every movement card
   and immediately before the submit button; the athlete cannot reach "Log strength" without passing
   it. Pre-filled, in the header, encountered once before the work exists and never again before
   submit, it is _functionally the hidden input the note forbids, with decorative rendering._
2. **It collides with V1-15.** [v1-15-day-navigation.md](./v1-15-day-navigation.md) replaces that
   exact date line with `<DayNav>` (‹ date › + a 7-link week strip) and already flags the density
   risk. A day-**role** select under a day-**date** nav is two controls answering one question in two
   vocabularies.
3. **The label is a known-temporary hack.** `DAY_ROLE_LABELS` renders `Strength A/B/C` while the
   program runs Day A / Day B — `strength_a`/`strength_b` are a documented reuse — and the select
   also offers `Strength C` and defaults its first option to "Not a programmed day", on a program
   with **no rest days**. Promoting that to the most-read text on the page is the wrong move.

⚠️ The badge must read as **derivation, not assertion** — it is what the calendar says, not what a
human declared. Word it so the two are distinguishable (`Day B` as page metadata on the date line,
the select's label unchanged as the thing a human answers).

**D3.** One link to `/p/[profileId]/routine`. The editor already does what Ray asked: **Remove** per
item ([routine-editor.tsx:104-108](../../apps/web/app/p/[profileId]/routine/routine-editor.tsx)) over a
catalog with **one entry per individual check-in row**, and `resolveRoutine` drops anything not in
`order`. Only the link is missing.

- **Ray's decision: permanent removal is fine.** He asked to remove rows "temporarily"; the editor
  persists until they are re-added. Recorded because the plan should not claim to have answered a
  request it reinterpreted.
- **Label it for its audience** — `Edit {name}'s routine`, not `⚙ Edit routine`. A gear is the only
  icon on a page whose idiom is text arrows, and "gear" reads as _settings for this screen_.
- **Place it below the logged-entries list, not in the header.** Parents scroll; kids do not scroll
  past their own work. This also keeps the header from becoming a junk drawer and sidesteps the
  tap-target question m1 raises about two adjacent action links.
- **Match `min-h-11`**, like the export link. `a11y.spec.ts` excludes `<a>` from its tap-target scan
  (an SC 2.5.8 inline-text exception), so CI will **not** catch a 20px link here.
- `tech-debt.md:302` already carries this entry and says the editor is _"reachable by URL only …
  limits discoverability but is not a security control."_ **Edit that sentence; do not add a second
  entry.**
- ⚠️ **A kid can remove `strength` itself** — it is the first item in `ROUTINE_CATALOG` and has a
  Remove button like any other. The session then becomes unloggable with nothing on screen
  explaining why. Not fixed here; **recorded as a known sharp edge**, and the argument for the
  confirm + "Restore default routine" that Ray deferred.

## PR 3 — the program card collapses

**Use `<details>`/`<summary>`, not children-plumbing into the client form.** The drafted approach
(pass the RSC as `children` into `StrengthForm`) works, but it is a repo first, threads through the
`key={gen}` remount — which would **re-expand the card after every logged session**, re-creating the
complaint — and forces both feature guides open. `<details open>` keeps `ProgramReference` a Server
Component, crosses no boundary, ships zero client JS, and the user's collapse survives a log.

The recorded reason the movement cards are _"NOT a native `<details>`"_ is **`required`-specific** —
hidden-but-present required inputs deadlock the native submit. `ProgramReference` contains **no form
controls at all**, so that reason does not transfer. Say so, or the next reader infers the wrong rule.

Two things the panels caught that must be built in:

- **`aria-labelledby` must not dangle.** The card is
  `<section aria-labelledby="program-{role}-heading">` with the `<h3 id=…>` **inside** it. Collapse
  that away and the attribute points at a missing id — `aria-valid-attr-value`, which **axe will fail
  the build on**. The `<summary>` must carry the heading and keep the id resolvable.
- **The trigger must not submit.** If any collapse control ends up inside the `<form>`, a `<button>`
  with no `type` defaults to `type="submit"`. `<summary>` does not have this problem — one more
  reason for it.

**What is NOT preserved, deliberately:** for the live program there is nothing to preserve on 11 of
13 rows. The one real prescription (`3 sets × 10 per side` on hip thrusts) is a 2× difference on a
glute movement, and "tap the summary, scroll up, read, scroll back" is the wrong home for it.
**Follow-up (its own row): put `targetReps` on the movement card** — the collapsed summary's second
line, where `Skipped` already renders. `ScaffoldRow` may carry `targetReps` as **static text, never a
`defaultValue`**; **`load` stays out**, which is the invariant, not a preference.

## D4 — CUT

`CheckinForm` is one `<form>` where each field rides a hidden `clientId` input, and the non-accumulating
number inputs are **uncontrolled** — their only state is the DOM node. Radix `CollapsibleContent`
**unmounts** when closed. So: type a value, collapse the group to tidy, submit → the input is gone from
the DOM, `actions.ts:168` skips absent keys (`if (raw === null || … ) continue`), and the form reports
**"Check-ins logged."** The habit is silently not recorded, and on a streak surface that is the worst
available failure. Two panels found this independently.

It is fixable (`<details>`, or `forceMount` + CSS hiding — safe here because **no check-in control is
`required`**). It is cut anyway: shipped expanded-by-default it changes nothing on first render, its
collapsed state would not survive a page load, and **D3 lets the coach delete those rows permanently
instead of hiding them.** Ray said "maybe". Use the app for a week with PR 1-3 in hand and see whether
the complaint survives.

## Verification

- **`pnpm verify`** for all three. **Correction to the draft: the smoke does NOT cover a strength
  submit** — `apps/web/e2e/` has `a11y.spec.ts`, `export-csv.spec.ts`, `log-bodyweight.spec.ts`, and
  the strength form appears only in the a11y spec's tap-target/360px checks, never submitted. The
  draft claimed otherwise. PR 1 is covered by unit tests on `scaffoldMovements`; PR 3's states need
  the a11y spec extended.
- **PR 1:** unit — null → 3 rows; explicit `sets` unchanged; `< 1` still floors to 1; the V1-19
  blankness invariant still holds across the wider structure.
- **PR 3:** axe over the **collapsed** state (the dangling-`aria-labelledby` case); 360px overflow in
  both states; the summary does not submit.
- **Screenshots** at mobile/tablet/desktop for PR 2 and PR 3, published with `--pr`.
- **Feature guides:** `strength-logging.md` owns `strength-form.tsx` **and**
  `strength-form-scaffold.ts`, so **PR 1 and PR 3 are CI-forced**. `page.tsx` and `checkin-form.tsx`
  are owned by **nothing** — PR 2 is not gated, so its guide update is a judgment call, not a CI catch.

## Review-response log

**Panels: correctness/DRY · simplicity/scope · architecture/consistency · UX interaction/trust ·
UX a11y/adaptive.** Every finding below was verified against the code before being accepted.

| #   | Finding                                                                               | Response                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Tap count goes **up** (~53 → ~55); the real sink is `clampSetCount(null)=1`           | **ACCEPTED — reshaped the plan.** It is now PR 1, ahead of everything asked for.                                                                                    |
| 2   | D1 costs ~78px above the fold for a **zero-tap** control                              | **ACCEPTED** — Ray chose display-only. D1 is now one span.                                                                                                          |
| 3   | D1 weakens P0-1 provenance: position, not visibility, is what makes it real           | **ACCEPTED** — the strongest finding against my own draft. Recorded in PR 2.                                                                                        |
| 4   | D1 collides with V1-15's day nav; two vocabularies, one band                          | **ACCEPTED** — moot once D1 is display-only, but recorded so it is not redone.                                                                                      |
| 5   | D4 **silently drops check-ins** (Radix unmounts; uncontrolled inputs)                 | **ACCEPTED — D4 cut.** Bug recorded so a future attempt starts from it.                                                                                             |
| 6   | D2's premise false: 11/13 YDP prescriptions are `open()`, nothing to keep             | **ACCEPTED** — PR 3 collapses fully; `targetReps`-on-card is a separate row.                                                                                        |
| 7   | `<details>` beats children-plumbing; the anti-`<details>` note is `required`-specific | **ACCEPTED** — and the note's real scope is now stated in the plan.                                                                                                 |
| 8   | D2's collapse state would die on `key={gen}`, re-expanding every log                  | **ACCEPTED** — `<details>` removes the coupling entirely.                                                                                                           |
| 9   | Collapsing breaks `aria-labelledby`; axe fails the build                              | **ACCEPTED** — a build-breaking bug the draft called "unchanged".                                                                                                   |
| 10  | A `<button>` in a form defaults to `type="submit"`                                    | **ACCEPTED** — `<summary>` avoids it; noted for any button trigger.                                                                                                 |
| 11  | D3's risk claim wrong: removals are not visible and order is unrecoverable            | **ACCEPTED** — link relocated + relabelled; confirm/restore deferred by Ray, recorded as a sharp edge.                                                              |
| 12  | A kid can remove `strength` and make the session unloggable                           | **ACCEPTED** as a recorded consequence of shipping D3, not fixed here.                                                                                              |
| 13  | `tech-debt.md:302` already holds this entry; D3 makes its text false                  | **ACCEPTED** — edit, do not duplicate.                                                                                                                              |
| 14  | Draft's verification claimed the e2e smoke covers the strength submit                 | **ACCEPTED — the claim was false.** Corrected above.                                                                                                                |
| 15  | Draft's D2 code sketch used `rows` (logged entries), not `programDay`                 | **ACCEPTED** — sketch removed with the approach.                                                                                                                    |
| 16  | React 19 auto-resets function-action forms; `form.reset()` reaches `form=`            | **MOOT** — D1 no longer moves the control. Recorded: the draft's reasoning about `key={gen}` was wrong about the mechanism even where its conclusion held.          |
| 17  | `id="strength-session-form"` is an un-hoisted cross-file literal                      | **MOOT** with D1 revised; would have been a real constants-rule violation.                                                                                          |
| 18  | Extract the select to an owned file or the P0-1 contract leaves the CI gate           | **MOOT** — the contract stays in `strength-form.tsx`, still gated.                                                                                                  |
| 19  | Ship D3 alone if only one session is available                                        | **PARTLY REJECTED.** D3 is nearly free, but PR 1 buys ~10 taps a session and D3 buys none. PR 1 goes first.                                                         |
| 20  | Split the bundle; four concerns in one PR busts the 400-line target                   | **ACCEPTED** — three PRs. PR 2 keeps two ~5-line header edits together as one concern.                                                                              |
| 21  | `page.tsx` (399 lines) is accreting page logic; extract `today-header.tsx`            | **REJECTED for now.** Real, but V1-15 and V1-22 both land in that file; the extraction should be theirs to shape, not a drive-by here. Recorded as a note on V1-15. |
| 22  | `← All profiles` is a 20px target and always has been                                 | **NOTED, out of scope** — pre-existing, excluded from the CI scan by the `<a>` rule.                                                                                |
| 23  | Line refs in the draft had drifted (`:145` vs `:122`, `:103` vs `:18`)                | **ACCEPTED** — the substantive claims held; refs corrected or removed.                                                                                              |
