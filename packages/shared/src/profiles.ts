import { z } from 'zod';

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
      ctx.addIssue({ code: 'custom', message: 'Enter a name.' });
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
});

export type RenameAthleteInput = z.infer<typeof renameAthleteSchema>;
