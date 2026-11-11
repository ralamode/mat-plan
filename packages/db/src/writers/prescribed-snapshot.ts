import { liveMatchesByKey } from '@mat-plan/shared/csv';
import { dayRoleSchema } from '@mat-plan/shared';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { programDayRows } from '../queries/program-day';
import type * as schema from '../schema';
import type { HouseholdScope } from '../scope';

/**
 * What was prescribed, frozen at log time (V1-22 chunk 2).
 *
 * The contract is `docs/plans/v1-22-2-renderer-and-writer.md` — read its **§ Decisions** first; D1
 * reshaped this after the panel, and the sections above it describe the superseded design.
 *
 * ## Why freezing at all
 *
 * `entries.prescribed_snapshot` shipped dark in chunk 1. Until something writes it, the export
 * reconstructs `prescribed` from **today's** program, which is safe only while prescriptions are
 * seed-immutable — and chunk 4 makes them editable. Without this, chunk 4's first edit silently
 * rewrites the `prescribed` column of every historical month.
 *
 * ## 🔴 The two rules, and why rule 2 is "freeze, don't leave NULL"
 *
 * 1. **No asserted `dayRole` → no snapshot, and no query.** Not an optimisation: the legacy fallback
 *    keys on `sessions.day_role`, so a session logged as "Not a programmed day" emits `''` for every
 *    row. Snapshotting it would make the two paths disagree on a shape the form produces in one tap.
 * 2. **A day role IS asserted → always freeze**, even when nothing matches. The first draft left
 *    NULL on a miss and called it "degrades to today's behaviour". It does not, past chunk 4: a NULL
 *    row re-runs the LIVE fallback at every export, so every later edit rewrites it. That is not an
 *    edge — it is every hand-typed movement, every card whose name was touched, and every day-role
 *    flip. Freezing what the legacy path would have emitted *at that moment* makes the row stable,
 *    and leaves NULL meaning exactly one thing.
 *
 * **So NULL means "logged before chunk 2, or logged with no day role"** — nothing else. Chunk 3's
 * backfill reasons from that, and `spec` R1 (upheld as D2) has it write `''`, never NULL.
 */

/**
 * ⚠️ **Read OUTSIDE the transaction, deliberately.** Under READ COMMITTED a single statement already
 * sees one snapshot, so moving it inside buys nothing; and acceptance 9 asks for a point-in-time
 * read at server receipt, which is what this is. It is the same pre-transaction seam the DAL already
 * uses to resolve movements. (An earlier draft justified this with a typecheck argument that was
 * simply false — `packages/db` has its own tsconfig and is covered.)
 *
 * Returns `movementId → rendered string`. A movement absent from the map gets **no** snapshot
 * (NULL); one present gets its string, which may legitimately be `''`.
 */
export async function prescribedSnapshotsFor(
  db: NodePgDatabase<typeof schema>,
  args: {
    profilePublicId: string;
    scope: HouseholdScope;
    dayRole?: string;
    movementIds: readonly number[];
  },
): Promise<Map<number, string>> {
  const out = new Map<number, string>();

  // Rule 1. ⚠️ Narrowed by the SCHEMA, not an `as DayRole` cast: `verify.ts` and a future
  // `/api/sync` reach this writer without passing through the app's zod boundary, so an unknown
  // role must be refused here rather than handed to a typed query that would silently return [].
  const role = dayRoleSchema.safeParse(args.dayRole);
  if (!role.success) return out;
  if (args.movementIds.length === 0) return out;

  const rows = await programDayRows(db, {
    profilePublicId: args.profilePublicId,
    dayRole: role.data,
    scope: args.scope,
  });

  // 🔴 The SAME function the export's fallback calls. Not a second composer tested to agree with
  // the first — acceptance 11 is structural here, which is the whole reason it was hoisted.
  const byMovement = liveMatchesByKey(rows);

  for (const movementId of args.movementIds) {
    const text = byMovement.get(movementId);
    // Rule 2: a day role was asserted, so every movement freezes. `undefined` is "not in today's
    // program" and `null` is "ambiguous"; both render `''`, which is exactly what the legacy
    // fallback emits for them — so the frozen value equals what the live path said at this moment.
    //
    // ⚠️ `text ?? ''`, NEVER `text || ''`. They differ on the DOMINANT shape: an `open()`
    // prescription renders `''`, 11 of the 13 seeded, and `||` would be indistinguishable from the
    // no-match case here while quietly collapsing them. The distinction is the point of the column.
    out.set(movementId, text ?? '');
  }
  return out;
}
