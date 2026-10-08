# V1-24 PR 3a — the strength section shows what you logged

> Backlog: [plan.md](../plan.md) → V1-24 (PR 3a) and V1-25 §3 ("a logged form should look complete").
> Parent plan: [v1-24-form-is-the-day.md](./v1-24-form-is-the-day.md) (§The one model, Decisions 5, 9,
> 16, B5). Branch (3a-i): `feat/v1-24-3a-strength-receipt`.
> **Order:** Ray, 2026-10-02, answering the parent plan's Open question 0: 3a before 2 (check-ins).
> 3b (demoting the separate log) still waits for 2.

## Goal

Today, after **Log strength**, the strength section snaps back to an **empty** form (the body remounts
on `${day}:${gen}`, `strength-form.tsx:133`). It says nothing, and the work appears only in the
"Logged entries" list at the bottom of the page. Ray (V1-25 §3): _"Once we've clicked Log Strength
maybe we should change the treatment to make it appear complete."_

After 3a, the strength section **is the day's strength record**:

- every logged session renders as a **receipt** in the section, on every day;
- the save is announced with its value, and focus lands on the new receipt;
- a set the app can correct carries **Change on every day**; a set it can't states a **true** reason
  and the recovery route;
- logging more is a deliberate second action that shows what's already saved, not a blank form that
  looks like nothing happened.

No checkmark: values stay editable (parent §The one model).

## The split (scope and architecture lenses; ~500 lines and three concerns as one PR)

| PR                                           | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Why separate                                                                                                                            |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **3a-i** (~300)                              | **The per-set amend becomes the 1b amend.** `EditableSet`: "Edit" → "Change" (`changeLabel`), `AMEND_COPY` for all three strings, a stacked editor that fits 280px deterministically, focus return, its own `role="status"`, `aria-describedby` on the error, the unit in the input's name. Plus `lockedReason(set)` next to `isEditableSet`, and its copy. **Ships on today's list**, which it improves on its own. Also moves `MovementLine` unchanged into `movement-line.tsx`. | It has been the weakest amend since V1-9, and 3a-ii's receipt makes it the primary surface. Small, and reviewable with one UX reviewer. |
| **3a-ii** (~400–450, overage accepted below) | **The section receipt.** A client island owns the save, the collapse and the announcement; receipts render in the section; "Log more strength" with "already saved today"; the list's copy goes read-only when the section is present.                                                                                                                                                                                                                                             | The design change Ray asked for. Full UX panel (done; this plan).                                                                       |
| **3a-iii** (next; a dependency, not "later") | **"Fill in today's movements" leaves out what's logged**, visibly, matched by movement slug server-side.                                                                                                                                                                                                                                                                                                                                                                           | Different layer (programming DTO, `page.tsx` narrowing), its own semantics; filed as a row.                                             |

This plan is the contract for **3a-i and 3a-ii**. 3a-iii gets a short plan of its own (its decisions,
from this panel, are recorded at the end so they are not lost).

## What exists, verified (fact sheet, re-checked at `43bd66a` after V1-27 merged)

- **Several sessions per day are legal.** Each movement is an `entries` row with `sessionId`.
- **The page already has the data**: `todayRows(entries)` → `SessionRow` (`activity-totals.ts`), rendered
  in "Logged entries" by `page.tsx` + `MovementLine`. `MovementLine` renders **every** flat entry kind
  (bodyweight, check-ins, life, session-less strength), not just strength.
- **`EditableSet`** says "Edit", hard-codes "Save"/"Cancel", drops focus on settle, has no status
  region, no `aria-describedby`, and no unit in the input's accessible name. It renders on **every**
  day, by design: `editStrengthSetAction` has no day bound (`actions.ts` docblock; parent Decision 5).
- **`SavedAnnouncer`** announces only on a none→value transition, on purpose (parent B5: a value→value
  change "is not evidence of THIS user's save"). It cannot announce a second session.
- **No shared editable primitive exists** (parent Decision 16 deferred it to PR 2). 3a extracts none:
  PR 2 extracts from `BodyweightAmend` + `EditableSet` + the check-in amend, and 3a-i's Locked line
  becomes the primitive's Locked state.
- **No `Locked` state exists in code.** A non-editable set renders as text with no reason.
- **`isEditableSet` locks more than "BW, band and timed"**: any non-`done` status, `reps === null`,
  more than one quantity, and any non-mass primary (lengths too).

## 3a-i — the per-set amend (implement first)

**I1 — Copy and naming.** All three button labels come from `AMEND_COPY` (`change`, `save`, `cancel`).
The Change button's accessible name is `changeLabel(subject, formatSetLine(set))`, e.g. `Change Back
squat set 2 — 5 × 135 lb`. The `ariaLabel` prop stays the **subject** (`Back squat set 2`), used for
the inputs. Update the `AMEND_COPY.change` docblock, which says "editable-set.tsx still says Edit".

**I2 — Layout at 280px** (a superset member's content width; a11y lens width math). The editor
stacks, deterministically, as the 1b amend does: reps × weight + unit on one row; Save and Cancel on
their own `w-full` row. The weight input's name and visible suffix carry the set's unit
(`UNIT_LABELS[unit]`, the lesson `AMEND_COPY.valueLabel` documents). _(Superseded by J1: the visible suffix is the unit **code**, `lb`/`kg`.)_

**I3 — Focus and announcement** (the `bodyweight-amend.tsx` pattern). On Save, focus returns to the
set's Change button. On Cancel, also to Change. An `sr-only` `role="status"` renders **outside the
read/edit conditional, in both states** (a region mounted with its text is never announced), and
announces the subject: `Back squat set 2 changed: 5 × 140 lb.`. The error `role="alert"` has a
**per-set** id (`amend-error-${set.publicId}`), referenced by the inputs' `aria-describedby` only
while the error renders. _(Superseded by J9: the id is `set-amend-error-${set.publicId}`, via `setAmendErrorId`; J2 adds focus on reps when the editor opens.)_

**I4 — Locked, with a true reason.** `lockedReason(set): LockedReason | null` lives in `set-display.ts`
next to `isEditableSet`, and is derived from the same clauses (a test pins that
`isEditableSet(s) === (lockedReason(s) === null)` over one fixture per clause). The copy lives in
`AMEND_COPY.locked` (generic, so PR 2's primitive inherits it):

- `mode` (bodyweight or band): "Bodyweight and band sets can't be changed in the app."
- `notMass` (time or distance): "Timed and distance sets can't be changed in the app yet." (V1-33 exists.)
- `status` (sub-failure, failed): the badge says what happened; the line is only the recovery route.
- `shape` (several quantities, no reps): "This set can't be changed in the app."

  Every reason line ends with the recovery route: **"Wrong? Ask a parent — don't log it again."**
  **Always one line per movement**; if its locked sets' reasons differ, the generic `shape` line. No
  "yet" except where a backlog row exists (V1-33 for time and distance).

**I5 — Closed days.** No change: Change keeps rendering on every day. `CLOSED_DAY_NOTICE` changes to
"…correct a logged weight or set", because 3a-i makes the set correction visible as a peer.

**As shipped (implementation review):** the a11y e2e case logs its own plain probe set on **Athlete Two's
yesterday** and opens Change there (~294px), rather than reusing a 3a-ii session; logging a superset
through the UI in a test costs far more. The 280px superset-member case is covered by the unit test's
structural assertion, the width math (with the unit **code** as the suffix) and the `strength-amend`
screenshot. ⚠️ **For 3a-ii:** that probe means Athlete Two's yesterday has strength logged, so its section
starts collapsed; 3a-ii's new strength writes must use another `(profile, day)`.

**What PR 2's shared primitive must keep (the two amends differ on purpose):** bodyweight follows the
server value while open (`seenProp`), sets do not; bodyweight shows `fieldErrors`, sets only
`state.error`; bodyweight focuses its receipt on save, a set its Change; both Change buttons are
`outline` (since 3a-ii); both clear their announcement on open.

**3a-i files:** `editable-set.tsx`, `set-display.ts` (+ test), `lib/constants.ts` (`AMEND_COPY`,
`CLOSED_DAY_NOTICE`), `movement-line.tsx` (NEW: `MovementLine` + `SessionMovementItem` moved from
`page.tsx` unchanged, then the reason line added; owned by the strength-logging guide), `page.tsx`
(imports it), `editable-set.test.tsx`
(new: name, stacked layout, focus, status, describedby), `e2e/a11y.spec.ts` (**opens** Change on a
superset member at 360px; this has never been tested), `docs/features/strength-logging.md`, changelog.
The a11y case reuses 3a-ii's allocated `(profile, day)` session (below), so it writes nothing
extra. ~300 lines. **One UX reviewer** (a small visual change), screenshots of the list with Change open.

## 3a-ii — the section receipt

**D1 — One renderer, with a placement.** `StrengthSessionReceipt` is extracted from `page.tsx`'s
session block (`MovementLine` already lives in `movement-line.tsx`, from 3a-i). The receipt takes `placement: 'section' | 'list'`:

- `section`: carries the focus id `strengthReceiptId(sessionPublicId)` and `tabIndex={-1}`; renders
  Change;
- `list`: no ids. Sets render **read-only when the strength section is on the page**, so every set has
  one Change and one accessible name (scope, a11y). When the routine has no strength block, the list
  keeps Change: it's then the only surface.

**D2 — The form after a save** (interaction, a11y, correctness). A client island, `StrengthLog`, owns
the form's `useActionState`, the open/collapsed state and the announcement:

- With **no** strength session on the day there is **no toggle**: the form is simply open (a
  "Cancel" there would collapse to an empty section, and "more" would be false). Once a session exists,
  it **starts collapsed**.
- **Collapses on this device's own successful save** (`useOnActionSuccess`). It never collapses
  because the server's count changed: a session arriving from another device must not unmount a
  typed draft.
- Collapsing **hides** the form (`hidden`), never unmounts it: a mis-tapped Cancel keeps a typed
  second session, and reopening restores it. The body is reset only by this device's successful save
  (the existing `gen` remount) or a day change. `aria-controls` therefore always points at a mounted
  element.
- The toggle is a persistent `<Button aria-expanded aria-controls>` reading "Log more strength" /
  "Cancel", placed **directly under the receipts**. Opening focuses a labelled container
  (`role="group"`, `tabIndex={-1}`) whose `aria-describedby` points at D3's two lines, so a
  screen-reader user hears the guard. Cancel collapses and returns focus to the toggle. The toggle is
  disabled while a save is pending.
- State is keyed on `day` (the V1-28 trap), with prefixed sibling keys.
- _Rejected:_ `<details>`. Its summary can be ≥44px (`program-reference.tsx` does it), but native
  `<details>` keeps its open state across an RSC re-render, so it wouldn't re-collapse after a save.
- On a **closed day** the toggle and form are absent; receipts and Change remain.

**D3 — "Already saved today"** (trust lens). When the form is opened from "Log more", a static line
above it reads **"Already saved today: Back squat, Bench, Rows (skipped)."** It comes from one helper,
`loggedMovements(sessions)` (done vs skipped), which 3a-iii reuses for its fill filter, so the two
surfaces cannot disagree about what "logged" means. Names via `entryLabel`, joined by `VALUE_JOINER`
(renamed from `BODYWEIGHT_VALUE_JOINER`). It stays on
screen, unlike the announcement, and it is the guard against re-logging a session.

**D4 — What "complete" looks like.**

- **Receipts render directly under the h2**, then the toggle. The **program card moves into the
  form** (above its first card): it is reference for typing and runs a screenful
  (`program-reference.tsx` docblock), so after a save it no longer separates the receipt from "Log
  more". On an empty day the form is open, so the card is where it is today.
- A treatment the form never uses: a `bg-muted/40` fill, no inputs, still no tick.
- Header: h3 **`Strength A session`** (`DAY_ROLE_LABELS ?? SESSION_TYPE_LABELS`, computed inside the
  receipt), with **"Saved"** as adjacent text, not in the heading (a11y: the headings list shouldn't
  read "Saved" N times). `·` separators are `aria-hidden`. The row gets `flex-wrap`.
- Counts are honest: **`3 movements · 1 skipped`**.
- Two sessions of the same role get **"session 2" inside the h3** (`Strength A session 2`), so the
  headings list can tell them apart.
- The section h2 **stays "Log strength" in 3a-ii**, deferred to 3b (the size cut, below). The rename to
  `Strength` is agreed; it touches ~15 locator lines across 4 specs.

**D5 — Announce and focus** (B5). `StrengthLog` announces from **its own action result**:
`logStrengthSessionAction` returns the new session's `publicId` (an optional field on `ActionState`),
and the island writes **`Strength saved: Back squat, Bench, Rows.`** (that session's movements) into
a `role="status"` region mounted in both states. **Focus is keyed on the props, not timing:** the
section passes its rendered session ids into `StrengthLog`, and an effect on `[savedId,
renderedSessionIds]` focuses `strengthReceiptId(savedId)` once that id is in the list (and only once).
If it never arrives, focus goes to the toggle, never `<body>`. The writer already returns the public
id, including on a replay (`writeStrengthSession`). `SavedAnnouncer` is **not** changed or used.

**D6 — Session-less strength entries → 3b** (scope round 2). Legacy strength entries with no session,
and members of a soft-deleted session, are `{kind:'entry'}` rows. They keep rendering in "Logged
entries" until 3b, which owns making the section complete (with an `isStrengthEntry(e)` predicate
beside `todayRows`, used for the section rows, the starting state and the read-only rule).

**D7 — "Forgot a movement" makes a second session** (trust lens). There is no add-to-session path;
"Log more" creates a new session, and the CSV then has two rows for that role on one day. **This is
acceptable** (V1-8 already allows it). The open form's caption says **"Adds a new session."**, and the
receipt numbers it ("Session 2").

## The KB-swings incident (trust lens; parent Open question 0)

**3a does not fix the founding bug's class.** A BW set that should have been loaded stays Locked
("Bodyweight and band sets can't be changed in the app. Wrong? Ask a parent — don't log it again.").
The fix is **V1-26 PR-B** (remove + undo), which the parent plan already names. 3a's contribution:
the recovery copy steers away from re-logging, which is the one action that makes it permanently worse.
The parent's Open question 0 is answered as: 3a before 2, and the incident class stays with V1-26 PR-B.

## Acceptance

**3a-i**

1. Every editable set's control reads **Change**, named by `changeLabel`, and all three amend labels
   come from `AMEND_COPY`.
2. The editor fits a 280px superset member with Save/Cancel on their own row (an a11y e2e case opens it
   at 360px: axe, tap targets, overflow).
3. Save and Cancel return focus to Change; a save is announced with the new value; an error is tied to
   its inputs.
4. Every locked set either shows a **true** reason (`lockedReason`, pinned to `isEditableSet` by a
   test) with the recovery route, or a status badge.
5. Change still renders on closed days.

**3a-ii** (parent acceptance 4–7, for strength)

1. After a save, the section shows the receipt and a collapsed "Log more strength", never an empty open
   form. A second session collapses it again.
2. Each save is announced with that session's movements, and focus lands on its receipt, the first
   and the second session alike: RTL (including the result arriving one render before the props) and
   e2e (`document.activeElement.id === strengthReceiptId(...)` for both).
3. Cancel keeps a typed draft; reopening restores it.
4. A session from another device never collapses an open, typed form.
5. Receipts render on every day; Change renders on every day; "Log more" never on a closed day, and
   no toggle on a day with nothing logged.
6. Every set has exactly one Change on the page.
7. axe + tap targets + 360px overflow on: a session with a superset, a Locked movement and a skipped
   movement (collapsed and with "Log more" open). The closed-day state is covered by unit tests and
   screenshots (no backdated e2e fixture exists, the 1a precedent).

## File-by-file — 3a-ii (3a-i's list is in its section)

| Path                                                       | Change   | What & why                                                                                                                                           |
| ---------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/movement-line.tsx`             | EDIT     | (Created in 3a-i.) Adds the `placement` prop.                                                                                                        |
| `apps/web/app/p/[profileId]/strength-session-receipt.tsx`  | NEW      | The session block (D1, D4), a server component; `placement`.                                                                                         |
| `apps/web/app/p/[profileId]/strength-log.tsx`              | NEW      | The client island (D2, D3, D5): `useActionState`, open/collapsed, toggle, "Already saved today", status region, focus. Wraps `StrengthForm`'s body.  |
| `apps/web/app/p/[profileId]/strength-section.tsx`          | NEW      | Server: h2, receipts (D6 included), program card, `StrengthLog` when writable.                                                                       |
| `apps/web/app/p/[profileId]/strength-form.tsx`             | EDIT     | Hands its `useActionState` to `StrengthLog` (or exposes the body), so the island owns save state.                                                    |
| `apps/web/app/p/[profileId]/actions.ts`, `action-state.ts` | EDIT     | `logStrengthSessionAction` returns `sessionId` (the public id) on success; `ActionState` gains an optional `savedId`.                                |
| `apps/web/app/p/[profileId]/page.tsx`                      | EDIT     | The strength block renders `StrengthSection`; "Logged entries" uses the receipt with `placement="list"`.                                             |
| `apps/web/lib/constants.ts`                                | EDIT     | `STRENGTH_COPY` (submit, "Log more strength", "Already saved today", "Adds a new session.", the announcement), `strengthReceiptId`, `VALUE_JOINER`.  |
| `apps/web/lib/entries/activity-totals.ts` (+ test)         | EDIT     | `loggedMovements(sessions)` (D3; reused by 3a-iii).                                                                                                  |
| tests                                                      | NEW/EDIT | `strength-section.test.tsx`, `strength-log.test.tsx` (open/collapse, second save, remote session doesn't collapse a dirty form, focus); e2e (below). |
| `docs/features/strength-logging.md`                        | EDIT     | The section states; owns the new files and `movement-line.tsx` (decided: strength-logging, since session rendering is its subject).                  |
| `docs/features/write-path.md`                              | EDIT     | The action's new `savedId` return (owned: `actions.ts`).                                                                                             |
| `docs/plan.md`, changelog                                  | EDIT/NEW | The V1-24 row: 3a split; 3a-iii and the invariant-3 row filed.                                                                                       |

**e2e** (correctness B1, a11y 7). The collapse breaks specs that need the form open on a day another
spec logs strength on (`playwright.config.ts`: `fullyParallel`, retries 1):

- writers on Athlete One's today: `scaffold-submit.spec.ts` (two tests, after V1-27); on yesterday:
  `export-full-day.spec.ts`;
- readers that need the open form: `a11y.spec.ts` (three strength cases), `scaffold-submit.spec.ts`
  (two), `day-nav-form-state.spec.ts`, and `export-full-day.spec.ts` on retry.

**Fix:** a retry-safe `openStrengthForm(page)` helper in `e2e/steps.ts`. It matches
`getByRole('button', { name: STRENGTH_COPY.logMore, exact: true })`, clicks **only** when it has
`aria-expanded="false"`, then asserts the form's submit is visible (so a pre-hydration click can't
pass silently). Every reader calls it, and `day-nav-form-state.spec.ts` calls it again after each
`waitForURL`. Region locators use `exact: true` (the program card's own region name contains
"Strength"). `export-full-day.spec.ts`'s post-click `toBeEnabled()` wait becomes a wait for the
receipt.

**New strength writes get their own `(profile, day)`:** **Athlete Two, yesterday** (only a bodyweight
write there today). The a11y receipt case logs a session with a superset, a locked (BW) movement and
a skipped movement **only if no receipt exists** (the `testInfo.retry` pattern), so a retry never
measures "session 2". `global.setup.ts`'s allocation comment is extended to strength writes.

**Size:** ~400–450 after the cuts (D6 to 3b, the `MovementLine` move to 3a-i, the h2 rename to 3b).
**The remaining overage is accepted:** the island, its two RTL suites and the e2e retargeting are one
indivisible change (collapsing without the e2e fixes breaks CI).

**3a-ii as shipped** (deviations from the table above, decided during implementation):

- **The island is `StrengthForm` itself**, not a new `strength-log.tsx`: it already owned the
  `useActionState` the island needs, and lifting it into a wrapper would have split one component's
  state across two files. Its new props (`logged`, `alreadySaved`, `programCard`) are optional, so its
  existing tests render it unchanged.
- **The announcement is a during-render update of the island's own state** (the `useOnActionSuccess`
  idiom) once the saved id is in the props; the effects only move DOM focus. (`react-hooks/
set-state-in-effect` forbids the effect-based version.)
- **The list's session block changed too**, because it is the same renderer: the header shows the
  honest counts and the session ordinal there as well (not "Saved", which is section-only).
- **The new a11y case writes on Athlete Two's today** (not their yesterday, which 3a-i's probe holds).
  Its superset coverage is the receipt's unit tests and the screenshots.
- **The review's carry-overs from 3a-i landed here:** one Locked line per session listing its
  movements (J15), and Change is an outline button that reads as a control (J16).

## 3a-iii — recorded decisions (its own plan later)

- Match **logged ↔ prescribed by movement slug** (the export's key, `lib/dal/export.ts`;
  `findOrCreateMovementId` resolves by slug), **filtered server-side in `page.tsx`**, where the program
  rows are narrowed. No internal id reaches the client, and `ScaffoldRow` doesn't widen.
- A **skipped** movement does not count as logged. The match is **count-aware** for a movement
  prescribed twice (warm-up + working). The filter runs **before** the 12-movement clamp.
- **Visible, never silent:** "Loaded 3 movements. Left out 2 already logged today: Back squat, Bench."
  plus an **"Add them too"** button. When everything is logged, the button becomes **text**, not a
  disabled control.

## Out of scope

- Check-ins (2), and demoting the list (3b).
- Making locked sets editable (V1-33 for time and distance; V1-26 PR-B for remove + undo).
- Program-card ticks.
- **Filed by this plan:** invariant 3 isn't identical. `isEditableSet` requires exactly one quantity,
  but `updateStrengthSetById`'s guard doesn't check the count, so a crafted POST can edit a set the
  UI shows as locked. A server fix, filed as **V1-36**.
- `app/p/[profileId]/` holds ~35 flat files. A `strength/` subfolder is a separate refactor.
- **Filed (found outside the diff):** `export-full-day.spec.ts`'s comment "no other spec submits the
  strength form" is false since `scaffold-submit`, so its determinism check can race a same-month
  write. A small, separate fix, filed as **E2E-3**.

## Open questions

None.

## Review-response log

### UX panel (3 lenses) + engineering panel (4 lenses), round 1

| #   | Lens(es)                                                              | Critique (short)                                                                                                                                                                         | Verdict              | Resolution                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | Trust, Interaction, A11y, Correctness, Scope, Arch, Reuse (all seven) | D6 removed Change on closed days, reversing parent Decision 5; the shared renderer would make the section and list disagree                                                              | **accepted**         | Change on every day; a closed day drops only "Log more" and the form. `CLOSED_DAY_NOTICE` updated.                                                                                              |
| R2  | A11y, Interaction, Correctness, Scope, Arch, Reuse                    | D5's "count+1" can't be done by `SavedAnnouncer` and would reopen B5 (announcing another device's save); one static focus id can't target N receipts                                     | **accepted**         | The island announces from its own action result, which returns the session's public id; per-session focus ids. `SavedAnnouncer` is unchanged.                                                   |
| R3  | Trust, Interaction, A11y, Correctness, Scope, Arch, Reuse             | D3's single reason ("BW, band and timed") is false for sub-failure, multi-quantity, `reps === null` and length sets; "yet" promised a fix with no row; no recovery route; "BW" is jargon | **accepted**         | `lockedReason(set)` beside `isEditableSet`, pinned by a test; true copy per reason; "yet" only for time/distance (V1-33); a recovery route on every line; status-locked sets rely on the badge. |
| R4  | Scope, Trust, Arch, Correctness                                       | D7 is a second concern, needs plumbing the table lacked, would leak an internal id, and hides movements invisibly                                                                        | **accepted (split)** | 3a-iii, by slug and server-side, with its decisions recorded.                                                                                                                                   |
| R5  | Interaction                                                           | Keep D7 in 3a: "Log more" + an unfiltered Fill invites duplicates                                                                                                                        | **partly accepted**  | D7 splits (R4), but its risk is covered in 3a-ii by D3's persistent "Already saved today" line; 3a-iii is sequenced next.                                                                       |
| R6  | A11y, Interaction, Correctness, Arch, Scope                           | D2's collapse had no owner, no re-collapse, no focus or `aria-expanded`, and a server-count-driven collapse would destroy a typed draft                                                  | **accepted**         | `StrengthLog` island: collapses on its own success only; persistent toggle with `aria-expanded`/`aria-controls`; focus in and back; keyed on day; disabled while pending.                       |
| R7  | A11y                                                                  | `EditableSet` lacks 1b's hardening: focus drops, no status, no describedby, no unit in the name, and the editor fits 280px only by wrap luck                                             | **accepted (split)** | 3a-i, first.                                                                                                                                                                                    |
| R8  | A11y, Scope, Reuse, Correctness, Arch                                 | One renderer in two places duplicates ids and gives every set two identically named Change buttons                                                                                       | **accepted**         | `placement` prop: ids only in the section; the list goes read-only when the section is present.                                                                                                 |
| R9  | Correctness, A11y                                                     | The e2e plan targeted the wrong breakage: the collapse breaks the specs that need the form open                                                                                          | **accepted**         | A retry-safe `openStrengthForm` helper; readers listed; the "matches twice" claim dropped.                                                                                                      |
| R10 | Trust                                                                 | The KB-swings incident class is still unrecoverable, and "Log more" invites a permanent duplicate                                                                                        | **accepted**         | Stated plainly; owned by V1-26 PR-B; the Locked copy says "don't log it again"; parent Open question 0 answered.                                                                                |
| R11 | Trust                                                                 | "Log more" re-entry and "forgot a movement" create sessions with no guard or explanation                                                                                                 | **accepted**         | D3 "Already saved today"; D7 "Adds a new session.", and "Session 2" in the header.                                                                                                              |
| R12 | Interaction                                                           | The receipt looks like a form card and sits below the program card's screenful; "Saved" alone is weak; "4 movements" counts a skip                                                       | **accepted**         | Receipts above the program card; `bg-muted/40` fill; honest counts; "Session 2".                                                                                                                |
| R13 | Interaction, A11y, Reuse                                              | The h2 "Log strength" is false over a receipt or a closed day                                                                                                                            | **accepted**         | "Strength", through `STRENGTH_COPY.heading`; locators re-pointed.                                                                                                                               |
| R14 | Arch                                                                  | `MovementLine` isn't strength-specific                                                                                                                                                   | **accepted**         | Its own file, `movement-line.tsx`.                                                                                                                                                              |
| R15 | Arch                                                                  | Guide ownership is incomplete; `write-path.md` would trip                                                                                                                                | **accepted**         | Ownership is in the file table.                                                                                                                                                                 |
| R16 | Correctness                                                           | Session-less strength entries would vanish from "the record"                                                                                                                             | **accepted**         | D6 renders them in the section.                                                                                                                                                                 |
| R17 | Correctness                                                           | The fact sheet was pinned to a stale base; V1-27 rewrote the form                                                                                                                        | **accepted**         | The branch was reset to `43bd66a` and the anchors re-checked.                                                                                                                                   |
| R18 | Reuse                                                                 | `EditableSet` still has literal Save/Cancel; the announcement re-implements a joiner                                                                                                     | **accepted**         | All three from `AMEND_COPY`; `VALUE_JOINER` + `entryLabel`.                                                                                                                                     |
| R19 | Scope                                                                 | Closed-day and skipped e2e cases need a fixture that doesn't exist                                                                                                                       | **accepted**         | Unit tests + screenshots for the closed day; a skipped movement is UI-producible, so it stays in e2e.                                                                                           |
| R20 | Scope                                                                 | The guide's stale Files table is unrelated                                                                                                                                               | **partly accepted**  | Fix only the lines this PR's files touch; delete the line counts rather than refresh them.                                                                                                      |
| R21 | Interaction, A11y, Scope                                              | D2(c)'s rejection reason for `<details>` was wrong                                                                                                                                       | **accepted**         | The real reason recorded: it keeps its open state across an RSC re-render.                                                                                                                      |
| R22 | Scope, Arch                                                           | The shared primitive (Decision 16)                                                                                                                                                       | **agreed: not here** | Stated in the fact section.                                                                                                                                                                     |

### Round 2 (light pass): trust, scope, interaction, correctness, a11y

No BLOCKING findings. Every SHOULD is accepted except where noted.

| #        | Lens                  | Critique (short)                                                               | Resolution                                                                                                                |
| -------- | --------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| T1       | Trust                 | Status-locked sets got no recovery route                                       | The status line carries the recovery route alone (I4).                                                                    |
| T2 · X4  | Trust · Interaction   | "Already saved today" listed skipped movements as saved; 3a-iii disagreed      | One `loggedMovements` helper; skipped marked "(skipped)" (D3).                                                            |
| S1       | Scope                 | Move D6 to 3b now, not "if over"                                               | Done (D6).                                                                                                                |
| S2       | Scope                 | The `MovementLine` move belongs in 3a-i                                        | Done.                                                                                                                     |
| S3       | Scope                 | Per-movement vs per-set reason lines is a second layout rule                   | Always per movement; generic line when reasons differ (I4).                                                               |
| S4       | Scope                 | Re-baseline; name the next cut                                                 | 3a-i ~300, 3a-ii ~400–450. The h2 rename is deferred to 3b; the rest of the overage is accepted, with the reason (§Size). |
| X1       | Interaction           | Cancel destroys a typed second session                                         | Collapse hides, never unmounts (D2).                                                                                      |
| X2 · A3a | Interaction · A11y    | A first-run toggle reads "Cancel" to an empty section                          | No toggle until a session exists (D2).                                                                                    |
| X3       | Interaction           | "Log more" sits a screenful below the receipt, past the program card           | The toggle goes under the receipts; the program card moves into the form (D4).                                            |
| X5       | Interaction           | Unfiltered Fill opens on a logged movement until 3a-iii                        | 3a-iii is recorded as the next dependency.                                                                                |
| C1       | Correctness           | Renamed region locators hit strict mode (the program card contains "Strength") | `exact: true` (moot for the h2 until 3b, kept for the new locators).                                                      |
| C2 · A4  | Correctness · A11y    | D5's "once in the DOM" names no mechanism; no fallback                         | Focus keyed on rendered ids, with a fallback to the toggle; RTL out-of-order test; e2e asserts `activeElement` (D5).      |
| C3       | Correctness           | D6 has no strength predicate                                                   | Moot for 3a (D6 → 3b); recorded for 3b as `isStrengthEntry`.                                                              |
| C4       | Correctness           | `openStrengthForm`'s contract is underspecified                                | Exact name, `aria-expanded="false"` check, visible-submit assertion, re-run after navigation.                             |
| C5       | Correctness (outside) | `export-full-day`'s "exclusively ours" comment is false                        | Filed.                                                                                                                    |
| A1       | A11y                  | I3's status region placement, per-set error ids, an ambiguous announcement     | Region outside the read/edit conditional; `amend-error-${publicId}`; the subject in the announcement (I3).                |
| A2       | A11y                  | Focusing the first control skips the trust lines for screen readers            | Focus a labelled group described by both lines (D2).                                                                      |
| A3b      | A11y                  | `aria-controls` dangles when the form unmounts                                 | The form is hidden, not unmounted (D2).                                                                                   |
| A5       | A11y                  | "Session 2" outside the h3 gives identical headings                            | Inside the h3 (D4).                                                                                                       |
| A6       | A11y                  | New e2e writes need their own `(profile, day)` and a retry guard               | Athlete Two yesterday; log only if no receipt; the allocation comment is extended.                                        |

### 3a-i implementation review (`review-pr` on #211): correctness, UX, reuse

No P0. Every P1 and P2 is fixed in the PR unless marked.

| #   | Lens                     | Finding (short)                                                             | Resolution                                                                                          |
| --- | ------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| J1  | UX                       | A kg editor overflows a 280px superset member ("Kilograms" suffix)          | The visible unit is the **code** (`lb`, `kg`), as on the read line and in the log form.             |
| J2  | UX                       | Opening Change drops focus to `<body>`                                      | Reps is focused on open (`autoFocusReps`); tested in RTL and e2e.                                   |
| J3  | Reuse · UX · Correctness | Re-saving the same value isn't announced                                    | The announcement is cleared on open; a two-save test, mutation-checked.                             |
| J4  | Correctness              | The status-region test couldn't fail                                        | It now asserts node identity across open and save.                                                  |
| J5  | UX                       | "Ask a parent" is wrong for an adult profile and leads with the wrong thing | "Wrong? Don't log it again — tell a parent so they can fix it."                                     |
| J6  | UX                       | "This set" on a line that can cover several sets                            | "Some sets here can't be changed in the app."                                                       |
| J7  | UX                       | `CLOSED_DAY_NOTICE`: "weight or set" reads redundant                        | "…correct a weigh-in or a strength set."                                                            |
| J8  | Reuse                    | Tests re-type the weight label and `UNIT_LABELS.lb`                         | `weightInputLabel` in `lib/constants.ts`, used by the field and both specs.                         |
| J9  | Reuse                    | `amendErrorId` named generically but set-only                               | Renamed `setAmendErrorId`.                                                                          |
| J10 | Reuse                    | The guide quoted copy that had already drifted                              | The guide points at `AMEND_COPY.locked` / `lockedRecovery`.                                         |
| J11 | Reuse                    | The two amends' deliberate differences aren't written down                  | Listed above, for PR 2.                                                                             |
| J12 | Correctness              | Plan vs shipped e2e case; Athlete Two-yesterday strength hazard for 3a-ii   | Recorded above ("As shipped").                                                                      |
| J13 | Correctness              | Unscoped, non-exact e2e locators                                            | Scoped to the region, `exact: true`; Change found by `changeLabel` exactly.                         |
| J14 | Correctness              | Orphaned `SessionMovementItem` docblock in `page.tsx`                       | Moved with the function.                                                                            |
| J15 | UX                       | The Locked line repeats on a bodyweight-heavy day                           | **3a-ii**: the session receipt owns session-level layout (one line per session, listing movements). |
| J16 | UX (outside)             | A muted ghost "Change" barely reads as a control                            | **3a-ii**, where it becomes the primary surface.                                                    |
| J17 | Correctness (also)       | Inputs aren't disabled while a save is pending                              | Not changed: the bodyweight amend shares it; PR 2's primitive decides once.                         |

### 3a-ii implementation review (`review-pr` on #212): correctness, UX, reuse

No P0. Every P1 and P2 is fixed in the PR unless marked.

| #   | Lens                     | Finding (short)                                                                    | Resolution                                                                                                                        |
| --- | ------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| K1  | UX                       | "Already saved **today**" is false on yesterday, a writable day                    | "Already saved for this day: …".                                                                                                  |
| K2  | UX · Reuse · Correctness | The announcement named a skipped movement as saved; two builders disagreed         | One `movementNames` (skipped marked, repeats removed) for both.                                                                   |
| K3  | Correctness              | A second session with the same names wasn't a text change, so not announced        | The announcement leads with the receipt's heading ("Strength A session 2 saved: …"); tested.                                      |
| K4  | UX                       | A sub-failure-only session showed a lone "Wrong? …" line                           | Badge-only (no line); tested.                                                                                                     |
| K5  | UX · Reuse               | The Locked line's names landed on "the app", built by regex-editing the copy       | `AMEND_COPY.lockedFor`: "Pull-Up: Bodyweight and band sets …".                                                                    |
| K6  | UX                       | The open toggle read "Cancel", implying the draft is discarded                     | "Close" (the draft is kept).                                                                                                      |
| K7  | UX                       | The list's copy of a session looked like a double-log                              | The "Logged entries" heading is visible when the section also shows sessions. 3b demotes the list properly.                       |
| K8  | Reuse · UX               | The submit rendered a literal its constant duplicated; specs re-typed copy and ids | `STRENGTH_COPY.submit`/`submitting` rendered; specs and the screenshot script use the constants and `STRENGTH_RECEIPT_ID_PREFIX`. |
| K9  | Reuse                    | The plural/skipped wording was hand-built twice                                    | `movementCount` / `skippedCount`, shared with `strengthSummary`.                                                                  |
| K10 | Correctness              | Nothing tested `savedId` or the replay id                                          | An action test: same id on replay.                                                                                                |
| K11 | Correctness              | "Exactly one Change on the page" wasn't pinned where it's wired                    | Page-scope count in the 3a-i e2e case.                                                                                            |
| K12 | Correctness              | Collapse and pending-disable checked only as attributes                            | e2e asserts the submit is hidden after each save; RTL asserts the toggle is disabled while pending.                               |
| K13 | Correctness              | The receipt case couldn't heal a failed first attempt; nth-match locators          | Gated on state, not attempt; locators by label/role per card.                                                                     |
| K14 | UX                       | The group shared the name "Log strength" with the h2 and the submit                | "New strength session".                                                                                                           |
| K15 | Reuse                    | The plan said `ghost` for set Change                                               | Fixed above.                                                                                                                      |
| K16 | Reuse                    | Four copies of announce-then-focus                                                 | **Filed** in tech-debt for PR 2's primitive.                                                                                      |
| K17 | Reuse                    | Duplicated `EntryDTO` fixtures across three tests                                  | **Not changed**: a shared fixture module is worth doing with the next test that needs one.                                        |
| K18 | Correctness (outside)    | The replay re-select isn't scoped to the profile                                   | **Filed** in tech-debt (folds into AUTH-1).                                                                                       |
