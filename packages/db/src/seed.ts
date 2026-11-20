import {
  ACTIVITY_CATEGORY_ROWS,
  HOUSEHOLD_DEFAULT_NAME,
  EQUIPMENT,
  MUSCLES,
  ACTIVITY_TYPE_SEED_ROWS,
  type CatalogLibraryName,
  type CatalogMovement,
  isFixturesDatabase,
  METRIC_DEFINITION_SEED_ROWS,
  MOVEMENT_SEED_ROWS,
  MUSCLE_ROLE,
  newId,
  PROGRAM_SEED,
  QUANTITY_SLOT_ROWS,
  type ProgramBlockSeedRow,
  type RoutineConfig,
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_2_NAME,
  SEED_PROFILE_2_PUBLIC_ID,
  SEED_PROFILE_3_NAME,
  SEED_PROFILE_3_PUBLIC_ID,
  SEED_PROFILE_4_NAME,
  SEED_PROFILE_4_PUBLIC_ID,
  SEED_PROFILE_NAME,
  SEED_PROFILE_PUBLIC_ID,
  UNITS,
} from '@mat-plan/shared';
import { CATALOG_MOVEMENTS } from '@mat-plan/shared/catalog/data';
import { CATALOG_FIXTURE } from '@mat-plan/shared/catalog/fixture';
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema';
import { householdScopeForScript } from './writers/household-scope-script';
import {
  inHousehold,
  movementIsCatalog,
  movementIsGlobal,
  movementIsOwned,
  programBlockIsLegacy,
} from './writers/ownership';
import { seedProgramFixtures } from './writers/program/seed-fixtures';

/**
 * The PRE-ONB-0 default routine, written out explicitly — the full `ROUTINE_CATALOG` order
 * (strength → check-ins → life).
 *
 * ONB-0 narrowed what a NULL `routine_config` falls back to, from the whole catalog down to
 * `['strength']`, so that a brand-new household no longer inherits this household's ~17 controls. Profile
 * 1 was NULL and therefore rode that fallback, which means two things it is this literal's job to fix:
 *
 *  1. **Fixtures.** `e2e/global.setup.ts` warms the check-ins path by submitting `Splits` on profile 1,
 *     and the V0-11 smoke drives `Rice bucket` + `Pressure` (a `brush_teeth` metric) there. Under the
 *     neutral fallback those controls stop rendering and the setup project fails, taking the whole suite
 *     with it. Writing the routine explicitly keeps every existing spec green with no spec edits.
 *  2. **The live household.** A seed cannot fix the row that already exists (`onConflictDoNothing` below),
 *     so the matching correction `null-routine-to-full-2026-10-07` writes this same config to any live
 *     profile whose `routine_config` is NULL. Run it BEFORE the deploy: it writes what the app renders
 *     today, so it is a no-op from the household's point of view.
 *
 * ⚠️ Hand-authored because `packages/db` cannot import the app-side `ROUTINE_CATALOG` (it is derived from
 * `LIFE_ACTIVITIES`, which is React-adjacent). `apps/web/lib/routine/catalog.test.ts` asserts this list
 * RESOLVES to `ROUTINE_CATALOG`, in order (`resolveProfileRoutine`; entries the catalog retired drop),
 * so the two cannot drift.
 */
export const SEED_FULL_ROUTINE = {
  version: 1,
  order: [
    { key: 'strength' },
    { key: 'checkin:rice_bucket' },
    { key: 'checkin:brain_rep' },
    { key: 'checkin:splits' },
    { key: 'checkin:brush_teeth:stance' },
    { key: 'checkin:brush_teeth:ladder' },
    { key: 'checkin:brush_teeth:bridge' },
    { key: 'checkin:brush_teeth:mobility' },
    { key: 'checkin:brush_teeth:pressure' },
    { key: 'checkin:brush_teeth:reaction' },
    { key: 'checkin:brush_teeth:shot' },
    { key: 'checkin:calisthenics:pushups' },
    { key: 'checkin:calisthenics:pullups' },
    { key: 'checkin:calisthenics:vsit_crunch' },
    { key: 'checkin:calisthenics:vsit_skill_step' },
    { key: 'life:wake' },
    { key: 'life:wrestling_practice' },
  ],
} as const satisfies RoutineConfig;

/**
 * V1-18: Athlete Two's EXPLICIT routine (check-ins before strength, a conditional strength, Wake), so a
 * fresh DB demonstrates A≠B against Athlete One (`SEED_FULL_ROUTINE` above). The keys are grammar-valid
 * (`db:verify` parses them); `conditional` is the opaque V1-10 marker. Since FAM-1 12f PR 5 trimmed the
 * routine catalog to `strength` and Wrestling practice, its check-in keys and Wake drop at read, and
 * `apps/web/lib/routine/contract.test.ts` asserts it resolves to `strength` alone, with the marker. Only
 * differentiates on an EMPTY target (fresh PGlite / Docker PG); a prod re-seed no-ops via
 * onConflictDoNothing.
 */
export const SEED_ATHLETE_TWO_ROUTINE = {
  version: 1,
  order: [
    // Check-ins FIRST (before strength) — a genuine reorder vs Athlete One's default — and CONTIGUOUS (rice bucket
    // + the push-up count in ONE block), so the check-in-logging e2e has a single, full surface. Then
    // strength (cosmetic `conditional` marker), then a life SUBSET (wake only, not wrestling). Demonstrates
    // A≠B via order + selection without splitting the check-in form.
    { key: 'checkin:rice_bucket' },
    { key: 'checkin:calisthenics:pushups' },
    { key: 'strength', conditional: true },
    { key: 'life:wake' },
  ],
} as const satisfies RoutineConfig;

/**
 * Idempotent seed (AGENTS.md: seed reference data ON CONFLICT DO NOTHING; runs
 * twice → identical result). Seeds the `units` + `activity_type_categories`
 * reference tables, the root household, two kid profiles scoped to it (V1-3: Athlete One +
 * Athlete Two), and (V1-2) the FULL catalog — `activity_types`, `metric_definitions`, and
 * `movements` — sourced from @mat-plan/shared as the single source of truth. Fixed
 * UUIDv7s let re-runs conflict on the natural key / public_id instead of inserting
 * duplicates. V1-1b's three minimal rows (weigh_in / sc_lift / bodyweight) are SPREAD
 * into these arrays, so they keep one definition and re-seed as a no-op (ON CONFLICT
 * DO NOTHING).
 */

// The fixed seed public_ids now live in `@mat-plan/shared` (packages/shared/src/seed-ids.ts) so the app-side
// PROGRAM_SEED can reference the same household + kids; re-exported here so existing importers (db:verify,
// tests) keep resolving them from '../src/seed'.
export {
  SEED_HOUSEHOLD_PUBLIC_ID,
  SEED_PROFILE_PUBLIC_ID,
  SEED_PROFILE_2_PUBLIC_ID,
  SEED_PROFILE_3_PUBLIC_ID,
  SEED_PROFILE_4_PUBLIC_ID,
  SEED_PROFILE_NAME,
  SEED_PROFILE_2_NAME,
  SEED_PROFILE_3_NAME,
  SEED_PROFILE_4_NAME,
} from '@mat-plan/shared';

/**
 * 🔴 **The environment flag that turns the fixtures on: `SEED_FIXTURES=1`** (FAM-1 plan D10, `OPS-2`).
 *
 * With it, the seed also writes `seedFixtures` (the seed household and its four role-named athletes),
 * `PROGRAM_SEED` and `seedProgramFixtures`' programs (lane P, step 6c). Without it, which is how
 * `migrate.yml` seeds **production**, it writes reference data only (`seedReference`), and household
 * rows a database already holds stay as they are. Only the exact value `1` turns it on.
 *
 * The runners that set it: CI's e2e job (`ci.yml`), the preview migration (`migrate-preview.yml`) and
 * the local harnesses (`apps/web/scripts/embedded-pg.ts` → `migrateAndSeed`). A test pins that no
 * other workflow names it (`apps/web/test/seed-fixtures-is-contained.test.ts`).
 */
export const SEED_FIXTURES_ENV = 'SEED_FIXTURES';

/** Whether the flag's raw value turns the fixtures on. Fail closed: only `'1'` does. */
export function seedFixturesRequested(raw: string | undefined): boolean {
  return raw === '1';
}

/** The refusal `assertFixturesTargetAllowed` throws. Fixed text: it names nothing from the URL. */
export const FIXTURES_TARGET_REFUSED =
  'db:seed: refusing to seed fixtures — SEED_FIXTURES=1 is allowed only against a local ' +
  'database or the preview database, and this connection string names neither (FAM-1 plan D10; ' +
  'docs/features/programming.md, invariant 3)';

/**
 * 🔴 **Fixtures go only to a database that is provably not production**: one on this machine,
 * or one whose name marks it as the preview database. An ALLOWLIST on the connection string itself,
 * not a check of `EXPECTED_DB_ENV`, which is a declaration and is simply absent from a seed run by
 * hand (the security lens's finding on the step-1 plan). Run after `assertMigrationTarget`, on the
 * same resolved string the seed connects with.
 *
 * The rule is `isFixturesDatabase` (`db-environment.ts`), the same one the app uses to choose the
 * fixture movement library (CAT-3 K29), so a database the seed fills with fixtures is the database
 * the app reads with them. Accepted limits, shared with OPS-1's guards: a production database named
 * `*preview*`, or a tunnel to production on localhost, would pass. `seed` then checks it owns the
 * database before writing anything (`assertSeedOwnsDatabase`).
 */
export function assertFixturesTargetAllowed(connectionString: string): void {
  if (!isFixturesDatabase(connectionString)) throw new Error(FIXTURES_TARGET_REFUSED);
}

/** What a caller must decide about every seed run. `fixtures` is REQUIRED: none gets it by omission. */
export interface SeedOptions {
  readonly fixtures: boolean;
}

/**
 * `db:seed`'s whole decision, in one tested function: the flag from the environment, and, when it is
 * on, the allowlist on the URL the seed connects with. Throws `FIXTURES_TARGET_REFUSED` before
 * anything connects. `scripts/seed.ts` passes its result straight to `seed`, and `seed.test.ts` pins
 * that call site by source, so neither the function nor its one caller can drop the guard silently.
 */
export function resolveSeedOptions(
  env: Readonly<Record<string, string | undefined>>,
  connectionString: string,
): SeedOptions {
  const fixtures = seedFixturesRequested(env[SEED_FIXTURES_ENV]);
  if (fixtures) assertFixturesTargetAllowed(connectionString);
  return { fixtures };
}

/**
 * 🔴 **OPS-2 PR 1: production's seed writes reference data and nothing else.** `seed(db, { fixtures })`
 * is two building blocks ([plan](../../../docs/plans/ops-2-split-the-seed.md), D1):
 *
 * - `seedReference` always: units, quantity slots, categories, equipment, muscles, activity types,
 *   metric definitions and the movement library, plus the TEN-2c shadow detection. No row a household
 *   owns. It never reads `households` or `profiles`, so no household state can make it throw.
 * - `seedFixtures` only with fixtures: the seed household (1c-4's guard and refusal) and its four
 *   fixture athletes, then the program and lane P's fixture world. Never in production: `migrate.yml`
 *   seeds without `SEED_FIXTURES`, and `resolveSeedOptions` refuses the flag for any database that is
 *   not provably local or the preview.
 *
 * 🔴 **CAT-3 A2-ii (spec E4): the flag also picks the movement library** ([plan](../../../docs/plans/
 * cat-3-a2-ii-seed-switch.md), D1). Without it, `CATALOG_MOVEMENTS` and no legacy rows (production);
 * with it, `CATALOG_FIXTURE`, then the 35 legacy rows the e2e specs and fixtures name. One name decides
 * both, so no caller can write the real library beside the legacy rows, or the reverse.
 *
 * 🔴 **With fixtures, ownership is checked before ANY write** (plan D2). The fixture library is global
 * reference data, shown to every household: written into a database the seed does not own and then
 * refused, it would stay, and on a shared slug production's next seed would keep it (E2).
 *
 * ⚠️ **A household-scoped write belongs inside the `fixtures` branch**, never in `seedReference`
 * (`docs/features/write-path.md` → Traps).
 */
export async function seed(
  db: NodePgDatabase<typeof schema>,
  { fixtures }: SeedOptions,
): Promise<void> {
  if (fixtures) await assertSeedOwnsDatabase(db);

  const library = seedLibraryOf(fixtures ? 'fixture' : 'catalog');
  const counts = await seedReference(db, { library });

  // FAM-1 D10: the authored program (`PROGRAM_SEED`, the Youth Daily Program block, human-authored —
  // the LLM never authors loads) and lane P's fixture programs are written ONLY when the caller asks
  // for fixtures, which production's seed never does. So, since OPS-2 PR 1, are the seed household and
  // its athletes, which they need first. Program rows a database already holds are left alone.
  if (fixtures) {
    const household = await seedFixtures(db);
    await seedProgram(db, PROGRAM_SEED);
    // K29: the world's items resolve over the library this run wrote, the one the app reads here.
    await seedProgramFixtures(db, householdScopeForScript(household.id), library.entries);
  }

  reportSeed(counts);
}

/**
 * What `seedReference` writes as movements (CAT-3 A2-ii, D1): the library's entries, and whether the
 * legacy `MOVEMENT_SEED_ROWS` follow them. `seed` only ever builds one with `seedLibraryOf`; `db:verify`
 * builds others to prove one case at a time.
 */
export interface SeedLibrary {
  readonly entries: readonly CatalogMovement[];
  readonly legacyMovements: boolean;
}

/** The library a seed writes, by name (K29): the real one alone, or the test one plus the legacy rows. */
export function seedLibraryOf(name: CatalogLibraryName): SeedLibrary {
  return name === 'fixture'
    ? { entries: CATALOG_FIXTURE, legacyMovements: true }
    : { entries: CATALOG_MOVEMENTS, legacyMovements: false };
}

/** `seedReference`'s required options. No default, as `SeedOptions.fixtures` has none. */
export interface SeedReferenceOptions {
  readonly library: SeedLibrary;
}

/**
 * What a seed run did, as **counts only** (CAT-3 spec rule 7, E5). 🔴 Every field is a number, and
 * `seed.test.ts` pins that: `migrate.yml` prints this to a world-readable log, and a slug of a row a
 * household owns says what that household typed. Naming rows is the operator's job, at their own
 * console (`docs/runbooks.md` → "the seed's shadow guard fired").
 */
export interface SeedCounts {
  /** Library entries written as new catalog rows. */
  readonly catalogInserted: number;
  /** Library entries whose slug a global row already held: catalog rows (left as they are, E2). */
  readonly catalogPresent: number;
  /** …held by a legacy global row instead (no `modality`; also left as it is). */
  readonly catalogHeldByLegacy: number;
  /** Library entries left out because an earlier entry in the same list has their slug. */
  readonly catalogDuplicates: number;
  /**
   * Household-owned rows sitting on a library slug that is not also a legacy slug (counted before the
   * write, never touched, E3); a row on a shared slug is in `householdRowsOnSeedSlugs` only.
   */
  readonly householdRowsOnCatalogSlugs: number;
  /** Household-owned rows sitting on a legacy seed slug (TEN-2c's shadow report). */
  readonly householdRowsOnSeedSlugs: number;
}

/**
 * Every reference table, idempotently, then the library entries it is given (`seedCatalog`, before
 * the legacy movements), with the TEN-2c and CAT-3 shadow counts taken before either movements insert
 * (so they read only what households owned beforehand). Exported for `db:verify`; `seed` is its only
 * other caller.
 */
export async function seedReference(
  db: NodePgDatabase<typeof schema>,
  { library }: SeedReferenceOptions,
): Promise<SeedCounts> {
  const catalog = library.entries;
  // GAP-3: the seed mirrors `UNITS` exactly (onConflictDoUPDATE, not DoNothing): the 7 pre-GAP-3 rows
  // already existed in every deployed DB, and DoNothing would leave them with whatever `dimension` the
  // migration backfilled, a reference table that silently stops mirroring its source.
  //
  // OPS-2 PR 1: ONLY the rows that are missing or differ are written. `dimension` is part of the key
  // that `entry_set_quantities`' and `prescription_quantities`' composite FKs reference, so an UPDATE
  // that sets it takes a full row lock even when the value is unchanged, and it did that to every
  // unit on every push, against any open insert that references a unit. An unchanged unit is now
  // never touched. (`scripts/seed.ts` also sets a lock and a statement timeout on its connections.)
  const storedUnits = await db
    .select({
      code: schema.units.code,
      label: schema.units.label,
      dimension: schema.units.dimension,
    })
    .from(schema.units);
  const stored = new Map(storedUnits.map((u) => [u.code, u]));
  const unitsToWrite = UNITS.filter((u) => {
    const s = stored.get(u.code);
    return !s || s.label !== u.label || s.dimension !== u.dimension;
  });
  if (unitsToWrite.length > 0) {
    await db
      .insert(schema.units)
      .values(unitsToWrite)
      .onConflictDoUpdate({
        target: schema.units.code,
        set: { label: sql`excluded.label`, dimension: sql`excluded.dimension` },
      });
  }

  // GAP-3: onConflictDoNOTHING here, deliberately NOT the DoUpdate above. `quantity_slots` is the
  // parent of a composite FK with no ON UPDATE CASCADE, so once any `entry_set_quantities` row exists,
  // an UPDATE of a slot's dimension is REJECTED by the FK — and `db:seed` runs on every push to main
  // (.github/workflows/migrate.yml), so a DoUpdate would turn the PROD migrate job red, not just a PR.
  // The PK is the (code, dimension) pair, so adding a slot or a new dimension for one still inserts
  // cleanly; only REMOVING a pair needs an expand→contract, which is the correct amount of friction.
  await db
    .insert(schema.quantitySlots)
    .values(QUANTITY_SLOT_ROWS)
    .onConflictDoNothing({ target: [schema.quantitySlots.code, schema.quantitySlots.dimension] });

  await db
    .insert(schema.activityTypeCategories)
    .values(ACTIVITY_CATEGORY_ROWS)
    .onConflictDoNothing({ target: schema.activityTypeCategories.code });

  // CAT-3 A1: the library's two vocabularies, codes only (labels stay in shared). DoNothing, not
  // DoUpdate: the code is the whole row, and movement_equipment / movement_muscles reference it, so
  // there is nothing to update. Adding a word lands here with no migration; removing or renaming one
  // needs a migration, because join rows name the code.
  await db
    .insert(schema.equipment)
    .values(EQUIPMENT.map((code) => ({ code })))
    .onConflictDoNothing({ target: schema.equipment.code });
  await db
    .insert(schema.muscles)
    .values(MUSCLES.map((code) => ({ code })))
    .onConflictDoNothing({ target: schema.muscles.code });

  // V1-2: the FULL catalog (activity_types + metric_definitions + movements), sourced from
  // @mat-plan/shared (single source of truth). ON CONFLICT on each natural key → idempotent,
  // and a safe no-op for V1-1b's 3 reused rows (weigh_in / sc_lift / bodyweight). Runs after
  // the FK parents (units + activity_type_categories) so category/unit references resolve.
  await db
    .insert(schema.activityTypes)
    .values([...ACTIVITY_TYPE_SEED_ROWS])
    .onConflictDoNothing({ target: schema.activityTypes.key });

  await db
    .insert(schema.metricDefinitions)
    .values([...METRIC_DEFINITION_SEED_ROWS])
    .onConflictDoNothing({ target: schema.metricDefinitions.key });

  // ── TEN-2b's SHADOW GUARD, DEMOTED TO A REPORT AT TEN-2c — and BOTH halves had to move ─────────
  //
  // 🔴 **What the guard was for, and why its premise is GONE.** TEN-2b moved the arbiter below onto
  // the partial `uq_movements_slug_global` (predicate repeated literally, per the V1-5 lesson;
  // `where:` not `targetWhere:`, which `onConflictDoNothing` silently drops). But while the
  // non-partial `movements_slug_unique` lived, Postgres inferred BOTH arbiters for `(slug)` — the
  // non-partial one's empty predicate is trivially implied by `WHERE household_id IS NULL` — so if a
  // household already owned a slug this seed was about to add globally, `DO NOTHING` absorbed the
  // GLOBAL-unique collision too and the catalog row was NEVER INSERTED while `db:seed` reported
  // success (measured). The failure was SILENCE, not a duplicate, which is why the guard was the only
  // detector, and why it REFUSED rather than adopting — adopting would promote one household's free
  // text into the global reference namespace, the defect `ON DELETE SET NULL` is forbidden for
  // (schema.ts → `movements`).
  //
  // **Migration 0017 DELETED that premise.** With only `uq_movements_slug_global` left, a
  // household-owned row sits OUTSIDE the index's subset, so the global insert does not collide with
  // it and the curated row lands. A global row and a household row sharing one slug is the INTENDED
  // end state: global-first then serves the curated row to everyone.
  //
  // ⚠️ **SO THIS IS NOW A REPORT, AND IT SUPPRESSES NO WRITE — both halves, or it is worse than
  // either was.** TEN-2c's panel caught the half-fix: the guard was detect → **omit** → seed → throw,
  // and the omission (a `seedableMovements` filter) happened BEFORE the arbiter was ever consulted. So
  // demoting only the `throw` would leave the curated row still never inserted, forever, with nothing
  // complaining loudly — a loud confidentiality guard turned into a silent, permanent gap in reference
  // data, strictly worse than the status quo. The filter is therefore gone and `MOVEMENT_SEED_ROWS` is
  // inserted whole; the partial arbiter is correct and idempotent on its own.
  //
  // ⚠️ **Why detect at all, then?** Because a household owning a seeded slug is still worth saying out
  // loud: global-first means that household's own row is now permanently shadowed by the curated one,
  // which is the right outcome but not an obvious one, and `TEN-2c-1` / `TEN-2b-2` are the rows that
  // tidy it up. It is **not** an error. `migrate.yml` runs `db:migrate` then `db:seed` against
  // PRODUCTION in one job on every push to `main`, and `migrate.yml:16-22` spells out what a throw
  // there costs: the job turns red on every subsequent push and *cannot clear itself by re-running*.
  // Recovery / context: `docs/runbooks.md` → "the seed's shadow guard fired".
  //
  // ⚠️ **CAT-3 A2-i: the report is COUNTS ONLY** (spec rule 7). It used to name the seed slugs a
  // household also owns; that slug is also the household's own row's slug, which says what they typed,
  // and this lands in a world-readable Actions log. Never a slug, never a `name`. `db:verify` asserts
  // the count is printed and the slug is not, and the privacy half is the one a rewrite loses first.
  //
  // CAT-3 A2-ii: taken whether or not this run writes the legacy rows. Production keeps its 35 until
  // the fresh start (R2), and global-first keeps serving them, so a household row on one is still
  // shadowed and still worth a count (plan D1; mutation 329).
  const householdRowsOnSeedSlugs = await countOwnedRowsOn(
    db,
    MOVEMENT_SEED_ROWS.map((m) => m.slug),
  );
  // A library slug that is also a legacy slug is counted once, above.
  const legacySlugs = new Set<string>(MOVEMENT_SEED_ROWS.map((m) => m.slug));
  const householdRowsOnCatalogSlugs = await countOwnedRowsOn(
    db,
    catalog.map((entry) => entry.slug).filter((slug) => !legacySlugs.has(slug)),
  );

  // CAT-3 A2-i: the library first, so on a shared slug the catalog row wins and the legacy insert's
  // DO NOTHING skips it (the order A2-ii's fixtures need, spec E4).
  const written = await seedCatalog(db, catalog);

  // No filter: every seeded movement is offered to the arbiter, which is the whole fix. CAT-3 A2-ii:
  // only on a fixtures database (E4); production's 35 stay as they are until R2 deletes them.
  if (library.legacyMovements) {
    await db
      .insert(schema.movements)
      .values([...MOVEMENT_SEED_ROWS])
      .onConflictDoNothing({ target: schema.movements.slug, where: movementIsGlobal() });
  }

  return { ...written, householdRowsOnCatalogSlugs, householdRowsOnSeedSlugs };
}

/** How many household-owned movements sit on one of `slugs`: a count, never the rows. */
async function countOwnedRowsOn(
  db: NodePgDatabase<typeof schema>,
  slugs: readonly string[],
): Promise<number> {
  if (slugs.length === 0) return 0;
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.movements)
    .where(and(inArray(schema.movements.slug, [...slugs]), movementIsOwned()));
  return row?.n ?? 0;
}

/** `seedCatalog`'s counts: the `catalog*` half of `SeedCounts`. */
export type CatalogSeedCounts = Pick<
  SeedCounts,
  'catalogInserted' | 'catalogPresent' | 'catalogHeldByLegacy' | 'catalogDuplicates'
>;

/**
 * 🔴 **CAT-3 A2-i: the movement library's writer** (spec E1–E3, E5, rule 7; plan
 * `docs/plans/cat-3-a2-i-catalog-seed.md`, D2). Writes each entry as a GLOBAL row with its `modality`,
 * and its equipment and muscle rows, in ONE transaction: a failure part-way leaves nothing.
 *
 * - **Never touches a row that already holds the slug** (E2): the insert is `ON CONFLICT DO NOTHING` on
 *   the global partial index (predicate repeated, the V1-5 lesson), and the join rows are keyed to the
 *   ids its `RETURNING` gave back, never to a slug lookup, so a held slug gets no join row.
 * - **Never a household's row** (E3): a household row on the slug sits outside the global index, so it
 *   neither conflicts nor is touched, and nothing here sets `household_id`. No delete, no update.
 * - **Resolves on every empty shape rule 7 lists**: an empty list, every entry already present, entries
 *   with no equipment or no muscles. Each insert skips itself when it has nothing to write (drizzle
 *   throws on an empty `values()`, and every production push after A2-ii's first has every entry
 *   present). A duplicated slug keeps its first entry and counts the rest. **Any constraint violation
 *   still throws, and leaves nothing** (one transaction): a bad entry is fixed forward.
 * - **Order:** equipment and secondaries in the entry's authored order (the join rows' identity order
 *   then records it), the primary first and only when there is one.
 *
 * Aliases, the supervision label, instructions and media are never written: no column holds them
 * (spec rule 11), and the readers take them from the library by slug.
 */
export async function seedCatalog(
  db: NodePgDatabase<typeof schema>,
  entries: readonly CatalogMovement[],
): Promise<CatalogSeedCounts> {
  const bySlug = new Map<string, CatalogMovement>();
  for (const entry of entries) if (!bySlug.has(entry.slug)) bySlug.set(entry.slug, entry);
  const catalogDuplicates = entries.length - bySlug.size;
  if (bySlug.size === 0) {
    return { catalogInserted: 0, catalogPresent: 0, catalogHeldByLegacy: 0, catalogDuplicates };
  }
  const unique = [...bySlug.values()];

  return db.transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.movements)
      .values(
        unique.map((entry) => ({
          publicId: newId(),
          slug: entry.slug,
          name: entry.name,
          modality: entry.modality,
          pattern: entry.pattern,
          trackingType: entry.trackingType,
          unitDefault: entry.unitDefault,
          isBodyweight: entry.isBodyweight,
        })),
      )
      .onConflictDoNothing({ target: schema.movements.slug, where: movementIsGlobal() })
      .returning({ id: schema.movements.id, slug: schema.movements.slug });

    const equipmentRows = inserted.flatMap(({ id, slug }) =>
      bySlug.get(slug)!.equipment.map((equipmentCode) => ({ movementId: id, equipmentCode })),
    );
    if (equipmentRows.length > 0) {
      await tx.insert(schema.movementEquipment).values(equipmentRows);
    }

    const muscleRows = inserted.flatMap(({ id, slug }) => {
      const entry = bySlug.get(slug)!;
      return [
        ...(entry.primaryMuscle
          ? [{ movementId: id, muscleCode: entry.primaryMuscle, role: MUSCLE_ROLE.primary }]
          : []),
        ...entry.secondaryMuscles.map((muscleCode) => ({
          movementId: id,
          muscleCode,
          role: MUSCLE_ROLE.secondary,
        })),
      ];
    });
    if (muscleRows.length > 0) {
      await tx.insert(schema.movementMuscles).values(muscleRows);
    }

    // What already held the other slugs: a catalog row (E2) or a legacy global row. Counts only.
    const held = unique.length - inserted.length;
    const catalogPresent =
      held === 0
        ? 0
        : ((
            await tx
              .select({ n: sql<number>`count(*)::int` })
              .from(schema.movements)
              .where(
                and(
                  inArray(
                    schema.movements.slug,
                    unique.map((entry) => entry.slug),
                  ),
                  movementIsCatalog(),
                ),
              )
          )[0]?.n ?? 0) - inserted.length;
    return {
      catalogInserted: inserted.length,
      catalogPresent,
      catalogHeldByLegacy: held - catalogPresent,
      catalogDuplicates,
    };
  });
}

/** `seedFixtures`' refusal, and `assertSeedOwnsDatabase`'s: one message, asserted by `db:verify`. */
export const SEED_HOUSEHOLD_REFUSED =
  'seed: refusing to seed into a household this seed does not own — a live household exists ' +
  'under a different public_id, so the guard above skipped the insert and there is no ' +
  'seed-owned household to scope fixture rows to';

/**
 * 🔴 **CAT-3 A2-ii, D2: the fixtures run's ownership check, before ANY write.** `seedFixtures` refuses
 * the same database, but only after `seedReference` has committed the fixture library, which is global
 * and would stay. This is the same decision taken first: a live household exists, and none carries
 * the seed's `public_id`. `seedFixtures` keeps its own check, so neither can drift alone.
 */
export async function assertSeedOwnsDatabase(db: NodePgDatabase<typeof schema>): Promise<void> {
  const [live] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(isNull(schema.households.deletedAt))
    .limit(1);
  if (!live) return;
  const [own] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));
  if (!own) throw new Error(SEED_HOUSEHOLD_REFUSED);
}

/**
 * The seed household and its four fixture athletes (fixture databases only). Returns the household
 * the fixture programs are scoped to. Exported for `db:verify`; `seed` is its only other caller.
 */
export async function seedFixtures(db: NodePgDatabase<typeof schema>): Promise<{ id: number }> {
  // 🔴 **CONDITIONAL ON NO LIVE HOUSEHOLD EXISTING — `AUTH-1` 1c-4.**
  //
  // The arbiter used to be `onConflictDoNothing` on `public_id`, which is idempotent for THIS row
  // and silent about every other: seed a database that already holds a household under a different
  // `public_id` and you get a SECOND one. That was survivable only because the scope resolver threw
  // on a second live household, so the mistake announced itself as an outage on the next request.
  //
  // ⚠️ **1c-4 removed that detector.** The resolver now counts a principal's memberships, not
  // households, and two live households is the *intended* Beta 0 end state once a family is invited
  // — so there is nothing left to be loud. `migrate.yml` runs this seed against **production** on
  // every merge to `main`, which makes the seed itself the one automated creator of household #2.
  // The parent plan's Q5 called this out and assigned the fix to 1b; it was never written, and
  // porting the throw to an alert would have fired on every request forever instead.
  //
  // Closing the creator in code beats alerting on it: there is no window, no quota, and nothing to
  // mute. An operator who genuinely wants a second household creates it deliberately, not by
  // re-running a seed.
  const [liveHousehold] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(isNull(schema.households.deletedAt))
    .limit(1);

  if (!liveHousehold) {
    await db
      .insert(schema.households)
      .values({ publicId: SEED_HOUSEHOLD_PUBLIC_ID, name: HOUSEHOLD_DEFAULT_NAME })
      .onConflictDoNothing({ target: schema.households.publicId });
  }

  // Resolve the root household id to scope the seed profile (household_id is enforced
  // NOT NULL by the migration's CHECK, so the profile must carry it).
  //
  // ⚠️ Still by `public_id`, deliberately: this is the SEED's household, and the rows below belong
  // to it. On a database that already held a different live household the guard above skipped the
  // insert, so this finds nothing — and the seed must refuse rather than seed fixture profiles into
  // somebody else's household.
  //
  // 🔴 **The refusal is an explicit throw, and that is what makes the guard PROVABLE.** It used to
  // fall through to a `TypeError` on `household.id` — the right outcome, reached by accident, and an
  // assertion pinning a `TypeError` pins the absence of a property rather than the decision. The
  // message is what `db:verify`'s seed-guard block asserts on, so `migrate.yml`'s red run also says
  // why it went red instead of handing the operator a stack trace.
  //
  // 📌 **It also means `db:seed` is no longer unconditionally idempotent against an arbitrary
  // database** — only against one that is empty or already seed-owned, which is every database this
  // repo actually seeds (`migrate.yml`, the harnesses, `db:verify`).
  const [household] = await db
    .select({ id: schema.households.id })
    .from(schema.households)
    .where(eq(schema.households.publicId, SEED_HOUSEHOLD_PUBLIC_ID));

  if (!household) throw new Error(SEED_HOUSEHOLD_REFUSED);

  // V1-3: the kid profiles the picker tiles render (two until PROF-1 b added a third for the
  // archive specs). Both scoped to the root
  // household; idempotent by public_id. ⚠️ `onConflictDoNothing` means a re-seed CANNOT rename a row
  // that already exists: a live household keeps whatever names it entered, which is its own data and
  // not this seed's business (OSS-1 scrubbed the REPO, never the database). So these role names are a
  // FRESH-DB fixture only — what a reviewer sees in a preview, a screenshot or `db:verify`.
  await db
    .insert(schema.profiles)
    .values([
      {
        publicId: SEED_PROFILE_PUBLIC_ID,
        name: SEED_PROFILE_NAME,
        kind: 'kid',
        householdId: household.id,
        // ONB-0: EXPLICIT, where this row used to be NULL. NULL now means "the neutral first-run
        // routine" (`['strength']`), and the check-in specs drive habits + a brush-teeth metric here.
        routineConfig: SEED_FULL_ROUTINE,
      },
      {
        publicId: SEED_PROFILE_2_PUBLIC_ID,
        name: SEED_PROFILE_2_NAME,
        kind: 'kid',
        householdId: household.id,
        routineConfig: SEED_ATHLETE_TWO_ROUTINE,
      },
      {
        // PROF-1 b: the ARCHIVE specs' own athlete. See `SEED_PROFILE_3_PUBLIC_ID`'s docblock for
        // why archive cannot share a fixture the way rename can.
        publicId: SEED_PROFILE_3_PUBLIC_ID,
        name: SEED_PROFILE_3_NAME,
        kind: 'kid',
        householdId: household.id,
        routineConfig: SEED_ATHLETE_TWO_ROUTINE,
      },
      {
        // FAM-1: the Change e2e's own athlete, on the test-only program `seed-e2e.ts` writes. See
        // `SEED_PROFILE_4_PUBLIC_ID`'s docblock. The neutral routine (NULL): the smallest page.
        publicId: SEED_PROFILE_4_PUBLIC_ID,
        name: SEED_PROFILE_4_NAME,
        kind: 'kid',
        householdId: household.id,
        routineConfig: null,
      },
    ])
    .onConflictDoNothing({ target: schema.profiles.publicId });

  return household;
}

/**
 * The seed's one report line, from its counts (CAT-3 A2-i, spec rule 7, E5), last and in both modes.
 * 🔴 **Counts only**: it is printed to `migrate.yml`'s world-readable log, and naming a slug a household
 * also holds says what that household typed. Never a slug, never a `name`. `db:verify` captures everything
 * printed to stdout and stderr around the run and asserts it.
 *
 * The household lines are warnings, not errors: the curated row IS inserted (since TEN-2c the two
 * namespaces are separate and global-first serves it), so nothing is broken, and a throw would wedge
 * `migrate.yml`, which seeds production on every push to `main`.
 */
export function reportSeed(counts: SeedCounts): void {
  if (counts.catalogInserted + counts.catalogPresent + counts.catalogHeldByLegacy > 0) {
    console.log(
      `seed: catalog: ${counts.catalogInserted} inserted, ${counts.catalogPresent} already present, ` +
        `${counts.catalogHeldByLegacy} held by a legacy row, ${counts.catalogDuplicates} duplicate(s) ` +
        'in the list.',
    );
  }
  const owned = counts.householdRowsOnSeedSlugs + counts.householdRowsOnCatalogSlugs;
  if (owned > 0) {
    console.warn(
      `seed: ${counts.householdRowsOnSeedSlugs} household-owned movement(s) share a legacy seed slug ` +
        `and ${counts.householdRowsOnCatalogSlugs} share a library slug. The global row(s) were ` +
        'inserted beside them and global-first serves the curated one, so those rows are shadowed. ' +
        'Nothing is broken. To list them, run the query in docs/runbooks.md → "the seed\'s shadow ' +
        'guard fired" from your own console; never paste its output anywhere tracked.',
    );
  }
}

/**
 * Expand a program seed (V1-10) into `program_blocks` → `prescriptions` → `prescription_targets`, idempotent
 * by each table's partial-unique natural key. Row-by-row (config data, few rows): resolve each FK by its
 * natural key (household + block by public_id/slug, movement by `movements.slug`, profile by public_id) with
 * the existing `select({id}).where(eq(...))` idiom, insert with `onConflictDoNothing` whose arbiter REPEATS
 * the partial index's `WHERE deleted_at IS NULL` (the V1-5 lesson), then re-resolve the id so children attach
 * whether the parent was just inserted or already existed. Re-seed is INSERT-ONLY (a moved/replaced slot is a
 * future authoring path, not re-seed). An empty seed makes every loop a no-op.
 * Every referenced id is resolved among LIVE rows (`isNull(deleted_at)`) and an unresolved ref THROWS —
 * a misspelled movement slug / household / profile public_id in a future data-only PR fails the seed LOUDLY
 * (caught by CI's `db:seed`/`db:verify`) instead of silently dropping a prescription or an entire block. Refs
 * are resolved BEFORE the block insert, so a typo throws with nothing written. Each block resolves its
 * movements + profiles ONCE (one `inArray` query each, not an N+1 per prescription/target). Exported so
 * `db:verify` drives a non-empty fixture through the REAL resolver, not just the DDL.
 * INVARIANT (caller's responsibility, mirroring the supersets writer): a target's profile belongs to the
 * block's household — the seed authors profiles within the block's household; the slice-2 DAL scopes reads by
 * that household join (BOLA).
 *
 * **TEN-1 1c turns that invariant into a WHERE clause.** The profile resolution below already ran inside
 * the block's household by construction, so this is symmetry rather than a fix — but it is the last
 * hand-written copy of the live-profile predicate in `packages/db/src`, and leaving one behind is what
 * would force 1d's structural guard to ship with an allowlist. A target naming a profile in **another**
 * household now throws `unknown profile` with nothing written, instead of silently seeding a
 * cross-household `prescription_targets` row that `programDayRows` would then have to refuse.
 *
 * The scope comes from `householdScopeForScript`, named for what it is: the seed has **no request** to
 * derive one from, exactly like `db:verify` and `db:correct`. It is reached by relative path from inside
 * `packages/db` — `src/index.ts` never re-exports it, so `apps/web` cannot name it at all
 * (`packages/db/src/scope.test.ts` pins both halves).
 */
export async function seedProgram(
  db: NodePgDatabase<typeof schema>,
  blocks: readonly ProgramBlockSeedRow[],
): Promise<void> {
  for (const block of blocks) {
    const [household] = await db
      .select({ id: schema.households.id })
      .from(schema.households)
      .where(
        and(
          eq(schema.households.publicId, block.householdPublicId),
          isNull(schema.households.deletedAt),
        ),
      );
    if (!household) {
      throw new Error(
        `seedProgram: unknown household "${block.householdPublicId}" for block "${block.slug}"`,
      );
    }

    // Resolve every referenced movement + profile ONCE for the block (one query each, no N+1), among LIVE
    // rows; a ref that doesn't resolve is an authoring typo → throw (before any write) rather than skip.
    const movementSlugs = [...new Set(block.prescriptions.map((p) => p.movementSlug))];
    // TEN-2b: resolve in the GLOBAL namespace only (`household_id IS NULL`). One line, and it kills
    // the last-row-wins hazard STRUCTURALLY rather than by preference: the global namespace is unique
    // by slug (`uq_movements_slug_global`), so the map below can no longer be overwritten by a
    // household's own row, and a prescription can no longer silently attach to another household's
    // movement. A slug that exists ONLY in some household's namespace now falls through to the
    // unknown-slug throw below — correct and loud: `seedProgram` seeds `PROGRAM_SEED`, whose slugs
    // are all catalog slugs, and there is no authoring path that puts a household row here.
    const movementRows = movementSlugs.length
      ? await db
          .select({ id: schema.movements.id, slug: schema.movements.slug })
          .from(schema.movements)
          .where(and(inArray(schema.movements.slug, movementSlugs), movementIsGlobal()))
      : [];
    const movementIdBySlug = new Map(movementRows.map((m) => [m.slug, m.id]));
    for (const slug of movementSlugs) {
      if (!movementIdBySlug.has(slug)) {
        throw new Error(`seedProgram: unknown movement slug "${slug}" in block "${block.slug}"`);
      }
    }

    const profilePublicIds = [
      ...new Set(block.prescriptions.flatMap((p) => p.targets.map((t) => t.profilePublicId))),
    ];
    // The plural variant of the live-profile predicate: `inArray` where `isLiveProfile` has `eq`, so it
    // cannot use the helper directly — but the household conjunct is the SAME single-sourced
    // `inHousehold`, which is the one function in the repo allowed to unwrap the scope (ADR 0006 fwd-1).
    const blockScope = householdScopeForScript(household.id);
    const profileRows = profilePublicIds.length
      ? await db
          .select({ id: schema.profiles.id, publicId: schema.profiles.publicId })
          .from(schema.profiles)
          .where(
            and(
              inArray(schema.profiles.publicId, profilePublicIds),
              isNull(schema.profiles.deletedAt),
              inHousehold(blockScope),
            ),
          )
      : [];
    const profileIdByPublicId = new Map(profileRows.map((p) => [p.publicId, p.id]));
    for (const publicId of profilePublicIds) {
      if (!profileIdByPublicId.has(publicId)) {
        throw new Error(
          `seedProgram: unknown profile "${publicId}" in block "${block.slug}" ` +
            `(not live, or not in household "${block.householdPublicId}")`,
        );
      }
    }

    await db
      .insert(schema.programBlocks)
      .values({
        publicId: newId(),
        householdId: household.id,
        slug: block.slug,
        name: block.name,
        notes: block.notes,
      })
      .onConflictDoNothing({
        target: [schema.programBlocks.householdId, schema.programBlocks.slug],
        where: isNull(schema.programBlocks.deletedAt),
      });
    // Re-resolve the block id (just-inserted OR pre-existing) by its natural key — and only a LEGACY
    // block (FAM-1 4a-i): a template block a household built under the same slug must never be adopted
    // and filled with seeded prescriptions. The insert above omits `kind`, so it lands `legacy`.
    const [blockRow] = await db
      .select({ id: schema.programBlocks.id })
      .from(schema.programBlocks)
      .where(
        and(
          eq(schema.programBlocks.householdId, household.id),
          eq(schema.programBlocks.slug, block.slug),
          programBlockIsLegacy(),
          isNull(schema.programBlocks.deletedAt),
        ),
      );
    if (!blockRow)
      throw new Error(
        `seedProgram: block "${block.slug}" failed to resolve after upsert — no live LEGACY block ` +
          'holds that slug; a household-built (template) block under the same slug would cause this',
      );

    for (const p of block.prescriptions) {
      await db
        .insert(schema.prescriptions)
        .values({
          publicId: newId(),
          blockId: blockRow.id,
          dayRole: p.dayRole,
          movementId: movementIdBySlug.get(p.movementSlug)!,
          idx: p.idx,
          sets: p.sets,
          targetReps: p.targetReps,
        })
        .onConflictDoNothing({
          target: [
            schema.prescriptions.blockId,
            schema.prescriptions.dayRole,
            schema.prescriptions.idx,
          ],
          where: isNull(schema.prescriptions.deletedAt),
        });
      const [presRow] = await db
        .select({ id: schema.prescriptions.id })
        .from(schema.prescriptions)
        .where(
          and(
            eq(schema.prescriptions.blockId, blockRow.id),
            eq(schema.prescriptions.dayRole, p.dayRole),
            eq(schema.prescriptions.idx, p.idx),
            isNull(schema.prescriptions.deletedAt),
          ),
        );
      if (!presRow) {
        throw new Error(
          `seedProgram: prescription (block "${block.slug}", ${p.dayRole}#${p.idx}) failed to resolve after upsert`,
        );
      }

      for (const target of p.targets) {
        await db
          .insert(schema.prescriptionTargets)
          .values({
            publicId: newId(),
            prescriptionId: presRow.id,
            profileId: profileIdByPublicId.get(target.profilePublicId)!,
            load: target.load,
            reps: target.reps ?? null, // per-kid reps override (null → the prescription's shared target_reps)
          })
          .onConflictDoNothing({
            target: [
              schema.prescriptionTargets.prescriptionId,
              schema.prescriptionTargets.profileId,
            ],
            where: isNull(schema.prescriptionTargets.deletedAt),
          });
      }
    }
  }
}
