import { and, eq, exists, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { schema } from '../client';

/**
 * "Does this profile have anything logged?" — **one correlated `EXISTS`, defined once** (PROF-1 b).
 *
 * Maintainer decision N3 needs it on two surfaces: Household settings disables the export control
 * with a stated reason, and the athlete's own day page does the same, because `buildExportZip`
 * otherwise returns an EOCD-only archive that iOS Files opens as nothing — indistinguishable from a
 * download that failed.
 *
 * ## 🔴 Why it is a helper and not a `sql` template at each call site
 *
 * The first version was `sql\`EXISTS (SELECT 1 FROM ${entries} WHERE ${entries.profileId} =
 * ${profiles.id} …)\`` written inline — and it was **silently uncorrelated**. Drizzle strips the
 * table qualifier from every `Column` interpolated into a `sql` chunk in a **single-table SELECT
 * list**, so it rendered:
 *
 * ```sql
 * EXISTS (SELECT 1 FROM "entries" WHERE "profile_id" = "id" AND "deleted_at" IS NULL)
 * ```
 *
 * `"id"` binds to **`entries.id`**, not `profiles.id`. The predicate became "does any live entry have
 * `profile_id` equal to its own id" — which in production (entry ids in the thousands, profile ids
 * single-digit) is almost always FALSE, so **every** archived athlete would have shown "nothing to
 * export" and no export link, which is the exact control the published notice promises. It can also
 * be TRUE for everyone, depending on the ids. A review lens caught it by dumping `.toSQL()`, and the
 * inline form had already been hand-copied to a second site, which is how a subtle defect doubles.
 *
 * The `exists()` + nested-select form keeps qualifiers, which is the whole reason to prefer it:
 *
 * ```sql
 * exists (select 1 from "entries" where ("entries"."profile_id" = "profiles"."id" and …))
 * ```
 *
 * ⚠️ **It is correlated against `profiles`,** so it is only valid in a query whose FROM includes
 * `profiles`. `db:verify` proves the VALUE (two profiles, one with a live entry and one with only a
 * soft-deleted one), and a mutation patch proves the proof can fail.
 */
export function hasLiveEntries(db: NodePgDatabase<typeof schema>) {
  // `.mapWith(Boolean)` types it as `SQL<boolean>`: `exists()` alone is `SQL<unknown>`, and an
  // `unknown` flowing into a DTO field typed `boolean` is a compile error at the mapper rather than
  // here — which is the right place for it to fail, but a worse place to read it.
  return exists(
    db
      .select({ one: sql`1` })
      .from(schema.entries)
      .where(
        and(eq(schema.entries.profileId, schema.profiles.id), isNull(schema.entries.deletedAt)),
      ),
  ).mapWith(Boolean);
}
