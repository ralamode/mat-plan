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
  ✅ **That guard is proved, and the first version of the proof was vacuous — which is the lesson.**
  The state the guard is about is _"a live household and none under the seed's `public_id`"_, and
  `db:verify`'s database is already seeded by the time any block runs, so **inserting** another
  household makes the seed row the second — the guard correctly skips past it and the assertion
  passed with the guard **deleted**. The construction that works moves the seed row out of the way
  instead: nothing references `households.public_id` (children carry `household_id`) and
  `households_public_id_unique` is a plain UNIQUE, so **renaming it** is reversible and local. The
  seed's refusal is now an explicit throw rather than a `TypeError` on `household.id`, because an
  assertion pinning a `TypeError` pins the absence of a property and not the decision — and
  `migrate.yml`'s red run now says why. `pnpm db:mutations` is at **ten** patches, all RED
  (`10-seed-ignores-live-household`).
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
  🔴 **The sweep is grep PLUS a read, and the read is the half that found the dangerous one.** The
  grep catches claims that NAME the chunk; the expensive ones **describe the behaviour**:
  `.github/SECURITY.md` cited the removed throw as an **enforced control**, `schema.ts` said creating
  a second household _"takes the app down"_, `profiles.ts` said the ≥2 case _"never reaches here"_,
  `plan.md` told a future `OBS-2` the same thing, and `architecture.md`'s §2b Mermaid **node** and
  **edge** carried the old outcomes where no prose did (that file does contain `1c-4` — the grep saw
  the file and not the claim).
  ⚠️ **`runbooks.md`'s triage was the one that mattered.** Its step 4 read _"the app is down with
  `household scope is ambiguous` → two or more live households exist"_ and told the operator to
  **soft-delete a household**. That message now means one principal holds two memberships, which is
  per-account — so following the old step would have deleted a real family. Step 4 now treats the
  duplicate **membership**, step 3 is a `scope_outcome` table (`no_membership`, `schema_missing`,
  `no_scope`, and `no_household` marked retired), and the ambiguous case notes that
  `uq_household_members_clerk_user` should make it unreachable at all.
  Also swept, each found by review rather than by the grep: the **sixth** _"until 1c-4"_ block
  (`export/route.ts`), `screenshot-ephemeral.ts`'s claim to run _"the same query
  `getHouseholdScope()` runs"_, `household-scope.ts` predicting a retirement that did not happen (it
  survives for `db:verify` and that one fixture script), `recording-db.ts`'s _"the households
  probe"_, a retired `no_household` in a `sentry-scrub` fixture, and three living docs still saying
  the resolver _"throws on a second live household"_ in the present tense.
  📌 **`docs/lessons.md` now carries the entry this is the FOURTH occurrence of** (1c-3a → #320,
  1c-3b → #323 and #324, 1c-4 → #330), with the two-pass sweep written down — grep the chunk id,
  then grep the **behaviour** — and the rule that the PR states the list, never a count.
  🔴 **The published privacy notice was telling parents a protection did NOT work that this chunk
  makes work**, and `session.ts` — the module the resolver reads its principal from — still said
  `1c-4` was _"still owed"_ in the present tense, a sixth site. `notice.md`'s limitation 1 read _"removing someone from the household in the database
  does not currently stop them, because the app does not yet work out whose data you get from who you
  are; that is the next piece of work"_ — this **is** that work, and `membershipHousehold` filters
  both `deleted_at` conjuncts (proved by `07-membership-ignores-soft-delete`), so removing a
  membership drops that person to the no-household screen. Limitation 3's _"anyone with your access
  code can download any athlete's full history"_ now needs the code **and** a session **and** a
  membership. `data-inventory.md` §4's export row gave **both** halves of a reason that are now
  false, and it is the row `.github/SECURITY.md` — edited by this PR — redirects readers to as the
  source of truth for what is enforced. All corrected, `notice-content.ts` regenerated. ⚠️ **What did
  NOT change:** inside one household any member still reads and exports any athlete (profile tiles
  are a UX switch, not a security boundary), the access code is still shared and all-or-nothing until
  `1d`, and the movement-name list is still common to every household. ⚠️ **And one thing the notice
  now says that it did not:** removing someone **hides** their membership rather than erasing it, so
  it keeps their account identifier until the whole household is deleted — the inventory said that
  and the published page did not, which matters because this change makes membership removal the
  recommended lever. The inventory's staleness command also could not see
  `packages/db/src/queries/`, the directory the published claim rests on; it watches it now, and §8
  records the new in-process store of Clerk ids behind the bound.
  🔴 **Both new captures are BOUNDED per principal.** States B′ and C are reachable on every page
  read, and page reads are not rate-limited — `checkMutationLimit` covers the seven mutating actions
  — so one admitted account looping `GET /p/<id>` emitted an unbounded stream. The cost is secondary:
  a flood of `no_membership` is what buries the `cross_household` event ADR 0006 obligation 3 exists
  to make noticeable, and at `1d` "admitted by the Clerk instance" is the only requirement left.
  `session.ts` already called its own cap _"the `scope_outcome` precedent"_ while this path had none.
  **Per principal rather than once per process**, which is the whole argument for C having its own
  outcome — once-per-process would hide the second affected family behind the first. ⚠️ **What that
  buys is a count, not an identity:** the payload is a fixed message and one tag, so two principals'
  events are byte-identical and group into one issue, and the runbook row says so rather than telling
  an operator to act on an account the event cannot name.
  🔴 **Two halves of that bound were wrong in the first attempt, and both were found by review.**
  (1) `reportScopeMiss`'s `no_scope` rode the **same loop uncapped**, so the stream the bound exists
  to stop survived under a different value — it joins the bound now, while `cross_household` and
  `unknown_resource` stay uncapped **on purpose**, because those two are the signal ADR 0006
  obligation 3 raises and `runbooks.md`'s _"more than 3 events in 1 hour"_ rule is written against
  them. Both directions are pinned: under-bounding and over-bounding each turn a different case red.
  (2) `schema_missing` shared one never-evicted 100-slot budget with the attacker-fillable
  `no_membership`, so **100 distinct no-membership principals could silence _"production is dark for
  everyone"_ for the life of the process.** B′ is deployment-wide, so it takes `session.ts`'s shape
  instead — one boolean, once per process — and reaching the per-principal cap now **emits once**, so
  the blackout after it is visible rather than inferred from silence.
  ⚠️ **The membership-containment guard was one-sided.** `scope.test.ts` greps `apps/web` for the
  symbol, which cannot see a rename that happens in `packages/db`: one
  `export { membershipHousehold as lookupHousehold }` line republishes it on the `"."` specifier
  under a name the sweep has never heard of, and every guard stays green while a page holds a raw
  internal `household_id`. The sibling guard for `householdScopeForScript` already carried the
  DB-side mirror; this one now does too. ⚠️ **The first version exempted the declaring module, which
  is the one file where the alias would actually publish** — the barrel star-exports it, so anything
  it exports reaches the app's specifier — and the probe planted the alias in the barrel, where the
  filter did reach. The sibling's exemption is safe only because its home is unreachable from
  `apps/web` at all. Exemption dropped, three redundant patterns collapsed to one, a directory-barrel
  star-export added, and re-probed by planting the alias **inside** the declaring module: red.
  ⚠️ **`runbooks.md` carried two more claims the new seed throw falsified**, neither containing
  `1c-4` — the lesson this PR adds, applied to it: _"`db:seed` is idempotent"_, the last line an
  operator reads before dispatching against production, and "Precondition 2", whose stated failure
  mode on deleting a seeded household is now only the **single-household** branch. With a second live
  household present — the intended end state once a family is invited — the seed skips, finds nothing
  under its `public_id` and **throws**, so `migrate.yml` is red on every merge until a row under that
  id exists again. Both branches and the recovery are written down.
  📌 Also: the `householdState` cases were titled _"zero/two live households"_ while their bodies set
  memberships, so a red test would have named a state that cannot occur; `household.ts`'s lead
  docblock still documented the deleted algorithm, `SQL` and all, thirty lines above the block saying
  what 1c-4 changed; a `db:verify` **gate** asserted _"the state `getHouseholdScope()` THROWS on"_;
  and the notice's own flattener compared probes against the author's hard line breaks, so
  re-wrapping a corrected sentence reddened two tests without changing a rendered word.
