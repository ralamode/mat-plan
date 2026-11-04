- **2026-11-03** — 🔴 **The household scope is derived from the session** (`AUTH-1` 1c-4, PR 2 of the
  [1c-4 plan](../plans/auth-1c-4-resolve-scope-from-session.md)). `getHouseholdScope()` stops
  answering _"the one live household"_ and starts answering _"the household this principal is a
  member of"_. **This is what makes `1d` safe:** before it, a session proved only _that_ you were
  someone the Clerk instance admits, so deleting the access gate would have **widened** access rather
  than narrowing it.
  **Five outcomes, one test case each** — one membership → that scope; no principal → `null`
  silently and without touching the database (1c-3b already refused that caller at all twelve doors);
  schema missing → `null` + `schema_missing`; **no membership → `null` + `no_membership`**, the state
  this chunk makes person-reachable; two memberships → throws, because "pick one" is a silent
  cross-wire. ⚠️ `no_household` is **retired** rather than left in the map: nothing counts households
  now, so an event carrying it is pre-1c-4 — which is the one fact an operator triaging an old alert
  needs.
  📌 **The schema-missing branch is the repo's first pg-error-code check, so it is the template**, and
  it had three hazards. A bare `catch` would map `ECONNREFUSED`, pool exhaustion and a statement
  timeout onto _"no household for this account"_, telling the one family that does have data that
  nothing is linked to their account. The code is on **`.cause`** — drizzle wraps the driver error —
  so a test fabricating `{ code }` on the error itself passes while production rethrows, which is a
  `42P01` on every route; a case pins the rethrow. And the payload is a fixed message and tag only,
  **never the error**, whose message embeds `params:` — and the param here is the Clerk user id.
  🔴 **The ≥2-live-households throw is gone, and the creator is closed instead of alerted on.**
  Porting it to a Sentry message would have fired on **every request, forever** once the first invite
  lands, because two live households is the intended Beta 0 end state. `seed.ts`'s household insert
  is now conditional on no live household existing — `migrate.yml` seeds **production** on every
  merge, which made the seed the one automated creator of household #2. The parent plan's Q5 assigned
  that fix to `1b` and it was never written.
  ⏳ **That guard's proof is OWED, and said so in place rather than faked.** A `db:verify` assertion
  was written, probed, and found **vacuous**: the state it is about is _"a live household and none
  under the seed's `public_id`"_, and that file's database is already seeded by the time any block
  runs — so inserting another makes it the second, which the guard correctly skips past, passing with
  the guard **deleted**. The gap is recorded where the proof would have been, citing
  `mutations/README.md`: _"a boundary test that cannot fail is worse than none, because it is counted
  as coverage."_
  `membershipHousehold` is barrel-exported, which its own docblock refused because it returns
  **internal** household ids — but `packages/db`'s `exports` map publishes only `"."`, so the DAL had
  no other route and a lookalike in the app is what TEN-1 extracted these modules to prevent. The
  containment is now a **guard**: `scope.test.ts` pins that exactly one `apps/web` file names it.
  The three DAL suites broke for **two independent reasons each**, as the plan predicted: no
  principal (vitest has no Clerk keys and no bypass, so every case fell to state B and the query
  under test was never emitted — the failure `recording-db.ts` exists to prevent, one layer up), and
  a probe regex keyed on `from "households"` when the resolver emits `from "household_members" inner
join "households"`. ⚠️ `household.test.ts`'s `no_scope` case was the one to watch: it would have
  gone **green for the wrong reason**, and it is the only assertion standing between
  `reportScopeMiss` and reporting every legitimate request as a cross-household probe.
  **The sweep was grep PLUS a read**, because the grep cannot see a claim that describes the
  behaviour without naming the chunk: `.github/SECURITY.md` cited the removed throw as an **enforced
  control**, `schema.ts` said creating a second household _"takes the app down"_, `profiles.ts` said
  the ≥2 case _"never reaches here"_, and `architecture.md`'s §2b node and edge both stated the old
  outcomes. None of those four contains the string `1c-4`.
