import { movementSlug, newId } from '@mat-plan/shared';
import { eq } from 'drizzle-orm';

import { schema } from '../client';
import type { Executor } from './executor';

/**
 * Find-or-create a `movements` row from a free-text movement name, and return its internal id.
 *
 * Idempotent by `slug` (UNIQUE): `INSERT … ON CONFLICT DO NOTHING`, then select the id. The slug is
 * derived once through the shared `movementSlug` — the same derivation the V1-1b migration backfill
 * used — so a v0 free-text name and a seeded catalog name converge on the same row.
 *
 * ## ⚠️ This is the one write path in the app that is NOT household-scoped, and it cannot be
 *
 * `movements` has **no `household_id` column at all** — the table is global reference data seeded
 * from `packages/shared`, and the slug is its natural key. So this function is **cross-tenant by
 * construction**:
 *
 * - a household typing a name another household already created is handed **that household's row**,
 *   with its `name`, `is_bodyweight` and `unit_default`, which
 *   `packages/db/src/queries/program-day.ts` reads onto the other household's Today card as *"the
 *   MOVEMENT's declaration"*;
 * - whichever household types a name **first** pins that slug's row permanently. `ON CONFLICT DO
 *   NOTHING` means the second household's text is discarded, and the catalog seed only ever touches
 *   its **own** slugs, so nothing repairs a custom row afterwards;
 * - this function can only ever write `is_bodyweight: false` and **no** `unit_default`, so a
 *   movement first typed by one household is declared loaded-with-no-default-unit for everybody.
 *
 * TEN-1 **cannot** fix that: the fix is a `household_id` column plus partial unique indexes built
 * `CONCURRENTLY`, which is **TEN-2** ([plan.md](../../../../docs/plan.md) → TEN-2). What TEN-1 owns is
 * the **verdict**, and the reason this core exists at all is that the verdict had to be *proved*
 * rather than asserted: `apps/web/lib/dal/catalog.ts` is `server-only` and imports the app's env, so
 * `db:verify` cannot execute it, and re-typing these two statements in the proof would have made the
 * proof a lookalike of the code instead of the code itself (the `householdProfileRows` /
 * `liveHouseholdIds` precedent). `packages/db/scripts/verify.ts` → *"TEN-1 1d: the catalog verdict"*
 * runs **this** function, in both directions.
 *
 * ⚠️ **It takes no `HouseholdScope`, and a future reader must not add one that does nothing.** There
 * is no column to scope by; a parameter that is accepted and ignored would be worse than the honest
 * absence, because `apps/web/lib/dal/scoped.test.ts` allowlists the caller **by name** with this
 * reason beside it, and TEN-2 is what removes that entry.
 */
export async function findOrCreateMovement(exec: Executor, name: string): Promise<number> {
  const slug = movementSlug(name);
  await exec
    .insert(schema.movements)
    .values({ publicId: newId(), slug, name, isBodyweight: false })
    .onConflictDoNothing({ target: schema.movements.slug });

  const [row] = await exec
    .select({ id: schema.movements.id })
    .from(schema.movements)
    .where(eq(schema.movements.slug, slug))
    .limit(1);
  if (!row) throw new Error(`movement not found after upsert for slug: ${slug}`);
  return row.id;
}
