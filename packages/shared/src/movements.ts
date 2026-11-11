import { z } from 'zod';

import { hasALetter, hasCommaOrLineBreak } from './text';

/**
 * `movement.pattern` — the movement-pattern taxonomy used to group lifts (spec.md §4).
 * Text + CHECK (a structural enum, not a reference table). One list; the DB CHECK on
 * `movements` mirrors these literals (coverage test with the catalogs at V1-2).
 */
export const MOVEMENT_PATTERNS = [
  'squat',
  'hinge',
  'horizontal_push',
  'vertical_push',
  'horizontal_pull',
  'vertical_pull',
  'lunge',
  'jump',
  'core',
  'carry',
  'isolation',
] as const;

export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export const movementPatternSchema = z.enum(MOVEMENT_PATTERNS);

/**
 * Derive a `movements.slug` from a free-text movement name — the v0→v1 bridge
 * (the v0 strength form submits a free-text name; the movement picker is V1-8).
 * ONE definition so the DAL's find-or-create and the V1-1b migration backfill
 * produce the SAME slug (AGENTS.md constants convention — reuse small logic too).
 * The migration's SQL mirrors this exactly:
 *   `lower(regexp_replace(btrim(name), '\s+', '_', 'g'))`.
 */
export function movementSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * The app-input cap on a movement NAME. The column is unbounded `text`, so this is the boundary's
 * limit, not the schema's — named here (AGENTS.md constants) because it was an inline `.max(100)` on
 * `sessionMovementSchema.movementName` and PICK-1, `MOV-1` and `V1-22` A4 all need the same number.
 * A contract test pins the value once.
 */
export const MOVEMENT_NAME_MAX = 100;

/**
 * Every refusal a movement name can earn, named so a test asserts the CONSTANT and not a re-typed
 * string (AGENTS.md → "Tests use the same constant as the app"). Four rules, two of which apply only
 * to text a person TYPED — see {@link typedMovementNameIssues}.
 *
 * ⚠️ **`missing` reads "Choose a movement.", not "Enter a movement."** _(PICK-1 Decision 1, a
 * deliberate copy change.)_ After PICK-1 PR 4 the field is a button that opens a picker, not a text
 * box, so "enter" names an interaction the screen no longer offers. The old string shipped from
 * `strength-session.ts`'s inline `.min(1)`; tests asserting it change with it.
 */
export const MOVEMENT_NAME_MESSAGES = {
  missing: 'Choose a movement.',
  tooLong: 'That movement name is too long.',
  commaOrLineBreak: 'A movement name can’t contain a comma or a line break.',
  noLetter: 'A movement name needs at least one letter.',
} as const;

/**
 * The LABEL shape: trimmed, non-empty, capped. What a movement name must satisfy **however it
 * arrived** — typed by a person or handed over by the database on PICK-1's id path.
 *
 * 🔴 **The two rules below are NOT here, and that is the point** (PICK-1 Decision 1, correctness
 * S1). An id-resolved movement's `movementName` is `movements.name` read from the row the submitted
 * public id names, so refusing it for a comma would refuse a row the household cannot even edit yet
 * (`MOV-1` is what makes a name fixable). The id decides; the name is a label.
 */
export const movementLabelSchema = z
  .string()
  .trim()
  .min(1, MOVEMENT_NAME_MESSAGES.missing)
  .max(MOVEMENT_NAME_MAX, MOVEMENT_NAME_MESSAGES.tooLong);

/**
 * The messages a TYPED movement name earns — the rules that apply to free text and not to a label
 * the database supplied. **One definition, two consumers**, which is why it is a function returning
 * messages rather than two `.refine()` calls copied into each:
 *
 * 1. {@link movementNameSchema}, the standalone schema `MOV-1`'s rename and `V1-22` A4 import;
 * 2. `logStrengthSessionSchema`'s `superRefine`, which cannot use that schema directly — it must
 *    report at `['movements', i, 'movementName']`, the path the action's `Movement N: …` mapping
 *    already understands, and only for movements WITHOUT a `movementPublicId`.
 *
 * A third typed-name rule added here therefore reaches both. Returns `[]` for an acceptable name.
 *
 * ⚠️ The comma rule is a CSV-contract guard, not an ergonomic one: `movements.name` and
 * `entries.movement_name` are both joined raw into the export, so a comma shifts every later field
 * in the row (`packages/shared/src/text.ts`). `"` stays legal — `30" Box Jump` is real data.
 */
export function typedMovementNameIssues(value: string): readonly string[] {
  const issues: string[] = [];
  if (hasCommaOrLineBreak(value)) issues.push(MOVEMENT_NAME_MESSAGES.commaOrLineBreak);
  if (!hasALetter(value)) issues.push(MOVEMENT_NAME_MESSAGES.noLetter);
  return issues;
}

/**
 * A movement name a person TYPED — the label shape plus {@link typedMovementNameIssues}' rules.
 *
 * The session schema deliberately does **not** use this (see that function's note 2); its consumers
 * are the surfaces where a name is the whole input: `MOV-1`'s rename and `V1-22` A4's authored
 * movement names. Kept here rather than in either of those so the four rules have one home.
 */
export const movementNameSchema = movementLabelSchema.superRefine((value, ctx) => {
  for (const message of typedMovementNameIssues(value)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }
});
