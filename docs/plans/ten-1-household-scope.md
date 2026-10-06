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

Verbatim from `plan.md:726-731`:

> **TEN-1 — household scoping through one DAL seam, proven.** A `cache()`d `getHouseholdScope()`;
> every read and write scopes through it (folds in DAL-2). Before AUTH-1 it resolves to Ray's household;
> AUTH-1 swaps its implementation. `db:verify` proves a second household cannot read, write, correct or
> export the first's data, at every entry point, including `findOrCreateMovementId`. Needs the
> household-addressing ADR first. _(Beta 0.)_

And from `beta-1.md:131-136`:

> **The proofs are the point:** `db:verify` drives two households through every read, write, correction
> and export, and asserts B can never see or touch A. Including `findOrCreateMovementId` … Either TEN-1
> proves the picker and the metadata stay per household, or **TEN-2** … moves into Beta 0.

**Done when:**

1. `apps/web/lib/dal/household.ts` exports `getHouseholdScope(): Promise<HouseholdScope | null>`, is
   `cache()`d, and is the **only** place in the repo that _derives_ a household from a request.
2. `isLiveProfile` takes a **required** `HouseholdScope` and emits
   `profiles.household_id = $n` alongside its existing two conjuncts. All **nine** hand-written copies
   are gone; `grep -c 'profiles.deletedAt' packages/db apps/web` finds the predicate only inside
   `ownership.ts`, `listProfiles`, and `seed.ts`'s plural variant.
3. `listProfiles()` returns only the scope's profiles; `getProfileByPublicId()` returns `null` for a
   foreign profile, so every one of the 8 entry points that already calls it inherits the scope.
4. **`actions.test.ts` has a wrong-household suite enumerated over all 7 actions**, mirroring the
   unauth suite's shape (`:116-143`) — the first time AGENTS.md`:453`'s _wrong-owner→forbid_ is
   literally satisfiable in this repo.
5. `db:verify` drives **two households** through: the picker read, the day read, adherence, the
   programmed day, all three export queries, the bodyweight write, the check-in write, the strength
   write, both amends, the amend re-read, and `db:correct`'s registry query — asserting, **in both
   directions**, that each returns/writes for its own household and **zero** for the other.
6. A structural test fails CI if a new `lib/dal` read reaches `db` without a scope, or if anything under
   `apps/web` imports `householdScopeForScript`.
7. `findOrCreateMovementId`'s cross-household behaviour is **proven either way**, and the TEN-2 go/no-go
   (`beta-1.md:134-136`) is recorded in `plan.md` with the proof's output as its evidence.
8. `getHouseholdScope()` returns `null` — and the app is dark, not leaky — when the database holds zero
   or ≥2 live households before AUTH-1.

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
 * THE household this request is authorized for. Branded: the only way to obtain one is to DERIVE it
 * (apps/web/lib/dal/household.ts, server-only) or for a script to NAME one. SECURITY.md:13 — "Never
 * trust a householdId / profileId from the request body/params" — becomes a type error, not a review note.
 */
export type HouseholdScope = {
  readonly householdId: number;      // profiles.household_id / program_blocks.household_id (bigint, mode:'number')
  readonly synthetic: boolean;       // OBS-2 (plan.md:437-441). Nothing reads it yet.
  readonly [householdScopeBrand]: true;
};

/**
 * For a caller with NO request: db:verify and db:correct. It NAMES the household, so the name says
 * what it is. Nothing under apps/web may import it (enforced by lib/dal/scoped.test.ts).
 */
export function householdScopeForScript(
  householdId: number, synthetic = false,
): HouseholdScope { … }

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
 *   SELECT id, synthetic FROM households WHERE deleted_at IS NULL LIMIT 2
 * Exactly one row → that household. Zero or two → null, and the app is DARK, never cross-wired.
 * LIMIT 2 makes "more than one" detectable without a COUNT over a table that will grow.
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
seed-only database under OPS-1; ONB-2's household creation is post-AUTH-1 per `plan.md:684`), and
AUTH-1 is sequenced immediately after (`beta-1.md:81-83`), so the window is short by construction.

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

`null` scope maps to exactly the path an unknown profile already takes: `getProfileByPublicId → null →
notFound()` / `NO_PROFILE_LOG`. **No new error shape, no new copy, no new UI state** — which is what
`beta-1.md:46` promised: _"'wrong account' becomes a 404 that TEN-1's proofs cover."_

A `null` caused by **≥2 households** additionally captures a Sentry _message_ (not an exception — it is
not a user-caused error, and `write-path.md` invariant 4 reserves throws for the unexpected). A
household count is not PII, so `SECURITY.md:65-67` is satisfied.

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

| #      | Chunk                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Why it cannot move                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0**  | **ADR 0006 — household addressing.** Records `beta-1.md:46`'s recommendation as a decision: session-only for beta, `/p/<profileId>` stays, wrong household is a 404. Docs-only, plan-exempt (`docs/plans/README.md` → Exempt). Supersedes HH-1.                                                                                                                                                                                                                                                                                                                                                               | `beta-1.md:126`: _"**The ADR first** (household addressing, above). TEN-1 and AUTH-1 both build on its answer."_ Every error shape below rests on "wrong account → 404". It reverses a decision Ray made, so it is his call, not an implementation detail.                                                                                                                                                                                                                                                                                                                                                                                    |
| **1a** | **`households.synthetic`, shipping dark** (`boolean NOT NULL DEFAULT false`, metadata-only `ADD COLUMN`), idempotent seed, a `db:verify` readback. **Plus `packages/db/tsconfig.json` + `typecheck` over `scripts/**`** if AUDIT-1 #9 has not landed.                                                                                                                                                                                                                                                                                                                                                         | Two independent reasons. (i) The v1-22-1 argument: _"`migrate.yml` runs on merge while Vercel deploys in parallel"_ — a column no code reads has no deploy-order window, but only if no code PR reads it in the same merge. (ii) **The typecheck must exist before the sweep** or the required-parameter safety net has a hole exactly where the proof lives: `pnpm typecheck` is `pnpm --filter web exec tsc --noEmit` (`package.json:16`), and `packages/db/scripts/**` is reachable from no app import, so `verify.ts` and `corrections/registry.ts` are checked by nothing (`docs/audits/2026-09-30-baseline.md:121`).                    |
| **1b** | **The seam, and the gate closes.** `HouseholdScope` + `householdScopeForScript` + household-aware `isLiveProfile`/`ownedEntryIds`; `getHouseholdScope()`; the three profile-resolution sites (`listProfiles`, `getProfileByPublicId`, `updateProfileRoutine`); every site `isLiveProfile`/`ownedEntryIds` **already** reaches (`listEntriesForDay`, `logBodyweight`, `weeklyAdherenceRows`, both amends, `findAmendableBodyweight`, `registry.ts:225`); ~22 `db:verify` call sites; the two-household fixture + the first matrix; **the wrong-household boundary suite**; the recording-pool SQL-shape tests. | `isLiveProfile` is one exported symbol imported **across the package boundary** (`apps/web/lib/dal/entries.ts:6`), so a required parameter is a breaking signature change: every existing caller converts in this PR or the web build fails. The three gate sites ride here because they are the 404 the ADR's decision rests on, and because leaving them unscoped for a PR means a foreign id _resolves_ and then dies deeper down (see R8). AGENTS.md`:453` puts the boundary tests in the PR that changes the authZ — this is that PR.                                                                                                    |
| **1c** | **DAL-2's tail.** The remaining predicate sites `isLiveProfile` does not yet reach: `logCheckinEntries` (`entries.ts:376`), `writeStrengthSession` (`:295`), `programDayRows` (`:41`), `export-month` ×3, `seed.ts:256`; ~36 `db:verify` call sites; the export/program/check-in DAL threading; the matrix extended to those entry points.                                                                                                                                                                                                                                                                    | After 1b: a site cannot convert to a helper that does not yet take a scope. Split from 1b purely on size — these are the three highest-churn call-site families (`programDayRows` 17, `writeStrengthSession` 14, `export-month` 6 in `verify.ts`), and bundling them would bury 1b's authZ change in mechanical diff. After 1c the hand-written count is **zero**, which is what makes 1d's guard absolute.                                                                                                                                                                                                                                   |
| **1d** | **Guards, corrections, catalog verdict, docs.** `registry.ts:65-71` onto the helper with a named household; `lib/dal/scoped.test.ts`; the `findOrCreateMovementId` cross-household proof + the recorded TEN-2 go/no-go; `write-path.md`, `programming.md`, `architecture.md`; the `plan.md`/`status.md` rows.                                                                                                                                                                                                                                                                                                 | The structural guard can only be made **absolute** (no exceptions beyond the three reference reads) once 1c leaves no hand-written sites — written earlier it ships with an allowlist that then has to shrink, and an allowlist that shrinks is one nobody audits. The catalog verdict needs 1b's two-household fixture and is the **only** input to `beta-1.md:134-136`'s TEN-2 Beta-0 decision, so it must be recorded before that decision is taken. `householdScopeForScript` gets its second real consumer here — `ownership.ts:23` forbids extracting a helper with one (_"Extracted here with **two** consumers, not speculatively"_). |

**Cuttable, in this order, if the milestone runs long:** nothing. `beta-1.md:274-276` is explicit —
_"If it must shrink, shrink Beta 1, never TEN-1's proofs."_ The only defensible deferral is 1d's **docs**
rows (into 1c's PR), and even that costs `guides:check`.

## File-by-file changes

| Path                                                  | Change   | What & why                                                                                                                                                                                                                                                                                                                     | PR         |
| ----------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- |
| `docs/decisions/0006-household-addressing.md`         | NEW      | Session-only; `/p/<profileId>` stays; wrong household = 404; supersedes HH-1. Records Q5's forward path.                                                                                                                                                                                                                       | 0          |
| `packages/db/src/schema.ts`                           | EDIT     | `households.synthetic: boolean().notNull().default(false)` (`:120-125`).                                                                                                                                                                                                                                                       | 1a         |
| `packages/db/migrations/0014_household_synthetic.sql` | NEW      | Metadata-only `ADD COLUMN … NOT NULL DEFAULT false` (no rewrite since PG 11), `lock_timeout`, statement-breakpoints, the `0006_spooky_lyja.sql` header idiom: _"No app code reads the column here … so there is no deploy-order window."_                                                                                      | 1a         |
| `packages/db/tsconfig.json` + root `package.json`     | NEW/EDIT | `tsc --noEmit` over `src` **and `scripts`**; `typecheck` runs both filters. AUDIT-1 #9 / baseline seed 4 (`:121`).                                                                                                                                                                                                             | 1a         |
| `packages/db/src/writers/ownership.ts`                | EDIT     | `HouseholdScope`, `householdScopeForScript`, the third conjunct in `isLiveProfile:32`, `ownedEntryIds:43` threads it. Docblock: `:27`'s _"Nine full hand-written copies remain"_ becomes zero (after 1c) and names the third conjunct as the household seam.                                                                   | 1b         |
| `apps/web/lib/dal/household.ts`                       | NEW      | `getHouseholdScope()`. Covered by `write-path.md`'s `owns: apps/web/lib/dal/`, so `guides:check` already forces the guide.                                                                                                                                                                                                     | 1b         |
| `apps/web/lib/dal/profiles.ts`                        | EDIT     | `listProfiles:24` gains `eq(householdId, scope)`; `:85` and `:121` convert to `isLiveProfile(id, scope)`; all three resolve the scope and return `[]`/`null` on a null scope. Stale docblocks at `:11-16` and `:45-51` (_"lands with auth at V1-1/v1.5; this is the seam it plugs into"_) are rewritten — the seam has landed. | 1b         |
| `apps/web/lib/dal/entries.ts`                         | EDIT     | 1b: `listEntriesForDay:115`, `logBodyweight:304`, `editBodyweight:491`, `ownedBodyweightValue:507`, `editStrengthSet:521` resolve + pass the scope. 1c: `logCheckinEntries:367` onto the helper, `logStrengthSession:455`.                                                                                                     | 1b, 1c     |
| `apps/web/lib/dal/adherence.ts`                       | EDIT     | `getWeeklyAdherence:20` passes the scope to `weeklyAdherenceRows`.                                                                                                                                                                                                                                                             | 1b         |
| `apps/web/lib/dal/programming.ts`                     | EDIT     | `getProgramDay:21` passes the scope. `:18-19`'s claim is upgraded: no caller can pass a household id **and** the requester's household is now asserted independently of the profile's row.                                                                                                                                     | 1c         |
| `apps/web/lib/dal/export.ts`                          | EDIT     | `prescribedFor:98`, `buildExportEntries:119`, `buildExportZip:163` thread the scope. `:120`'s `getProfileByPublicId` already fails closed — the queries get it too (`write-path.md:72`).                                                                                                                                       | 1c         |
| `packages/db/src/queries/weekly-adherence.ts`         | EDIT     | `:70` passes the scope through.                                                                                                                                                                                                                                                                                                | 1b         |
| `packages/db/src/writers/bodyweight.ts`               | EDIT     | `findAmendableBodyweight:107` + `updateBodyweightEntryById` take a scope and hand it to `ownedEntryIds:117`. `insertBodyweightEntry` takes an **internal** `profileId` and builds no predicate → unchanged.                                                                                                                    | 1b         |
| `packages/db/src/writers/strength-session.ts`         | EDIT     | `updateStrengthSetById` (1b, via `ownedEntryIds`); `writeStrengthSession:295` onto the helper (1c) — the scope must be checked **inside** the transaction, where `:291-298` already resolves the profile.                                                                                                                      | 1b, 1c     |
| `packages/db/src/queries/program-day.ts`              | EDIT     | `isThisProfile:40-43` → `isLiveProfile(id, scope)`; both sub-selects inherit it (`:38-39`'s rule). Docblock `:13-16` gains the independent-assertion property and marks the `:51` join a deliberate redundancy.                                                                                                                | 1c         |
| `packages/db/src/queries/export-month.ts`             | EDIT     | `:84`, `:122`, `:146` onto the helper.                                                                                                                                                                                                                                                                                         | 1c         |
| `packages/db/src/seed.ts`                             | EDIT     | `:256-259` gains the conjunct for symmetry (already correct via `:217-222`'s household resolution).                                                                                                                                                                                                                            | 1c         |
| `packages/db/scripts/corrections/registry.ts`         | EDIT     | `:65-71` onto `isLiveProfile(LIAM, householdScopeForScript(…))`; the household resolved by `public_id` beside the profile. `:219-225` gains the scope.                                                                                                                                                                         | 1d         |
| `packages/db/scripts/verify.ts`                       | EDIT     | ~59 call sites; the second-household fixture extended with entries/sets/weigh-in/check-in; the TEN-1 matrix; the `findOrCreateMovementId` cross-household probe.                                                                                                                                                               | 1b, 1c, 1d |
| `apps/web/app/p/[profileId]/actions.test.ts`          | EDIT     | The wrong-household suite over all 7 actions; `:162-165`'s KNOWN GAP comment in `actions.ts` deleted (the gap is closed).                                                                                                                                                                                                      | 1b         |
| `apps/web/lib/dal/profiles.test.ts`                   | NEW      | Recording-pool SQL-shape tests for `listProfiles` / `getProfileByPublicId`, in `entries.test.ts:9-23`'s shape.                                                                                                                                                                                                                 | 1b         |
| `apps/web/lib/dal/scoped.test.ts`                     | NEW      | The structural guard.                                                                                                                                                                                                                                                                                                          | 1d         |
| `docs/features/write-path.md`                         | EDIT     | A **household scope** invariant beside `:68`'s ownership one; `:137`'s nine → zero; `owns:` gains `packages/db/src/queries/export-month.ts` and `weekly-adherence.ts` (today **no guide owns them**, so `guides:check` cannot see a change to a security-load-bearing query).                                                  | 1d         |
| `docs/features/programming.md`                        | EDIT     | Forced by `guides:check` (`owns: packages/db/src/queries/program-day.ts`).                                                                                                                                                                                                                                                     | 1c or 1d   |
| `docs/architecture.md`                                | EDIT     | `:106` (_"the seam v1.5's Clerk household scoping tightens"_) and `:135-136` now describe shipped behaviour.                                                                                                                                                                                                                   | 1d         |
| `.github/SECURITY.md`                                 | EDIT     | `:12-13`'s _"every query is scoped by `household_id`"_ becomes true; name the proof and the two residuals (`movements` → TEN-2; authorization vs. consistency → AUTH-1).                                                                                                                                                       | 1d         |
| `docs/plan.md` · `docs/status.md` · `docs/roadmap.md` | EDIT     | TEN-1/DAL-2 rows, the TEN-2 verdict, the seam row. **Owned by another lane — the implementing PR does it, not this plan.**                                                                                                                                                                                                     | 1d         |
| `docs/changelog/*.md`                                 | NEW ×4   | One fragment per PR (DoD).                                                                                                                                                                                                                                                                                                     | all        |

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
- **The `synthetic` readback** (1a): default `false`, settable, surviving a re-seed.
- **`findOrCreateMovementId`'s SQL** (1d): A creates "Ray Special"; B calls with the same name; assert
  whether B gets A's `id`/`is_bodyweight`/`unit_default`. **The assertion states the truth the code
  has** — if it leaks, the assertion documents the leak and the TEN-2 trigger fires. Do not write an
  aspirational assertion here.

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

## Risks / rollback

| #      | Risk                                                                                                                                                                                                                                                                                            | Mitigation                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **R1** | **A missed site = a cross-family leak** (`beta-1.md:276`).                                                                                                                                                                                                                                      | Required parameter → compile error; the structural guard; the matrix. **Residual:** `packages/db/scripts/**` is in no tsc program (`package.json:16`), so `verify.ts` and `registry.ts:65` are invisible to `pnpm typecheck` — the hole sits exactly where the proof lives. → **1a adds `packages/db/tsconfig.json`** (or AUDIT-1 #9 lands first). Confirm during 1a by introducing a deliberate type error in `verify.ts` and checking `pnpm typecheck` fails. |
| **R2** | `getHouseholdScope()` returns `null` in prod (0 or ≥2 households) → **the app goes dark**.                                                                                                                                                                                                      | Loud: a Sentry message naming the count. Cannot fire today (one household; `verify.ts`'s B is PGlite-only; previews are seed-only under OPS-1; ONB-2's creation path is post-AUTH-1, `plan.md:684`). Chosen deliberately over "pick one", which would be a silent cross-wire. Rollback is a revert of 1b.                                                                                                                                                       |
| **R3** | `cache()` may not memoise in the export Route Handler.                                                                                                                                                                                                                                          | Degrades to one extra 2-row query, never a different answer — the scope is deterministic per request. Correctness never depends on `cache()`.                                                                                                                                                                                                                                                                                                                   |
| **R4** | Performance.                                                                                                                                                                                                                                                                                    | One equality on `idx_profiles_household` (`schema.ts:150`), already present as the FK covering index, plus one `LIMIT 2` scan per request on a one-row table.                                                                                                                                                                                                                                                                                                   |
| **R5** | ⚠️ **A vacuous proof.** With ~59 mechanical `verify.ts` edits, one wrong household constant makes an assertion pass for the wrong reason — zero rows because the fixture is wrong, not because scoping works. **This is the risk most likely to actually bite**, and it is invisible in review. | The both-directions rule is **mandatory**: every zero-rows assertion ships with a matching positive one on the same call. Plus the hand mutation check above — if deleting the conjunct does not turn the matrix red, the matrix was never proving anything.                                                                                                                                                                                                    |
| **R6** | `movements` still shared across households.                                                                                                                                                                                                                                                     | Unfixable in TEN-1 (no column). Proven, recorded, and the input to TEN-2's Beta-0 decision (`beta-1.md:134-136`).                                                                                                                                                                                                                                                                                                                                               |
| **R7** | 59 call-site edits in one file invite a bad merge.                                                                                                                                                                                                                                              | 1b/1c are sequential, not parallel; `keep-mergeable` after each; `verify.ts` is append-heavy so conflicts are append-style.                                                                                                                                                                                                                                                                                                                                     |
| **R8** | **The 1b→1c intermediate state.** After 1b the gate is closed but `logCheckinEntries`, `writeStrengthSession`, `programDayRows` and `export-month` are not yet scoped.                                                                                                                          | **Not a leak** — `getProfileByPublicId` fails closed first, so a foreign id never reaches them. The exposure is a worse _error shape_ for a crafted POST that cannot currently exist (one household in prod). Accepted explicitly, and it is why the gate sites ride in 1b rather than 1c: the reverse order would leave a window where a foreign id resolves and then dies deeper down.                                                                        |
| **R9** | `profiles.household_id` is typed nullable (`schema.ts:137`) while the DB enforces NOT NULL (`0001:158-159`). A reader could conclude orphans are possible and write a `OR household_id IS NULL` escape.                                                                                         | Stated in the `isLiveProfile` docblock. Tightening the drizzle column to `.notNull()` is **out of scope** — the validated CHECK already gives the guarantee, and a `SET NOT NULL` is a migration for a type-level nicety.                                                                                                                                                                                                                                       |

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

| #         | Question                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Recommendation                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Q1** 🔴 | **ADR 0006: session-only, `/p/<profileId>` stays?**                                                                                                                                                                                                                                                                                                                                                                                                        | Yes — `beta-1.md:46`'s own recommendation. **Blocking: Ray's call**, because it reverses a decision he made. Every error shape here assumes it.                                                                                                                                                                                                                                                                                                                                                                           |
| **Q2**    | **AUDIT-1 #9 first, or fold the `packages/db` tsconfig into 1a?**                                                                                                                                                                                                                                                                                                                                                                                          | Fold into 1a unless #9 is already in flight. Without it, R1's safety net has a hole precisely at `verify.ts`.                                                                                                                                                                                                                                                                                                                                                                                                             |
| **Q3**    | **Does `households.synthetic` ride here?**                                                                                                                                                                                                                                                                                                                                                                                                                 | Yes — `plan.md:439-441` asks for it by name, and a metadata-only `ADD COLUMN` is the cheapest it will ever be. Cut it if 1a is contested; OBS-2 then pays a WHERE-per-query.                                                                                                                                                                                                                                                                                                                                              |
| **Q4**    | **Any e2e proof in beta?**                                                                                                                                                                                                                                                                                                                                                                                                                                 | No. `db:verify` + Vitest, per the DoD pyramid and the OPS-2 seed collision.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Q5** 🟠 | **A singular `HouseholdScope` — does it paint us into a corner?** Today the resolver answers _"the one household."_ AUTH-1 with a user in two households, and COACH-1's _"a scope seam that can express 'not mine, but shared with me'"_ (`plan.md:556`), need _"the household that authorizes **this** profile"_ — which **inverts the direction of resolution**: resolve the candidate household **from the addressed profile**, then assert membership. | **Keep it singular and no-argument now**, and record the forward path in ADR 0006: it becomes `getHouseholdScope(profilePublicId)` and the change is **confined to one file plus the ~11 call sites inside `lib/dal`** — because the pages and actions never hold the scope (Design §3). That containment is what makes deferring it safe, and it is the reason to resist threading the scope through page/action signatures today. Ray should see this one: it is the only place TEN-1's shape could cost AUTH-1 rework. |
| **Q6**    | **Does `write-path.md` grow to own `packages/db/src/queries/`?**                                                                                                                                                                                                                                                                                                                                                                                           | Own the two specific files (`export-month.ts`, `weekly-adherence.ts`), not the prefix — a prefix would also claim `program-day.ts`, forcing **both** guides on every programming change. A security-load-bearing query owned by no guide is invisible to `guides:check`.                                                                                                                                                                                                                                                  |

## Review-response log (adversarial panel)

_Empty — the panel has not run. `docs/plans/README.md` requires the full panel + re-review for an auth
plan: the four standing lenses (correctness · simplicity/scope · architecture · reuse) **plus a
dedicated DB-safety reviewer** (1a is a migration) and **a security lens** (SEC-1/SEC-2 precedent). **No
UX panel is owed** — TEN-1 changes no pixel and no copy: wrong-household reuses the existing
`notFound()` / `NO_PROFILE_LOG` path, which is the decision recorded at `beta-1.md:46`. Say that
explicitly in the PR body so the missing UX log reads as a decision, not an omission._

**Questions to put to the panel directly:** R5 (the vacuous-proof risk and whether the both-directions
rule is sufficient), Q5 (the resolution-direction inversion), the 1b/1c cut (R8's intermediate state),
and whether `getHouseholdScope()` failing closed on ≥2 households is right or should instead throw.
