---
id: PROF-1 a-1w
pr: pending
---

## The write path for adding an athlete, shipped dark with its proofs

`PROF-1 a-1` split (maintainer decision aD2) into a dark write path and the UI that follows. This is
the write path: `createProfile`, `addAthleteAction`, and the proofs. **Nothing calls it yet** — there
is no form, no route and no tile until `a-1u`.

**It is replay-first.** `createProfile` looks the device-generated `client_id` up **inside the
scope** before inserting, so a double tap, a replayed pre-hydration POST and an offline flush all
return the first row instead of minting a twin — and a replay costs one indexed read and no write.
A replay still resolves after the athlete is archived, because archive is not a delete and does not
free the key.

🔴 **The two scoped reads are the entire cross-household boundary, and the obvious proof is blind to
the leak.** `uq_profiles_client_id` is **global and non-partial** — migration `0020`'s header calls
that "the decision this file exists to carry" — so a caller-chosen key _will_ collide across
households. If `profileByClientId` loses its `inHousehold` conjunct, household B replaying A's key
gets back **A's `public_id`**, which the action then redirects B to: a cross-household identifier in
the other household's URL bar. **B still gains no row.** The plan shipped with "B gains no row" as
its only assertion, which stays green on exactly that. So `db:verify` asserts the **returned value**,
and mutation patch `20` removes the conjunct to prove the assertion can fail.

Two further edits are forbidden by patches rather than by prose. `DO UPDATE` on the conflict
(patch `21`) would let B **rewrite** A's row through the conflict path with every scoped read intact
— so `db:verify` asserts A's name survives B's replay. And the conflict target is **named**: a bare
`onConflictDoNothing()` swallows every unique violation, `profiles_public_id_unique` included,
turning an unrelated failure into a silent no-op a parent reads as "couldn't add this athlete".

## The first household-scoped action, and the matrix it needed

`addAthleteAction` carries **no `profileId`** — the lever every other mutating action's isolation
proof uses. The household matrix WP-1's plan accepted (R1, R7) and never built now exists: `Binding`
is a discriminated union where a household entry **requires** a `scopeMiss` (only its author knows
which DAL function to make miss), and the suite asserts a scope miss is byte-identical to the
unauthenticated refusal, revalidates nothing and navigates nowhere.

⚠️ **It opens with a non-vacuity floor.** `it.each([])` passes silently, so a registry filter that
matched nothing would have reported success — which is how this suite would have gone green on the
day the action was registered with the wrong scope. `mutating-actions.test.ts`'s tripwire flips from
"no household action exists until its matrix does" to naming the one that is driven.

⚠️ **The `next/navigation` mock's `redirect` throws**, as Next's does. A `vi.fn()` returning
`undefined` would let a `redirect` misplaced inside a `try` pass every test while silently doing
nothing in production.

## A quota, because a create with no delete needs one

`MAX_HOUSEHOLD_ATHLETES = 25` (maintainer decision aD1). The mutation limiter is **per principal**
and **fails open**: 120 attempts / 5 min is ~34,500 rows a day from one invited member, unbounded
with Upstash down. The rows are not stolen data — the names are the caller's own — what makes them a
problem is that **nothing in the app can remove one** (archive hides, it does not delete) and that
the picker renders every row with no `LIMIT`. ⚠️ The revisit condition is recorded beside the
constant, not in a thread: 25 is sized for a world where a wrong row is permanent without the
operator, so whichever chunk ships an in-app per-profile delete re-opens it.

The quota is checked **after** the replay lookup and before the insert, so a household at the cap
retrying a key it already used still gets `ok` — `db:verify` asserts that. And `full` is the one
refusal that **names its cause**: it is reachable only after the scope resolved, states a fact the
caller can already see on their picker, and telling them "couldn't add" would have them retry a
request that can never succeed.

## The word "kind" does not reach a screen

`profiles.kind` stores `kid`; every surface renders **"Child"**. ⚠️ Probing the pinned zod showed
`z.enum(PROFILE_KINDS)` with no message emits `Invalid option: expected one of "kid"|"adult"` — it
leaks the raw **values**, not the field name. So `addAthleteSchema` authors its own message,
`CHOOSE_KIND_MESSAGE`, and both the shared schema's test and the action's test assert that no stored
value appears in anything a person reads.

**22/22 mutations RED**, including the three new ones and two older patches that needed regenerating
because this chunk's edits shifted their context — which the gate reported rather than silently
passing.
