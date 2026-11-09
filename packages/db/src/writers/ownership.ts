import { and, eq, isNotNull, isNull, sql } from 'drizzle-orm';

import { schema } from '../client';
import { HOUSEHOLD_ROLE, type HouseholdRole, newId, type ProfileKind } from '@mat-plan/shared';
import type { HouseholdScope, OwnerScope } from '../scope';
import type { Executor } from './executor';

/**
 * The ownership predicates every guarded write shares (V1-24 PR 1b; household-scoped since TEN-1 1b).
 *
 * ## Why these are named rather than re-typed
 *
 * `and(eq(profiles.publicId, …), isNull(profiles.deletedAt))` appeared **eleven** times across the
 * writers, the queries and the app DAL. `queries/program-day.ts` already argues the case against
 * itself, one function down:
 *
 * > *"THE ownership predicate … Named once and used by BOTH sub-selects below … so the two can never
 * > drift into scoping by different rules — which is exactly how a BOLA hole gets introduced by a
 * > later edit."*
 *
 * That reasoning does not stop at a function boundary. AGENTS.md: *"Reuse small logic too — a
 * validation/derivation used in two places becomes one exported helper, not a copy-paste."* This is a
 * **security** predicate, which is the strongest case there is for single-sourcing it.
 *
 * ⚠️ Extracted here with **two** consumers, not speculatively: `updateStrengthSetById` converts to a
 * caller in the same PR, so V1-9's existing `db:verify` cross-profile proof covers this helper for
 * free (and `db:verify` proves the profile soft-delete half for both writers). `listEntriesForDay`
 * (the app DAL's day read) and `weeklyAdherenceRows` joined in DAL-1 — the two sites that had
 * skipped the soft-delete half.
 *
 * ## TEN-1 1b — the third conjunct IS the tenancy seam
 *
 * `isLiveProfile` now takes a **required** `HouseholdScope` and emits `profiles.household_id = $n`
 * alongside its existing two conjuncts. The parameter is required and positional **on purpose**: it
 * makes every unconverted call site a **compile error**, which is the plan's primary safety
 * mechanism — `docs/milestones/beta-1.md` § 2 names a missed scope as a cross-family leak, and
 * `docs/plan.md` → DAL-2 has watched this predicate drift once already (*"DAL-1 is what drift looks
 * like"*). An optional or defaulted parameter is the single change that would make a missed site
 * invisible, which is why `packages/db/src/scope.test.ts` fails on one.
 *
 * ## TEN-1 1c — the hand-written count is ZERO
 *
 * 1c converted the tail: `logCheckinEntries`, `writeStrengthSession`'s in-transaction resolve,
 * `programDayRows`'s `isThisProfile`, `export-month`'s three reads, and `seed.ts`'s plural variant
 * (`inArray` where this has `eq`, so it takes `inHousehold` directly — the household half, from the
 * one function allowed to unwrap the scope). **There is no copy of this predicate left in
 * `packages/db/src/**` or `apps/web/lib/dal/**`** (bar the probe below). 1d's structural guard,
 * `apps/web/lib/dal/scoped.test.ts`, inspects **only** `apps/web/lib/dal/*.ts`; `packages/db/src`
 * is held by `scope.test.ts`'s containment rules and by `db:verify`, not by a text scan.
 *
 * ## TEN-1 1d — zero in `lib/dal`, `packages/db/src` and the corrections registry
 *
 * ⚠️ **Not zero everywhere.** `apps/web/scripts/screenshot-ephemeral.ts` still hand-writes
 * `eq(schema.profiles.publicId, SEED_PROFILE_PUBLIC_ID)` to stage screenshot fixtures. It is an
 * exception, not a leak: it only ever runs against the throwaway database it provisions itself, and
 * nothing inspects it.
 *
 * 1c left three copies in `packages/db/scripts/corrections/registry.ts` — a verbatim pre-1c predicate
 * in `kbSwingsLoadRepsSwap`, and `inHousehold`'s body hand-written twice in `nullRoutineToFull` — and
 * said so rather than claiming them away, because they sit outside the domain 1d's `lib/dal` guard
 * inspects and `scope.test.ts`'s "exactly one module reads `scope.householdId`" could not see them
 * (they named a raw id, not a scope). **1d converted all three.** A correction now resolves its
 * household into a `HouseholdScope` (`liveHouseholdScope`) and rides `isLiveProfile` where there is a
 * `public_id` and `inHousehold` for the one bulk shape — so no correction holds a raw `household_id`
 * either, and ADR 0006's capability rule holds in the scripts too.
 *
 * **THREE sites deliberately do NOT use it** (TEN-2b removed the fourth — see below), each
 * documented where it lives:
 *
 * 1. `reportScopeMiss`'s existence-only probe (`apps/web/lib/dal/household.ts`) — how the miss path
 *    tells `cross_household` from `unknown_resource`. Returns `void`, so it cannot be copied into
 *    something that returns data.
 * 2. `getActivityTypeByKey` and 3. `getMetricDefinition` (`apps/web/lib/dal/catalog.ts`) — genuinely
 *    global reference reads. ⚠️ **It is these two `cache()`d readers that reach `db`, not the
 *    `getActivityTypeIdByKey` / `assertMetricKeyExists` wrappers** this list named before 1d: those
 *    delegate and build no query, so an allowlist keyed on them would have exempted the wrong
 *    symbols. `scoped.test.ts` finds the real ones by construction.
 * ✅ **The fourth is GONE as of TEN-2b, and that is the whole point of the arc.**
 * `findOrCreateMovementId` was listed here as a WRITE that could not be scoped because `movements`
 * had nothing to scope by. It now takes a `HouseholdScope` and resolves **global-first** through the
 * `movements` helpers at the foot of this file, so `scoped.test.ts`'s dead-entry assertion forced its
 * allowlist entry out rather than letting it stand as coverage nobody re-earned.
 * ⚠️ **One residual survives TEN-2c, and it is not an allowlist entry:** `0017` dropped
 * `movements_slug_unique`, so the resolver's `23505` fallback is now unreachable (it survives one more
 * PR for the deploy race — `TEN-2d`) and the **denial** window is closed. What is left is the **pre-2b** rows still at `household_id IS NULL`, which global-first serves to every household — closing at **`TEN-2c-1`** (the split backfill). `0017` only stops it growing, via `movements_global_row_has_pattern`.
 * `db:verify` → "the catalog verdict".
 *
 * A NEW read or write that wants to be none of these is a design question, not an edit: use this
 * helper. All three are enforced as allowlists with a reason each — `apps/web/lib/dal/scoped.test.ts`
 * — not as this prose.
 *
 * ⚠️ **`profiles.household_id` is typed NULLABLE in drizzle and is NOT NULL in the database.**
 * `0001_loose_barracuda.sql` adds `profiles_household_id_not_null` as `CHECK … NOT VALID` and then
 * `VALIDATE`s it, so no orphan profile can exist — `schema.ts` keeps the column nullable only
 * because the backfill needed it to be. **Do not conclude from the drizzle type that orphans are
 * possible and add an `OR household_id IS NULL` escape**: that would be a hole in the one security
 * predicate this seam exists to create. Tightening the drizzle type has its own backlog row (the
 * plan's R9); `SET NOT NULL` is catalog-only when a validated CHECK already exists (PG ≥ 12).
 */

/**
 * THE household conjunct for `profiles` — and, with the `movements` helpers at the foot of this
 * file, one of the handful of reads of `scope.householdId` in the **one module** allowed any.
 *
 * ⚠️ TEN-2b made that distinction matter: it is "exactly one MODULE", never "exactly one function".
 * `packages/db/src/scope.test.ts` asserts the module, which is what ADR 0006 actually needs.
 *
 * ADR 0006's forward-compatibility requirement 1 is that the scope stay a **capability**, never a
 * naked tenant id. That survives a refactor only if unwrapping it happens in exactly one place: a
 * call site that destructures `scope.householdId` to build its own `eq()` has turned the capability
 * back into a number, and COACH-1's _"not mine, but shared with me"_ would then have to widen every
 * such site instead of this one function. `packages/db/src/scope.test.ts` pins it.
 */
export function inHousehold(scope: HouseholdScope) {
  return eq(schema.profiles.householdId, scope.householdId);
}

/**
 * The owner conjunct — **the scope's own `role`, bound as a parameter** (`PROF-1 b-s`).
 *
 * 🔴 **READ THIS BEFORE BUILDING ON IT: it consults no table.** The emitted SQL is `$1 = $2` with
 * two bind parameters — `['member', 'owner']` for a non-owner scope. There is no column and no
 * `household_members` in it; the database does not re-check membership, and this is **not** a
 * second, independent check. The ONLY authority is `membershipHousehold`'s single live-row read
 * (`queries/household-membership.ts`), which is where a reviewer must look.
 *
 * ⚠️ This docblock said "`household_members.role = 'owner'`, as SQL" and called itself "the
 * database-side half … the half that survives a forgery" — through four other documents as well.
 * It was wrong in a way that mattered: the next author would have under-reviewed the resolver,
 * believing a row count was backstopping it. A probe settled it
 * (`new PgDialect().sqlToQuery(isOwnerOf(forged))` → `$1 = $2`), not an argument.
 *
 * **What it genuinely buys, which is narrower and still worth the line:**
 *
 * 1. **A LOST NARROWING FAILS CLOSED, AND AS A ROW COUNT.** A scope whose role is honestly `member`
 *    but which was cast past `ownerScope()` binds `'member' = 'owner'` → the UPDATE matches **0
 *    rows** rather than succeeding. `db:verify` can assert that; a type cannot.
 * 2. **IT PINS ITS CALLER'S SIGNATURE FROM INSIDE THE BODY.** Widening `archiveProfile(exec, scope:
 *    HouseholdScope, …)` fails to compile *at the `isOwnerOf(scope)` call*, which the signature
 *    alone does not give you.
 * 3. **Mutation patch `14` makes its removal a RED gate** instead of a line nobody missed.
 *
 * ⚠️ **What it does NOT stop:** a forgery that *writes the role* —
 * `{ ...scope, role: 'owner' } as OwnerScope` — passes this and the brand both, and the database
 * cannot tell it from an honest owner. Closing that needs the **principal** on the scope and a real
 * `EXISTS (SELECT 1 FROM household_members WHERE household_id = profiles.household_id AND … AND
 * role = 'owner' AND deleted_at IS NULL)`. The scope carries no principal today, which is deliberate
 * (plan § Role authority) and the right upgrade path at `INVITE-1`, when demotion becomes a live
 * operation. Do not pretend this line already does it.
 *
 * ⚠️ **It takes an `OwnerScope`, so it cannot be called with an unnarrowed scope** — the parameter
 * type is that check, exactly as `isLiveProfile`'s required positional `HouseholdScope` is. Reading
 * `scope.role` here rather than in a caller keeps the authority decision in one of the two modules
 * `src/scope.test.ts` names with a reason.
 *
 * **Ships dark at b-s.** `PROF-1 b`'s `archiveProfile` is its first caller.
 */
export function isOwnerOf(scope: OwnerScope) {
  return sql`${scope.role} = ${HOUSEHOLD_ROLE.owner}`;
}

/** THE live-profile predicate, household-scoped. One definition; no call site can scope weaker. */
export function isLiveProfile(profilePublicId: string, scope: HouseholdScope) {
  return and(
    eq(schema.profiles.publicId, profilePublicId),
    isNull(schema.profiles.deletedAt),
    inHousehold(scope),
  );
}

/**
 * Internal ids of the LIVE entries owned by the profile named by `public_id`, **inside `scope`**.
 *
 * Drizzle's `update()` cannot JOIN and `sql.raw` is banned (AGENTS.md), so every guarded UPDATE
 * proves parent ownership by riding this as `inArray(<fk>, ownedEntryIds(exec, id, scope))`. Taking
 * the PUBLIC id — never an internal one from the request — is the seam itself; the scope is its
 * second half, and it reaches both amends plus the amend re-read without any of those writers
 * building a predicate of its own.
 */
export function ownedEntryIds(exec: Executor, profilePublicId: string, scope: HouseholdScope) {
  return exec
    .select({ id: schema.entries.id })
    .from(schema.entries)
    .innerJoin(schema.profiles, eq(schema.entries.profileId, schema.profiles.id))
    .where(and(isLiveProfile(profilePublicId, scope), isNull(schema.entries.deletedAt)));
}

/**
 * ## TEN-2b — `movements`' two namespaces, and the one insert that owns a row
 *
 * `movements` is the only table with **two** namespaces rather than one tenancy seam
 * ([TEN-2a's plan](../../../../docs/plans/ten-2a-household-movements.md)):
 * `household_id IS NULL` is a **value** — reference data owned by no household, the 35 curated seed
 * rows — and `household_id = <scope>` is one household's own free text. So it needs a namespace
 * predicate pair as well as a household conjunct, and the four helpers below are not
 * interchangeable with `inHousehold` / `isLiveProfile` above.
 *
 * **Naming convention, stated so a third table does not invent a third one:** an **unprefixed**
 * helper (`inHousehold`, `isLiveProfile`) is the `profiles` tenancy seam, which every other table
 * reaches *through*. A helper for a table that carries its own `household_id` is **prefixed**
 * (`movementInHousehold`). `movements` is the first; it should not be the pattern's only example.
 *
 * **Why these two live HERE rather than beside the resolver:** `movementInHousehold` and
 * `insertMovementOwnedBy` read `scope.householdId`, and `packages/db/src/scope.test.ts` asserts that
 * exactly one **module** does. The two namespace predicates do not read the scope at all; they live
 * here because they have two consumers each (this file's own rule: *"extracted with two consumers,
 * not speculatively"*) — the resolver's lookups plus `seed.ts`' arbiter and `seedProgram`.
 */

/** `movements.household_id IS NULL` — the GLOBAL reference namespace, owned by no household. */
export function movementIsGlobal() {
  return isNull(schema.movements.householdId);
}

/** `movements.household_id IS NOT NULL` — any household's own namespace. */
export function movementIsOwned() {
  return isNotNull(schema.movements.householdId);
}

/** `movements.household_id = <scope>` — THIS household's namespace. */
export function movementInHousehold(scope: HouseholdScope) {
  return eq(schema.movements.householdId, scope.householdId);
}

/**
 * `program_blocks.household_id = <scope>` — THIS household's blocks (`PROF-1` a-g).
 *
 * The second **prefixed** helper, per the convention above: `program_blocks` carries its own
 * `household_id`, so it gets a prefix rather than reaching through `profiles`. It reads
 * `scope.householdId`, which is why it belongs in this module — `scope.test.ts` asserts exactly one
 * module does.
 *
 * Its one consumer is `householdHasProgram`, which the day page needs to tell two states apart that
 * look identical to the old query: **"this household programs nothing"** and **"this household
 * programs, but you are an adult so none of it is yours"**. Without it the adult sees an unexplained
 * empty day.
 */
export function programBlockInHousehold(scope: HouseholdScope) {
  return eq(schema.programBlocks.householdId, scope.householdId);
}

/**
 * AUTH-1 1b — bind a Clerk account to a household. **Ships dark: nothing reads the row until 1c.**
 *
 * 🔴 **This lives HERE, not in the `writers/household-members.ts` the plan proposed.** A scoped
 * insert must unwrap `scope.householdId`, and `scope.test.ts:56` pins `UNWRAPS_SCOPE` to **this one
 * module** — a new writer module would have forced that allowlist to grow, widening the exception the
 * guard exists to police. `insertMovementOwnedBy` directly below is the same shape for the same
 * reason, and this module already states it: *"Keeping the number inside this module means the
 * capability rule still has a gate behind it."*
 *
 * The caller passes a `HouseholdScope`, so the correction never holds a raw `household_id` — which is
 * ADR 0006's capability rule holding in the scripts too.
 *
 * ⚠️ **No `onConflictDoNothing`.** `uq_household_members_clerk_user` is a real constraint and a
 * collision here is an OPERATOR ERROR, not a replay: the same Clerk id already belongs to a
 * household. The correction reads first and refuses with a message naming the runbook; swallowing the
 * conflict would turn "already claimed by someone else" into a silent no-op, which is the exact
 * failure the read-then-branch guard was designed to prevent.
 */
export async function insertHouseholdMember(
  exec: Executor,
  scope: HouseholdScope,
  row: { publicId: string; clerkUserId: string; role: HouseholdRole },
): Promise<void> {
  await exec.insert(schema.householdMembers).values({ ...row, householdId: scope.householdId });
}

/**
 * Insert a movement **owned by `scope`**, arbitrated by `uq_movements_household_slug`.
 *
 * ⚠️ **This performs the insert rather than returning the owner value, and that is the point.** A
 * `movementOwnerValues(scope)` helper returning `{ householdId }` would hand every caller the naked
 * tenant id via `.householdId` — without matching `scope.test.ts`'s `/[Ss]cope\.householdId/` regex,
 * so the guard behind ADR 0006 forward-1 would silently stop covering the one new way to defeat it.
 * Keeping the number inside this module means the capability rule still has a gate behind it.
 *
 * The `where:` predicate **repeats the partial index's own predicate, literally** — it must, or
 * Postgres cannot infer a partial index as the arbiter and the statement fails `42P10`
 * ([lessons.md](../../../../docs/lessons.md)). ⚠️ It goes in **`where:`**, never `targetWhere:`:
 * `onConflictDoNothing` reads `config.where` and **silently drops** `targetWhere`.
 */
export async function insertMovementOwnedBy(
  exec: Executor,
  scope: HouseholdScope,
  row: { publicId: string; slug: string; name: string; isBodyweight: boolean },
): Promise<void> {
  await exec
    .insert(schema.movements)
    .values({ ...row, householdId: scope.householdId })
    .onConflictDoNothing({
      target: [schema.movements.householdId, schema.movements.slug],
      where: movementIsOwned(),
    });
}

/**
 * Find a profile in `scope` by its device-generated `client_id` (PROF-1 a-1).
 *
 * 🔴 **THIS IS THE ENTIRE CROSS-HOUSEHOLD BOUNDARY FOR `createProfile`, and it is one function on
 * purpose.** `uq_profiles_client_id` is **global and non-partial** (`schema.ts`; migration `0020`'s
 * header calls that "the decision this file exists to carry"), so a caller-chosen key **will**
 * collide across households by design. `createProfile` reads through here twice — once before the
 * insert and once after it — and `inHousehold` is what stops the second household being handed the
 * first one's row.
 *
 * ⚠️ **What a lost conjunct costs, stated because the plan's proof was blind to it.** Without
 * `inHousehold`, household B replaying A's key gets back **A's `public_id`**, and the action then
 * redirects B to `/p/<A's public_id>` — a cross-household identifier in the other household's URL
 * bar. B gains no row, so a proof that only counts rows stays GREEN. `db:verify` therefore asserts
 * the **returned value**, and mutation patch `20` removes this conjunct.
 *
 * 🔴 **The plan asked for TWO patches, one per read; one read makes that unnecessary — and is
 * stronger.** The two steps share this predicate, so there is no way to scope one call and forget the
 * other. Two copies would have been the duplication the maintainer's N4 rule names, and the second
 * patch would have proved only that the copies were still identical.
 *
 * `deleted_at IS NULL` rides along because a soft-deleted row must not be revived by a replay: the
 * key is spent (the index is non-partial), so the honest answer is `refused`, not resurrection.
 */
export async function profileByClientId(
  exec: Executor,
  scope: HouseholdScope,
  clientId: string,
): Promise<{ publicId: string } | null> {
  const rows = await exec
    .select({ publicId: schema.profiles.publicId })
    .from(schema.profiles)
    .where(
      and(
        eq(schema.profiles.clientId, clientId),
        isNull(schema.profiles.deletedAt),
        inHousehold(scope),
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}

/**
 * How many athletes `scope` currently holds (PROF-1 a-1) — the quota's read half.
 *
 * ⚠️ **Archived rows COUNT.** Archive hides an athlete; it does not free their slot, and treating it
 * as a delete would make the cap bypassable by archiving in a loop. Soft-deleted rows do not count:
 * `deleted_at` is the real removal, and nothing in the app sets it on a profile yet.
 */
export async function countProfilesIn(exec: Executor, scope: HouseholdScope): Promise<number> {
  const rows = await exec
    .select({ id: schema.profiles.id })
    .from(schema.profiles)
    .where(and(isNull(schema.profiles.deletedAt), inHousehold(scope)));

  return rows.length;
}

/**
 * Insert a profile **owned by `scope`** (PROF-1 a-1), arbitrated by `uq_profiles_client_id`.
 *
 * The `insertMovementOwnedBy` shape, for the reason that function gives: it performs the insert so
 * `scope.householdId` never leaves this module, which is what keeps `scope.test.ts`'s `UNWRAPS_SCOPE`
 * allowlist meaningful.
 *
 * ⚠️ **No `where:` on the conflict target, unlike the movement precedent.** That one repeats a
 * PARTIAL index's predicate because Postgres cannot otherwise infer it as the arbiter.
 * `uq_profiles_client_id` is non-partial, so a `where` here would be noise that reads as meaningful.
 *
 * 🔴 **The target is NAMED.** A bare `onConflictDoNothing()` swallows **every** unique violation —
 * `profiles_public_id_unique` included — turning an unrelated failure into a silent no-op that the
 * re-select reports as `refused` and a parent reads as "couldn't add this athlete".
 *
 * 🔴 **`public_id` is minted HERE, never supplied.** Taking it from the caller would let a crafted
 * body choose an athlete's URL; minting inside the one module that already owns the tenant id keeps
 * both server-side facts in one place.
 */
export async function insertProfileOwnedBy(
  exec: Executor,
  scope: HouseholdScope,
  row: { name: string; kind: ProfileKind; clientId: string },
): Promise<void> {
  await exec
    .insert(schema.profiles)
    // 🔴 **The three columns are ENUMERATED, never spread.** `{ ...row, … }` is safe only by two
    // accidents: `addAthleteSchema` is a non-strict `z.object` (so unknown keys are stripped) and the
    // two server-owned columns sit AFTER the spread (so a smuggled one is overwritten). Reverse that
    // order, or widen `AddAthleteInput` — which `a-1d` plans to — and a column-named key such as
    // `pinHash`, `birthdate`, `deletedAt` or `routineConfig` rides straight into the row.
    // SECURITY.md → Input: whitelist mutable fields, no mass assignment.
    .values({
      name: row.name,
      kind: row.kind,
      clientId: row.clientId,
      publicId: newId(),
      householdId: scope.householdId,
    })
    .onConflictDoNothing({ target: schema.profiles.clientId });
}
