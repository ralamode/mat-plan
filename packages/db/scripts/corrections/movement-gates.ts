import {
  isCountableMovementFk,
  movementFkTable,
  type MovementForeignKey,
  type MovementReferenceCount,
} from '../../src/queries/movement-ownership';

/**
 * The gate of the fresh start's step 5, `delete-legacy-movements-2026-11-20` (CAT-3 R1; plan
 * `docs/plans/priv-3-fresh-start-prep.md`, D2). Pure, so every branch is unit-tested here
 * (`movement-gates.test.ts`) rather than only through a database.
 *
 * It is the deletion's only guard: the entry is not limited to production (D2), so what keeps it
 * from removing a movement anything still needs is the reference refusal, read from the catalog.
 */

/** The three counts `--apply` must be given back, each the number the dry run printed. */
export const EXPECT_LEGACY_MOVEMENTS = 'EXPECT_LEGACY_MOVEMENTS';
export const EXPECT_LEGACY_EQUIPMENT = 'EXPECT_LEGACY_EQUIPMENT';
export const EXPECT_LEGACY_MUSCLES = 'EXPECT_LEGACY_MUSCLES';

/** What step 5 deletes: the legacy movements and their two join tables' rows. */
export type LegacyMovementCounts = {
  readonly movements: number;
  readonly equipment: number;
  readonly muscles: number;
};

/** Each count's environment name, in the order the lines print them. */
export const LEGACY_COUNT_ENV = {
  movements: EXPECT_LEGACY_MOVEMENTS,
  equipment: EXPECT_LEGACY_EQUIPMENT,
  muscles: EXPECT_LEGACY_MUSCLES,
} as const satisfies Record<keyof LegacyMovementCounts, string>;

/**
 * What `--apply` was given: each count parsed (`parseExpectedRows`), `null` when unset or not a whole
 * number. `'dry-run'` skips the comparison, so a dry run reports only the refusals `--apply` would hit.
 */
export type ExpectedLegacyCounts =
  { readonly [K in keyof LegacyMovementCounts]: number | null } | 'dry-run';

const NO_ACTION_OR_RESTRICT = ['a', 'r'];

/**
 * Why step 5 must not delete what it found, or `null` when it may. The caller has already returned
 * "nothing to do" when `found` is empty.
 *
 * - `foreignKeys`: every key into `movements` (`foreignKeysIntoMovements`), the join tables included.
 *   A key that is not one column onto `movements.id` refuses, never a skip: its references cannot be
 *   counted. A key whose delete rule is not NO ACTION or RESTRICT refuses: a `SET NULL` or `CASCADE`
 *   edge would let the delete change rows silently (the household graph's `NON_ABORTING_EDGES`).
 * - `references`: each countable key's rows on a found movement, hidden rows included. Any refuses.
 * - `expected` and `found`: under `--apply`, each count must be given and equal.
 *
 * Every message is built from table names, column names and counts only: never a row's value.
 */
export function legacyMovementDeletionIssue({
  foreignKeys,
  references,
  expected,
  found,
}: {
  readonly foreignKeys: readonly MovementForeignKey[];
  readonly references: readonly MovementReferenceCount[];
  readonly expected: ExpectedLegacyCounts;
  readonly found: LegacyMovementCounts;
}): string | null {
  const uncountable = foreignKeys.filter((fk) => !isCountableMovementFk(fk));
  if (uncountable.length > 0) {
    return (
      `the foreign key from ${uncountable.map(movementFkTable).join(', ')} into movements is not ` +
      'one column onto movements.id, so its references cannot be counted; nothing deleted'
    );
  }
  const nonAborting = foreignKeys.filter((fk) => !NO_ACTION_OR_RESTRICT.includes(fk.deleteRule));
  if (nonAborting.length > 0) {
    return (
      `the foreign key from ${nonAborting.map(movementFkTable).join(', ')} into movements does not ` +
      'abort a delete (not NO ACTION or RESTRICT), so the delete could change its rows silently; ' +
      'nothing deleted'
    );
  }
  const referenced = references.filter((r) => r.rows > 0);
  if (referenced.length > 0) {
    return (
      `${referenced.map((r) => `${r.table}.${r.column}: ${r.rows} row(s)`).join(', ')} still ` +
      'reference a legacy movement (hidden rows included); nothing deleted'
    );
  }
  if (expected === 'dry-run') return null;
  const keys = Object.keys(LEGACY_COUNT_ENV) as (keyof LegacyMovementCounts)[];
  const missing = keys.filter((k) => expected[k] === null);
  if (missing.length > 0) {
    return (
      `--apply needs ${missing.map((k) => LEGACY_COUNT_ENV[k]).join(', ')}, the count(s) this ` +
      "sitting's dry run printed; nothing deleted"
    );
  }
  const differ = keys.filter((k) => expected[k] !== found[k]);
  if (differ.length > 0) {
    return (
      `found ${differ.map((k) => `${found[k]} ${k}`).join(', ')} but ` +
      `${differ.map((k) => `${LEGACY_COUNT_ENV[k]} is ${expected[k]}`).join(', ')}: rolled back, ` +
      'nothing deleted; re-run the dry run'
    );
  }
  return null;
}
