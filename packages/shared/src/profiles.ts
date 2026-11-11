import { z } from 'zod';

import { PROFILE_KINDS } from './enums';
import { uuidSchema } from './id';
import { collapseWhitespace, foldName, hasControlChar } from './text';

/**
 * The athlete-identity contract (PROF-1) — the name's limit, its schema, and the rename body.
 *
 * It lives in `packages/shared` rather than in the app because three consumers must agree on it: the
 * Server Action validates with it, the edit form's `maxLength` is rendered from the same number, and
 * `db:verify` stores a `PROFILE_NAME_MAX` name and reads it back, so the unbounded `text` column
 * and this cap cannot drift apart unnoticed. ⚠️ That third claim was in this docblock BEFORE the
 * assertion existed — a review lens caught it. A name limit re-typed in a form
 * attribute is how a field silently accepts 50 characters the action then rejects.
 *
 * ⚠️ **`kind` is deliberately absent from the rename body** _(maintainer, 2026-11-07)_. PROF-1 a-r is
 * **rename only**: one control serving both "I added them as the wrong kind" (where emptying past
 * `prescribed` cells is correct) and "they turned 18" (where those cells were legitimately theirs)
 * cannot tell the two apart, and the second is the realistic trigger. The `kind` radio belongs to
 * a-1's ADD form, where there is no history to rewrite. The edit page still SHOWS the kind
 * (acceptance criterion 9 asks it to show, not to edit) via `PROFILE_KIND_LABELS`.
 */

/**
 * The stored-name cap, in characters.
 *
 * 40 is the approved prototype's own `maxlength` (`docs/prototypes/crud-1/index.html:2145`, `:2164`),
 * not a fresh guess. `profiles.name` is an unbounded `text` column, so this is purely the app-input
 * limit — the same relationship `FREE_TEXT_NOTE_MAX` has to `entries.notes`.
 */
export const PROFILE_NAME_MAX = 40;

/**
 * The message a blank or unrenderable name gets. Here rather than inline in the schema because the
 * e2e asserts it — and it re-typed the literal until a reuse lens pointed out that a test must use
 * the same const as the app.
 */
export const NAME_REQUIRED_MESSAGE = 'Enter a name.';

/**
 * An athlete's name, as the app accepts it.
 *
 * The transform order is the contract, because the STORED value is what comes out of it:
 *
 *  1. `.trim()` — leading/trailing whitespace is never meaningful in a name.
 *  2. **collapse every run of whitespace to one space** — so `'a   b'` stores as `'a b'`, and a tab
 *     or a stray line break pasted from a spreadsheet becomes an ordinary space rather than a
 *     refusal. Here rather than only in `foldName` because the stored name, the duplicate warning
 *     (a-1d) and A3's typed-match confirmation all have to agree about what was saved; a name that
 *     displays with three spaces and folds with one makes the warning read as nonsense.
 *  3. **reject any control character that SURVIVES the collapse** — i.e. the non-whitespace ones:
 *     NUL, BEL, the C1 block.
 *     🔴 **This order is the second correction to this schema, and the first one over-corrected.**
 *     Round one put a `hasLineBreak` refine AFTER the collapse, where it could never fire (the
 *     collapse had already turned `'Ada\nMae'` into `'Ada Mae'`) — a guard that read as present and
 *     did nothing. Round two moved a `hasControlChar` refine BEFORE the collapse, which fired, and
 *     then **refused `'Ada\tMae'`** — a tab is `\p{Cc}`, and a spreadsheet paste is a real way to
 *     enter a name. Collapsing first and checking after is what both rounds were reaching for.
 *     ⚠️ **What makes the check load-bearing is NUL, not CR/LF.** `'\u0000Ada'` passed the old
 *     line-break check, reached Postgres, and `text` rejects a NUL byte — so the action **threw**
 *     and the parent got `error.tsx` instead of the typed envelope the convention exists for
 *     (probed). ⚠️ Unlike `freeTextNoteSchema`'s line-break guard, this is NOT a CSV-contract rule:
 *     `profiles.name` never reaches an export, so a line break here cannot split a record — which is
 *     exactly why turning it into a space is the right answer and refusing it was not.
 *  4. `1..PROFILE_NAME_MAX` — measured AFTER collapsing, so whitespace cannot buy length.
 *  5. **reject a name that folds to `''`** — a name of only combining marks, or only zero-width
 *     FORMAT characters. It would be stored, rendered as nothing, and compared as the empty string
 *     against every other such name. This is the guard that lets `foldName` be lossy (see its
 *     docblock). ⚠️ It only works because `foldName` strips `\p{Cf}` as well as `\p{M}`: before it
 *     did, `'\u200b'` folded to itself, passed this check, and stored a picker tile with no
 *     readable name (probed). The guard and the fold are one mechanism, not two.
 *
 * The messages are the ones the form shows, so they are authored here rather than at the use site.
 *
 * 🔴 **Steps 4 and 5 are ONE `superRefine`, not two `.refine`s, and the reason is user-facing.**
 * `.refine` does not abort the chain, so a whitespace-only name failed BOTH the length check and the
 * fold check — and the form, which joins the field's messages, rendered **"Enter a name. Enter a
 * name."** Caught in a screenshot, not by a test that only counted messages. Two different conditions
 * can share one correct answer; what the person must not see is that answer twice.
 */
export const athleteNameSchema = z
  .string()
  .trim()
  .transform(collapseWhitespace)
  .refine((v) => !hasControlChar(v), 'A name can’t contain control characters.')
  .superRefine((v, ctx) => {
    // Empty and folds-to-empty are distinct failures with the same answer: there is nothing here a
    // person would recognise as a name. One issue, then stop.
    if (v.length === 0 || foldName(v) === '') {
      ctx.addIssue({ code: 'custom', message: NAME_REQUIRED_MESSAGE });
      return;
    }
    if (v.length > PROFILE_NAME_MAX) {
      ctx.addIssue({ code: 'custom', message: `Use ${PROFILE_NAME_MAX} characters or fewer.` });
    }
  });

/**
 * The rename body — a public profile id plus the new name, and nothing else.
 *
 * ⚠️ **`.strict()` is deliberately NOT used**, for the reason every other action here skips it: the
 * body arrives as `FormData`, which React's Server Action encoding decorates with its own fields, so
 * a strict object would reject every real submit. Extra keys are ignored because the action reads
 * only what it names.
 */
export const renameAthleteSchema = z.object({
  profileId: uuidSchema,
  name: athleteNameSchema,
  /**
   * PROF-1 a-1d-ren — the duplicate warning's acknowledgement, the same shape and the same
   * reasoning as `addAthleteSchema`'s: a FOLDED NAME rather than a boolean, so consent to one name
   * cannot wave a different one through after an edit; bounded, because NFKD can expand 40
   * characters into several hundred; compared, never stored.
   *
   * ⚠️ **Not a protection.** A crafted body can forge it. Duplicates are advisory on rename too.
   */
  acknowledgedDuplicate: z
    .string()
    .max(PROFILE_NAME_MAX * 20)
    .optional(),
});

export type RenameAthleteInput = z.infer<typeof renameAthleteSchema>;

/**
 * The body of an athlete action that needs **only an id** — archive and restore both (PROF-1 b).
 *
 * 🔴 **ONE schema for both, deliberately.** They are the same body, and writing
 * `archiveAthleteSchema` beside an identical `restoreAthleteSchema` is the duplication the
 * maintainer's N4 rule names: a block that appears twice gets parameterized at the second copy. Here
 * there is nothing to parameterize — the two bodies are identical — so there is one schema and the
 * **authority** difference lives where it belongs, in the writers' parameter types (`OwnerScope` vs
 * `HouseholdScope`). A second schema would imply the two bodies could diverge, which is precisely the
 * drift a shared contract exists to prevent.
 *
 * ⚠️ No `.strict()`, for the reason `renameAthleteSchema` gives: `FormData` arrives with React's own
 * fields on it.
 */
export const athleteActionSchema = z.object({
  profileId: uuidSchema,
});

export type AthleteActionInput = z.infer<typeof athleteActionSchema>;

/**
 * The refusal when nothing is chosen, or when a crafted body sends a value that is not a kind
 * (PROF-1 a-1).
 *
 * 🔴 **Authored here, and asserted here, because zod's default leaks the schema's vocabulary.**
 * Probed on the pinned zod (4.6.7), `profileKindSchema` with no `message` emits
 * `Invalid option: expected one of "kid"|"adult"` — the raw enum VALUES. ⚠️ **`kid` is exactly the
 * word that must never reach a screen** _(maintainer, 2026-11-09)_: the column stores `kid` and every
 * surface renders it as **"Child"** through `PROFILE_KIND_LABELS`. #349 already removed a `Kind`
 * label from the rename screen on the same ground.
 *
 * So the message says what a person chooses between, in their words, and `profiles.test.ts` pins the
 * string — the same way `athleteNameSchema`'s messages are authored at the schema rather than at the
 * use site.
 */
export const CHOOSE_KIND_MESSAGE = 'Choose Child or Adult.';

/**
 * How many athletes one household may hold _(maintainer, 2026-11-09: **25**)_.
 *
 * 🔴 **A create with no in-app delete needs a quota, and the mutation limiter is not one.**
 * `MUTATION_RATE_LIMIT` is 120 attempts / 5 min **per principal** and `checkMutationLimit`
 * **fails open** when Upstash is unconfigured or erroring — so one invited member can mint ~34,500
 * profiles a day, or an unbounded number with Redis down. The rows are not stolen data (the names are
 * the caller's own); what makes them a problem is that **nothing in the app can remove one**
 * (archive is owner-only and hides rather than deletes), and that `householdProfileRows` has no
 * `LIMIT` and runs one `EXISTS` per row on the single Neon project every household shares.
 *
 * ⚠️ **Revisit condition, recorded beside the number because that is where it will be read**
 * _(maintainer, 2026-11-09: "we can revisit if we ever surface a delete")_: 25 is sized for a world
 * where a wrong row is permanent without the operator. Whichever chunk ships an in-app per-profile
 * delete (`A3` / `V1-9b`) changes that arithmetic and re-opens this number.
 *
 * ⚠️ **It is a count-then-insert, so a concurrent burst OVERSHOOTS it** — N requests that all read
 * `count < 25` before any commits all insert. Written down rather than locked: the rows are the
 * caller's own household, and 25 is not a correctness boundary the way a tenancy predicate is — it is
 * a brake on unbounded growth. **What it means for the claim above: the cap bounds the steady state,
 * not a single burst.** A `pg_advisory_xact_lock` per household inside `ownership.ts` (the one module
 * that may unwrap `scope.householdId`) would close it; it is filed in
 * [tech-debt.md](../../../docs/tech-debt.md) rather than fixed here, because it changes the
 * `Executor` contract on the write path and that belongs in its own reviewed chunk.
 *
 * 🔴 **An earlier draft of this paragraph said the burst "is bounded by the limiter", which the
 * paragraph above contradicts** — `checkMutationLimit` fails open, so with Upstash down there is no
 * limiter to bound it and the only ceiling is Neon's connection count. A security lens caught the two
 * halves of one docblock disagreeing. The honest statement is the one now above it.
 *
 * In `packages/shared` because three consumers must agree: the writer enforces it, the DAL maps the
 * refusal, and the copy says what the limit is.
 */
export const MAX_HOUSEHOLD_ATHLETES = 25;

/**
 * The add-an-athlete body (PROF-1 a-1).
 *
 * `clientId` is the device-generated idempotency key (D1/D2): the form mints one per mount, and the
 * writer looks it up **inside the scope** before inserting, so a double submit returns the first
 * row instead of a twin. ⚠️ It is **never rendered, exported or logged** — `uq_profiles_client_id` is
 * global and non-partial, so a key that escaped would let another household probe for it.
 *
 * No `.strict()`, for the reason `renameAthleteSchema` gives: `FormData` arrives with React's own
 * fields on it.
 */
export const addAthleteSchema = z.object({
  name: athleteNameSchema,
  // The VALUES come from the shared const (never a second enum); only the MESSAGE is authored here.
  kind: z.enum(PROFILE_KINDS, { error: CHOOSE_KIND_MESSAGE }),
  clientId: uuidSchema,
  /**
   * The FOLDED name the caller was warned about (PROF-1 a-1d), present only on a re-confirm.
   *
   * 🔴 **A folded NAME, never a boolean.** A boolean would let consent to "Ada" wave "Bea" through:
   * the parent acknowledges a warning, edits the field, and the acknowledgement is still set. The
   * server compares this to `foldName(parsed.name)`, so an acknowledgement only ever skips the check
   * for the name it was actually shown for.
   *
   * ⚠️ **`.optional()` means `undefined`, and `formData.get()` returns `null`.** The action must read
   * it as `?? undefined` — `z.string().optional().safeParse(null)` is **false** (probed), and a parse
   * failure here would break every ORDINARY add while rendering nothing, since no visible field is
   * named in the error.
   *
   * ⚠️ **Bounded.** NFKD can expand 40 characters into several hundred, and a crafted body can send
   * anything. It is compared, never stored.
   *
   * ⚠️ **Not a protection.** A crafted body can always forge it; duplicates are advisory, not a
   * boundary. Nothing should describe this field as a security control.
   */
  acknowledgedDuplicate: z
    .string()
    .max(PROFILE_NAME_MAX * 20)
    .optional(),
});

export type AddAthleteInput = z.infer<typeof addAthleteSchema>;
