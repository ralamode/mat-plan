# A stale rename tab is refused instead of silently overwriting a newer name

_Tech debt: "A stale rename tab silently overwrites a concurrent rename" (`docs/tech-debt.md`).
Status: **plan, reshaped by a five-lens panel (round 1).** Approved as a P3 item by the maintainer
(2026-11-20, relayed by the board). The refusal copy is theirs to approve (§ Open questions)._

## Where this sits

- **Owning row:** the tech-debt entry above, found in #350's review and deliberately deferred. Its
  proposed fix is the core of this plan.
- **Standalone tech debt.** It gates nothing, and it touches the `PROF-1` rename path that the
  write-path guide owns.
- _Roadmap alignment (2026-11-20): checked against the private roadmap; nothing to add here. No
  `ID-1` item moves: the rename's authority (any adult in the household, through `isLiveProfile`) is
  unchanged. `COACH-1`, which the row names as what raises the impact, is untouched._ Roadmap: none
  moved.
- **The unhydrated-refusal trigger** (`docs/tech-debt.md`, "the next PR that changes the add or rename
  form") fires with this PR. It is **not taken here**: the new `stale` refusal joins that entry's list
  of refusals an unhydrated submit loses (§ Risks says what that render does).

## Goal

Two devices can rename one athlete: a parent's phone with the edit screen left open, and another
adult's tablet. Today the later Save wins by server clock, and the earlier name is gone with no
history (`PROF-1` a-r keeps none, deliberately). After this change:

- a Save from a screen whose name is out of date is **refused**;
- the stored name is shown;
- the parent's typing is kept;
- overwriting the newer name takes a differently labelled, deliberate tap.

## Acceptance

1. `renameProfile(exec, scope, publicId, name, seenName, options)` takes the name the form was shown,
   as a **required positional** argument, so no caller can skip it. This is the `seenValue` idiom of
   `updateBodyweightEntryById`: the guard compares the **value**, never an `updated_at` token, for
   the precision trap `writers/bodyweight.ts` records.
2. **The answers, decided in one local function** (`classifyRename(stored, name, seenName)`), which
   runs on the scoped pre-read and again on the 0-row re-read:
   - **no row** → `refused`, the one answer for an unknown, foreign or soft-deleted id (ADR 0006);
   - **stored = name** → `ok`, with no write. This is the **replay**: a double-tapped Save, or two
     devices choosing the same name. It returns the row's stored `public_id`;
   - **stored ≠ seenName** → `{ ok: false, reason: 'stale', current: stored }`. Nothing is written;
   - otherwise, proceed.
3. **Order:** the scoped pre-read and the classification come first, so a stale submit is answered
   `stale` **before** the duplicate guard. Then the existing fold and duplicate guard, unchanged.
4. **The race is closed by the UPDATE's `WHERE`**, which carries `eq(profiles.name, seenName)`. If a
   rename commits between the pre-read and the UPDATE, the UPDATE matches 0 rows. Then one re-read
   through the existing scoped `profileNameFor` is classified again: `refused`, `ok` or `stale`. The
   classifier's fourth answer, "proceed" (stored = seenName ≠ name), means an A→B→A flip around the
   UPDATE. It is reachable deterministically under mutation 33. **On the re-read it answers
   `stale{current: stored}`**, never a second UPDATE, so there is no loop.
   Under READ COMMITTED a blocked UPDATE re-evaluates its `WHERE` against the committed row.
5. **The action** maps `stale` to `{ ok: false, error: null, stale: { current } }`, a new typed member
   of `ActionState` that mirrors `duplicate`. It revalidates the edit path, so the page heading shows
   the stored name. It never carries `duplicate` or `fieldErrors`.
6. **The form:**
   - It holds `seenName` in **component state**. It is captured once, at mount, from the stored name.
     It advances **only** on a `stale` answer, to `stale.current`, and a later `duplicate` answer does
     not reset it.
     ⚠️ It is **not** bound to the `name` prop: any server refresh (the time-zone sync, a revalidate)
     would then advance the precondition silently while the field keeps stale typing, and the next
     Save would overwrite with no refusal.
   - **The refusal message** renders between the field and the submit, where the duplicate callout
     renders. It has an `id`, `role="alert"` and `tabIndex={-1}`, takes focus, and is added to the
     field's and the submit's `aria-describedby`. The stored name sits in a `NAME_WRAP_CLASS` span.
   - **While it shows,** the submit reads `ATHLETE_FORM_COPY.saveAnyway`, outline, `size="lg"`. The
     overwrite is then a differently labelled tap, never a retry of the same button. **Enter or Go in the field does not overwrite**: the duplicate flow's disabled-default-button sentinel (`write-path.md` invariant 4) is reused while the message shows.
   - **The field keeps the parent's typing.**
   - **The heading** shows the stored name after the revalidate.
7. **Proofs:**
   - `db:verify` covers every arm (§ Test plan).
   - Three mutations each go RED on their own assertion.
   - Boundary tests cover unauthenticated, wrong owner, a bad body (`seenName` missing or too long),
     stale and replay.
   - A form test covers stale → duplicate → Save anyway.
   - One e2e covers two pages in one context.

## Design

- **`packages/shared/src/profiles.ts`:**
  - `renameAthleteSchema` gains `seenName: z.string().max(PROFILE_ECHO_MAX)`.
  - `PROFILE_ECHO_MAX` is a **new named const** (`PROFILE_NAME_MAX * 20`), the bound the two
    `acknowledgedDuplicate` fields already type by hand; both switch to it, and the tests import it.
  - It is not `athleteNameSchema`: it is the stored value echoed back, compared and never stored.
  - It is **required**, so a form regression cannot silently bring back last-write-wins. A crafted `seenName` with a NUL never reaches SQL: the JS comparison answers `stale` first, and the conjunct only ever binds a value equal to the stored one. That is one more reason to keep both checks. Every
    app-written name has passed `athleteNameSchema` (trimmed, single-spaced, no control characters),
    so the HTML and multipart round trip returns it byte for byte, and `===` matches Postgres `=`.
- **`packages/db/src/writers/profile.ts`:**
  - the new positional `seenName`, `classifyRename`, the conjunct, and the re-read;
  - a `stale` arm on `RenameProfileResult`;
  - the `profileNameFor` docblock now says the value is also rendered, in-household only.
- **`apps/web/lib/dal/profiles.ts`:** `renameAthlete` gains the required `seenName`. Its result is the
  writer's, unflattened, as its docblock requires.
- **`apps/web/app/p/[profileId]/action-state.ts`:** `stale?: { current: string }`, with a docblock
  like `duplicate`'s.
- **`apps/web/app/p/profile-actions.ts`:**
  - `seenName` joins the hidden-field group that answers `NO_ATHLETE_SAVE`;
  - the `stale` mapping;
  - `revalidatePath` on that arm.
  - It stays on the `ActionState` envelope: AGENTS.md's typed-result shape is for **new** mutations.
    The new request field does not trip the Contract's "additive" clause, because the only client is
    the co-deployed form.
- **`apps/web/app/p/[profileId]/edit/rename-form.tsx`:** as Acceptance 6. The comment that says "three
  arms are mutually exclusive" becomes four.
- **`apps/web/lib/constants.ts`:** `ATHLETE_FORM_COPY.renameStale(stored)` (§ Open questions).

## File-by-file changes

| File                                                                                 | Change                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/shared/src/profiles.ts`                                                    | EDIT. `PROFILE_ECHO_MAX` (used by both acknowledgement fields too), and `seenName`.                                                                                                                                                                                                                                                                                                                                      |
| `packages/db/src/writers/profile.ts`                                                 | EDIT. As Design.                                                                                                                                                                                                                                                                                                                                                                                                         |
| `packages/db/scripts/verify.ts`                                                      | EDIT. Every `renameProfile` call gains its true `seenName` (about 15). The new proofs. The vacuous `assert.ok(renameProfile(…))` at about :8524 becomes `renamedId(…)`.                                                                                                                                                                                                                                                  |
| `packages/db/scripts/mutations/428-…`, `429-…`, `430-…` (+ README)                   | NEW. 428 drops the pre-check; 429 drops the replay arm; 430 drops the conjunct.                                                                                                                                                                                                                                                                                                                                          |
| `packages/db/scripts/mutations/13-…`, `32-…`, `33-…`                                 | RE-CUT for the new context. 33's `.expect` is re-pointed if its first red moves.                                                                                                                                                                                                                                                                                                                                         |
| `apps/web/lib/dal/profiles.ts` (+ `profiles.test.ts`, `writes-quiet-errors.test.ts`) | EDIT. The argument; the recorded pre-read returns the seen name.                                                                                                                                                                                                                                                                                                                                                         |
| `apps/web/app/p/[profileId]/action-state.ts`                                         | EDIT. `stale`.                                                                                                                                                                                                                                                                                                                                                                                                           |
| `apps/web/app/p/profile-actions.ts` (+ test)                                         | EDIT. The parse and the map. Every rename body in the test gains a valid `seenName`, and one test pins that it reaches the DAL verbatim.                                                                                                                                                                                                                                                                                 |
| `apps/web/app/p/[profileId]/edit/rename-form.tsx` (+ test)                           | EDIT. As Acceptance 6.                                                                                                                                                                                                                                                                                                                                                                                                   |
| `apps/web/e2e/athletes.spec.ts`                                                      | EDIT. One test: two pages, rename in B to a 40-character name, Save in A at 360px.                                                                                                                                                                                                                                                                                                                                       |
| `apps/web/lib/constants.ts`                                                          | EDIT. The copy.                                                                                                                                                                                                                                                                                                                                                                                                          |
| `docs/features/write-path.md`                                                        | EDIT. The rename row: where the branch lives (in the writer, unlike the amends, so `db:verify` proves it), the `seenName` lifetime invariant, and the `seenName` lifetime. The self-match race note is **narrowed, not retired**: the replay arm covers a rival that commits before the pre-read, but one landing between the pre-read and `findNameMatch` still self-matches (the comment at `profile.ts:125-132` too). |
| `docs/tech-debt.md`                                                                  | EDIT. This entry is closed. `stale` is added to the unhydrated-refusal entry.                                                                                                                                                                                                                                                                                                                                            |
| `docs/changelog/…`                                                                   | NEW fragment.                                                                                                                                                                                                                                                                                                                                                                                                            |

**Size:** about 400–450 lines of code, tests and docs, plus this plan. That is **over the 400-line
target**. The bulk is the required argument rippling through about 15 existing proof calls and test
bodies. Splitting would ship a guard that an optional argument lets callers skip, so it stays one PR.

## Test plan

- **`db:verify`**, beside the "PROF-1 a-r" block:
  - **stale:** stored `B`, seen `A`, name `C` → `stale{current:B}`, stored still `B`;
  - **stale beats duplicate:** stored `B`, seen `A`, name equal to another live athlete's,
    unacknowledged → `stale`, not `duplicate`. This is what makes mutation **428** observable;
  - **replay:** seen `A` ≠ stored `B` = name `B` → `ok`, no write. The no-edit shape cannot tell, so
    this is what makes mutation **429** observable;
  - **the race:** a Proxy over the executor traps **`update`**, and returns a small recursive Proxy
    over the builder whose `then` first awaits a direct `UPDATE … SET name = 'Rival'` on the raw
    handle (about 12 lines). It does not reuse `program.ts`'s `stealing()`, which traps the async
    `transaction` this writer never opens.
    - The rival runs **after** the duplicate guard and just before the writer's UPDATE →
      `stale{current:'Rival'}`, stored `Rival`.
    - With the conjunct dropped the UPDATE overwrites and answers `ok`, so mutation **430** goes RED.
    - A rival that writes the submitted name proves the 0-row `ok` arm. Hooked at the pre-read
      instead, it would answer `duplicate` (the self-match below);
  - **tenancy, both directions:** `B_SCOPE` on A's athlete with a wrong `seenName`, and with
    name = A's stored name, both → `refused`, no `current`, nothing written.
- **The mutations:** `db:mutations --only 428-430`, plus `--only 13,32,33` after the re-cut.
  - **428 is cut at the pre-read's call site**, never inside the shared `classifyRename`. Cut there,
    it would land on the re-read's path and redden a different assertion.
  - **33's first red moves** to the tenancy assertion, because under 33 the re-read's `stale` would
    carry A's name to household B. Its `.expect` names that, knowingly.
- **The action:** boundary tests (Acceptance 7) and the verbatim pass-through.
- **The form:** the three-answer sequence (stale → duplicate → Save anyway), asserting `seenName` on
  the third submit; the label switch; focus; `aria-describedby`.
- **The e2e** (`athletes.spec.ts`, at `NARROW_VIEWPORT`):
  - the alert shows;
  - the field keeps its value;
  - the `h1` shows the stored name;
  - focus is in the message;
  - there is no horizontal overflow;
  - then Save anyway leaves `/edit`.

## Alternatives considered

- **The conjunct alone, with no pre-check** (scope and reuse lenses): rejected. A stale tab whose new
  name also collides would see the duplicate warning first, then `stale` on Save anyway, which is
  four taps and a misleading first answer. The interleave rig makes both checks provable, which was
  that suggestion's reason.
- **Binding `seenName` to the `name` prop** (scope and reuse lenses): rejected, because a server
  refresh would advance it silently (Acceptance 6).
- **Lock then compare in a transaction** (architecture lens): rejected for a P3. The conjunct is the
  idiom the amends use, and the interleave rig proves it behaviourally rather than by a source pin.
- **An `updated_at` token or a version column:** rejected, for the precision trap, and because a
  version column needs a migration.
- **Refusing a replay too** (the row's literal fix): rejected. A double tap would read as a failure.
- **ABA** (A→B→A between render and Save) passes the value check. That is correct by this design's
  definition: the name is what it was when shown.

## Risks / rollback

- **An unhydrated `stale` submit** re-renders the island fresh, so the field seeds from the stored
  name. A second Save is then a replay, and it answers "Name saved." for the stored name: the
  parent's typing is lost, though nothing is overwritten. This is the parked unhydrated-refusal
  debt; the entry lists it.
- **A tab opened before this deploy** lacks `seenName`. It is refused once, as a malformed body
  (`NO_ATHLETE_SAVE`), or, unverified, by Next's own unknown-action handling. Either way nothing is
  overwritten.
- **Rollback:** revert the PR. No migration is involved.

## Out-of-scope

- Moving the rename to the typed-result envelope. No row exists for it; `ActionState` forms are the
  legacy shape `add-server-action` names.
- The same race on the routine editor.
- The unhydrated `typed` echo (`td-unhydrated-refusal`).

## Open questions (for the maintainer, through the board)

1. **The refusal copy.** Option (a), reusing the amend's "the latest is showing now", is **withdrawn**:
   it is false here, because the field keeps the typing.
   - **(b)** "This name was changed on another device to “{stored}”. Save again to use yours."
   - **(c)** (recommended): "Not saved. This name was changed to “{stored}” on another device. Save
     anyway to replace it, or go back to keep it." While it shows, the button reads "Save anyway".

## Review-response log (adversarial panel)

### Engineering + UX panel (round 1), 2026-11-20

> Models: Fable for all five lenses (plan-with-panel's sanctioned model).

| #   | Lens                                 | Critique (short)                                                                                                         | Verdict      | Resolution                                                                                                                                                                           |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Correctness, Scope, Reuse (BLOCKING) | The pre-check and the conjunct mask each other, so mutations 428 and 430 cannot go RED; the staging hook does not fit.   | **accepted** | Kept both. Their order is proven by a stale-and-duplicate case (428) and an interleave Proxy (430); 429 uses the seen ≠ stored = name shape. One `classifyRename` serves both reads. |
| C2  | Correctness, Arch                    | The 0-row re-read has a third outcome (a row gone → `refused`) and must go through the scoped read.                      | **accepted** | Acceptance 2 and 4.                                                                                                                                                                  |
| C3  | Correctness, Arch                    | `stale.current` makes the pre-read's scope leak-bearing: a minor's name.                                                 | **accepted** | Tenancy proofs both ways. Mutation 33 re-pointed.                                                                                                                                    |
| C4  | Correctness, Arch                    | An optional `previousName` lets a second caller skip the guard.                                                          | **accepted** | A required positional `seenName`. Every call site updated, and the size restated honestly.                                                                                           |
| C5  | Correctness                          | Four action tests would go green for the wrong reason once the field is required.                                        | **accepted** | Every body gains a valid `seenName`; a verbatim pass-through test.                                                                                                                   |
| C6  | Correctness, Arch, UX                | The hidden field's lifetime: prop-bound advances silently; `changedTo ?? prop` loops after a duplicate.                  | **accepted** | Component state: captured at mount, advanced only on `stale`, kept across `duplicate`. A three-answer test.                                                                          |
| C7  | Correctness, Scope                   | The unhydrated path, and the parked trigger this PR fires.                                                               | **accepted** | Named in § Where this sits and § Risks; added to the unhydrated entry; not taken.                                                                                                    |
| S1  | Scope, Reuse                         | Drop `changedTo` and bind the prop.                                                                                      | **rejected** | A refresh would advance the precondition silently (C6). The payload is the typed `stale` member instead.                                                                             |
| S2  | Scope                                | Fewer mutations.                                                                                                         | **rejected** | Each of the three proves a distinct line, and each now goes RED.                                                                                                                     |
| S3  | Scope, Arch, Reuse                   | Patches 13, 32 and 33 break, and the file table and size were short.                                                     | **accepted** | Re-cut; table and size restated (over 400, with the reason).                                                                                                                         |
| A1  | Arch                                 | The response change's home (`action-state.ts`), and its shape should mirror `duplicate`.                                 | **accepted** | `stale?: { current }`, `error: null`, copy composed in the form.                                                                                                                     |
| A2  | Arch                                 | Lock then compare is missing from Alternatives.                                                                          | **accepted** | Added, and rejected for a P3.                                                                                                                                                        |
| U1  | UX (BLOCKING)                        | Copy (a) is false on this screen.                                                                                        | **accepted** | Withdrawn; the maintainer has (b) and (c).                                                                                                                                           |
| U2  | UX                                   | The overwrite was the same button.                                                                                       | **accepted** | "Save anyway", outline, while the refusal shows.                                                                                                                                     |
| U3  | UX, Reuse                            | The stored name overflows 360px in the error line.                                                                       | **accepted** | A `NAME_WRAP_CLASS` span, and an e2e overflow check.                                                                                                                                 |
| U4  | UX                                   | Wrong surface: the page-level error block, focus after Save.                                                             | **accepted** | The message sits between field and submit, takes focus, and is in `aria-describedby`.                                                                                                |
| U5  | UX                                   | Copy (b): "yours" is ambiguous, it never says "not saved", and it names one route.                                       | **accepted** | Option (c) offered.                                                                                                                                                                  |
| U6  | UX                                   | The duplicate flow is not unchanged: stale beats duplicate.                                                              | **accepted** | Stated, ordered and tested.                                                                                                                                                          |
| U7  | UX, Correctness                      | Only a browser proves the round trip, the heading and the geometry.                                                      | **accepted** | One e2e.                                                                                                                                                                             |
| R1  | Reuse, Scope, Arch                   | A third ad-hoc multiplier.                                                                                               | **accepted** | `PROFILE_ECHO_MAX`, shared with the two existing fields.                                                                                                                             |
| R2  | Reuse                                | Vocabulary: `seenValue` / `stale`.                                                                                       | **accepted** | `seenName`, `stale`.                                                                                                                                                                 |
| R3  | Reuse                                | Where the branch lives differs from the amends.                                                                          | **accepted** | The write-path guide says so: in the writer, so `db:verify` proves it.                                                                                                               |
| N   | All                                  | NITs: the untracked sheet cite, the mutation range (428–439 is lane S's own block), the stale comments, the replay's id. | **accepted** | Applied.                                                                                                                                                                             |
| X1  | Correctness (outside)                | `verify.ts:~8524` `assert.ok(renameProfile(…))` cannot fail.                                                             | **accepted** | Fixed in this PR, since that call is edited anyway.                                                                                                                                  |

### Correctness re-review (round 2), 2026-11-20

> Model: Fable, medium effort. No BLOCKING. Each of 428, 429 and 430 goes RED on its stated
> assertion, and the `seenName` lifetime is correct (no `cacheComponents`, so the form does not
> survive a navigation).

| #   | Critique (short)                                                                                                                | Verdict      | Resolution                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------- |
| R1  | Hook the rival at `update`, not at the pre-read; `stealing()` traps a transaction this writer lacks                             | **accepted** | § Test plan, the race.                                                            |
| R2  | A pre-read hook makes the "rival writes the same name" case answer `duplicate`; the self-match race is narrowed, not superseded | **accepted** | Hooked at `update`; the guide and comment narrowed.                               |
| R3  | The re-read's fourth answer ("proceed") is undefined, and reachable under mutation 33                                           | **accepted** | It answers `stale`; 33's `.expect` is re-pointed knowingly.                       |
| N   | Where 428 cuts; Enter overwrites while stale shows; the NUL note                                                                | **accepted** | 428 cuts at the call site; the sentinel is reused; the note is beside the schema. |
