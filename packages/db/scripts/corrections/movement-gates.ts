import { parseExpectedRows } from './erasure-gates';
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

/** One `EXPECT_LEGACY_*` as given: a whole number, unset, or something else. */
export type ExpectedLegacyCount = number | 'unset' | 'malformed';

/**
 * What `--apply` was given (`parseExpectedLegacyCounts`). `'dry-run'` skips the comparison, so a dry
 * run reports only the refusals `--apply` would hit.
 *
 * ⚠️ **A restatement of the current counts, not a binding to one dry run** (as R0's
 * `EXPECT_ERASED_ROWS`): a bare `--apply` refuses, and so does an earlier number once a count has
 * changed, but a stale number that still equals the count passes. It is compared under the lock.
 */
export type ExpectedLegacyCounts =
  { readonly [K in keyof LegacyMovementCounts]: ExpectedLegacyCount } | 'dry-run';

/** Each `EXPECT_LEGACY_*` read through `read` (the environment, in the entry). */
export function parseExpectedLegacyCounts(
  read: (name: string) => string | undefined,
): Exclude<ExpectedLegacyCounts, 'dry-run'> {
  const one = (name: string): ExpectedLegacyCount => {
    const raw = read(name);
    if (raw === undefined || raw.trim() === '') return 'unset';
    return parseExpectedRows(raw) ?? 'malformed';
  };
  return {
    movements: one(LEGACY_COUNT_ENV.movements),
    equipment: one(LEGACY_COUNT_ENV.equipment),
    muscles: one(LEGACY_COUNT_ENV.muscles),
  };
}

/**
 * Under `--apply`, step 5 reads `DATABASE_URL_UNPOOLED` only (`correctionTargetUrl({ kind:
 * 'erasure' })`): never a `DATABASE_URL` fallback, which is pooled or a leftover local string. Not a
 * production gate (D2 has none on purpose), only "the operator named the direct string".
 */
export function legacyMovementTargetIssue(url: string | undefined): string | null {
  return url === undefined || url === ''
    ? 'DATABASE_URL_UNPOOLED is not set: step 5 writes through the direct string only; nothing deleted'
    : null;
}

/**
 * After the three deletes: each deleted count must equal the count found under the lock, or the
 * transaction rolls back. A row the lock held cannot vanish, but a rule or trigger that skips a
 * delete would, and this is the last check before commit.
 */
export function deletedCountIssue(
  found: LegacyMovementCounts,
  deleted: LegacyMovementCounts,
): string | null {
  const differ = (Object.keys(LEGACY_COUNT_ENV) as (keyof LegacyMovementCounts)[]).filter(
    (k) => deleted[k] !== found[k],
  );
  return differ.length > 0
    ? `the delete removed ${differ.map((k) => `${deleted[k]} ${k}`).join(', ')}, not the locked ` +
        'count: rolled back, nothing deleted; re-run the dry run'
    : null;
}

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
 * - `expected` and `found`: under `--apply`, each count must be given, a whole number, and equal.
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
  const missing = keys.filter((k) => expected[k] === 'unset');
  if (missing.length > 0) {
    return (
      `--apply needs ${missing.map((k) => LEGACY_COUNT_ENV[k]).join(', ')}, a restatement of the ` +
      'current count(s) the dry run prints; nothing deleted'
    );
  }
  const malformed = keys.filter((k) => expected[k] === 'malformed');
  if (malformed.length > 0) {
    return `${malformed.map((k) => LEGACY_COUNT_ENV[k]).join(', ')} is not a whole number; nothing deleted`;
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
