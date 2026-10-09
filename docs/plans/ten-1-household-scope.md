# TEN-1 — one household cannot see another

> Backlog: [docs/plan.md](../plan.md) → **TEN-1** (`plan.md:726-731`), folding in **DAL-2**
> (`plan.md:1033-1038`). Milestone: [beta-1](../milestones/beta-1.md) §2 (`:121-138`).
> Seam owner: [roadmap.md](../roadmap.md) `:99` — _"`lib/dal/` household scoping · Tenancy ∩ Authoring ∩
> Profiles · owner **Tenancy**"_. Guides: [write-path](../features/write-path.md),
> [programming](../features/programming.md). Branch: `feat/ten-1-household-scope` (per PR below).

## Goal

Make **one household's data unreachable from another household's request**, through a single scope
point that every read and every write passes, and _prove_ it against a real database rather than
asserting it in prose.

Today the system has no concept of "whose request this is". `listProfiles()` returns **every profile in
the database** (`apps/web/lib/dal/profiles.ts:33` — its only predicate is
`isNull(profiles.deletedAt)`), and every write is existence-scoped: `actions.ts:162-165` says so in the
source, and names it _"KNOWN GAP, inherited and recorded rather than papered over … any known profile id
writes to that profile."_ With one family that is a recorded compromise. With two it is
`.github/SECURITY.md:6`'s **#1 risk** realised: _"BOLA/IDOR is the #1 risk given the multi-profile
household"_, against `:12-13`'s rule that _"every query is scoped by `household_id`"_ — a rule the code
has never satisfied.

**Why now, and why before its consumers.** [roadmap.md](../roadmap.md)`:106-109` classifies this as the
clearest live **seam**: _"it introduces one household-scope seam that every pillar's DAL calls change
through, so it wants to land **before** the pillars that consume it, not beside them."_ Concretely,
three pillars are queued behind the same files: AUTH-1 swaps only this function's body
(`beta-1.md:128`), V1-22's household library is explicitly deferred until a scope exists
(`docs/decisions/0005-programming-model.md:318-323`), and PROF-1/ONB-2's household-creation path writes
through it (`plan.md:684`). A seam change does not parallelize
([roadmap.md](../roadmap.md)`:104-105`), so every day TEN-1 is open is a day those three cannot start.

**And the blast radius is the point, not a side effect.** `beta-1.md:276`: _"TEN-1 is a sweep. One
missed scope is a cross-family leak, which is why the exit criterion is a proof, not a review."_ This
plan's central design choice exists to make a missed scope a **compile error** rather than a review
miss.

## Acceptance

Verbatim from [plan.md](../plan.md) → **TEN-1**:

> **TEN-1 — household scoping through one DAL seam, proven.** A `cache()`d `getHouseholdScope()`;
> every read and write scopes through it (folds in DAL-2). Before AUTH-1 it resolves to the
> maintainer's household; AUTH-1 swaps its implementation. `db:verify` proves a second household
> cannot read, write, correct or export the first's data, at every entry point, including
> `findOrCreateMovementId`. Needs the household-addressing ADR first. _(Beta 0.)_

And from [beta-1.md](../milestones/beta-1.md) § 2:

> **The proofs are the point:** `db:verify` drives two households through every read, write, correction
> and export, and asserts B can never see or touch A. Including `findOrCreateMovementId` … Either TEN-1
> proves the picker and the metadata stay per household, or **TEN-2** … moves into Beta 0.

**Done when:**

1. `apps/web/lib/dal/household.ts` exports `getHouseholdScope(): Promise<HouseholdScope | null>`,
   `cache()`d, and is the **only** module that names `householdScopeForRequest` — the mechanically
   checkable form of "the only place that derives a household", since pre-AUTH-1 nothing derives from
   a _request_ at all (it resolves the one live household). Pinned by `packages/db/src/scope.test.ts`.
   ⚠️ **Reworded in 1b** per **C11 · A-af**: the original wording was not checkable and was literally
   false before AUTH-1.
2. `isLiveProfile` takes a **required** `HouseholdScope` and emits `profiles.household_id = $n`
   alongside its existing two conjuncts, and **no `packages/db` function defaults or optionalises that
   parameter** (`scope.test.ts`) — the defaulted parameter, not the missing conjunct, is the change
   that would make a missed site invisible. The unit is **predicate sites**: nine hand-written copies
   at the start of 1b, **five** after 1b, **zero** after 1c. ⚠️ **Reworded in 1b**: the original
   `grep -c 'profiles.deletedAt'` matched comments and was already wrong on `main`.
3. `listProfiles()` returns only the scope's profiles — proved by `db:verify` running the DAL's own
   `householdProfileRows` against two households × two profiles, in both directions — and
   `getProfileByPublicId()` returns `null` for a foreign profile, so all **11 call sites** of that one
   function (the unit ADR 0006 counts in: 7 Server Actions, 2 pages, the export handler, and
   `lib/dal/export.ts`) inherit the scope. ⚠️ **Reworded in 1b**: "8 of the 9 entry points" mixed two
   units — the entry-point table has 7 rows and the function has 11 callers.
4. **`actions.test.ts` has a wrong-household suite enumerated over all 7 actions**, mirroring the
   unauth suite's shape (`:116-143`) — the first time AGENTS.md`:453`'s _wrong-owner→forbid_ is
   literally satisfiable in this repo.
5. `db:verify` drives **two households** through: the picker read, the day read, adherence, the
   programmed day, all three export queries, the bodyweight write, the check-in write, the strength
   write, both amends, the amend re-read, and `db:correct`'s registry query — asserting, **in both
   directions**, that each returns/writes for its own household and that there is **no cross-household
   access except through an explicitly published projection**, a set that is **empty today** and whose
   unpublished case is proved exactly as strictly as an unconditional zero would be. (Phrased this way
   per ADR 0006 → forward compatibility 2, so a later published surface extends the matrix instead of
   invalidating the criterion.)
6. A structural test fails CI if a new `lib/dal` read reaches `db` without a scope, or if
   `householdScopeForScript` is reachable from `apps/web` — by import, by alias, or via a **defaulted**
   `scope` parameter anywhere in `packages/db`.
7. `findOrCreateMovementId`'s cross-household behaviour is **proven in both directions** (read _and_
   the write/poison direction, including the refused-write side effect), and the TEN-2 go/no-go is
   recorded in `plan.md` with the proof's output as its evidence.
8. Before AUTH-1, **zero** live households → `getHouseholdScope()` returns `null` and the app is dark,
   not leaky; **≥2** live households → it **throws** (`error.tsx` + a Sentry exception), because the
   server cannot tell whose data it holds and the empty-state copy would misreport that as "your data
   does not exist". Pinned by a test.
9. **ADR 0006's three named obligations are discharged**, each with a vehicle and a chunk — see
   "What ADR 0006 obliges, and where it lands" below.

## What ADR 0006 obliges, and where it lands

[ADR 0006](../decisions/0006-household-addressing.md) is **Accepted — option A (session-only)**
_(the maintainer, 2026-10-07)_, which closes this plan's chunk 0 and its Q1. Accepting it created
**three named obligations** and **three forward-compatibility requirements** for TEN-1. The first
draft named them in the chunk-0 cell and then built none of them; **every panel lens flagged that**.
Each now has an owner:

| ADR 0006 asks for                                                                                                                                                                              | Vehicle                                                                                                                                                                                                                                                                            | Chunk  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| **1. The picker scoped AND proved** with two households × two profiles each. Under option A `/p` is byte-identical for every household, so `listProfiles` has **no second factor at all**.     | Single-source the picker's query into `packages/db/src/queries/` (the `weeklyAdherenceRows` / `programDayRows` precedent) so `db:verify` runs the **same function** the DAL runs, then add it to `ENTRY_POINTS`. The emitted-SQL test stays as a second vehicle, not the only one. | **1b** |
| **2. `force-dynamic` pinned by a test**, with a comment saying tenancy now depends on it, plus the rule that **no household-scoped read enters a cache without the household id in the key**.  | A test pinning `apps/web/app/layout.tsx`'s directive **and the export Route Handler's dynamism** (a Route Handler does **not** inherit a layout's segment config — it is dynamic only because it calls `cookies()`). The rule itself goes in `write-path.md`'s invariants.         | **1b** |
| **3. A structured cross-household event on the miss path** — on a miss only, re-resolve without the household conjunct and emit `actor`/`action`/`resource`/`outcome`, carrying **no values**. | See "The miss-path event" below — it needs a layer decision, not just a line.                                                                                                                                                                                                      | **1b** |
| **4.** (Consequence) Promote `NO_PROFILE_LOG` / `NO_PROFILE_SAVE` from module-local in `actions.ts` to `apps/web/lib/constants.ts`.                                                            | The `AMEND_ERROR_COPY` idiom already in that file. Both `it.each` tables then assert via the const, so byte-identity is structural rather than prose — `actions.test.ts` currently re-types the literal 7 times.                                                                   | **1b** |
| **Fwd 1.** The scope stays a capability, never a naked tenant id.                                                                                                                              | §Design 1 + 1b: branded, row-typed, and exactly one module reads `.householdId`. `scoped.test.ts` gains that assertion.                                                                                                                                                            | 1b     |
| **Fwd 2.** Proofs phrased to allow an explicitly published projection.                                                                                                                         | Acceptance 5, above.                                                                                                                                                                                                                                                               | 1b     |
| **Fwd 3.** The 404 rule carries an explicit exception clause for published resources.                                                                                                          | The `SECURITY.md` + `write-path.md` edits.                                                                                                                                                                                                                                         | 1d     |

### The miss-path event — the layer decision obligation 3 actually needs

A miss can happen at `getProfileByPublicId`, inside a writer's in-transaction resolution, and at
`ownedEntryIds`'s zero-row amend. The conjunct deliberately lives in **one predicate in
`packages/db`**, which is the one place that must not do IO or hold request context. So the event is
emitted from **one `lib/dal` emitter** that the scoped profile resolution funnels through — not from
the predicate, and not by re-resolving at 11 call sites (the threading this plan rejects in
Alternative 4).

Constraints, each of which turns the event into noise or a leak if missed:

- **Payload is exhaustively typed** — `{ actor, action, resource: profilePublicId, outcome }` and
  nothing else, built in one named helper with an explicit `Required<…>` record (the
  `SENTRY_DATA_COLLECTION` idiom in `apps/web/lib/sentry-scrub.ts`). That module strips denied headers
  and anything named `params`, but has **no allowlist for hand-built contexts**, so a later
  `setContext({ name })` would ship a kid's name to a third party unscrubbed.
- **Never carries** a profile name, any value, any `DrizzleQueryError` (SEC-3's scar: its message
  embeds query params and already shipped a kid's bodyweight to Sentry once — the probe catches its own
  driver errors), or the **owning** household's id (a requester→owner mapping in a third-party store is
  a cross-tenant linkage over minors' data).
- **A null/ambiguous scope must not be reported as `cross_household`.** With no resolvable scope every
  lookup misses and the unscoped re-resolve _finds_ the row, so a naive implementation emits
  `cross_household` for every legitimate request. `outcome` needs a distinct `no_scope` value.
- **Emit once per request.** The export route resolves the profile twice (the handler, then
  `buildExportEntries`), so emit at exactly one site or dedupe through the same `cache()` the scope uses
  — two events for one request skews any rate alert and is itself a timing artifact.
- **The unscoped re-resolve is a `lib/dal` read reaching `db` with no scope** — the one thing
  acceptance 6's guard exists to fail. It gets an allowlist entry **with its reason written beside it**
  (the shape this plan already demands for `catalog.ts`'s reference reads), must live in `household.ts`,
  and must return `void` rather than a row, so the allowlisted unscoped read cannot be copied into
  something that returns data.
- **Do not await a Sentry flush** before responding, and run the probe identically for both miss
  reasons — a flush only in the `cross_household` case is a measurable per-request timing oracle on
  exactly the case an attacker is probing for.
- **Name the consumer or record the deferral.** The ADR justifies the event as what makes rate-limiting
  id probing possible, but `apps/web/lib/rate-limit.ts` deliberately does not limit the mutating
  actions. Either a Sentry alert rule lands in `docs/runbooks.md` or the plan says the consumer is
  deferred and to what — otherwise the event is a write-only channel.

## What exists today — the real surface

### Entry points (all of them)

| Entry point                                                 | Reads/writes                                                                                                               | Scoped today                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `app/p/page.tsx:18` — the picker                            | `listProfiles()`                                                                                                           | ❌ **every profile in the database**                      |
| `app/p/[profileId]/page.tsx:57,86-88`                       | `getProfileByPublicId` · `listEntriesForDay` · `getWeeklyAdherence` · `getProgramDay`                                      | ❌ existence only (program-day alone has a household hop) |
| `app/p/[profileId]/routine/page.tsx:28`                     | `getProfileByPublicId`                                                                                                     | ❌                                                        |
| `app/p/[profileId]/export/route.ts:46,49`                   | `getProfileByPublicId` → `buildExportZip` → `loggedMonths` · `strengthMonthRows` · `bodyweightMonthRows` · `prescribedFor` | ❌                                                        |
| `actions.ts:105,219,348,444,485,545,618` — 7 Server Actions | `getProfileByPublicId` then one writer each                                                                                | ❌ `actions.ts:162-165` says so                           |
| `packages/db/scripts/corrections/registry.ts:65-71`         | `db:correct`'s KB-swings query                                                                                             | ❌ (pinned to a literal profile id)                       |
| `lib/dal/catalog.ts:76-89` — `findOrCreateMovementId`       | **writes `movements`**                                                                                                     | ❌ **unscopable** — `movements` has no `household_id`     |

**The single most useful fact in this table:** 8 of the 9 entry points resolve the profile through
`getProfileByPublicId` _first_. Scope that one function and every one of them fails closed at the gate.
Everything else in this plan is depth behind that gate — which `write-path.md:72` demands anyway
(_"a guard that exists only in the DAL is a guard no proof covers"_).

### The nine (DAL-2, counted for real)

The full predicate is `and(eq(profiles.publicId, …), isNull(profiles.deletedAt))`, flattened or nested:

| #   | Site                                                | Function                           |
| --- | --------------------------------------------------- | ---------------------------------- |
| 1   | `apps/web/lib/dal/profiles.ts:85`                   | `getProfileByPublicId`             |
| 2   | `apps/web/lib/dal/profiles.ts:121`                  | `updateProfileRoutine`             |
| 3   | `apps/web/lib/dal/entries.ts:376`                   | `logCheckinEntries`                |
| 4   | `packages/db/src/writers/strength-session.ts:295`   | `writeStrengthSession`             |
| 5   | `packages/db/src/queries/program-day.ts:41-42`      | `programDayRows` (`isThisProfile`) |
| 6   | `packages/db/src/queries/export-month.ts:84-85`     | `strengthMonthRows`                |
| 7   | `packages/db/src/queries/export-month.ts:122-123`   | `bodyweightMonthRows`              |
| 8   | `packages/db/src/queries/export-month.ts:146-147`   | `loggedMonths`                     |
| 9   | `packages/db/scripts/corrections/registry.ts:65,71` | the KB-swings correction           |

**Exactly nine.** `ownership.ts:11`'s _"appeared eleven times"_ minus DAL-1's two conversions, exactly as
`plan.md:1033` and `write-path.md:137` claim. Two adjacent sites that are **not** among the nine and
still matter:

- **`apps/web/lib/dal/profiles.ts:33`** — `listProfiles`, `isNull(deletedAt)` with no id half (it is a
  list; there is no id to write). Not one of the nine, and **the single most important site in TEN-1.**
- **`packages/db/src/seed.ts:256-259`** — the plural variant (`inArray(publicId, …) + isNull`). Same
  rule, different operator; it resolves targets _within the block's household_ already
  (`schema.ts:699-700`), so it is correct-by-construction but gets the conjunct for symmetry.

Five sites are already on the helper and get the conjunct for free: `entries.ts:170`
(`listEntriesForDay`), `entries.ts:308` (`logBodyweight`), `weekly-adherence.ts:70`, `registry.ts:225`,
and `ownership.ts:48` (`ownedEntryIds`) — which fans out to `updateStrengthSetById`,
`updateBodyweightEntryById` and `findAmendableBodyweight:117`.

**That is the lever.** The nine conversions _are_ the household scoping. DAL-2 is not "folded in" as a
convenience; it is the same edit.

### Does `program-day` generalise? — yes, and it strengthens

`packages/db/src/queries/program-day.ts:13-16` states the idiom:

> OWNERSHIP (BOLA): the household is resolved INSIDE this query via `profiles.public_id → household_id →
program_blocks.household_id` — the caller never supplies (and `ProfileDTO` never exposes) a household
> id, so a kid can only ever see their OWN household's block.

Mechanically (`:48-62`) that is an `innerJoin(profiles, eq(profiles.householdId,
programBlocks.householdId))` with `isThisProfile` in the `WHERE` — a **correlated** resolution. It never
materialises a household id, which is why it needs no scope _value_.

**It generalises cleanly:** `isThisProfile` (`:40-43`) is textually the nine's predicate, so it becomes
`isLiveProfile(args.profilePublicId, scope)` and both sub-selects — the household hop and the per-kid
target scope at `:66-69`, which `:38-39` already insists must share one predicate — pick up the conjunct
together. The existing join equality then transitively pins `program_blocks.household_id` to the scope.
No shape change, no new join.

**And the generalisation is a real strengthening, not a refactor.** Today's chain authorizes the _block_
against the _profile's own row_. Nothing checks that the **requester** belongs to that household —
because there is no requester. So a profile whose `household_id` were ever repointed (a future
household-transfer, a correction, an ONB-2 bug) would read the new household's program with no
independent check. Under TEN-1 the requester's household is asserted **independently of the profile's
row**, and the two must agree. That is a property today's two-hop correlation cannot express.

Two caveats, both benign:

- `:15-16`'s _"a profile with a NULL `household_id` matches no block → zero rows"_ is **unreachable**:
  `0001_loose_barracuda.sql:158-159` adds `profiles_household_id_not_null` as `CHECK … NOT VALID` and
  then `VALIDATE`s it, so `household_id` is NOT NULL in the database even though `schema.ts:137` types it
  nullable. No orphan profile can exist, so `eq(profiles.householdId, scope)` can never silently hide a
  live profile. Keep the defensive comment; do **not** rely on the drizzle type.
- Once the conjunct is in the `WHERE`, the `profiles` join inside the block subquery is redundant.
  **Leave it.** Removing a join from a BOLA-load-bearing subquery for tidiness is risk with no payoff;
  note it in the docblock as a deliberate redundancy.

### `writers/ownership.ts` — the lever, stated

`ownership.ts:19-21` already argues TEN-1's design before TEN-1 exists:

> That reasoning does not stop at a function boundary … This is a **security** predicate, which is the
> strongest case there is for single-sourcing it.

and `:31`: _"THE live-profile predicate. One definition, so no call site can scope by a weaker rule."_
TEN-1 adds one conjunct to that one definition. `ownedEntryIds:43` (`:40-41`: _"Taking the PUBLIC id —
never an internal one from the request — is the seam itself"_) is the fan-out that carries it to both
amends and the amend re-read without touching them.

## Design

### 1 · `HouseholdScope` — a value with exactly two constructors

New, in `packages/db/src/writers/ownership.ts` (beside the predicate it parameterises):

```ts
declare const householdScopeBrand: unique symbol;

/**
 * THE household this request is authorized for — a CAPABILITY, never a naked tenant id (ADR 0006 →
 * "Forward compatibility", requirement 1). Branded, so it cannot be forged from an object literal;
 * the only ways to obtain one are to DERIVE it (apps/web/lib/dal/household.ts, server-only) or for a
 * script to NAME one.
 *
 * What each mechanism actually buys, stated precisely because the first draft over-claimed that
 * SECURITY.md's "never trust a householdId from the request body" becomes a type error (it does not
 * — `householdScopeForScript(Number(formData.get('hh')))` type-checks):
 *   - the REQUIRED positional parameter on isLiveProfile is the compile-time guarantee, and it is
 *     what makes an unconverted call site a build failure;
 *   - the BRAND blocks an inline object literal standing in for a derived scope;
 *   - the module boundary (below) is what keeps the script constructor out of apps/web.
 *
 * `householdId` is typed from the row rather than re-declared, so a future change to the column's
 * drizzle `mode` is a compile error in `isLiveProfile`'s `eq()` instead of a comment that went stale.
 * The field name stays `householdId`, not `id`: this is a capability, not a row.
 *
 * It carries NO observability flag. `households.synthetic` (chunk 1a) is deliberately NOT a member —
 * see §Design 1a below.
 */
export type HouseholdScope = {
  readonly householdId: HouseholdRow['id'];
  readonly [householdScopeBrand]: true;
};

/**
 * For a caller with NO request: db:verify and db:correct. It NAMES the household, so the name says
 * what it is. It lives in a module the package barrel does NOT re-export, so `apps/web` cannot reach
 * it by a bare specifier at all (lib/dal/scoped.test.ts is depth, not the boundary — see §Design 1b).
 * Asserts an integer: a drizzle `eq(col, undefined)` does not fail loudly, so an unresolved public_id
 * must throw here rather than silently widen a predicate.
 */
export function householdScopeForScript(householdId: number): HouseholdScope { … }

/** THE live-profile predicate, now household-scoped. One definition; no call site can scope weaker. */
export function isLiveProfile(profilePublicId: string, scope: HouseholdScope) {
  return and(
    eq(schema.profiles.publicId, profilePublicId),
    isNull(schema.profiles.deletedAt),
    eq(schema.profiles.householdId, scope.householdId),
  );
}
```

**Why a required positional parameter and not an optional/defaulted one:** it makes every unconverted
site a **compile error**. The sweep cannot be forgotten in one place, which is the failure mode
`beta-1.md:276` names and `plan.md:1035` has already seen once (_"DAL-1 is what drift looks like"_).
That is the plan's primary safety mechanism — and §Risks R1 is about the one place it does not reach.

### 1a · Why `households.synthetic` is NOT on the scope _(panel, 2026-10-07)_

The first draft put `readonly synthetic: boolean` on `HouseholdScope`, on the strength of
[plan.md](../plan.md) → OBS-2: _"The clean form is a flag on the household honoured at **one seam**,
which is TEN-1's `getHouseholdScope()`."_ **Five of the six panel lenses independently rejected it**,
and they are right for four separate reasons:

1. **It is mechanically incoherent for OBS-2's stated need.** OBS-2 wants synthetic rows _"excluded
   from every aggregate — adherence, streaks, export, dashboards."_ Those are **cross-household**
   rollups. `getHouseholdScope()` resolves **the household of this request**; a per-request
   single-tenant scope cannot exclude a household from an aggregate it is not computing. The repo has
   zero cross-household queries today, and a future one has no single scope to carry a flag on.
2. **It creates a cross-PR production ordering hazard for no benefit.** With `synthetic` on the scope,
   chunk 1b's resolver emits `SELECT id, synthetic FROM households` on **every page and every Server
   Action** — so a 1b deploy that lands before migration 0014 is applied is `42703 undefined column`
   on every route, i.e. a total outage, not a dark app. And `migrate.yml` exits **0 with a warning**
   when `DATABASE_URL_UNPOOLED` is absent, so a green migrate run does not prove the column exists.
   Taking the field off removes the hazard rather than managing it with a runbook gate.
3. **It is a second source of truth for a DB column.** A defaulted `synthetic = false` parameter on
   the script constructor asserts `false` regardless of the row — the duplication AGENTS.md →
   Constants calls a defect rather than a style nit.
4. **It couples observability to the authorization capability**, at the seam
   [roadmap.md](../roadmap.md) says **Tenancy** owns, and invites `if (scope.synthetic)` — a
   test-household behavioural fork inside the authorization type, reachable in production.

**ADR 0006 is satisfied unchanged.** Its forward-compatibility requirement is that the scope stay a
**branded record rather than a naked tenant id**; it cites `{ householdId, synthetic, brand }`
descriptively, as evidence the design was already branded. The obligation is the brand, not the field.

**So the column still lands in 1a and OBS-2 reads it directly.** The payoff is that `synthetic` is
then dark **end to end** — no PR between 1a and OBS-2 names it — which is what makes landing a column
ahead of its consumer safe at all, and which `household-synthetic-is-dark.test.ts` now enforces.

### 1b · Where the scope type and the script constructor live

Not `packages/db/src/writers/ownership.ts` for both, as first drafted. `packages/db/src/index.ts` is
`export * from './writers/ownership'` and `packages/db/package.json` maps only `"." : "./src/index.ts"`,
so anything declared in `ownership.ts` is published to `apps/web` on the exact specifier the app
already imports — putting an unauthenticated constructor for the authorization capability in the same
autocomplete list as the predicate the app is supposed to use. The drafted guard was a **text scan**
of `apps/web` for the identifier, which three mistake paths defeat without the name ever appearing
there: a `packages/db` helper that **defaults** the scope parameter (which silently removes the
required-parameter compile error, the plan's primary safety mechanism), an aliased re-export, and
`import * as db`.

- **`HouseholdScope` + the brand** → `packages/db/src/scope.ts`, re-exported from `index.ts`;
  `ownership.ts` imports it. The app legitimately needs the type.
- **`householdScopeForScript`** → its own module that `index.ts` does **not** re-export, imported by
  relative path from `packages/db/scripts/**`. A deep bare import then fails **module resolution**, so
  containment is lexical rather than textual.
- `scoped.test.ts` stays as depth, extended to fail on an aliased re-export outside
  `packages/db/scripts/**` and on any **defaulted** `scope` parameter in `packages/db`.
- `packages/shared` was considered and rejected: the constructor needs drizzle/schema neighbours and
  `shared` is client-reachable. AGENTS.md → Constants points at `shared` for cross-boundary values, so
  this deviation is stated rather than left implicit.

### 2 · `getHouseholdScope()` — resolution, per request, cached

New `apps/web/lib/dal/household.ts`:

```ts
import 'server-only';
import { cache } from 'react';

/**
 * THE household scope point (TEN-1). The ONE place in the repo that DERIVES a household from a request.
 *
 * Before AUTH-1 there is no principal — the access gate is a shared code, not an identity
 * (actions.ts:163-164) — so the scope is "the one live household, and nothing if that is ambiguous":
 *   SELECT id FROM households WHERE deleted_at IS NULL LIMIT 2
 * Exactly one row → that household. ZERO rows → null (a genuinely empty database). TWO rows → THROW:
 * the server cannot tell whose data this is, which is an unexpected server state, not a user error.
 *
 * ⚠️ The LIMIT 2 exists to DETECT ambiguity. The first row must NEVER be read as a pick — "just use
 * rows[0]" is the exact edit a later author makes to "fix" a dark app, and it is a silent cross-wire.
 * No ORDER BY, deliberately: there is no correct ordering, because there is no correct answer.
 *
 * It does NOT select `households.synthetic` — see §Design 1a.
 *
 * AUTH-1 replaces this body with session → household_members and nothing else moves (beta-1.md:128).
 */
export const getHouseholdScope = cache(async (): Promise<HouseholdScope | null> => { … });
```

**Why `cache()`:** `catalog.ts:26,49` is the established precedent in this repo for request-memoised
reference reads, and it is already exercised from Server Actions (`logBodyweight` →
`getActivityTypeIdByKey`, `entries.ts:313`). One request fans out to ~11 DAL calls
(`page.tsx:86-88` alone is three in a `Promise.all`); without `cache()` that is 11 identical queries.

**Why `cache()` is safe even if it does not memoise** (e.g. in the export Route Handler, where no
precedent exists): the function is deterministic for the request, so a cache miss costs **one extra
2-row query and never a different answer**. `cache()` here is a performance device, not a correctness
device — which is precisely why it is acceptable on the resolution half while the propagation half is
compiler-checked.

**Why not `SEED_HOUSEHOLD_PUBLIC_ID`:** `beta-1.md:58-60` — _"No code path may ever treat 'the seed
household' or 'the first sign-in' as an owner — its ids are public."_ The constant is exported from
`packages/shared/src/seed-ids.ts:10` and appears in a public repo. A hardcoded id would also make the
dev/e2e fixture id load-bearing in production.

**Why not an env var:** three environments to set, a typo is a silent total outage, and it adds a
secret-shaped config item for something the database already knows unambiguously.

**Why "fail closed on ≥2" rather than "pick one":** it converts the one dangerous pre-AUTH-1 state into
a loud one. Today it cannot fire (`verify.ts`'s second household lives only in PGlite; previews get a
seed-only database under OPS-1; ONB-2's household creation is post-AUTH-1), and AUTH-1 is sequenced
immediately after (`beta-1.md`'s Beta 0 ordering), so the window is short by construction. "Pick one"
would be a silent cross-wire, which is indefensible in the one milestone whose point is isolation.

**But zero and ≥2 are different states and must not share a path** _(security lens, accepted)_. The
first draft returned `null` for both and mapped it onto the unknown-profile path. That path renders
the picker's existing empty state — _"No profiles found. Seed the database to get started."_ So an
**invariant violation** ("the server cannot tell whose data this is") would be reported to the
operator as _"your data does not exist"_, together with an instruction whose remedy under `migrate.yml`
is a **production write**. A Sentry message is loud to a dashboard, not to a parent on a gym floor at
6:30pm.

- **Zero live households → `null`.** A genuinely empty database; the empty state is the honest answer.
- **≥2 live households → throw.** `write-path.md`'s invariant 4 routes the unexpected to a throw →
  `error.tsx` + a Sentry **exception** with a stack. It never tells the operator their data is gone.

A wrong-household **id** stays a 404 either way — this split is about the global-ambiguity state, not
about an id.

### 3 · Who calls it — the DAL, not the pages

Each `lib/dal` function calls `getHouseholdScope()` itself and passes the scope down into
`packages/db`. **`page.tsx`, `actions.ts` and `route.ts` signatures do not change at all.**

- `write-path.md:118` (invariant 8) already makes `lib/dal/*` the only layer allowed ambient server
  state. The scope is ambient at the request boundary and explicit at the SQL boundary — each in the
  layer that is allowed to hold it.
- Threading a scope parameter through 7 actions, 3 pages and a Route Handler would touch ~11 files to no
  benefit, and a threading mistake at _that_ layer is a leak the compiler cannot see (the parameter is
  present, just wrong).
- `cache()` makes the ambient call free after the first.

A **wrong-household profile id** maps to exactly the path an unknown profile already takes:
`getProfileByPublicId → null → notFound()` / `NO_PROFILE_LOG`. **No new error shape and no new copy**
— which is what `beta-1.md`'s AUTH-1 exit criterion promised: wrong account becomes a 404 that TEN-1's
proofs cover. (The ≥2-households state is the exception, and it throws — see above. So the original
claim of "no new UI state" is narrowed: a wrong **id** introduces none; a server that cannot resolve a
scope reaches `error.tsx`, which already exists.)

A zero-household `null` captures a Sentry _message_ (not an exception — an empty database is not a
server fault). A household **count** is not personal data, so `SECURITY.md` → Logging is satisfied.

### 4 · `movements` cannot be scoped here — and that is the deliverable

`catalog.ts:76-89` does `INSERT … ON CONFLICT DO NOTHING ON (movements.slug)` then selects by slug.
`movements` has **no `household_id` column** (confirmed: `grep -n household packages/db/src/schema.ts`
returns `households`, `profiles` and `program_blocks` only). So household B's free-text "RDL" silently
binds to household A's row — and `program-day.ts:88-89` reads `movements.isBodyweight` and
`movements.unitDefault` off that row, so B inherits A's declarations. Exactly `beta-1.md:132-134`.

TEN-1 **cannot fix this** (it needs a migration with partial unique indexes built `CONCURRENTLY` — that
is TEN-2, three PRs, `plan.md:732-734`). TEN-1's deliverable is the **verdict**: PR 1d proves the
behaviour and records the go/no-go `beta-1.md:134-136` asks for. My read of the code is that the proof
will come back _leaking_, so plan for TEN-2 entering Beta 0 — but the plan does not prejudge it; the
assertion does.

`getActivityTypeByKey`, `getMetricDefinition` and `assertMetricKeyExists` are **deliberately global**
reference data seeded from `packages/shared` (`catalog.ts:11-16`, `architecture.md:178`). They go on the
structural guard's allowlist **with that reason written next to them**, so a future global read has to
argue its way onto a list rather than slip past a regex.

### 5 · How it is proved — three vehicles, because one cannot reach everything

**(a) `db:verify` — the real-database proof** (`packages/db/scripts/verify.ts`, PGlite). Reuses three
existing idioms verbatim:

1. **The second-household fixture** already exists: `verify.ts:3502-3515` creates `VERIFY_HH_PUBLIC_ID`
   - `VERIFY_PROFILE_PUBLIC_ID` with its own program block, _"its own household/profile/block slug so a
     future real data-PR block can never collide"_. TEN-1 extends it with entries, sets, a weigh-in and a
     check-in so the whole matrix has something to find.
2. **Both directions, always.** `verify.ts:3678-3683` states the rule and the reason:
   > _Asking only one way would pass even with the household scoping deleted, since the globally-newest
   > block happens to be the verify one — the assertion would then be proving fixture ordering, not
   > ownership._
   > Generalised: **every new zero-rows assertion ships with a matching assertion that the same call
   > returns rows for the right household** (the `:3694-3700` shape). This is the single most important
   > test-design rule in this plan; see R5.
3. **The refusal matrix.** `verify.ts:2986-2998`'s
   `for (const [arg, arg, why] of […] as const) assert.equal(…, null, \`… refuses a ${why} row\`)`becomes`entry point × {own household, other household}`with a`why` per row.

**(b) The recording-pool SQL-shape test** (`apps/web/lib/dal/entries.test.ts:9-23`) for the app-DAL reads
that `db:verify` cannot execute — its docblock says why: _"The app DAL cannot run under `db:verify` (it
is `server-only` and imports the app's env), so the query runs through the real Drizzle builder over a
recording pg client and the emitted SQL is asserted."_ `listProfiles` and `getProfileByPublicId` are
exactly that case. Assert `where` contains `"profiles"."household_id" = $` and that `values` contains
the scope's id — a statement about emitted SQL, not about source text.

**(c) `actions.test.ts` — the boundary suite**, enumerated over all 7 actions in the shape of the
existing unauth suite (`:116-143`), which is the pattern `write-path.md:67` asks for
(_"A new action without it fails the unauth suite in `actions.test.ts` only if you add it to that
suite: do"_).

**(d) The anti-regression guard** — `apps/web/lib/dal/scoped.test.ts`, in the shape of
`pages-are-gated.test.ts:44-65` (_"SEC-1's invariant as a test, not a sentence"_), including its
comment-stripping trick (`:21-26`) so a `// TODO: getHouseholdScope()` cannot satisfy it, and its
empty-glob sanity assertion (`:45-47`). Two assertions:

1. every exported async function in `apps/web/lib/dal/*.ts` that mentions `db` either calls
   `getHouseholdScope()` or takes a `HouseholdScope` — allowlist: `catalog.ts`'s three reference reads
   (reason recorded), `household.ts` itself, `gate.ts`, `db.ts`;
2. no file under `apps/web` mentions `householdScopeForScript`.

**No e2e.** It would need a second household in the shared seed, which collides head-on with OPS-2
(`plan.md:717-721`: the seed already _"expands ramp targets over every kid in the database"_) and with
`docs/definition-of-done.md`'s rule to _"push correctness (idempotency, zod, ownership, edge cases) down
to the fast tiers and let E2E prove only that the pieces are wired together."_ Named in Out-of-scope so
it cannot fall between PRs.

## Chunks, in order

| #      | Chunk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Why it cannot move                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **0**  | **[ADR 0006 — household addressing](../decisions/0006-household-addressing.md). ✅ DONE** — **Accepted: option A (session-only)** _(the maintainer, 2026-10-07; #252)_. `/p/<profileId>` stays the address, a wrong household is a **404**, and it supersedes **only HH-1's URL clause**. It also created three named obligations and three forward-compatibility requirements for this plan — all now owned, see "What ADR 0006 obliges, and where it lands". Docs-only, plan-exempt (`docs/plans/README.md` → Exempt).                                                                                      | [beta-1.md](../milestones/beta-1.md) § 2 ordered Beta 0 as `ADR → TEN-1 → AUTH-1`: both build on its answer, and every error shape below rests on "wrong account → 404". It reversed a decision the maintainer had already made (HH-1), so it was theirs to sign rather than an implementation detail.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **1a** | **`households.synthetic`, shipping dark** — `boolean NOT NULL DEFAULT false`, metadata-only `ADD COLUMN`, **no seed change**, a `db:verify` readback that fails on nullability/default drift and on a seed that clobbers the flag, plus `household-synthetic-is-dark.test.ts`. _(The second half of this chunk — `packages/db/tsconfig.json` + `typecheck` over `scripts/**` — **landed as DX-7 in #244**; `packages/db/tsconfig.json` exists and the root `typecheck` runs both projects. So 1a is the dark column only.)_                                                                                   | One reason now, and it is absolute rather than conditional. The v1-22-1 argument is that `migrate.yml` runs on merge while Vercel deploys in parallel, so a column no code reads has no deploy-order window — _"but only if no code PR reads it in the same merge"_. Cutting `synthetic` from `HouseholdScope` (§Design 1a) means **no TEN-1 chunk ever reads it**, so the condition holds for the whole plan rather than for one merge, and the dark-column guard enforces it. The typecheck reason is retired: DX-7 shipped it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **1b** | **The seam, and the gate closes.** `HouseholdScope` + `householdScopeForScript` + household-aware `isLiveProfile`/`ownedEntryIds`; `getHouseholdScope()`; the three profile-resolution sites (`listProfiles`, `getProfileByPublicId`, `updateProfileRoutine`); every site `isLiveProfile`/`ownedEntryIds` **already** reaches (`listEntriesForDay`, `logBodyweight`, `weeklyAdherenceRows`, both amends, `findAmendableBodyweight`, `registry.ts:225`); ~22 `db:verify` call sites; the two-household fixture + the first matrix; **the wrong-household boundary suite**; the recording-pool SQL-shape tests. | **The cut is FORCED, not a size judgement** _(panel P7)_: `isLiveProfile` is one exported symbol imported **across the package boundary** (`apps/web/lib/dal/entries.ts`), so a required parameter is a breaking signature change — every existing caller converts in this PR or the web build fails. The three gate sites ride here because they are the 404 the ADR's decision rests on, and because leaving them unscoped for a PR means a foreign id _resolves_ and then dies deeper down (see R8). AGENTS.md → Backend/API PR rules puts the boundary tests in the PR that changes the authZ — this is that PR. **Budget: ~400 lines of non-test source, the rest proofs and guides.** AGENTS.md's <400-line target is about reviewable _concerns_, and the proofs are this chunk's deliverable (`beta-1.md`: _"If it must shrink, shrink Beta 1, never TEN-1's proofs"_); the forcing function above is why they cannot be a follow-up PR. **As built: ~2,000 lines across 27 files, of which ~1,300 are tests, proofs and guides.** |
| **1c** | **DAL-2's tail.** The remaining predicate sites `isLiveProfile` does not yet reach: `logCheckinEntries` (`entries.ts:376`), `writeStrengthSession` (`:295`), `programDayRows` (`:41`), `export-month` ×3, `seed.ts:256`; ~36 `db:verify` call sites; the export/program/check-in DAL threading; the matrix extended to those entry points.                                                                                                                                                                                                                                                                    | After 1b: a site cannot convert to a helper that does not yet take a scope. Split from 1b purely on size — these are the three highest-churn call-site families (`programDayRows` 17, `writeStrengthSession` 14, `export-month` 6 in `verify.ts`), and bundling them would bury 1b's authZ change in mechanical diff. After 1c the hand-written count is **zero**, which is what makes 1d's guard absolute. **Budget: ~150 lines of source, ~400 of `verify.ts` edits** — almost all mechanical, which is the point of splitting it out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **1d** | **Guards, corrections, catalog verdict, docs.** `registry.ts:65-71` onto the helper with a named household; `lib/dal/scoped.test.ts`; the `findOrCreateMovementId` cross-household proof + the recorded TEN-2 go/no-go; `write-path.md`, `programming.md`, `architecture.md`; the `plan.md`/`status.md` rows.                                                                                                                                                                                                                                                                                                 | The structural guard can only be made **absolute** (no exceptions beyond the three reference reads) once 1c leaves no hand-written sites — written earlier it ships with an allowlist that then has to shrink, and an allowlist that shrinks is one nobody audits. The catalog verdict needs 1b's two-household fixture and is the **only** input to `beta-1.md:134-136`'s TEN-2 Beta-0 decision, so it must be recorded before that decision is taken. `householdScopeForScript` gets its second real consumer here — `ownership.ts:23` forbids extracting a helper with one (_"Extracted here with **two** consumers, not speculatively"_).                                                                                                                                                                                                                                                                                                                                                                                              |

**Cuttable, in this order, if the milestone runs long.** [beta-1.md](../milestones/beta-1.md) § 2 is
explicit — _"If it must shrink, shrink Beta 1, never TEN-1's proofs"_ — so none of the proofs is on
this list. The first draft answered "nothing", which the scope lens correctly called a refusal rather
than an answer. The real list, which leaves every proof intact:

1. **`households.synthetic` (chunk 1a) → OBS-2's own PR.** It reads nothing and removes no `WHERE`
   from OBS-2. Two lenses argued for this outright; it ships only because
   [plan.md](../plan.md) → OBS-2 asks for it by name. It is the cheapest thing here to drop.
2. **The miss-path event (ADR obligation 3) → AUTH-1.** Pre-AUTH-1 there is **one** household in prod
   and ≥2 throws, so a cross-household miss cannot occur and there is **no actor to name** — the event
   would be unreachable code written against a resolver body AUTH-1 replaces. ADR 0006 itself files the
   404 rule, the segment rule and this event as _AUTH-1's boundary-test contract_. **Not cut by
   default** — it is a named obligation and 1b is where the two states become indistinguishable — but
   this is the one obligation with a principled deferral if the milestone runs out.
3. **1d's `architecture.md` + `SECURITY.md` prose → folded into 1c.** `write-path.md` cannot move: it
   is `guides:check`-forced in 1b and 1c.

**Not cuttable:** the picker's `db:verify` proof, the matrix, the boundary suite, the structural guard,
or the `findOrCreateMovementId` verdict.

## File-by-file changes

| Path                                                    | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | PR         |
| ------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `docs/decisions/0006-household-addressing.md`           | NEW    | Session-only; `/p/<profileId>` stays; wrong household = 404; supersedes HH-1. Records Q5's forward path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 0          |
| `packages/db/src/schema.ts`                             | EDIT   | `synthetic: boolean('synthetic').notNull().default(false)` on `households`, in the `movements.is_bodyweight` idiom. Docblock states: OBS-2 is the consumer, it ships dark, it is **not** on `HouseholdScope`, the **seed must never name it**, and a synthetic household must not exist in prod before AUTH-1. No `HouseholdRow` edit needed — it is `$inferSelect`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | 1a         |
| `packages/db/migrations/0014_household_synthetic.sql`   | NEW    | `ALTER TABLE "households" ADD COLUMN IF NOT EXISTS "synthetic" boolean DEFAULT false NOT NULL;` — generated by `drizzle-kit generate --name household_synthetic`, then hand-hardened with the header, `SET lock_timeout = '5s'` / `SET statement_timeout = '60s'` (each with a **trailing** `--> statement-breakpoint`) and `IF NOT EXISTS`. Metadata-only: a non-volatile default has not rewritten the table since PG 11. **Squawk: `Found 0 issues`** on `squawk-cli@2.66.0` with the repo's config. Header follows `0013`'s structure but states its own reason — and, unlike 0006/0013, carries **no "chunk N is the reader"** clause, because nothing reads it until OBS-2.                                                                                                                                                    | 1a         |
| `packages/db/src/writers/ownership.ts`                  | EDIT   | `HouseholdScope`, `householdScopeForScript`, the third conjunct in `isLiveProfile:32`, `ownedEntryIds:43` threads it. Docblock: `:27`'s _"Nine full hand-written copies remain"_ becomes zero (after 1c) and names the third conjunct as the household seam.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 1b         |
| `apps/web/lib/household-synthetic-is-dark.test.ts`      | NEW    | TEN-1 1a's central claim as a test: `households.synthetic` is named by **only** `schema.ts` and `verify.ts`, with comments stripped (the `pages-are-gated.test.ts` idiom). 0006 and 0013 made the same ships-dark claim in prose and got away with it because their columns were nullable and unread by construction; this one had a reader planned one chunk later, which is exactly when an unchecked claim matters. ⚠️ **OBS-2 deletes this file** in the PR that lights the column up — a visible edit, not a loosened allowlist. Lives in `lib/`, **not** `lib/dal/`: it is a cross-cutting guard about a schema column, not part of the write path — and `write-path.md` owns `lib/dal/`.                                                                                                                                      | 1a         |
| `packages/db/src/scope.ts`                              | NEW    | `HouseholdScope` + the brand, re-exported from `index.ts` (the app legitimately needs the type). Split out of `writers/ownership.ts` so the tenancy seam does not live in the write-cores directory — most of its consumers are reads.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 1b         |
| `packages/db/src/writers/household-scope-script.ts`     | NEW    | `householdScopeForScript`, in a module `index.ts` does **NOT** re-export, imported by relative path from `packages/db/scripts/**`. `packages/db/package.json` maps only `"."`, so a deep bare import from `apps/web` fails **module resolution** — containment becomes lexical instead of a text scan a defaulted parameter or an aliased re-export defeats.                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 1b         |
| `apps/web/lib/constants.ts`                             | EDIT   | **ADR 0006 consequence:** promote `NO_PROFILE_LOG` / `NO_PROFILE_SAVE` out of module scope in `actions.ts`, in the `AMEND_ERROR_COPY` idiom already in this file. `actions.test.ts` re-types the literal **7 times** today; both `it.each` tables then assert via the const, so the byte-identity the refusal's security argument depends on is structural rather than prose.                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 1b         |
| `apps/web/lib/dal/household.ts`                         | NEW    | `getHouseholdScope()`. Covered by `write-path.md`'s `owns: apps/web/lib/dal/`, so `guides:check` already forces the guide.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 1b         |
| `apps/web/lib/dal/profiles.ts`                          | EDIT   | `listProfiles:24` gains `eq(householdId, scope)`; `:85` and `:121` convert to `isLiveProfile(id, scope)`; all three resolve the scope and return `[]`/`null` on a null scope. Stale docblocks at `:11-16` and `:45-51` (_"lands with auth at V1-1/v1.5; this is the seam it plugs into"_) are rewritten — the seam has landed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 1b         |
| `apps/web/lib/dal/entries.ts`                           | EDIT   | 1b: `listEntriesForDay:115`, `logBodyweight:304`, `editBodyweight:491`, `ownedBodyweightValue:507`, `editStrengthSet:521` resolve + pass the scope. 1c: `logCheckinEntries:367` onto the helper, `logStrengthSession:455`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 1b, 1c     |
| `apps/web/lib/dal/adherence.ts`                         | EDIT   | `getWeeklyAdherence:20` passes the scope to `weeklyAdherenceRows`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 1b         |
| `apps/web/lib/dal/programming.ts`                       | EDIT   | `getProgramDay:21` passes the scope. `:18-19`'s claim is upgraded: no caller can pass a household id **and** the requester's household is now asserted independently of the profile's row.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 1c         |
| `apps/web/lib/dal/export.ts`                            | EDIT   | `prescribedFor:98`, `buildExportEntries:119`, `buildExportZip:163` thread the scope. `:120`'s `getProfileByPublicId` already fails closed — the queries get it too (`write-path.md:72`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 1c         |
| `packages/db/src/queries/weekly-adherence.ts`           | EDIT   | `:70` passes the scope through.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 1b         |
| `packages/db/src/writers/bodyweight.ts`                 | EDIT   | `findAmendableBodyweight:107` + `updateBodyweightEntryById` take a scope and hand it to `ownedEntryIds:117`. `insertBodyweightEntry` takes an **internal** `profileId` and builds no predicate → unchanged.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 1b         |
| `packages/db/src/writers/strength-session.ts`           | EDIT   | `updateStrengthSetById` (1b, via `ownedEntryIds`); `writeStrengthSession:295` onto the helper (1c) — the scope must be checked **inside** the transaction, where `:291-298` already resolves the profile.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 1b, 1c     |
| `packages/db/src/queries/program-day.ts`                | EDIT   | `isThisProfile:40-43` → `isLiveProfile(id, scope)`; both sub-selects inherit it (`:38-39`'s rule). Docblock `:13-16` gains the independent-assertion property and marks the `:51` join a deliberate redundancy.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | 1c         |
| `packages/db/src/queries/export-month.ts`               | EDIT   | `:84`, `:122`, `:146` onto the helper.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 1c         |
| `packages/db/src/seed.ts`                               | EDIT   | `:256-259` gains the conjunct for symmetry (already correct via `:217-222`'s household resolution).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 1c         |
| `packages/db/scripts/corrections/registry.ts`           | EDIT   | `:65-71` onto `isLiveProfile(ATHLETE_ONE, householdScopeForScript(…))`; the household resolved by `public_id` beside the profile. `:219-225` gains the scope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | 1d         |
| `packages/db/scripts/verify.ts`                         | EDIT   | ~59 call sites; the second-household fixture extended with entries/sets/weigh-in/check-in; the TEN-1 matrix; the `findOrCreateMovementId` cross-household probe.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | 1b, 1c, 1d |
| `apps/web/app/p/[profileId]/actions.test.ts`            | EDIT   | The wrong-household suite over all 7 actions; `:162-165`'s KNOWN GAP comment in `actions.ts` deleted (the gap is closed).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | 1b         |
| `apps/web/lib/dal/recording-db.ts` + `profiles.test.ts` | NEW    | Recording-pool SQL-shape tests for `listProfiles` / `getProfileByPublicId`. ⚠️ **The harness must be EXTRACTED, not copied** — `entries.test.ts`'s `vi.hoisted` recording client is the only copy today, and a second one is the occurrence AGENTS.md makes the trigger to extract; `entries.test.ts` converts in the same PR so the extraction lands with two consumers. ⚠️ **And the vehicle does not execute as first drafted:** that pool returns `{ rows: [], rowCount: 0 }` for **every** query, so `getHouseholdScope()` sees zero households, the function short-circuits, and the profiles query is never emitted — `queries[0]` is the households query. Teach the pool to answer per-SQL (one household row when the text matches `from "households"`), or mock the scope and stop calling this the `listProfiles` proof. | 1b         |
| `apps/web/lib/dal/scoped.test.ts`                       | NEW    | The structural guard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | 1d         |
| `docs/features/write-path.md`                           | EDIT   | The **household scope** invariant beside the ownership one, and the **no-cache-without-the-household-id-in-the-key** rule (ADR 0006 obligation 2). Nine → zero. `owns:` gains `packages/db/src/queries/export-month.ts` and `weekly-adherence.ts` (today **no guide owns them**, so `guides:check` cannot see a change to a security-load-bearing query). ⚠️ **Must be touched in 1b and 1c, not deferred to 1d:** this guide `owns: apps/web/lib/dal/` and `packages/db/src/writers/`, both of which 1b and 1c edit, so `guides:check` fails those PRs without it.                                                                                                                                                                                                                                                                  | 1b, 1c, 1d |
| `docs/features/programming.md`                          | EDIT   | Forced by `guides:check` (`owns: packages/db/src/queries/program-day.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 1c or 1d   |
| `docs/architecture.md`                                  | EDIT   | `:106` (_"the seam v1.5's Clerk household scoping tightens"_) and `:135-136` now describe shipped behaviour.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | 1d         |
| `.github/SECURITY.md`                                   | EDIT   | _"every query is scoped by `household_id`"_ becomes **true-with-a-named-exception**, NOT true: `movements` has no `household_id` column at all, so it stays unscopable until TEN-2. Write it as the exception plus the 404 rule's published-resource carve-out (ADR 0006 fwd 3); name the proof and the two residuals (`movements` → TEN-2; authorization vs. consistency → AUTH-1). Also drop `:69`'s stale "⚠️ proposed, unsigned" on ADR 0006.                                                                                                                                                                                                                                                                                                                                                                                    | 1d         |
| `docs/plan.md` · `docs/status.md` · `docs/roadmap.md`   | EDIT   | TEN-1/DAL-2 rows, the TEN-2 verdict, the seam row. **Owned by another lane — the implementing PR does it, not this plan.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 1d         |
| `docs/changelog/*.md`                                   | NEW ×4 | One fragment per PR (DoD).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | all        |

## Test plan

**Per PR:** `pnpm verify` (format · lint · typecheck · test · **db:verify** · skills · actions · guards ·
`audit --prod`) and `pnpm e2e:local` for 1b/1c (the day read and the write path change).

### `db:verify` — the TEN-1 matrix

Fixture: extend `verify.ts:3502-3515`'s household B with one profile, one strength session (2 movements
× 2 sets), one weigh-in, one check-in and one ramp target, so every query has something to wrongly
find. Household A is the seed (`SEED_PROFILE_PUBLIC_ID`, `SEED_PROFILE_2_PUBLIC_ID`).

```ts
// Every row asserts BOTH directions — one direction alone would pass with the scoping deleted
// (verify.ts:3678-3683's argument, generalised).
for (const [label, call] of ENTRY_POINTS) {
  assert.ok((await call(A_PROFILE, A_SCOPE)).length > 0, `TEN-1: ${label} returns A's own rows`);
  assert.equal((await call(A_PROFILE, B_SCOPE)).length, 0, `TEN-1: ${label} — B cannot read A`);
  assert.ok((await call(B_PROFILE, B_SCOPE)).length > 0, `TEN-1: ${label} returns B's own rows`);
  assert.equal(
    (await call(B_PROFILE, A_SCOPE)).length,
    0,
    `TEN-1: ${label} — A cannot read B (reverse)`,
  );
}
```

`ENTRY_POINTS` ⊇ `listEntriesForDay`'s SQL · `weeklyAdherenceRows` · `programDayRows` ·
`strengthMonthRows` · `bodyweightMonthRows` · `loggedMonths` · `ownedEntryIds`. Writers (`null`/throw
instead of zero rows) use the `verify.ts:2986-2998` refusal matrix: `writeStrengthSession` ·
`logBodyweight`'s resolve · `logCheckinEntries`'s resolve · `updateStrengthSetById` ·
`updateBodyweightEntryById` · `findAmendableBodyweight` · the `db:correct` registry query.

Plus:

- **Soft-deleted household** → `profiles.household_id` still points at it; the scope resolver filters
  `deleted_at IS NULL`, so no scope exists and nothing is readable.
- **The `synthetic` readback** (1a, built): `columnsOf('households')` for the declared type, plus a
  direct `information_schema.columns` read for `is_nullable = 'NO'` and `column_default = 'false'` —
  the two catalog facts `columnsOf`'s name→`data_type` Map cannot express, and the ones that guarantee
  prod's pre-existing row acquired `false` rather than NULL. Then the assertion that is **not** a
  tautology: flip the flag, run `seed()` a **third** time, and prove the value held; restore it, seed
  again, and prove the seed never sets it either. That pins "the seed does not name this column" in
  both directions, which is what keeps a fresh or restored prod database from labelling the real
  family's household a test fixture. Plus a behavioural DEFAULT probe on the existing household-B
  insert, which never names the column. **Verified load-bearing by three mutations** (nullable → red;
  `DEFAULT true` → red; seed switched to `onConflictDoUpdate` → red). ⚠️ `db:verify` applies migrations
  to an **empty** PGlite database, so the prod path — an existing row acquiring the default through
  `attmissingval` — is **not** covered here, for this or any future `ADD COLUMN … DEFAULT`.
- **`findOrCreateMovementId`'s SQL** (1d), **in both directions** — the both-directions rule applies to
  the verdict too, and the first draft tested only the read direction:
  - **Read:** household A creates a custom movement (a neutral fixture name, never a person's); B
    calls with the same name; assert whether B gets A's `id` / `is_bodyweight` / `unit_default`.
  - **Write / poison, which is strictly worse:** `findOrCreateMovementId` inserts with
    `isBodyweight: false` and the caller's free-text name, `ON CONFLICT (slug) DO NOTHING` — and the
    seed seeds the real catalog with the **same** arbiter while prescription targets resolve **by
    slug**. So whichever household types a name first permanently pins that slug's row and the seed
    will never repair it: the other household's program card then renders the **first typist's** name
    and `is_bodyweight` / `unit_default`, which the renderer treats as _"the MOVEMENT's declaration,
    not the coach's"_. The shared catalog has bodyweight movements and this function can only ever
    write `false`, so a typo in B can change which load controls A's UI offers. Given the inviolable
    load rule that is safety-adjacent, not cosmetic.
  - **A refused write still commits the catalog row:** the strength DAL resolves every movement
    through `findOrCreateMovementId` **before** `writeStrengthSession`, whose in-transaction ownership
    re-resolve is the actual seam. So a POST the seam refuses has already committed globally-visible,
    caller-supplied text — a cross-tenant **write primitive surviving a refusal**, categorically
    different from a read leak. Assert that side effect explicitly.
  - **The assertion states the truth the code has** — if it leaks, the assertion documents the leak and
    the TEN-2 trigger fires. Do not write an aspirational assertion here. _(The security lens reads
    the write direction as forcing TEN-2 into Beta 0 regardless of the read probe's result; the proof
    decides, and the verdict is recorded with its output.)_

### Vitest

- `actions.test.ts`: `it.each` over all 7 actions — a foreign profile returns exactly
  `NO_PROFILE_LOG` / `NO_PROFILE_SAVE` (byte-identical to the unauth and unknown-profile copy, so the
  refusal leaks nothing), **no writer is called**, and `revalidatePath` is not called. Mirrors `:116-143`.
  Plus: a `null` scope takes the same path.
- `profiles.test.ts`: emitted SQL for `listProfiles` / `getProfileByPublicId` carries
  `"profiles"."household_id" = $` and the scope's value.
- `scoped.test.ts`: the two structural assertions, with the empty-glob sanity check.
- **Mutation check (1b/1c), by hand:** delete the third conjunct from `isLiveProfile` and confirm the
  matrix goes red in **both** directions, and that `scoped.test.ts` stays green (it checks call sites,
  not SQL) — which is exactly why both vehicles are needed.

## 1b as built — what diverged from this plan, and why

Recorded in the implementing PR, per AGENTS.md: a divergence from a reviewed plan is recorded with
its reason, not absorbed silently. Nothing below weakens a proof; three of the five strengthen one.

| #     | The plan said                                                                                                                    | What shipped                                                                                                                                                                                                                                                                                                                                                             | Why                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | §Design 1 names **one** constructor (`householdScopeForScript`) and says the other way to get a scope is to "DERIVE" it.         | **Two named constructors**: `householdScopeForScript` (not re-exported) and `householdScopeForRequest` in `scope.ts`, which the barrel **does** re-export, plus a private `makeHouseholdScope`. `index.ts` switched from `export *` to **named** re-exports so neither `makeHouseholdScope` nor the script constructor can reach `apps/web` on a bare specifier.         | The plan never said how `getHouseholdScope()` obtains a branded value, and the brand is `declare const` so the app cannot name it. The alternatives were an `as unknown as` cast in `household.ts` (unreviewable, and indistinguishable from a forgery) or a cast in every future caller. A named constructor is what §Design 1 already concedes the brand buys: it blocks the **accidental** object literal, not a deliberate forgery. |
| **2** | §Design 5 lists three vehicles; the resolver's own query was untested against a database.                                        | **A fourth single-sourced query**, `packages/db/src/queries/household-scope.ts` → `liveHouseholdIds(db)`, which `getHouseholdScope()` runs and `db:verify` proves.                                                                                                                                                                                                       | The test plan asks for a **soft-deleted household** case ("the scope resolver filters `deleted_at IS NULL`, so no scope exists and nothing is readable"). That is a claim about rows, and the app DAL cannot run under `db:verify` — so without single-sourcing it, the case could only have been a re-typed lookalike, which is the vehicle the panel rejected for the picker (**A2 · S1 · C7**). Same argument, same fix.             |
| **3** | §Design 1 puts the household `eq()` inside `isLiveProfile`.                                                                      | One more named predicate, **`inHousehold(scope)`**, which `isLiveProfile` and the picker query both use.                                                                                                                                                                                                                                                                 | The picker takes **no profile id**, so it cannot use `isLiveProfile`; without `inHousehold` it would read `scope.householdId` itself and **two** modules would unwrap the capability, which is exactly what ADR 0006's fwd-1 forbids. `scope.test.ts` now asserts **exactly one** reader, and that assertion is only true because of this extraction.                                                                                   |
| **4** | The file-by-file table assigns `apps/web/lib/dal/scoped.test.ts` to **1d**, while the ADR-obligations table assigns fwd-1 to 1b. | The **fwd-1 half shipped in 1b** as `packages/db/src/scope.test.ts` (one `.householdId` reader; one `householdScopeForRequest` namer; no defaulted `scope` parameter; no re-export or alias of the script constructor; `apps/web` never names it; `verify.ts` mints ≤ 2 scopes). `scoped.test.ts` — "every `lib/dal` read reaching `db` carries a scope" — stays **1d**. | The two tables disagreed. The split follows their reasons: fwd-1 is about the **type's** containment and is checkable now; `scoped.test.ts` can only be **absolute** once 1c leaves no hand-written predicates, and an allowlist that shrinks is one nobody audits. It lives beside `scope.ts` rather than in `lib/dal/` because it is a claim about the scope type, not about the write path.                                          |
| **5** | R5(4) says new household-B fixture rows take ids from `verify.ts`'s **existing local counter**.                                  | New rows take ids from `newId()` (UUIDv7) — plus `insertBodyweightProbe`'s and `insertCalisthenicsBout`'s existing counters where those builders were reused. `insertCalisthenicsBout` was **parameterised** by `profileId` rather than copied (**C16**).                                                                                                                | Strictly stronger against the failure R5(4) names. A counter avoids collisions with the 23 hand-assigned ids; `newId()` makes a collision impossible, which matters because the session builders use `onConflictDoNothing` on `client_id` — a collision there would hand back **another profile's** row and the matrix would assert about the wrong entry while staying green.                                                          |

**Two further things 1b added that the plan did not specify**, both to discharge an obligation it did
specify:

- **`pnpm db:mutations`** (R5 mitigation 2) is a committed patch set plus a runner, wired into
  `pnpm verify`. Cost measured: **+5s** (both mutations fail fast, well before `db:verify`'s 14s).
  `packages/db/scripts/mutations/README.md` states what each patch must redden, in assertion messages
  rather than line numbers.
- **`apps/web/app/tenancy-is-not-cached.test.ts`** (ADR obligation 2) pins `layout.tsx`'s directive,
  the comment that now says tenancy depends on it, the export handler's **own** dynamism, and the
  cache rule as an absence check over all of `apps/web`.

**Two things 1b deliberately did NOT do**, both to keep the chunk honest rather than complete:

- **`listEntriesForDay` is not in `db:verify`'s `ENTRY_POINTS`.** The app DAL cannot run under
  `db:verify` (`server-only` + the app's env), and reproducing its join there would be the re-typed
  lookalike the panel rejected. Its use of the scoped predicate is pinned by the emitted-SQL proof in
  `lib/dal/entries.test.ts` (conjunct **and** bound value), and the predicate itself is proved against
  the database through `ownedEntryIds`, which is the same function. `programDayRows`, `export-month`'s
  three reads and `loggedMonths` join the matrix in **1c**, when they take a scope.
- **The dual mutation's full vacuity sweep is not enumerable.** Pointing `A_SCOPE` at the wrong
  household makes `db:verify` fail at the **first** pre-existing positive assertion that rides it
  (`V1-6b-2: one row per calisthenics target for the week`), so the run cannot reach the later
  **negative** assertions to show which stay green. What is verified instead, by inspection of all 22
  threaded sites: every family of threaded negatives shares its block with at least one threaded
  **positive** (`weeklyAdherenceRows` 2 positives / 1 negative; `updateStrengthSetById` 3 / 5;
  `updateBodyweightEntryById` 1 / 8; `findAmendableBodyweight` 1 / 5), so no negative assertion is the
  only proof in its block, and the dual mutation is detected. C9's hole is narrowed, not closed.

## 1c as built — the real surface, and what diverged

Recorded in the implementing PR, per AGENTS.md. **The line numbers in the chunk table predate 1b**, so
every site was found by symbol and reconciled against the list.

### The surface the chunk table named, versus what was there

| Chunk-table site                | Found as                                                                             | Converted                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| `logCheckinEntries` (`:376`)    | `apps/web/lib/dal/entries.ts` → `logCheckinEntries` (`:393`)                         | ✅ `isLiveProfile`, scope resolved in the function          |
| `writeStrengthSession` (`:295`) | `packages/db/src/writers/strength-session.ts` (`:298`)                               | ✅ `isLiveProfile`, **required** `scope` on the args object |
| `programDayRows` (`:41`)        | `packages/db/src/queries/program-day.ts` → `isThisProfile` (`:42`)                   | ✅ both sub-selects inherit it                              |
| `export-month` ×3               | `strengthMonthRows` (`:84`), `bodyweightMonthRows` (`:123`), `loggedMonths` (`:147`) | ✅ all three                                                |
| `seed.ts:256`                   | `packages/db/src/seed.ts` → `seedProgram` (`:311`)                                   | ✅ `inHousehold(householdScopeForScript(household.id))`     |

**Exactly the five families the plan named, no more and none already gone.** Three further sites that
hold the predicate's _shape_ and are deliberately **not** conversions, stated so 1d's guard does not
have to rediscover them:

- **`apps/web/lib/dal/household.ts` → `reportScopeMiss`** — an **existence-only** probe that reaches
  `db` with no scope **on purpose**: it is how the miss-path event tells `cross_household` from
  `unknown_resource`. 1b already documented it as the one allowlisted unscoped read and made it return
  `void`. Not converted, by design.
- **`packages/db/scripts/corrections/registry.ts`** — two predicates (the KB-swings correction and
  PROF-1's `routine_config` backfill, the latter already household-scoped by hand). Both are **1d**'s
  by the file-by-file table, and `registry.ts` is a script, not app code — the structural guard 1d
  writes covers `apps/web/lib/dal/`, so 1c's "zero" is zero **where that guard looks** plus zero in
  `packages/db/src/`. Stated plainly rather than claimed away.
- **`apps/web/scripts/screenshot-ephemeral.ts`** — see divergence 1.

### Divergences

| #     | The plan said                                                                                                          | What shipped                                                                                                                                                                                                                                                                                                                                                                                                                                       | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | The file-by-file table names no `apps/web` caller of `writeStrengthSession` other than the DAL.                        | **`apps/web/scripts/screenshot-ephemeral.ts` calls it three times** and the required parameter made it a build failure. It now **derives** a scope from the throwaway database through `liveHouseholdIds` + `householdScopeForRequest`, throwing on anything but exactly one live household; `scope.test.ts` names that one file **and gains a new, absolute assertion** that nothing under `apps/web/{app,lib,components}/` mints a scope at all. | The plan's §Design 1b containment works exactly as designed and _forces_ this: `packages/db`'s `exports` map publishes only `"."`, so an `apps/web` script **cannot** reach `householdScopeForScript` by module resolution. Deriving is the stronger half of the rule — it never names a household id. The allowlist does not shrink, and the tree-level assertion is coverage the file did not have before, so the net is tighter than 1b's, not looser. |
| **2** | `B_SCOPE` lives beside the TEN-1 matrix at the end of `verify.ts`.                                                     | **`B_SCOPE` moved ~900 lines up**, to where household B is created, with a pointer comment left at the old site.                                                                                                                                                                                                                                                                                                                                   | 1c made `programDayRows` scoped, and the V1-10 block — household B's biggest consumer, 12 of the 17 call sites — sits above the old definition. Still exactly two `householdScopeForScript(` calls in the file, which `scope.test.ts` pins.                                                                                                                                                                                                               |
| **3** | The matrix is one `ENTRY_POINTS` loop over a single `(A_PROFILE, B_PROFILE)` pair.                                     | **Each row carries its own pair.** The four assertions are unchanged.                                                                                                                                                                                                                                                                                                                                                                              | The reads need different fixtures — adherence needs ramp targets, the export reads need logged sessions, the program read needs a block. One shared pair would have meant a re-typed lookalike fixture per read, which is the vehicle the panel rejected for the picker (**A2 · S1 · C7**). The pair varies; the both-directions rule does not.                                                                                                           |
| **4** | Nothing about `programDayRows` needing its own fixture.                                                                | **Two new blocks through the real `seedProgram`, one per household, both programming `legs`** — a day_role no other fixture uses.                                                                                                                                                                                                                                                                                                                  | The V1-10 fixture gives the two households **disjoint** day_roles on purpose, which proves day-aware block selection but **cannot** prove household scoping: asked for a day the other household does not program, a leak and a correct refusal are the same zero rows. A day both households program is what makes the four-way row mean anything — and it is the exact R5 vacuity the plan warns about, found by writing the assertion.                 |
| **5** | 1c's `seed.ts` conjunct "runs against **prod** on every push, so it needs a positive assertion too" (**R-af · D-af**). | **Both**: the two fixture blocks are the positive, and a new negative asserts `seedProgram` **rejects** a target naming a profile in another household _and_ wrote no block.                                                                                                                                                                                                                                                                       | The refs resolve before the insert, so "throws with nothing written" is a claim about two things. The throw message now names the household, which is what the negative matches on.                                                                                                                                                                                                                                                                       |

### Mutation results — every predicate 1c added, broken on purpose

Each conversion was reverted by hand, one at a time, to the pre-1c hand-written predicate, and
`db:verify` re-run. **All seven have a matching red assertion, and it is the right one:**

| Predicate broken                       | First failure                                                                                                  |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `programDayRows` → `isThisProfile`     | `TEN-1: programDayRows (the Today page's program card) — household B cannot read A`                            |
| `strengthMonthRows`                    | `TEN-1: strengthMonthRows (the CSV export's strength log) — household B cannot read A`                         |
| `bodyweightMonthRows`                  | `TEN-1: bodyweightMonthRows (the CSV export's weigh-ins) — household B cannot read A`                          |
| `loggedMonths`                         | `TEN-1: loggedMonths (which months the export writes at all) — household B cannot read A`                      |
| `writeStrengthSession`                 | `Missing expected rejection: TEN-1: …and the other household cannot write it`                                  |
| `seedProgram`                          | `Missing expected rejection: TEN-1 1c: seedProgram refuses a target in another household`                      |
| `logCheckinEntries` (Vitest — app DAL) | `logCheckinEntries — ownership scope (TEN-1 1c) > resolves the profile through the household-scoped predicate` |

**A third committed patch, `03-undo-1c-predicates.patch`**, reverts all seven at once and is wired into
`pnpm db:mutations`. Its load-bearing property is the one the per-predicate runs above cannot be a gate
for: under it **every 1b assertion stays green and the first failure is a 1c one**, so the new rows are
proved to carry their own weight rather than riding 1b's. Like mutation 02 it fails fast, so it
demonstrates one 1c assertion per run — which is why the per-predicate results are recorded here
rather than left to the gate. A single-predicate revert that the combined patch no longer matches is
caught as `patch does not apply`, which the gate reports as a failure.

### Not in 1c, and why

- **`listEntriesForDay` still has no `db:verify` row** (1b's reasoning, unchanged): the app DAL cannot
  run there, and reproducing its join would be the lookalike the panel rejected. `logCheckinEntries`
  joins it in the same vehicle — an emitted-SQL proof plus a dark-path proof in
  `lib/dal/entries.test.ts` — and both ride the predicate the matrix proves against a real database.
- **`findOrCreateMovementId` is still unscopable** and a refused strength write has already committed
  its caller-supplied catalog text. 1c makes `writeStrengthSession` scoped; it does **not** make the
  strength write path tenant-isolated. The proof and the TEN-2 verdict are **1d**'s, by the plan.
- **`scoped.test.ts`, `registry.ts`, `architecture.md`, `SECURITY.md`'s exception clause and the
  `plan.md`/`status.md` TEN-1 rows** are **1d**'s, untouched here.

## 1d as built — the guard, the corrections, and THE CATALOG VERDICT

Recorded in the implementing PR, per AGENTS.md. **TEN-1 completes with this chunk.**

### The structural guard — final allowlists, and why each entry is there

`apps/web/lib/dal/scoped.test.ts` ships **two** assertions, each with its own exception list, because
the plan's single rule ("reaches `db` ⇒ resolves or takes a scope") turned out not to be able to see
the exception it most needed to:

| Assertion                                                                         | Exceptions                                                                                                 | Why                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1 · nothing reaches `db` without resolving or being handed a `HouseholdScope`** | `catalog.ts#getActivityTypeByKey` · `catalog.ts#getMetricDefinition` · `catalog.ts#findOrCreateMovementId` | Exactly `write-path.md`'s "`catalog.ts`'s three reference reads". The first two are global reference data seeded from `packages/shared` with no household column. The third is the **residual**, not a design choice, and it is the one entry `TEN-2` deletes. |
| **2 · nothing builds its own ownership predicate**                                | `household.ts` (the file)                                                                                  | `reportScopeMiss`'s existence-only probe — ADR 0006 obligation 3. It is also the one declaration assertion 1 **cannot** see: it resolves a scope (to classify the outcome) and then queries without it, so it reads as scoped there.                           |

**Two exception families, which is exactly the two `write-path.md` already declared** — the plan's
own prose for assertion 1 listed "`household.ts` itself, `gate.ts`, `db.ts`" as well, and none of
those is needed: `gate.ts` and `db.ts` never reach the Drizzle client at all, and `household.ts`'s two
functions each pass on their own merits (the resolver names `HouseholdScope` in its signature; the
probe resolves one). So the shipped list is **smaller** than the plan's, not larger.

Three divergences from the plan, all in the same direction (stricter):

| #     | The plan said                                                                      | What shipped                                                                                                                    | Why                                                                                                                                                                                                                                                                                                                                                       |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | "every **exported** async function in `apps/web/lib/dal/*.ts` that mentions `db`". | **Every top-level declaration, exported or not.**                                                                               | A private helper that reaches `db` unscoped is the same leak as a public one, and `export.ts` → `prescribedFor` is literally that shape today (it takes a `HouseholdScope` and is never exported). The exported-only rule would have left it unchecked.                                                                                                   |
| **2** | One assertion, plus "no file under `apps/web` mentions `householdScopeForScript`". | **The second assertion is the no-hand-written-predicate rule instead.** The `householdScopeForScript` sweep was NOT duplicated. | 1b already ships it (`packages/db/src/scope.test.ts` → "apps/web never names the script constructor"), and a second copy is the drift this repo's constants rule exists to prevent. What 1b does **not** cover is "no twelfth copy of the predicate" — which is the rule the chunk actually owed, and the one that catches `reportScopeMiss`-shaped code. |
| **3** | Nothing about the allowlist going stale.                                           | A **dead-entry assertion**: an allowlisted function that no longer exists, or now carries a scope, fails the build.             | The `household-synthetic-is-dark.test.ts` lesson. Without it, `TEN-2` scoping `movements` leaves `findOrCreateMovementId`'s entry standing as coverage nobody re-earned. Now TEN-2 **has** to delete it.                                                                                                                                                  |

**Verified load-bearing by hand**, since no committed patch covers it (the mutation gate runs
`db:verify`, not Vitest): an unscoped `db.select(...).where(eq(profiles.publicId, …))` added to
`lib/dal/programming.ts` reddens **both** assertions and names `programming.ts#leakProbe` and the
offending line. And the guard's limits are stated in its own docblock rather than left to be
discovered: a call-site guard cannot see SQL, so patch 01 (delete the household conjunct) leaves it
**green** while the matrix goes red — which is why all three vehicles exist.

### The corrections — three predicates, found by symbol

The chunk table named one (`registry.ts:65-71`); 1c's audit found three, and the line numbers
predate 1b, so each was found by symbol:

| Site                                                       | Was                                                                                        | Now                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| `registry.ts` → `kbSwingsLoadRepsSwap.run` (the set query) | `eq(profiles.publicId, TARGET)` + `isNull(profiles.deletedAt)` — the last copy in the repo | `isLiveProfile(TARGET_PROFILE_PUBLIC_ID, scope)`             |
| `registry.ts` → `nullRoutineToFull.run` (the READ)         | `eq(profiles.householdId, householdId)` + `IS NULL` guards                                 | `inHousehold(scope)` + the same `IS NULL` guards             |
| `registry.ts` → `nullRoutineToFull.run` (the WRITE guard)  | `eq(publicId)` + `eq(householdId)` + `routineConfig IS NULL` + `deletedAt IS NULL`         | `isLiveProfile(t.publicId, scope)` + `routineConfig IS NULL` |

- **The bulk read has no `public_id` half**, so it takes `inHousehold(scope)` rather than
  `isLiveProfile` — the same split `seedProgram` made in 1c (`inArray` where `isLiveProfile` has
  `eq`). Identical SQL to what it replaces.
- **`kbSwings` is the one that is not byte-identical**: it gains the household conjunct, so it is
  **strictly narrower**. Stated rather than smoothed over. The row set is unchanged (the profile is in
  the seeded household) and the correction was applied on 2026-09-30 with an `is_bodyweight` guard
  that already makes a re-run a no-op, so the narrowing costs nothing and buys the thing
  `bodyweightDuplicates` already argued for: a correction cannot reach a family that never reported a
  problem.
- **`liveHouseholdId` became `liveHouseholdScope`** and returns the capability, so **no correction
  holds a raw `household_id` any more** — ADR 0006's fwd-1 now holds in this script, not only in the
  app. Its three consumers are the three corrections.
- **Proved, which the plan asked for and 1b did not deliver.** § Test plan lists "the `db:correct`
  registry query" in the refusal matrix and nothing ran it. `db:verify` now runs the null-routine
  correction's **own dry run** (`apply = false`, nothing written) and asserts it returns _exactly_ the
  NULL-routine profiles that are not household B's — both directions in one assertion. The baseline is
  an **unscoped** `IS NULL` sweep, asserted to reach household B's profiles, so the negative cannot
  pass for free; B's profiles are resolved **by household**, because B has more than one and a list
  naming only the first would have passed while leaking the rest.
- **Not done, deliberately:** `inHousehold(scope) + isNull(profiles.deletedAt)` is now the third
  occurrence of that pair (`householdProfileRows`, `seedProgram`, this read), and it was **not**
  extracted into a `liveProfilesIn(scope)` helper. The thing that must not drift — the household
  conjunct — is already single-sourced through `inHousehold`; the soft-delete half appears across the
  repo and is not the security seam; and the three sites genuinely differ in what else they add
  (`inArray`, an `ORDER BY`, a from-value guard). Extracting across the package boundary in the last
  chunk of a critical-path PR is scope the chunk should not take. Recorded so the reuse question is
  answered rather than unnoticed.

### 🔴 THE CATALOG VERDICT — and the recommendation `beta-1.md` asked for

`beta-1.md` § 2: _"Either TEN-1 proves the picker and the metadata stay per household, or **TEN-2**
moves into Beta 0."_ This is the only input to that decision, so it is recorded with its evidence.

**The picker: proved per household** (1b, `householdProfileRows`, four-way).
**The metadata: proved NOT per household.** Every assertion below is in `db:verify` →
_"TEN-1 1d: the catalog verdict"_, run against PGlite through the **real** `findOrCreateMovement`
(extracted into `packages/db/src/writers/movement-catalog.ts` in this chunk precisely so the proof
could run the code the app runs, not a lookalike — the `householdProfileRows` precedent).

| Direction                                         | What the proof shows                                                                                                                                                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Structural**                                    | `movements` has **no `household_id` column**. There is nothing to scope by, so no amount of TEN-1 closes this.                                                                                                                                                         |
| **READ — leaks**                                  | Two households typing the same movement differently (`'TEN-1 Catalog Probe'` / `'  ten-1   CATALOG   probe '`) converge on **one row**, and the second household is handed the first's. Its positive twin: a genuinely different name does get its own row.            |
| **READ — metadata inheritance**                   | A free-text name that slugs onto a **catalog** row comes back `is_bodyweight: true` — a declaration `findOrCreateMovement` can never write. Whatever the row says, the caller did not say it.                                                                          |
| **WRITE — poison**                                | Whoever types a name **first** pins that slug: its `name` is the first typist's free text, `is_bodyweight` is `false` and `unit_default` is NULL, for everyone. `ON CONFLICT DO NOTHING` discards the second household's text and the seed only touches its own slugs. |
| **WRITE — it reaches the other household's card** | `seedProgram` + `programDayRows`, read under household A's **own correct scope**, render household B's string and B's `is_bodyweight`. The household-scoped read is working exactly as designed and still shows another household's content.                           |
| **WRITE — surviving a refusal**                   | A session write the seam **refuses** (`Profile not found`, whole transaction rolled back, no `sessions` row) has **already committed** the caller-supplied movement row. A cross-tenant **write** primitive surviving its own refusal.                                 |

**Mutation-proven, so the verdict cannot be vacuous.** `04-slug-is-not-the-arbiter.patch` is
deliberately _not_ "scope the catalog" — that is TEN-2, not a one-line break, and a leak assertion
driven by the same name on both sides cannot be falsified by any change that keeps the signature.
What it breaks is the property the verdict **rests on**: that the shared `movementSlug` derivation is
the single **global arbiter** two spellings converge on. Without it the proof would be measuring
fixture ordering — the exact V1-10 vacuity — and a later author "fixing" the catalog by not
normalising, or by matching on `name`, would leave the verdict green and wrong. The structural
assertion needs no patch: it reddens the day TEN-2 adds the column, which is when the verdict must be
re-taken.

#### Recommendation — the maintainer's call, stated plainly

> **TEN-2 moves into Beta 0**, and its deadline is **step 4's invite, not AUTH-1's merge.**

The criterion's own terms are met for the picker and failed for the metadata, so by the sentence
`beta-1.md` wrote, TEN-2 moves in. The timing argument is what makes it a schedule fact rather than a
slogan:

- **The leak needs two households, and nothing can serve two before AUTH-1.** `getHouseholdScope()`
  **throws** on a second live household today, deliberately — so the exposure window does not open
  when TEN-1 merges, and it does not open when TEN-2 is deferred.
- **It opens the moment household #2 exists**, which is AUTH-1's _"a new user gets a new, empty
  household"_ followed by step 4's _"invite family #1"_. That is **inside Beta 0**, not after it. So
  "defer TEN-2 to Beta 1" is not an option the milestone's own shape allows.
- **AUTH-1 is therefore still next.** TEN-2 does not block it; it blocks the invite. Three PRs,
  schedulable in parallel with AUTH-1's dashboard/runbook work, which is why this costs less than the
  "+3 PRs on the critical path" framing suggests.

**The honest alternative, if three PRs will not fit before the invite** (option B, _not_ the
recommendation): **make the catalog read-only to the app until V1-8.** `findOrCreateMovementId`
resolves a seeded slug and **refuses to create**, which closes the write/poison direction and the
surviving-refusal primitive entirely and reduces the read direction to "both households share the
seeded catalog", which is by design. Cost: a household typing a movement the catalog does not carry
gets a refusal instead of a new row — a real product regression on the v0→v1 free-text bridge that
the strength form uses today, and a **product** decision rather than a security one. It is cheaper
than TEN-2 and strictly worse for the household; it is listed because the maintainer should see the
real trade, not because it is preferable.

**Not an option:** accept it. The criterion does not permit it, and the surviving-refusal primitive is
the kind of finding that gets worse with age — the catalog accumulates rows, and TEN-2's backfill is
cheapest while there are few.

### Not in 1d, and why

- **TEN-2 itself.** It needs a migration with partial unique indexes built `CONCURRENTLY` — its own
  plan, its own panel, three PRs (`plan.md` → TEN-2). 1d produces the verdict, not the fix.
- **An e2e cross-household spec** — Out-of-scope, unchanged (OPS-2 seed collision; the DoD pyramid).
- **The miss-path event's `cross_household` branch has no proof that it fires**, because it cannot
  today: it needs two live households and the resolver throws on two. 1b built it and documented it;
  ADR 0006 files it as **AUTH-1's boundary-test contract**, and that is still where it sits.
- **`kbSwingsLoadRepsSwap`'s own `db:verify` row.** Its dry run returns zero rows under PGlite (the
  2026-09-28 rows exist only in prod), and a zero that cannot be anything else proves nothing. The
  null-routine correction is the one that carries the registry's proof; fabricating a 2026-09-28
  fixture to assert against would be testing the fixture.

## Risks / rollback

| #      | Risk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1** | **A missed site = a cross-family leak** (`beta-1.md` § 2).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Required parameter → compile error; the structural guard; the matrix. **The residual this row used to name is CLOSED:** `packages/db/scripts/**` was in no tsc program, so `verify.ts` and `registry.ts` — the hole sat exactly where the proof lives — were invisible to `pnpm typecheck`. **DX-7 (#244) fixed it**: `packages/db/tsconfig.json` includes `scripts/**/*.ts` and the root `typecheck` runs both projects, so the compile-error net now reaches the proof itself. Nothing for this plan to add.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **R2** | `getHouseholdScope()` returns `null` in prod (0 or ≥2 households) → **the app goes dark**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Loud: a Sentry message naming the count. Cannot fire today (one household; `verify.ts`'s B is PGlite-only; previews are seed-only under OPS-1; ONB-2's creation path is post-AUTH-1, `plan.md:684`). Chosen deliberately over "pick one", which would be a silent cross-wire. Rollback is a revert of 1b.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| **R3** | `cache()` may not memoise in the export Route Handler.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Degrades to one extra 2-row query, never a different answer — the scope is deterministic per request. Correctness never depends on `cache()`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **R4** | Performance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | One equality on `idx_profiles_household` (`schema.ts:150`), already present as the FK covering index, plus one `LIMIT 2` scan per request on a one-row table.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **R5** | ⚠️ **A vacuous proof.** With ~59 mechanical `verify.ts` edits, one wrong household constant makes an assertion pass for the wrong reason. **This is the risk most likely to actually bite**, and it is invisible in review. ⚠️ **And the correctness lens found the half the both-directions rule does not reach:** the ~59 sites are _pre-existing_ assertions about something else, and among them the **negative** ones (`verify.ts`'s refusal matrix — "refuses a non-done row", "refuses a text-valued row") still return `null` when threaded with the **wrong** scope. They stay green, and four assertions silently stop proving what their own messages name. Deleting the conjunct _restores_ correct behaviour there, so the hand mutation check cannot see them either. | The both-directions rule stays **mandatory** for every new assertion. On top of it: **(1)** one `A_SCOPE` / `B_SCOPE` constant each, with a `scoped.test.ts`-style assertion that `householdScopeForScript(` appears in `verify.ts` at most twice, so no site mints an ad-hoc scope. **(2) Automate the mutation check as a gate** — commit a patch file that removes the third conjunct, and a step that `git apply`s it, runs `db:verify`, asserts a **non-zero** exit, and reverts. A patch file, never a runtime flag: a flag that can disable a BOLA predicate must not exist in shipped `packages/db` source. **(3)** The **dual** mutation (thread `B_SCOPE` everywhere) must also go red — any pre-existing negative assertion still green under it was vacuous before the sweep and is vacuous after. **(4)** New household-B fixture rows take ids from `verify.ts`'s existing local counter, not hand-assigned ones: the file hand-assigns ids in 23 other places and a `uq_entries_client_id` collision would make `expectRejectedBy` report the WRONG constraint while staying green. |
| **R6** | `movements` still shared across households.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Unfixable in TEN-1 (no column). Proven, recorded, and the input to TEN-2's Beta-0 decision (`beta-1.md:134-136`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **R7** | 59 call-site edits in one file invite a bad merge.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 1b/1c are sequential, not parallel; `keep-mergeable` after each; `verify.ts` is append-heavy so conflicts are append-style.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| **R8** | **The 1b→1c intermediate state.** After 1b the gate is closed but `logCheckinEntries`, `writeStrengthSession`, `programDayRows` and `export-month` are not yet scoped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | **Not a leak** — `getProfileByPublicId` fails closed first, so a foreign id never reaches them. The exposure is a worse _error shape_ for a crafted POST that cannot currently exist (one household in prod). Accepted explicitly, and it is why the gate sites ride in 1b rather than 1c: the reverse order would leave a window where a foreign id resolves and then dies deeper down.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **R9** | `profiles.household_id` is typed nullable in drizzle while the DB enforces NOT NULL via a validated CHECK. A reader could conclude orphans are possible and write a `OR household_id IS NULL` escape — a hole in the single security predicate this plan exists to create.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Stated in the `isLiveProfile` docblock. ⚠️ **The original cost claim was wrong** _(DB-safety lens)_: since PostgreSQL 12, `ALTER COLUMN … SET NOT NULL` recognises an existing **validated** `CHECK (col IS NOT NULL)` and skips the table scan, so this is a catalog-only one-statement migration, not an expensive one — and `profiles_household_id_not_null` is exactly that constraint, already validated. Still out of scope for 1a (one migration per PR, and 1a stays the metadata-only column), but it gets its **own backlog row** rather than standing as a permanent residual accepted on a cost that is not real.                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Rollback.** Each PR is independently revertable. 1a's column is additive and forward-only (AGENTS.md):
a revert of the _code_ leaves the column, which is harmless since nothing reads it. 1b/1c/1d revert to
existence scoping — the status quo — with no data change, because **TEN-1 writes no data**: it only
narrows `WHERE` clauses. That is the single best property of this change.

## Alternatives considered and rejected

1. **Postgres RLS** (`household_id` policies + a per-transaction GUC). Strongest possible enforcement —
   the database refuses, not the application. **Rejected:** the write path runs many autocommit
   statements at READ COMMITTED (`write-path.md` invariant 6's caveats explicitly pin that), so a
   session GUC through a pooled PgBouncer connection (`client.ts`) either leaks across requests or
   forces every read into a transaction; Drizzle has no RLS session plumbing here; and it is a
   whole-subsystem change against ~4h/week. **Named as the post-beta hardening option** — it composes
   with this design rather than competing, since a single scope point is what would set the GUC.
2. **Denormalise `household_id` onto `entries`/`sessions`** so reads skip the `profiles` join.
   **Rejected:** `schema.ts:205` and `:701` already record it as _"a future option if a writer ever needs
   schema-level enforcement"_; it is a backfill on the largest table to avoid a join that is already
   indexed; and it creates a second source of truth that can drift from `profiles.household_id` — a
   security predicate is the last thing that should have two sources (`plan.md:1035`).
3. **Scope in the proxy/middleware.** Rejected by `SECURITY.md:15` (CVE-2025-29927) and by SEC-1's own
   scar (`gate.ts:12-16`): _"a matcher-driven layer and NOT the auth boundary."_
4. **Thread the scope through every page/action/route signature.** Rejected: ~11 extra files for no
   gain, and a mistake at that layer is a leak the compiler cannot see (the parameter is present, just
   wrong). `write-path.md:118` already makes `lib/dal` the layer allowed ambient state.
5. **Optional/defaulted `scope` parameter** on `isLiveProfile`, converting sites incrementally.
   Rejected: it is the one change that makes a missed site invisible, which is the whole risk.
6. **Keep the existence check and add a separate `assertHouseholdOwnsProfile()` beside it.** Rejected:
   two checks that can disagree, 8 call sites to remember, a new error shape, and `getProfileByPublicId`
   is already called first at every one of those 8 sites.
7. **One PR.** Rejected: ~59 `verify.ts` edits + 9 predicate sites + 11 consumer sites + 4 test files +
   5 docs, against AGENTS.md's one-concern / <400-line target. The authZ change would be unreviewable
   inside the mechanical diff.

## Out-of-scope / deferred

- **Authorization.** TEN-1 proves **consistent scoping**; isolation is only _authorized_ at AUTH-1
  (`beta-1.md:137-138`). Until then the principal is a shared access code. Say this in the PR body —
  it is the most likely thing for a reader to over-claim.
- **`household_members`, roles, invites, the Clerk swap** — AUTH-1.
- **`movements` per household** — TEN-2 (expand → switch → contract, partial unique indexes
  `CONCURRENTLY`, three PRs). TEN-1 produces its Beta-0 verdict, not its fix.
- **Reading `households.synthetic`** — OBS-2. It ships dark.
- **Tightening `profiles.household_id` to `.notNull()` in drizzle** — R9.
- **An e2e cross-household spec** — needs a second household in the shared seed (OPS-2 collision) and
  belongs in the fast tiers per the DoD test pyramid.
- **A household in the URL** — ADR 0006 decides against it for beta; HH-1's path segment _"touches every
  route, link and `revalidatePath` — the class with two prior incidents"_ (`beta-1.md:46`).
- **`/api/sync`, the MCP token, 403-on-wrong-household** (`SECURITY.md:59`) — no `/v1` surface exists.
- **Per-household rate limiting** — AUTH-1 re-keys the limiter from IP to user id.

## Open questions

| #         | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1** ✅ | **ADR 0006: session-only, `/p/<profileId>` stays?**                                                                                                                                                                                                                                                                                                                                                                                                        | **Answered — yes.** [ADR 0006](../decisions/0006-household-addressing.md) is **Accepted: option A (session-only)** _(the maintainer, 2026-10-07; #252)_. `/p/<profileId>` stays the address and a wrong household is a 404. Chunk 0 is done and this plan is unblocked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Q3**    | **Does `households.synthetic` ride here?**                                                                                                                                                                                                                                                                                                                                                                                                                 | **Yes — but as a column only, not on the scope.** ⚠️ Both of the original reasons were refuted by the panel and are withdrawn: _"the cheapest it will ever be"_ is false (an `ADD COLUMN` with a non-volatile default has been metadata-only since PG 11 and `households` holds one row — the identical statement costs the identical zero in OBS-2's own PR), and _"OBS-2 then pays a WHERE-per-query"_ is false (OBS-2 writes the same `WHERE` either way; landing the column early removes **zero** clauses). What the answer actually rests on is [plan.md](../plan.md) → OBS-2 asking for the flag **by name** to land with the tenancy work, plus the fact that a dark column carries no risk once §Design 1a takes it off `HouseholdScope`. Two lenses argued for cutting it to OBS-2 entirely; that is a defensible call and it is recorded in the log, but it is the maintainer's recorded ask, so it ships.                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Q4**    | **Any e2e proof in beta?**                                                                                                                                                                                                                                                                                                                                                                                                                                 | No. `db:verify` + Vitest, per the DoD pyramid and the OPS-2 seed collision.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **Q5** 🟠 | **A singular `HouseholdScope` — does it paint us into a corner?** Today the resolver answers _"the one household."_ AUTH-1 with a user in two households, and COACH-1's _"a scope seam that can express 'not mine, but shared with me'"_ (`plan.md:556`), need _"the household that authorizes **this** profile"_ — which **inverts the direction of resolution**: resolve the candidate household **from the addressed profile**, then assert membership. | **Keep it singular and no-argument now.** [ADR 0006](../decisions/0006-household-addressing.md) → "Does this foreclose anything?" is now the **owner** of this forward path, so it is not restated here: it becomes `getHouseholdScope(profilePublicId)`, confined to one file plus the `lib/dal` call sites. The ADR also splits out **COACH-1**, which this question wrongly folded in: a cross-household _grant_ needs the seam's RETURN to widen beyond a tenant id, which is a different shape from an inverted argument — so keep `HouseholdScope` a branded record, never a naked `household_id`. ⚠️ **TWO MODES, not one** _(panel A6, recorded in 1b)_: the inversion resolves a scope **from an addressed profile**, and the sites with **no profile id to invert on** — the picker (`listProfiles`, which under option A is the whole isolation boundary) and V1-22's household library — need a second mode, _"the households this principal is a member of"_, whose return shape is a **set**, not one scope. So the forward cost is "one file + the `lib/dal` call sites **+ a second resolution mode**", and the picker is the site that forces it. 1b keeps both modes cheap by resolving the scope **inside** each DAL function instead of threading it through signatures: a second mode then changes `household.ts` and the picker's own call, not eleven files. |
| **Q6**    | **Does `write-path.md` grow to own `packages/db/src/queries/`?**                                                                                                                                                                                                                                                                                                                                                                                           | Own the two specific files (`export-month.ts`, `weekly-adherence.ts`), not the prefix — a prefix would also claim `program-day.ts`, forcing **both** guides on every programming change. A security-load-bearing query owned by no guide is invisible to `guides:check`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

## Review-response log (adversarial panel)

**Panel run 2026-10-07, six lenses in parallel**, per `docs/plans/README.md` → "Adversarial plan
review" for an auth plan carrying a migration: the four standing lenses (`correctness-reviewer` ·
`scope-reviewer` · `architecture-reviewer` · `reuse-reviewer`) **plus `db-safety-reviewer`** (chunk 1a
is a migration) **plus `security-reviewer`** (this is the authorization seam). Each was given the plan,
the now-Accepted ADR 0006, AGENTS.md and the code, and prompted to find flaws rather than praise.

**No UX panel is owed, and that is a decision rather than an omission.** TEN-1 introduces no pixel and
no copy: a wrong-household id reuses the existing `notFound()` / `NO_PROFILE_LOG` path, which is what
`beta-1.md`'s AUTH-1 exit criterion already settled. The one place the panel found this claim
over-reaching has been narrowed in §Design 3 — a ≥2-household server state now throws to the existing
`error.tsx` rather than borrowing the picker's _"Seed the database to get started"_ empty state, which
would have put developer copy and a production-write instruction in front of a parent (**S7**, **C17**).

### Engineering panel, round 1 — findings that changed chunk 1a (the PR this log ships in)

| #                                     | Lens                                       | Critique (short)                                                                                                                                                                                                                                                                                                                                       | Verdict                                          | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **A4 · P3 · C4 · S-also-1**           | Architecture, Scope, Correctness, Security | **`synthetic` does not belong on `HouseholdScope`** — incoherent for OBS-2's cross-household need, a second source of truth for a DB column, tenancy ∩ observability at a seam Tenancy owns, and (C4) it makes chunk **1b** read the column, so a 1b deploy ahead of migration 0014 is `42703` on every route — a total outage, not a dark app.        | **accepted — the panel's most valuable finding** | New **§Design 1a** states the four reasons and cuts the field. The resolver selects `id` only. The column is now dark **end to end**, which is what makes landing it ahead of its consumer safe at all, and the ADR is satisfied unchanged (its obligation is the **brand**, not the field).                                                                                                                                                                                                                 |
| **D1**                                | DB-safety                                  | "Ships dark" ends at 1b; 1a therefore owes a runbook apply-gate ("1b merges only after 0014 is observed applied"), since `migrate.yml` exits 0 with a warning when `DATABASE_URL_UNPOOLED` is absent.                                                                                                                                                  | **resolved, not accepted — pushback recorded**   | The hazard is **removed** rather than managed: with `synthetic` off the scope, no TEN-1 chunk reads the column, so there is no cross-PR ordering dependency to gate. D1 explicitly rejected a _different_ alternative (keep the field, hardcode `false`), which I agree would be the wrong fix. The migration header therefore carries **no** "chunk N is the reader" clause and says why — the first migration here that can honestly omit it.                                                              |
| **C2 · D3 · R2 · P-af2**              | Correctness, DB-safety, Reuse, Scope       | **The specified readback is a tautology.** "default false" compares the default to itself; "settable" asserts `UPDATE` works; "surviving a re-seed" is un-failable because the seed is `onConflictDoNothing` and nothing sets the flag.                                                                                                                | **accepted**                                     | Rebuilt: `columnsOf('households')` for the type (reusing the one `information_schema` idiom), a direct catalog read for `is_nullable` and `column_default` (the two facts that Map cannot express), and the non-tautological one — flip the flag, seed a **third** time, prove it held; restore, seed, prove the seed never sets it. **Verified by three mutations**: nullable → red, `DEFAULT true` → red, seed switched to `onConflictDoUpdate` → red.                                                     |
| **S5**                                | Security                                   | **The plan never says what value the seed writes**, and `db:seed` runs against prod on every push. DO-NOTHING only saves it because a row already exists — on a **fresh or restored** database the seed inserts, and the real family's household gets whatever 1a hardcoded. The first reader would treat minors' health data as a disposable fixture. | **accepted — the sharpest 1a finding**           | **The seed is not touched at all.** The rule is written into the schema docblock and the migration header: `synthetic = true` is an assertion by whoever creates a fixture, never inherited from a seed that also runs in production. The readback pins it in **both** directions.                                                                                                                                                                                                                           |
| **D2 · R3**                           | DB-safety, Reuse                           | 1a's "idempotent seed" deliverable has no content; adding `synthetic: false` to `.values()` is a strict no-op, and `onConflictDoUpdate` would be an active prod regression.                                                                                                                                                                            | **accepted**                                     | Chunk row and file-by-file now say **no seed change**, with the reason.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **C5**                                | Correctness                                | "Ships dark" is asserted in three places and **nothing checks it**. 0006/0013 got away with prose; this one had a reader planned one chunk later.                                                                                                                                                                                                      | **accepted**                                     | `apps/web/lib/household-synthetic-is-dark.test.ts`, in the `pages-are-gated.test.ts` comment-stripping shape. Proven to catch a reader (adding one to `profiles.ts` turns it red and names the file). OBS-2 **deletes the file** rather than extending an allowlist.                                                                                                                                                                                                                                         |
| **C1 · P4 · A8 · S-also-2/3 · D-pre** | all six                                    | **Five stale places, not two.** Chunk 0, Q1, the 1a row's reason (ii), the tsconfig file-by-file row, Q2 and R1's residual — plus `docs/plan.md`'s TEN-1 row and its HH-1 row, which say in so many words that **TEN-1 does not start until the ADR is signed**.                                                                                       | **accepted**                                     | All corrected here. Chunk 0 → ✅ DONE; Q1 → answered; Q2 deleted; the tsconfig row deleted; R1's residual rewritten as **closed by DX-7 (#244)**. The two `plan.md` rows, `status.md`'s pointer, `roadmap.md`'s two rows and `beta-1.md`'s canonical chart move in this PR, because a backlog that forbids this work must not outlive it.                                                                                                                                                                    |
| **P1 · P2**                           | Scope                                      | **Cut chunk 1a entirely** — both of Q3's reasons are false ("cheapest it will ever be"; "OBS-2 then pays a WHERE-per-query"), and after DX-7 the chunk is a ~20-line dark column carrying a plan, a panel and a migration gate.                                                                                                                        | **partly accepted — pushback recorded**          | **Both refutations accepted and Q3 rewritten** to drop them: the cost claims do not survive inspection. **The column still ships**, resting only on `plan.md` → OBS-2 asking for it **by name** to land with the tenancy work, plus the fact that §Design 1a leaves it risk-free. Deferring it does not reduce total work — and it would then land in a PR that _also_ has a reader, which is strictly more deploy-order risk than a dark column. Recorded as **cuttable item 1** so the call stays visible. |
| **A4-shape**                          | Architecture                               | A `boolean` encodes "what this household is for" in one bit; `profiles.kind` (text + CHECK) is the sibling for that question, and OPS-2 has live neighbours ("fixture", "demo") a boolean cannot hold.                                                                                                                                                 | **rejected — reason recorded**                   | A two-valued flag is what OBS-2 asked for and what it needs; `purpose text` invents a vocabulary with one member and no second consumer, which is the speculative extraction `ownership.ts` exists to refuse. Both lenses agree the boolean breaks **no** schema convention (siblings `movements.is_bodyweight`, `entry_sets.is_band`). If a third purpose ever appears, that is its own migration with a real vocabulary to name.                                                                           |
| **C3**                                | Correctness                                | `HouseholdScope.synthetic`'s comment and Q3 both cite `plan.md:437-441`; OBS-2 is at `:511-522` and its actual text is stronger than the paraphrase.                                                                                                                                                                                                   | **accepted**                                     | The field is gone, so the first cite with it. Q3 and the schema docblock now cite **sections**, not line numbers.                                                                                                                                                                                                                                                                                                                                                                                            |
| **D7 · R4 · C6**                      | DB-safety, Reuse, Correctness              | Prescriptive: `generate` emits `boolean DEFAULT false NOT NULL` in that order with no header/breakpoints/`IF NOT EXISTS`; `--name household_synthetic` (not `0014_…`); do **not** copy 0006's "nullable, no default" clause, which is false here; Squawk measured clean.                                                                               | **accepted verbatim**                            | Followed exactly. `generate` emitted precisely the predicted statement. **Squawk: `Found 0 issues`**, run locally on the pinned `squawk-cli@2.66.0`. **No `squawk-ignore`** — D8 showed the two `SET`s are all the gate wants, and a speculative ignore is indistinguishable from a working one.                                                                                                                                                                                                             |
| **D5**                                | DB-safety                                  | R2 enumerates why ≥2 households "cannot fire today" and never notices that **OBS-2 is the thing that makes it fire** — the day a synthetic household lands in prod, the app goes dark, caused by the column 1a adds.                                                                                                                                   | **accepted**                                     | One line in the schema docblock, one in the migration header, and (below) on `plan.md`'s OBS-2 row.                                                                                                                                                                                                                                                                                                                                                                                                          |
| **R-af**                              | Reuse                                      | Do **not** name the default (`SYNTHETIC_DEFAULT`, a shared const, a zod schema) — `.default(false)` plus `DEFAULT false` are two necessary occurrences of a universal literal. Also: `columnsOf`'s docblock is orphaned above `assertRefTableMatches`.                                                                                                 | **accepted**                                     | No constant introduced. The orphaned docblock is moved onto `columnsOf` while adjacent, and now records why a check needing nullability queries the catalog itself.                                                                                                                                                                                                                                                                                                                                          |
| **D4**                                | DB-safety                                  | Two gate facts to not cite as safety: `drizzle-kit check` is **not wired anywhere** (the drift guard is the `generate` + clean-tree half alone), and Squawk **is** wired, contradicting two AGENTS.md lines that still list it as unwired.                                                                                                             | **accepted**                                     | Neither cited in the PR body. The stale AGENTS.md lines are noted but **not** fixed here — AGENTS.md is the quality bar's own definition and editing it inside a feature PR is exactly what `hold-the-bar` exists to catch. Its own row.                                                                                                                                                                                                                                                                     |

### Findings accepted and assigned to 1b / 1c / 1d — recorded here so none falls between PRs

| #                           | Lens                                       | Critique                                                                                                                                                                                                                                                                                                                                                             | Verdict      | Owner                                                                                                                                                                                                                                   |
| --------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A1 · C10 · S2 · S3 · P5** | Architecture, Correctness, Security, Scope | **BLOCKING: two of ADR 0006's three named obligations are named in a table cell and then built nowhere** — the `force-dynamic` pinning test and the cache rule, and the structured miss-path event. The event also needs a _layer_ decision, not just a line.                                                                                                        | **accepted** | New **"What ADR 0006 obliges, and where it lands"** section + the miss-path event spec. **1b.**                                                                                                                                         |
| **A2 · S1 · C7**            | Architecture, Security, Correctness        | **BLOCKING: the picker obligation is discharged by the vehicle the ADR excluded.** An emitted-SQL assertion proves the builder appended a conjunct, not which rows return — and `actions.test.ts` mocks `getProfileByPublicId` wholesale, so its "wrong-household" case is byte-identical to the unknown-profile case and **stays green with the conjunct deleted**. | **accepted** | Single-source the picker into `packages/db/src/queries/` so `db:verify` runs the same function; `ENTRY_POINTS` gains it. **1b.**                                                                                                        |
| **C8 · R8**                 | Correctness, Reuse                         | The recording-pool vehicle **does not execute** as specified (the pool answers every query with zero rows, so the scope resolves null and the profiles query is never emitted) — and copying the harness is the second occurrence that should be an extraction.                                                                                                      | **accepted** | File-by-file row rewritten with both. **1b.**                                                                                                                                                                                           |
| **C9**                      | Correctness                                | **R5's real hole:** the both-directions rule covers the _new_ matrix, but the ~59 pre-existing **negative** assertions stay green when threaded with the wrong scope, and the hand mutation check cannot see them because deleting the conjunct _restores_ correct behaviour.                                                                                        | **accepted** | R5 rewritten with the automated patch-file mutation gate, the dual mutation, the two-scopes rule and the id-allocator requirement. **1b/1c.**                                                                                           |
| **A3 · S4 · R6**            | Architecture, Security, Reuse              | `householdScopeForScript` is published by the package barrel on the specifier the app already imports, guarded only by a text grep that a **defaulted parameter** (which silently removes the required-parameter compile error), an alias or `import * as db` defeats.                                                                                               | **accepted** | New **§Design 1b**: `scope.ts` for the type, a non-exported module for the constructor, lexical containment. **1b.**                                                                                                                    |
| **A5 · P6**                 | Architecture, Scope                        | `guides:check` **fails 1b and 1c** as chunked — `write-path.md` owns `apps/web/lib/dal/` and `packages/db/src/writers/`, and it was assigned to 1d.                                                                                                                                                                                                                  | **accepted** | Guide row moved to **1b, 1c, 1d**; the self-contradicting "cuttable" sentence rewritten.                                                                                                                                                |
| **R1 · C10 · S8**           | Reuse, Correctness, Security               | `NO_PROFILE_LOG` / `NO_PROFILE_SAVE` are module-local and already re-typed **7 times** in `actions.test.ts`; the plan's new wrong-household suite would make it 14, with the byte-identity its security argument rests on enforced by nobody.                                                                                                                        | **accepted** | New `apps/web/lib/constants.ts` row + obligation 4. **1b.**                                                                                                                                                                             |
| **S6**                      | Security                                   | The `movements` verdict is **one-directional** — it misses the write/poison direction and the fact that a **refused** write has already committed caller-supplied catalog text — and the `SECURITY.md` edit over-claims by flipping "every query is scoped" to **true** when `movements` has no `household_id` at all.                                               | **accepted** | The verdict is now both directions plus the refused-write side effect; the `SECURITY.md` row says **true-with-a-named-exception**. **1d.**                                                                                              |
| **A7 · S-also-4/5**         | Architecture, Security                     | The three forward-compatibility requirements are prose, not artifacts: nothing stops a call site reading `.householdId`, acceptance 5 still asserted unconditional zero, and the 404 rule carried no published-resource clause.                                                                                                                                      | **accepted** | Acceptance 5 re-phrased; `scoped.test.ts` gains the `.householdId` assertion; the carve-out lands in the `SECURITY.md` row.                                                                                                             |
| **A6 · Q5**                 | Architecture                               | Q5's inversion is under-costed at exactly the sites with **no profile id** — the picker and V1-22's household library — which need a second resolution mode, so the forward path is "one file + 11 call sites **+ a second mode**".                                                                                                                                  | **accepted** | Q5 to record the two-mode shape; the seam's forward shape is owned here, not only in the consumer ADR. **1b.**                                                                                                                          |
| **P7**                      | Scope                                      | The 1b/1c cut is **forced** by the required parameter, not a size judgement — and no chunk carries a line estimate against the <400-line target.                                                                                                                                                                                                                     | **accepted** | 1b/1c to state the forcing function and carry budgets; if 1b exceeds ~400 lines, the full matrix moves to 1c and 1b keeps the decision plus the gate's proof.                                                                           |
| **D6**                      | DB-safety                                  | R9 accepts a residual in the core security predicate on a cost that is not real — `SET NOT NULL` skips the scan when a validated `CHECK (col IS NOT NULL)` exists (PG ≥ 12), which `profiles_household_id_not_null` is.                                                                                                                                              | **accepted** | R9 rewritten; it gets its own backlog row instead of a permanent residual.                                                                                                                                                              |
| **C11 · A-af**              | Correctness, Architecture                  | Unfalsifiable acceptance criteria: AC 1 is not mechanically checkable (and literally false pre-AUTH-1 — nothing derives from a _request_); AC 2's `grep` already matches **comments** and is wrong today; AC 3's "8 of the 9" is derivable under no consistent unit (the table has 7 rows and `getProfileByPublicId` has 11 call sites).                             | **accepted** | AC 6 and 8 rewritten here; AC 1/2/3's rewording and the unit statement ride **1b**, where the guard that replaces the prose grep is written.                                                                                            |
| **R7 · C16**                | Reuse, Correctness                         | The household-B fixture **already has two profiles**, which is exactly what the ADR's picker obligation needs; six fixture builders already exist and the plan names none; `insertCalisthenicsBout` is hard-pinned to one profile.                                                                                                                                   | **accepted** | 1b uses the existing pair and the existing builders, and parameterises the one blocker rather than hand-rolling.                                                                                                                        |
| **R-af · D-af**             | Reuse, DB-safety                           | `verify.ts` is permanently in the ≥2-households state after household B is created, so any 1b/1c assertion calling the **resolver** must sit above that line or expect the ambiguous path; and 1c's `seed.ts` conjunct runs against **prod** on every push, so it needs a positive assertion too.                                                                    | **accepted** | Both recorded for 1b/1c.                                                                                                                                                                                                                |
| **C12-C15 · C18 · S-af6/7** | Correctness, Security                      | Line-cite drift (`strength-session.ts:297` not `:295`; `isThisProfile` at `:39-42`; the fixture at `:3501`; `write-path.md:73`; `schema.ts:701`), 1c's arithmetic (37, not ~36), R4's index mechanism, and the resolver's missing "never read `rows[0]`" note.                                                                                                       | **accepted** | The resolver note is in §Design 2. The remaining cites are being converted to **section** references as each chunk touches its own section — the fix ADR 0006's own panel generalised, rather than re-pinning numbers that drift again. |

### Questions the plan put to the panel

| Question                                                   | Answer                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R5** — is "both directions, always" sufficient?          | **No** (C9). It is necessary, and it covers the new matrix; the vacuity lives in the pre-existing negative assertions, which it structurally cannot reach. R5 now carries an **automated** mutation gate, the dual mutation, and the two-scopes rule.                                                                             |
| **Q5** — does a singular scope paint us into a corner?     | **No, but the containment claim was under-costed** (A6). `cache()` is not the cost — it keys on arguments. The cost is the sites with no profile id to invert on, which need a second resolution mode. Recorded here rather than only in the ADR, because Tenancy owns this seam.                                                 |
| **The 1b/1c cut** — is R8's intermediate state acceptable? | **Yes, and the correctness lens traced every path to confirm it** — all seven actions, all three pages, the export route and `lib/dal/export.ts` resolve the profile and fail closed _before_ reaching an unscoped-in-1b site. R8 is accurately costed. The cut is **forced** by the required parameter, not chosen on size (P7). |
| **≥2 households** — fail closed, or throw?                 | **Throw** (S7). Dark-on-ambiguous is right and "pick one" is indefensible, but zero and ≥2 are different states: `null` for both would report an invariant violation to the operator as _"your data does not exist"_, with a production write as the suggested remedy. Zero → `null`; ≥2 → throw.                                 |

### Re-review

The two blocking classes (**A1/C10/S2/S3** — unbuilt ADR obligations; **A2/S1/C7** — the picker proved
by the wrong vehicle) are resolved **in the plan**, which is what the panel gates; their code lands in
1b, which is the PR AGENTS.md puts the boundary tests in. No blocking finding against **chunk 1a as it
ships here** survives: the `HouseholdScope` cut removes C4's outage path and D1's reason to exist, the
readback is rebuilt and mutation-proven, the seed is untouched with the rule written down, and the
ships-dark claim is now a gate rather than a sentence.
