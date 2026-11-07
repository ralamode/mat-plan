import { z } from 'zod';

import { uuidSchema } from './id';
import { foldName, hasLineBreak } from './text';

/**
 * The athlete-identity contract (PROF-1) — the name's limit, its schema, and the rename body.
 *
 * It lives in `packages/shared` rather than in the app because three consumers must agree on it: the
 * Server Action validates with it, the edit form's `maxLength` is rendered from the same number, and
 * `db:verify` asserts the column accepts what the schema accepts. A name limit re-typed in a form
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
 *  2. **reject a line break.** 🔴 **It must come BEFORE the collapse, not after** — probed: the
 *     collapse turns `'Ada\nMae'` into `'Ada Mae'`, so a check placed downstream of it can never
 *     fail and the guard reads as present while doing nothing. The trim already stripped
 *     leading/trailing breaks, so what this refuses is an INTERIOR one. A `<input type="text">`
 *     strips CR/LF on paste, so the only way to reach it is a crafted body: a trust-boundary guard,
 *     not an ergonomic one, same as `freeTextNoteSchema`.
 *  3. **collapse interior whitespace** — so `'a   b'` stores as `'a b'`. Here rather than only in
 *     `foldName` because the stored name, the duplicate warning (a-1d) and A3's typed-match
 *     confirmation all have to agree about what was saved; a name that displays with three spaces
 *     and folds with one makes the warning read as nonsense.
 *  4. `1..PROFILE_NAME_MAX` — measured AFTER collapsing, so whitespace cannot buy length.
 *  5. **reject a name that folds to `''`** — a name of only combining marks. It would be stored,
 *     rendered as nothing, and compared as the empty string against every other such name. This is
 *     the guard that lets `foldName` be lossy (see its docblock).
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
  .refine((v) => !hasLineBreak(v), 'A name has to be a single line.')
  .transform((v) => v.replace(/\s+/gu, ' '))
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
