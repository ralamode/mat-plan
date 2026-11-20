# Tech debt — a refusal on the add or rename form keeps what was typed, even before hydration

> Debt row: [tech-debt.md](../tech-debt.md) → "A refusal on the add or rename form, submitted before
> hydration, re-renders a blank form" (narrowed 2026-11-19 by #691). Branch:
> `fix/td-unhydrated-refusal`. No `plan.md` row: a tech-debt payoff.

_Roadmap alignment (2026-11-20): checked against the private roadmap; nothing to add here. Gates
nothing._

## Goal

Since #691 (`Referrer-Policy: same-origin`) a form submitted before the page hydrates reaches its
Server Action. On success that is a redirect, which works. On a **refusal** (a duplicate name, a
field error, a full household), Next re-renders the page with the action's result as
`useActionState`'s state, and the client island mounts **fresh**:
- the add form's `name` starts `''` and `kind` `null`, so the typed name and choice are gone;
- the duplicate callout cannot show, because it renders only while `foldName(name)` equals
  `state.duplicate.folded`, and `name` is `''`;
- the rename form's name re-seeds from the STORED name, losing the attempted one.

So a parent on a slow phone who taps Add before the page loads, and hits a duplicate, sees a blank
form with no message. Nothing is written; the cost is confusion and retyping.

## Design

- **The envelope carries what was typed on every refusal.** `ActionState` gains
  `typed?: { name: string; kind?: ProfileKind }`, set by `addAthleteAction` and
  `renameAthleteAction` on each `ok: false` they return after parsing the body. It holds the **raw
  submitted** name (what the person sees in the field), not the folded or trimmed form. An invalid
  kind is left out. On a parse failure the raw `FormData` values are echoed back the same way,
  trimmed to the name's max length, so a field error keeps the text too.
- **The forms seed from it.** `useState(() => state.typed?.name ?? …)`, using the stored name for
  rename and `''` for add, and the same for `kind`.
  - **Hydrated** (today's path): `useActionState`'s first state is `INITIAL_ACTION_STATE`, so
    nothing changes. Later refusals update `state` while the island keeps its own `name`, which is
    already what was typed.
  - **Unhydrated:** the re-render's first state is the refusal, so the fresh island starts from what
    was typed, and the duplicate callout's fold comparison matches.
- **Why this is safe now and was reverted in a-1d (#361):** then, the unhydrated POST never arrived
  (the cause #691 fixed), so there was no envelope to seed from. A submit captured *during*
  hydration replays against an island already mounted, where the initializer is inert, but the
  island's own state already holds the typed text, so that case needs nothing either.
- **Privacy:** the name echoes back to the same session that sent it, in the same response. It is
  not logged or stored, and it is not a new destination.

## Proofs

- **Unit (`profile-actions.test.ts`):** each refusal (duplicate, field error, full, rename duplicate)
  returns `typed` equal to the submitted name and kind.
- **Component (`add-athlete-form.test.tsx`, the rename form's test):** rendered with a refusal as the
  initial state, the field shows the typed name, the kind is checked, and the duplicate callout shows.
- **e2e (`form-before-hydration.spec.ts`):** chunks blocked, submit a duplicate of a seeded name, and
  assert the native POST answers 200 (a re-render, not a redirect), the field holds the typed name,
  and the callout text is visible. This costs no household slot, since nothing is created.

## Files

`apps/web/app/p/[profileId]/action-state.ts`, `apps/web/app/p/profile-actions.ts` (+ test),
`apps/web/app/p/new/add-athlete-form.tsx` (+ test), `apps/web/app/p/[profileId]/edit/rename-form.tsx`
(+ test), `apps/web/e2e/form-before-hydration.spec.ts`; `docs/tech-debt.md` (this entry closed, plus
the empty-export entry marked closed per the maintainer, 2026-11-20); `docs/features/write-path.md`
(it owns `profile-actions.ts`); a changelog fragment.

## Review-response log

Panel (2026-11-20): correctness (Fable), UX (one reviewer). **v1 not ready; PARKED** while the
lane clears its merge queue (board, 2026-11-20). Revise before any code.

| #   | Lens        | Finding                                                                                                                         | Response (for v2)                                                                                     |
| --- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| C1  | correctness | P1: `typed` on every ok:false breaks the byte-identical refusal matrix (action-matrix.ts:573-590, :645-659; no-session pin)     | enumerate the carrying branches: add field error, add duplicate, add `full`; rename field error, rename duplicate. Never on a NO_ATHLETE_* / entry refusal |
| C2  | correctness | P1: the component proof passes on main (the tests reach a refusal by submitting)                                                 | wrap the real `useActionState` in a test mock so the refusal is the FIRST state, as Fizz does          |
| C3  | correctness | P1: the e2e can flake (renamed/archived seed names), its cleanup archives a seed athlete, and it can pass hydrated              | SEED_PROFILE_NAME in a different case + trailing space; don't track it; native-submit guards; assert the radio and the acknowledgement button |
| C4  | correctness | P2: text typed BEFORE hydration never reaches state (pre-existing, #361)                                                          | a mount effect that reads the field and the checked radio into state, or record it                    |
| C5  | correctness | P2: Restore becomes reachable unhydrated and its answer blanks the form                                                         | see U3                                                                                                |
| C6  | correctness | P2: one non-exported `typedFrom(formData)`: string-only, sliced (never trimmed), kind via the shared enum                        | accepted                                                                                              |
| C7  | correctness | P2: unit list missing the negatives and the raw-vs-parsed cases                                                                  | accepted                                                                                              |
| U1  | UX          | P1: before hydration nothing scrolls to or announces the refusal; on 360x640 it is below the fold                               | `autoFocus` on the target (callout / first radio / an error wrapper) when `state.typed` is set; probe iOS |
| U2  | UX          | P1: at hydration the focus effect pulls focus out of a field the parent is already typing in                                    | skip the first-run focus when `document.activeElement` is not `<body>`                                |
| U3  | UX          | P1: Restore without JS shows a blank form on success and a silent failure                                                      | a page-level `restoreState.error`, and a "Restored." line with a link to the athlete                 |
| U4  | UX          | P2: pre-hydration edits are overwritten by the next re-render                                                                   | = C4                                                                                                  |
| U5  | UX          | P2: a parse failure can drop the kind                                                                                           | = C6                                                                                                  |
| U6  | UX          | P2: the e2e at 1280 cannot see "below the fold"                                                                                 | 360x640, `toBeFocused` and `toBeInViewport`                                                           |

