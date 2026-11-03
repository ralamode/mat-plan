# AUTH-1 chunk 1c-4 — the household scope is derived from the session

> Backlog: [plan.md](../plan.md) → `AUTH-1`. Parent: [auth-1-clerk-google.md](./auth-1-clerk-google.md)
> § Design 3. Milestone: [beta-1](../milestones/beta-1.md).
> **Status:** PR 1 shipped 2026-11-03 (option **D**, the existing correction — the draft's new
> script was withdrawn when review found it was not idempotent). PR 2 next.
> Branch for PR 2: `feat/auth-1c-4-resolve-scope-from-session`.

## Goal

`getHouseholdScope()` stops answering _"the one live household"_ and starts answering _"the household
this principal is a member of"_. That is the last thing before `1d` deletes the access gate, and the
order is a **security obligation**: until the scope is membership-derived, a session alone means
_"anyone this Clerk instance admits"_, so deleting the gate first would **widen** access.

🔴 **Verified against code, and sharper than the prose.** At `06274d6` the resolver never consults
the principal while all twelve entry points require gate **AND** session. Delete the gate first and
**any** Clerk session resolves the one live household — full read/write, including a minor's whole
bodyweight history as a zip at `GET /p/<public_id>/export`, whose `public_id` is a **committed,
zero-entropy constant** (`packages/shared/src/seed-ids.ts:11`) and whose household was seeded into
production by `migrate.yml:81`. Two uninvited accounts self-created during the `Open` window
(`runbooks.md:1364`) are exactly the principals that would have reached it.

## Why this is four PRs

The first draft of this plan was one. The panel's size estimate for that shape was **~35–45 files,
~1,400–1,900 lines** against a <400 target — and `6e0c197` (1c-3b, 37 files / 1,424 insertions) is the
calibration. More importantly the pieces have **independent failure modes**: the harness seam is a
no-op for production behaviour, the resolver is the security boundary moving. Bundling them means the
reviewer who must concentrate on the resolver is also reviewing a new DB command and three workflow
call sites — which is how #320's _"four controls that did not control what they claimed"_ happened.

| #    | PR                                                | Why separate                                                                                                                                                             | Size    |
| ---- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------- |
| 1 ✅ | `test(auth-1c-4a)`: the harness supplies a member | **Must land first** — the e2e story breaks the moment the resolver changes. Green before _and_ after, so it is reviewable on its own (1c-1 and 1c-3a won this argument). | ~40 ln  |
| 2    | `feat(auth-1c-4)`: the resolver                   | One concern: a security boundary moving, with its proofs and the claims it falsifies.                                                                                    | ~700 ln |
| 3    | `docs(privacy)`: the notice contradicts itself    | **Independent of both.** False since #323 merged. Can ship today.                                                                                                        | ~20 ln  |
| 4    | `fix(auth)`: the zip export has no rate limit     | Parallel-safe. Deferring to `1d` costs a `tech-debt.md` edit anyway, and `1d` is the PR least able to absorb it.                                                         | ~40 ln  |

---

# PR 1 — the harness supplies a member, not just a principal

## The blocker

The seed writes **no** `household_members` row on purpose, and `verify.ts:6490` asserts it:
_"the seed writes NO household_members row — the claim correction is the only writer"_. That exists
because `migrate.yml` seeds **production**.

Both harnesses inject `E2E_SESSION_BYPASS_USER` as the principal. The moment the resolver is
membership-derived that principal has **no membership** → state C → empty picker →
`global.setup.ts`'s health check and every gated spec fail.

## Four options, not three

The first draft offered three and recommended a new script. The panel found the fourth, which is the
answer:

| Option                                             | Verdict      | Why                                                                                                                                                                                                                                                               |
| -------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A.** The seed writes it                          | ❌           | `migrate.yml` seeds production. This is the one row that must never exist there.                                                                                                                                                                                  |
| **B.** The bypass implies a scope, not a principal | ❌           | Leaves the resolver's new path unexercised by every e2e spec, in the chunk that adds it — **and** puts a second scope-derivation branch in production code, armed by an env var, defeating this plan's own _"nothing derives a scope from household count"_.      |
| **C.** A new locality-gated `db:` script           | ❌ withdrawn | ~130 lines + a `package.json` entry + three call sites + a permanent **tenth** `guards:test` entry, to give a harness one row. And as drafted it was **not idempotent** — see below.                                                                              |
| **D.** The existing `household-claim-2026-10-25`   | ✅           | Already idempotent (read-then-branch), already env-parameterised for both targets, already dry-run by default, already prints the target host — and it is literally the writer `verify.ts:6490` names. Reuse keeps that whole sentence true, not just half of it. |

🔴 **Why C was wrong, recorded because the error is instructive.** The draft claimed _"idempotent via
the existing partial unique"_. `insertHouseholdMember` (`packages/db/src/writers/ownership.ts:208`)
carries the refutation in capitals: _"**No `onConflictDoNothing`.** `uq_household_members_clerk_user`
is a real constraint and a collision here is an OPERATOR ERROR, not a replay."_ A unique index does
not make a writer idempotent; it makes the second run a `23505`.

## 🔴 The locality guard reads the wrong string

The draft specified `isLocalDbHost(DATABASE_URL)`. **Every `packages/db` script connects with
`DATABASE_URL_UNPOOLED ?? DATABASE_URL`** (`seed.ts:7`, `migrate.ts:10`, `correct.ts:36`). So
`DATABASE_URL=localhost` + `DATABASE_URL_UNPOOLED=<prod Neon>` **passes the guard and writes to
production** — and that is not a hypothetical env mix: the claim-correction runbook
(`runbooks.md:120`) puts a prod unpooled string on the command line, and `pnpm dev` leaves a local
`DATABASE_URL` behind.

It breaks the repo's own rule verbatim — `packages/shared/src/db-environment.ts`, `hasHostOverride`'s
header: _"A guard that inspects a different representation than the consumer is not a guard."_ That
is the `?%68ost=` lesson from 1c-3a.

**The guard, as it must be written:**

1. Resolve the url **once**, exactly as `correct.ts:36` does, and run `isLocalDbHost` on **that**
   string. Additionally refuse if _any_ other defined candidate is non-local. Ignore `ALLOW_LIVE_DB`
   (no legitimate live-DB mode here) and refuse outright if `EXPECTED_DB_ENV` is set.
2. The clerk id is `=== E2E_SESSION_BYPASS_USER`, the committed constant. Never env-supplied.
3. 🔴 **A content guard, because hostname locality cannot see a tunnel.** Refuse unless
   `select count(*) from entries` is **0**. The seed writes no `entries` and no `sessions`, so
   "freshly migrated and seeded, nothing logged" is exactly the harness state at all call sites, and
   any real estate fails it. A localhost SSH/Neon forward defeats guards 1 and 2; it does not defeat
   this one.

✅ **The predicate itself is the hardened one** — `isLocalDbHost` decodes `searchParams` before
checking `host`/`hostaddr`, brackets IPv6, fails closed on an unparseable string, and
`embedded-pg.ts:48` is now literally `export const isLocalDbUrl = isLocalDbHost`, so the harness and
the script share one proof rather than two.

## Call sites — **four**, not three

`migrateAndSeed` has three callers, and the third is `pnpm dev` against the **persistent** cluster
(`dev-local.ts:85`, `persistent: true`). The draft's _"one edit covers both"_ would have killed the
second `pnpm dev` on a duplicate key.

| Site                                      | Gets it? | Note                                                                                                                                              |
| ----------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e-local.ts`, `screenshot-ephemeral.ts` | ✅       | Via a **sibling** of `migrateAndSeed`, not inside it — which also buys the state-C screenshot for free (run the harness _without_ the link step). |
| `.github/workflows/ci.yml:482-484`        | ✅       | CI seeds with raw `db:migrate` + `db:seed`, not via `migrateAndSeed`.                                                                             |
| `dev-local.ts` (`pnpm dev`)               | ❌       | Needs a **runbook line** instead — see below.                                                                                                     |
| `migrate.yml`                             | ❌       | The point. And it must be **enforced**, not stated.                                                                                               |

⚠️ **`pnpm dev` is a hole the draft missed entirely.** It injects no bypass id, so from `1c-4` a
developer signing in with a real dev-instance account has no membership → state C on every local run,
and the fixture row does not help them. The escape already exists and goes in `runbooks.md`:
`HOUSEHOLD_PUBLIC_ID=… CLERK_USER_ID=<dev id> DATABASE_URL_UNPOOLED=<local> pnpm --filter @mat-plan/db db:correct household-claim-2026-10-25 --apply`.
Note the trap `registry.ts:723` already records from the other side: a dev `user_…` is not the
production id.

## Guards this PR owes

Every comparable containment in this repo has a lexical guard; a prose rule does not count
(`bypass-is-contained.test.ts` exists because one didn't).

- The link step appears in exactly `{ci.yml, embedded-pg.ts}` and **no other workflow** — the
  `bypass-is-contained.test.ts:91` workflow-sweep idiom.
- The clerk id is never read from `process.env` in the link path.
- Behavioural refusals: non-local url, mismatched id, non-empty `entries`.

⚠️ `bypass-is-contained.test.ts` asserts `E2E_SESSION_BYPASS_USER_ID` appears **exactly once** in
`ci.yml`. The design survives that only because the id comes from the committed constant — say so, so
nobody "fixes" the guard by putting the id in the new step's `env:`.

---

# PR 2 — the resolver

## The five outcomes

| #      | Condition                          | Answer                                                                 |
| ------ | ---------------------------------- | ---------------------------------------------------------------------- |
| **A**  | principal, exactly one membership  | `householdScopeForRequest(id)`                                         |
| **B**  | no principal                       | `null`, silent — 1c-3b already refused this caller at all twelve doors |
| **B′** | schema missing                     | `null` + fixed message + tag (see below)                               |
| **C**  | principal, **no** membership       | `null` + a **distinct** `scope_outcome` (see below)                    |
| **D**  | principal, **≥2** live memberships | **throws** — "pick one" is a silent cross-wire                         |

✅ **Complete.** `membershipHousehold` can return only length 0, 1 or 2. The three distinct causes
that collapse into C — no row, soft-deleted membership, live membership on a soft-deleted household —
are each already proved in `verify.ts`'s 1b block, and all three land on C exactly as those proofs
demand. A membership pointing at a vanished household is impossible (FK, proved) and doubly covered
by the inner join.

⚠️ **D is unreachable in production** — `uq_household_members_clerk_user` is on `clerk_user_id` alone.
Its test must mock the query; an implementer trying to construct the row will waste an afternoon. Its
blast radius is also now _per-principal_: a two-membership account gets `error.tsx` everywhere and a
500 from the export handler, while everyone else is unaffected.

### B′ — three hazards, none of which the draft closed

There is **no pg-error-code helper in this repo** to copy, so this is the template.

1. **Breadth.** A bare `catch { return null }` maps `ECONNREFUSED`, pool exhaustion and a statement
   timeout onto "no household for this account" — during an outage the real family is told _"Nothing
   is linked to this account"_. Match the codes; **rethrow everything else.**
2. **Where the code lives.** drizzle wraps driver errors, so it is on `err.cause`, not `err`. A test
   fabricating `{ code: '42P01' }` on the error itself passes while production rethrows → `42P01` on
   every route, the total outage B′ exists to prevent. Specify `(err.cause ?? err)`, a
   `SCHEMA_MISSING_CODES` const, and build the test on a **real** `DrizzleQueryError`.
3. 🔴 **The payload.** Fixed message and tag only — **never the error object, never `extra`.** The
   caught error is a `DrizzleQueryError` whose message embeds `params:`, and here the param **is the
   Clerk user id**. `household.ts:169` already records SEC-3's scar; the scrubber has **no allowlist
   for hand-built contexts**. Mirror `household.test.ts:137`'s `not.toMatch(/params/)` for B′.

`null` is the right outcome: consistent with zero-households, the cause rides `scope_outcome` to a
dashboard rather than a line on a family's screen, and the repo already chose "avoid the `42703`"
once deliberately.

### C needs its own `scope_outcome`

`constants.ts:237` argues the five causes deliberately share one screen **because telemetry carries
the cause**. So C gets `no_membership`, distinct from today's `no_household` — otherwise
"the maintainer is locked out" and "someone used the wrong Google account" are the same dashboard row.

## 🔴 The ≥2-live-households detector: close the creator, delete the alert

The draft proposed porting the throw to a Sentry message. Three facts kill that:

1. **The removed detector is cited as an enforced control in six committed places** — including
   `.github/SECURITY.md:57` (_"enforced in code until `AUTH-1`: the scope resolver **throws** on a
   second live household"_), which **was not in the draft's file table**. Shipping without that edit
   leaves a false enforced-control claim in the security file.
2. **Its paired mitigation was never written.** The parent plan's Q5 says the non-request creator of
   household #2 is `seed.ts` + `migrate.yml` seeding production on every push; 1b was to make the
   insert conditional and never did. So this chunk removes the loud detector while the silent creator
   is still live.
3. **The replacement would fire forever.** Post-1c-4 two live households is the **intended** Beta 0
   end state. An alert on `length >= 2` fires on every request from every principal the moment the
   first invite lands — a quota drain that gets muted, and muting it silences `no_household` and
   `schema_missing` too.

**Decision: land 1b's conditional seed insert here (~5 lines + a `db:verify` assertion) and DELETE the
alert.** Closing the creator in code is strictly better than alerting on it. `liveHouseholdIds`
survives regardless, for `screenshot-ephemeral.ts` and `verify.ts` §0 — so the correction of the false
_"this module goes with it"_ docblock stands either way, and this also converts a dangling obligation
(`seed.ts`'s conditional insert) into a closed one.

## The tests — three suites, and one that passes vacuously

| File                               | What breaks                                                                                                                                                                                                                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entries.test.ts`                  | Mocks only `./db` → no principal → **state B** → the query under test is never emitted. The exact failure `recording-db.ts` was written to prevent, one layer up.                                                                                                                         |
| `profiles.test.ts`                 | Same, plus a hand-rolled `/from "households"/` at `:48`.                                                                                                                                                                                                                                  |
| `household.test.ts:41-158,174-188` | 🔴 The `reportScopeMiss` block too. `cross_household` and `unknown_resource` go **red**; `no_scope` and the keys case go **green vacuously** — and `no_scope` is the only assertion standing between `reportScopeMiss` and reporting every legitimate request as a cross-household probe. |

`recording-db.ts`'s `oneHouseholdThenEmpty` keys on `/from "households"/`; the membership query emits
`from "household_members" inner join "households"`, which does not match. Rewrite in place (it is not
dead — the `toContain(ONE_HOUSEHOLD_ID)` assertions are the only thing proving _which_ household's
conjunct is bound), and add `vi.mock('./session')` supplying a principal — **not** the three-mock
Clerk stack, and **not** `E2E_SESSION_BYPASS_USER_ID` in `vitest.config.ts`, which
`bypass-is-contained.test.ts` would redden.

Add a **non-vacuity** assertion that the membership query was actually emitted, or a stub that
silently answers "no membership" makes every "returns `[]` when no scope" test pass for the wrong
reason.

✅ **`cache()` is sound** — probed: React's `cache()` is a pass-through, both functions are keyed by no
args and scoped to the request store, and the layout is `force-dynamic`. One residual worth a line: a
Route Handler may not memoise, so `export/route.ts` runs `auth()` + the join twice. Performance, not
correctness.

## The `db:verify` proof — re-scoped, because the draft's version is impossible

The draft promised _"the row-level `cross_household` proof"_. The classifier lives in `apps/web` and
`db:verify` cannot import it (`server-only`, `@sentry/nextjs`), so as written it could only be a
re-typed lookalike — the vehicle the TEN-1 panel rejected.

**What it proves instead, which is the real content:** with two live households, `membershipHousehold`
for A's principal yields A's scope, `isLiveProfile(B's profile, A_SCOPE)` is **false**, and an
existence-only read **finds** that profile. The two predicates disagree — which is precisely what
makes the classifier answer `cross_household`. The classification itself stays the unit suite.

Two mechanics to honour: it must land **after** `verify.ts:6488` (the zero-members assertion) or its
own rows redden that; and `db:verify` is fail-fast, so a new mutation patch cannot name this
assertion as the first failure (01/07/09 already redden the predicates it rides). **Record that
absence in `mutations/README.md` rather than shipping an `.expect`-less patch, which the runner treats
as a pass.**

## The doc sweep — a grep, not a list

`git grep -l '1c-4'` → **34 files**. The draft's table listed 14. An enumerated list is the same
mechanism that produced #324; the committed grep is the mechanism. Split its output into two buckets
**explicitly**:

- **Claims FALSE at this commit → must ride.** ~18 code comments saying "until 1c-4", plus
  `architecture.md` (a Mermaid **node** reading `0 → null · ≥2 → throw` and an **edge** reading
  `the one live household`), `.github/SECURITY.md:57`, `write-path.md`, `runbooks.md` (`no_scope`
  changes meaning), `tech-debt.md` ×2, `profiles.ts:45`, `schema.ts:141,149`,
  `screenshot-ephemeral.ts:127`, `mutations/README.md`, `docs/lessons.md`.
- **Dated history → must NOT be rewritten.** `docs/changelog/*`, merged `docs/plans/*`.

⚠️ **`docs/lessons.md` is owed.** "A forward-looking claim naming a chunk that has now shipped" is on
its **fourth** occurrence (1c-3a → #320, 1c-3b → #323, #324, now). AGENTS.md requires the entry in the
same PR.

## Dropped from the draft

- **The `AGENTS.md` Sentry row.** Its evidence was wrong, confirmed by all four lenses:
  `sentry-scrub.ts:174` says _"`tags.scope_outcome` and `householdId` are **unaffected** — those are
  the observability this app does want."_ The scrubber deletes `event.user`/`contexts.user`; nothing
  calls `setUser`. AGENTS.md may still owe an amendment, but for the **opposite** reason — following
  it would ship those ids _unscrubbed_ — and that is another PR's file.
- **No UX panel, no screenshots.** `no-household-state.tsx` and the `p/page.tsx` branch already exist;
  this chunk makes state C _reachable_ without changing a pixel. Say so in the PR description or a
  reviewer blocks on the UI rules.

---

# PR 3 — the privacy notice contradicts itself (ship anytime)

`notice.md:48` and `:115` say sign-in is on; `:116` says Google is _"not yet"_. **A published privacy
notice contradicting itself about a third-party data flow**, false since #323 merged.

⚠️ `notice.md` is a **generated source** — `apps/web/lib/privacy/notice-content.ts` is derived with a
byte-exact drift test, so this needs `pnpm --filter web privacy:generate` or `pnpm verify` goes red on
a docs-only edit. The `Last updated:` line moves too.

The `wrongAccount` / `PICKER_EMPTY_COPY` re-read is genuinely contingent on state C and rides PR 2.
⚠️ Note in that PR that AGENTS.md's same-PR inventory trigger is _not_ what forces the edit — this
chunk changes what is **read at request time**, not what is stored or who receives it.

---

# PR 4 — the zip export has no rate limit

`tech-debt.md:372` assigns it here. Deferring to `1d` costs a `tech-debt.md` edit **anyway**, and `1d`
is the PR least able to absorb an unrelated limiter. `export/route.ts:74` already has the user id in
hand and `checkMutationLimit` is the pattern verbatim — ~40 lines plus a boundary test, with its own
limiter and constant (a zip must not consume the `mat-plan:mutate` budget).

---

## Before PR 2 merges — a runbook box, downgraded

🔴 **The draft called this a deploy blocker. It is not one, and the reason has an expiry date worth
writing down.** _(Maintainer, 2026-11-03: no account or row in production is anything but expendable;
starting fresh is acceptable.)_ So the failure the draft feared — every principal, the maintainer
included, locked out in state C — costs a correction re-run, or nothing. It does not gate the merge.

⚠️ **This latitude ends at the first invited family**, the next milestone step after `1d`. From that
commit the same missing row locks out a person who cannot fix it and whose data cannot be recreated,
and this box is a gate again. Any later chunk leaning on this paragraph should check that date first.

**What does NOT relax.** Expendable data is a statement about _recovery_, not about _correctness_:
the fixture-member locality guard, the `migrate.yml` containment and the 404-never-403 refusals all
stand unchanged. A guard that is wrong is wrong whether or not the rows behind it matter today, and
it will still be there when they do.

The deploy **is** the merge (Vercel builds on push to `main`), so "before deploy" was the wrong
boundary too. The box stays — the precedent is a runbook section with the answer written down, not a
risk-table sentence, because what went wrong in this series is precisely an unrecorded verification
(`runbooks.md:1362`: the sign-up restriction was verified on _development_ while production stayed
`Open`).

```sql
SELECT clerk_user_id, role, created_at FROM household_members WHERE deleted_at IS NULL;
```

Exactly one live row, `role = 'owner'`. If it is missing, every principal lands in state C — no
in-app recovery, exit via the claim correction. It fails in the **safe** direction: locked out, not
exposed. Today that is an inconvenience; after the first invite it is an outage.

⚠️ **Name the guard that must NOT be written:** a state-C fallback to "the one live household" would
reinstate exactly the widening this chunk exists to remove.

Two related items for the same session: the ledger row
(`packages/db/scripts/corrections/README.md:73`) still reads `pending` although the correction was
applied — **the README says that column is the only record** — and the two accounts from the `Open`
window need their disposition recorded or deleted.

## Out-of-scope

- **`1d`.** This unblocks it; it does not do it. ✅ The residue is clean and already enumerated — the
  two files that could have cornered it (`access-gate.ts`, `public-paths.ts`) were split along the 1d
  line by 1a.
- **A state-C Playwright spec.** ⚠️ The draft's reason was **false** — state C is the _absence_ of a
  membership for the one principal, not a second principal. The real reason is that `fullyParallel`
  shares one database. The free substitute: run `screenshot-ephemeral` without the link step and
  capture the screen, which has been described in committed copy since 1c-2 and never seen.
- **Routine-editor BOLA** (`tech-debt.md:563`). ✅ It **closes here** — `updateProfileRoutine` already
  writes through `isLiveProfile(publicId, scope)`, so membership-derivation turns scoping into
  authorization. Mark it closed in PR 2; don't re-own it.

## Review-response log (adversarial panel, round 1)

Four lenses, in parallel. **Every blocking finding was accepted**; the three rejections are recorded.

| #   | Lens         | Critique                                                                       | Verdict      | Resolution                                                                                      |
| --- | ------------ | ------------------------------------------------------------------------------ | ------------ | ----------------------------------------------------------------------------------------------- |
| B1  | Security     | The locality guard reads `DATABASE_URL`; scripts connect with the unpooled     | **accepted** | 🔴 The worst error in the draft. Resolved-string guard + content guard; PR 1 § guard            |
| B2  | Security     | The ≥2 detector is a cited enforced control; its mitigation was never written  | **accepted** | Close the creator (conditional seed insert), delete the alert, edit SECURITY.md + five others   |
| B3  | Security     | B′ specified by outcome, not predicate; can ship a Clerk id to Sentry          | **accepted** | Three hazards written out; `(err.cause ?? err)`, rethrow, fixed payload                         |
| C1  | Correctness  | `entries.test.ts` / `profiles.test.ts` collapse to state B                     | **accepted** | Added; the draft had no row for either                                                          |
| C2  | Correctness  | `insertHouseholdMember` is deliberately **not** idempotent                     | **accepted** | Option C withdrawn entirely                                                                     |
| C3  | Correctness  | `household.test.ts:82-158` — two red, two **vacuously green**                  | **accepted** | Range widened; the `no_scope` vacuity called out by name                                        |
| C4  | Correctness  | The mutation patch cannot be the first failure (fail-fast ordering)            | **accepted** | Stated absence in `mutations/README.md` rather than an `.expect`-less patch                     |
| A1  | Architecture | `docs/architecture.md` missing — a Mermaid node and edge go false              | **accepted** | Added to the FALSE-now bucket                                                                   |
| A2  | Architecture | Barrel-exporting `membershipHousehold` has no guard                            | **accepted** | Export kept (mechanically unavoidable) + the containment assertion                              |
| A3  | Architecture | The `cross_household` proof is structurally impossible as worded               | **accepted** | Re-scoped to the precondition, which is the real content                                        |
| S1  | Scope        | Three PRs in one plan's clothes                                                | **accepted** | Split four ways, ordered                                                                        |
| S2  | Scope        | Option C is over-engineered; the real fourth option is the existing correction | **accepted** | Option D. The draft's table was a justification, not a design                                   |
| S3  | Scope        | 34 files match `1c-4`; the table listed 14                                     | **accepted** | The grep replaces the list, with two explicit buckets                                           |
| S4  | Scope        | Zip limiter: deferring costs more than doing                                   | **accepted** | PR 4, parallel                                                                                  |
| ×1  | Scope/Arch   | Move the script to `scripts/fixtures/` for lexical containment                 | **rejected** | Moot — option D uses the existing correction, so there is no new script to place                |
| ×2  | Multiple     | Correct the `AGENTS.md` Sentry line                                            | **rejected** | The draft's evidence was wrong and so would the correction have been. Another PR's file.        |
| ×3  | Scope        | Split the privacy inventory edit out of PR 2 as well                           | **rejected** | The `wrongAccount` half is genuinely contingent on state C. Only the tense half is independent. |

## Open questions

1. ✅ **Resolved 2026-11-03.** Production data is expendable, so a missing membership row no longer
   gates PR 2's merge — it costs a correction re-run. The query is still worth running (it also says
   which of the two Clerk accounts from the `Open` window to keep), and the latitude expires at the
   first invited family.
2. `recording-db.ts` — the panel's answer is "rewrite in place, ~15 lines, not a harness rewrite".
   Confirm at implementation.
