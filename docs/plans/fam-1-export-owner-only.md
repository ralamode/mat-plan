# FAM-1 export follow-ups: a rate limit on the export, and the bodyweight file for the owner only

_Lane E, 2026-11-19. One plan, **two PRs**: (A) the rate limit first, then (B) the owner-only
bodyweight file. Rev 3, reshaped by the panel below. No code is committed before the maintainer
approves this plan._

## Where this sits

- **Pillar:** the export (lane E owns it, FAM-1 step 14).
- **Milestone:** [FAM-1](../milestones/fam-1-family-program.md).
- **What these are:** two of the follow-ups the maintainer decided at step 14's questions
  ([fam-1-14-export.md](./fam-1-14-export.md) → "Questions for the maintainer", 2026-11-17):
  "Bodyweight download, operator only", decided as its own small PR. The board added the export
  rate limit, the route's other open debt, on 2026-11-18. Formula escaping shipped separately (#621).
- **Next:** nothing is gated on them. PR B's member branch has no population until
  [`INVITE-1`](../plan.md) makes members real (see Facts).
- **Roadmap:** no item moves. The FAM-1 plan's step-14 line belongs to the roadmap thread, which
  gets an as-built sentence after each PR merges.
- _Roadmap alignment (2026-11-19):_ answers `.github/SECURITY.md` → Sensitive data for the export.
  Pays the export half of [tech-debt](../tech-debt.md) → "The zip export is not rate-limited".
  `ID-1`'s six keep-open items are answered in the log. `INVITE-1` gates Q2, and `COACH-1`'s "may
  archive will not be is-the-owner" note (`apps/web/lib/dal/household.ts:367`) applies here too.
  Checked against the private roadmap; nothing to add here.

## Acceptance

From the decision (fam-1-14-export.md:416-418): _"The code is made to match `.github/SECURITY.md:134`,
with a boundary test that a non-operator member is refused. The privacy lens reviews it, and the
inventory and notice change in the same PR."_

**PR A is done when:**

1. A principal past the export limit gets `429` with `no-store`, and no zip is built. Only an
   export of a profile the caller owns is counted. An unauthenticated caller, or an unknown or
   foreign id, gets today's byte-identical `404` and costs no Redis call.
2. The limit has its own key and its own budget. Exports never spend a parent's ✓ budget, and a ✓
   never spends an export.
3. Every doc that says the export is unlimited, or that Upstash sees mutations only, is corrected
   (step A5).

**PR B is done when:**

1. The household owner's zip is unchanged, byte for byte and in file order.
2. A member's zip has no bodyweight file in any month. A month whose remaining files would both be
   empty is left out, so the month list shows no weigh-in either.
3. The bodyweight read refuses a non-owner scope in SQL (`isOwnerOf`). `db:verify` proves a
   member-role scope reads zero rows, and a mutation proves that assertion can fail.
4. The notice, inventory, SECURITY.md and runbooks say exactly what the code does, including what
   it still does not do (the day page).

## Facts this plan rests on (read from `origin/main`)

- **"Operator" is the role `owner`.** `HOUSEHOLD_ROLES = ['owner','member']`
  (`packages/shared/src/enums.ts:63`).
- **No code path creates a `member` today.** Both corrections that bind a login insert
  `HOUSEHOLD_ROLE.owner` (`packages/db/scripts/corrections/registry.ts:828-832`, `:935-939`). `:935`
  binds several logins to one household, each as owner. `member` appears only in script and test
  scopes. So PR B's member branch ships dark until `INVITE-1`. Its tests and the `db:verify` proof
  are the only things that run it.
- **The owner-only pattern is type + conjunct + proof + mutation.**
  - `ownerScope(scope)` narrows to `OwnerScope` or returns `null` (`packages/db/src/scope.ts:104`).
  - `archiveProfile` pairs that type with `isOwnerOf(scope)` in its WHERE
    (`packages/db/src/writers/ownership.ts:168`), so a narrowing lost to a cast fails closed.
  - `db:verify` asserts it (`verify.ts:8278-8336`), and mutation 14 proves the assertion can fail.
  - `scope.ts:77` says the type alone "must not be sold as" the guard.
- **The zip is built in one place.** `buildExportEntries` (`apps/web/lib/dal/export.ts:83`) pushes
  three files a month (`:136-141`), over the months `loggedMonths` returns (every live entry,
  weigh-ins included; `export-month.ts:385-398`).
- **The limiter.** `checkMutationLimit(userId, policy = MUTATION_RATE_LIMIT)`
  (`apps/web/lib/rate-limit.ts:203`) has one caller, `enterMutation`. That is stated in a docblock;
  no test restricts the callers. `pages-need-a-session.test.ts:457-466` asserts only the order
  inside `mutation-entry.ts`. `enterMutation` also adds the id-free `limiter-error` breadcrumb
  (`apps/web/app/p/mutation-entry.ts:125-131`), the only signal of a dead limiter.
- **The principal.** `sessionUserOrNull()` returns `{ userId }` (`apps/web/lib/dal/session.ts:138`).
- **The export links** are plain `<a download>` (`apps/web/app/p/[profileId]/page.tsx:279`,
  `apps/web/app/settings/athlete-list.tsx:328`).
- **The household cap** is 25 athletes (`MAX_HOUSEHOLD_ATHLETES`, `packages/shared/src/profiles.ts:191`).

## PR A — the export rate limit

**A1. `apps/web/lib/rate-limit.ts`** (EDIT):

- **The policy.** `EXPORT_RATE_LIMIT = { attempts: 30, window: '10 m' }`.
  - Sized from the cap: one export of every athlete in a full household (25) fits, which the
    notice's "export before you delete" needs. Thirty in ten minutes still refuses a loop.
  - A test pins `EXPORT_RATE_LIMIT.attempts >= MAX_HOUSEHOLD_ATHLETES`, so raising the cap fails
    that test rather than the parent. It's a floor, not an exact bound: settings also lists
    archived athletes' links, so a household can show more than 25; 30 leaves that headroom.
- **Its own limiter**, built by the existing factory with the sibling prefix `mat-plan:export`.
  It is never a child of `mat-plan:mutate`, per `:122-126`.
- **`checkExportLimit(userId)`**, a new export with no policy parameter. It and
  `checkMutationLimit` delegate to one private `check(limiter, userId)`.
  - `enterMutation`'s `limiter-error` breadcrumb stays where it is (`mutation-entry.ts:125-131`),
    so `mutation-entry.ts` and its tests are untouched. The route adds its own id-free breadcrumb,
    `'export limiter unavailable'`, on `reason: 'limiter-error'` (rev 3, after architecture and
    correctness round 2: moving it into `check` would double it or break `mutation-entry.test.ts`).
- **`MutationLimitPolicy` stays closed** to the two mutation policies. `limiterFor` and its "falls
  toward the stricter limit" docblock stay true, and no Server Action can pass the export budget.
- **Docblock.** The "one caller" line becomes one caller per function, the module header (`:9`)
  says three instances, and the ⏳ note at `:32-34` goes.

**A2. `apps/web/app/p/[profileId]/export/route.ts`** (EDIT). The order:

1. session → `404`;
2. `getProfileByPublicId` → `404`;
3. `checkExportLimit(user.userId)` → `429`;
4. `buildExportZip`.

- **Why after the ownership check** (security S3): a GET carries the session cookie on a cross-site
  top-level navigation. A limiter in front of the id check would let any page drain a signed-in
  parent's budget with `/p/anything/export`. After it, a drain needs a real, non-enumerable id, and
  a miss still answers `404` with no Redis call.
- **The `429`** is inlined: `new NextResponse('Too many downloads. Try again in a few minutes.',
{ status: 429, headers: NO_STORE })`.
  - No `retry-after` header: nothing reads it on an `<a download>`, and a second spelling of the
    window would drift.
  - No `route-miss.ts` helper: it has one caller, and a 429 is not a miss.
  - On a phone the browser saves or shows that one-line text; that's acceptable at a budget only a
    loop reaches.

**A3. Tests:**

- **`export/route.test.ts`** (EDIT, the #643 file):
  - limited → `429` + `no-store`, and `buildExportZip` is not called;
  - signed out, unknown id or foreign id → today's `404`, and `checkExportLimit` is not called;
  - allowed → today's response, with `checkExportLimit` called once with `'u'`, the mocked
    `userId`;
  - limiter error → today's response, plus one `'export limiter unavailable'` breadcrumb.
  - 🔴 The "unknown or foreign id → not called" case is the only pin on A2's order. It is not
    optional.
- **`rate-limit.test.ts`** (EDIT):
  - the `built` pin lists the third instance and its prefix;
  - the export instance drains at `EXPORT_RATE_LIMIT.attempts`;
  - draining the export leaves the mutation budget untouched, and the reverse;
  - plus the cap relation from A1.

**A4. No new source guard** (scope S4, which overrides security S4 and architecture S7).

- The route tests above fail if the call is missing, misplaced before the profile check, or its
  result ignored.
- `checkExportLimit` takes no policy, so there is no wrong policy to pass.
- A caller allowlist would be new machinery in a 670-line guard file, and it would catch nothing
  these tests miss.

**A5. Docs** (all say "mutations only" or "the export is unlimited" today):

- `AGENTS.md`: Server conventions' "Rate limit" line, and backend rule 7's "NOT wired: export
  limit".
- `.github/SECURITY.md` → Rate limiting (`:325`, `:331-332`).
  - It becomes the one statement; the restatements in `docs/runbooks.md:1391` and
    `.claude/skills/add-server-action/SKILL.md:18` point at it instead.
  - Its CSRF note (`:171`) gains a line saying the export GET now moves a counter, and why the
    order makes that safe.
  - Its "the export is the only Route Handler" (`:171`) gets corrected; the how-to route exists
    since #624.
- `docs/architecture.md:33`, `:49`: the Upstash node and a Route Handler → Upstash edge.
- `docs/features/write-path.md:212-218`, `:246`: three limiters, with their prefixes.
- `docs/privacy/data-inventory.md`:
  - §7, the Upstash row (`:819`): it receives the principal on mutations and on exports, and the
    keyspaces are `mat-plan:mutate:`, `mat-plan:row-write:` (missing since #419) and
    `mat-plan:export:`;
  - §8, counter retention (`:949`): the longest window is now 10 minutes;
  - §4, the export row: the export is no longer the one unlimited surface.
- `docs/tech-debt.md`: the row's export half is marked paid, and its "1c-4 PR 4" pointer is
  corrected. The `docs/plan.md` SCALE-4 count of unwired claims (`:394`) drops by one.
- Plus a changelog fragment.

## PR B — the bodyweight file for the owner only

**B1. `packages/db/src/queries/export-month.ts`** (EDIT):

- `bodyweightMonthRows` takes `scope: OwnerScope`, and its WHERE gains `isOwnerOf(args.scope)`,
  as `archiveProfile` does.
- The type catches an accidental caller. The conjunct is the guard: a member scope cast past the
  type reads zero rows.
- `strengthMonthRows`, `checkinMonthRows` and `loggedMonths` keep `HouseholdScope`.

**B2. `apps/web/lib/dal/export.ts`** (EDIT): `const owner = ownerScope(scope)` once, before the
month loop.

- **Owner:** today's three pushes, in today's order.
- **Member:** the bodyweight read never runs, and the month pushes strength and check-ins. A month
  whose strength and check-in row arrays are both empty is skipped. The decision is made on the
  arrays, never by comparing file text to a header. By the 14b partition such a month holds only
  weigh-ins, so it leaves no trace. The skip sits inside the member branch only.
- **No `reportAuthorityRefusal`:** a member asking for the export is not refused anything they
  asked for by name.
- The comment at `:139` ("every month's zip holds the same files") becomes "for a given role".

**B3. `db:verify`** (EDIT):

- **The helper.** Add `asOwner(scope, what)` to `packages/db/scripts/verify/harness.ts`, the shape of
  the file-private one at `verify/erasure.ts:630`, with the message taking its prefix from `what`.
  Import it in `verify.ts` and `verify/day.ts`.
  - `erasure.ts` is the PRIV-3 lane's and `docs/features/erasure.md`'s, so its private copy stays.
    Swapping it to the shared helper goes to the board as a P2 for that lane.
  - No new file joins `scope.test.ts`'s cast allowlist.
- **The five existing call sites narrow through `asOwner`:**
  - `verify.ts:3258`, `:5417` and `:10194`;
  - the `TEN1_READS_1C` row at `:5391`, inside its lambda, which keeps the row's household-B
    assertion meaningful;
  - `verify/day.ts:813`, where the shared `args` splits, so the bodyweight read gets an owner scope.
- **The new proof**, in `verify.ts` beside the TEN-1 matrix (not in a `verify/` module, where a cast
  is red by design, `verify/harness.ts:281-288`):
  - the owner scope reads the fixture's weigh-in;
  - `A_MEMBER_SCOPE` (minted, not forged, at `verify.ts:431`) is cast `as OwnerScope` past the type
    and reads zero rows. That cast is new, and `verify.ts` is already on the per-file allowlist.
- **Mutation 610** drops the conjunct, and its first failing assertion is the new proof's.
- `03-undo-1c-predicates.patch` is re-cut where its `@@ -358,7` hunk meets the conjunct, and
  proved red again.
- `db:mutations` runs locally (a `packages/db/**` diff), taking the machine-wide slot.

**B4. Tests: `apps/web/lib/dal/export-prescribed.test.ts`** (EDIT, the existing harness):

- the scope becomes mutable, built with `HOUSEHOLD_ROLE.owner` / `.member`, which also fixes the
  hand-typed `role: 'owner'` at `:32`;
- the real `ownerScope` is used;
- the cases:
  - (a) owner: `entries.map(e => e.path)` equals strength, bodyweight, check-ins for each month;
  - (b) member, a month with strength rows and no check-ins: the exact path list is strength then
    check-ins, and `bodyweightMonthRows` is never called. That catches an "either file empty"
    skip;
  - (c) member, a weigh-in-only month: no entries for that month;
  - (d) owner, a weigh-in-only month: all three files, in order. That catches a skip placed outside
    the member branch.

**B5. Docs.** The privacy lens's list is the floor; every sentence is written in the PR, and the
lens re-reads it.

- **`docs/privacy/notice.md`:**
  - "Getting your data out" gets a new sentence, roughly: _the weigh-in file is in the download
    only when you are signed in as the household's owner; everyone else signed in to the household
    gets the rest. Weigh-ins are still shown, and can be changed, on the athlete's page by anyone
    signed in to the household, and anyone using the owner's signed-in phone can download them. An
    adult athlete who is not the owner gets their own weigh-ins by asking for the full copy. Today
    every adult given a sign-in to a household is its owner, so this changes nothing for anyone
    yet; it applies once people can be invited as members._
  - The dated "What changed on …" entry describes a rule that now exists, not a reduction in who
    receives the file, because nobody receives less today. The sign-off line (`:426-432`) is
    updated with it.
  - Limitation 3 (`:150-153`) is reworded to the same effect.
  - `:109` ("the adult … can export") becomes "the household owner".
  - The archived-athlete export lines (`:272-274`, `:287`) gain the role caveat.
  - `:122`'s "shared login" goes; sign-in is per person.
  - A dated "What changed on …" entry is added, "Last updated" is bumped, and
    `notice-content.ts` is regenerated.
- **`docs/privacy/data-inventory.md`:**
  - §4: the export row is corrected ("any member can export any athlete").
  - §4 also gets a new open fact, "the day page shows weigh-ins to any member", owned by Q2's row.
  - §4 also states that every login bound today is an owner.
  - §6: the per-role contents, and the residual that a member's empty zip still says the athlete
    has history.
  - A dated re-read entry in the header. PR A adds its own for §4, §7 and §8.
- **`docs/tech-debt.md`**, the empty-zip row (`:360-362`): a second cause, a member and a
  weigh-in-only athlete. It stays dark until members exist.
- **`.github/SECURITY.md` → Sensitive data:**
  - the export enforces it (owner scope, SQL conjunct, proof);
  - the day page does not, yet; Q2 owns that;
  - "owner" means every login a correction bound as owner, not a single person.
- **`docs/runbooks.md`:** `:1461`, `:1973` and `:2195` say the owner runs the in-app export, or the
  full copy is produced. `:1466`'s "no check-ins" went false at #655 and is fixed in the same edit.
- **The "three files" invariant:** `docs/csv-export-contract.md:222`, `docs/features/write-path.md`
  invariant 16 and `packages/shared/src/csv/checkins.ts:54` say "for the owner; two for a member".
- `docs/features/day-writers.md` invariant 28 and the mutations README (row 610, and the 03 re-cut).
- Plus a changelog fragment.

## Alternatives considered

- **One PR for both.** Rejected (scope S1). The maintainer's decision was "each its own small PR".
  The halves share only the route's neighbourhood. Bundled, the limiter would wait on PR B's
  questions, and reverting a misfiring 429 would re-expose the file.
- **Refuse the whole export to a member (`404`).** Rejected; Q1. A member would lose the athlete's
  training history, which nothing marks privileged, to keep back one file.
- **A header-only bodyweight file for a member.** Rejected. It reads as "no weigh-ins", which is
  false.
- **Type-only owner gate.** Rejected (correctness, security, privacy, architecture). It fails open
  under a cast, and nothing proves it.
- **Limiter before the profile read.** Rejected (security S3): it opens a cross-site drain.
- **Reuse `checkMutationLimit` with a third policy.** Rejected (architecture S3, security S4). It
  breaks `limiterFor`'s fail-direction, lets a Server Action spend the export budget, and makes a
  missing argument compile into the parent's ✓ budget.
- **A shared `enterPrincipal(policy)` for the action and the route** (reuse S1). Deferred to
  `/api/sync`, the second limited handler. Today's two callers differ in envelope and order (the
  route limits after the profile read). Each keeps its own one-line breadcrumb until then.
- **10 per 10 minutes.** Rejected (scope, reuse, correctness). An eleven-athlete household's owner
  would be refused mid-export.

## Risks / rollback

- **The owner's zip must not change.** B4 (a) pins the order. `export-full-day.spec.ts` runs as the
  seeded owner.
- **The limiter fails open, as every policy does.** A Redis outage leaves the export unlimited, never
  unavailable; the breadcrumb records it.
- **An adult athlete who is a member** gets their weigh-ins only through the full copy. Named in the
  notice and the runbooks.
- **Rollback:** revert either PR on its own. Neither has a migration or stored state.

## Out of scope

- **The day page's bodyweight reads for a member:** `loggedBodyweight`, `lastBodyweightBefore`, the
  amend and clear. That's Q2, and the inventory's §4 names it as open.
- **Copy beside the export link telling a member a file is withheld.** That's Q3; it needs a
  capability boolean and a UX pass.
- A `guardian` role, per-athlete grants (`ID-1`), and audit logging of exports.

## Questions for the maintainer

- **Q1:** a member's export leaves out the bodyweight file (recommended), or refuses the whole zip?
- **Q2:** the day page's bodyweight reads for a member. Open a backlog row now, gated on `INVITE-1`
  (recommended: members don't exist until then), or decide the behaviour now?
- **Q3:** tell a member their export has no weigh-ins with a line of copy beside the link, or the
  notice only (recommended until `INVITE-1`, when members first exist)?
- **Q4:** SECURITY.md:134 says "kid bodyweight", but the rule applies to every profile, since
  `ID-1` item 5 forbids branching on `kind`. Reword it to "bodyweight" (recommended), with a
  qualifier: the export returns it to owner logins only, and an adult athlete's own access is
  `ID-1`'s question.

## Review-response log

### Engineering panel (round 1, 2026-11-19)

> Lenses: correctness, scope, architecture, reuse, security, privacy (Fable, read-only, ~120–145k
> tokens and 4.5–5.5 min each).

| #           | Lens                                                          | Critique (short)                                                                                              | Verdict      | Resolution                                                                                 |
| ----------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------ |
| C1/A1       | Correctness, Architecture (BLOCKING), Scope, Reuse, Security  | `OwnerScope` breaks five `db:verify` call sites, unlisted; a cast is forbidden in `verify/day.ts`             | **accepted** | B3: hoisted `asOwner`, five sites listed, `db:mutations` locally                           |
| C3          | Correctness, Security S1, Privacy 4, Architecture S2          | Type-only gate fails open; no proof below the DAL                                                             | **accepted** | B1 `isOwnerOf`; B3 proof + mutation 610; 03 re-cut                                         |
| C2          | Correctness                                                   | The cited corrections create owners; no member exists                                                         | **accepted** | Facts restated; the branch ships dark until `INVITE-1`                                     |
| C4          | Correctness, Security S5, Privacy 7, Architecture S5          | `loggedMonths` reveals weigh-in-only months to a member                                                       | **accepted** | B2 skips a member's all-empty month; B4 (c)                                                |
| C5          | Correctness, Scope S6, Reuse S6                               | 10/10 m is sized for 3 athletes; the cap is 25                                                                | **accepted** | 30/10 m, pinned against `MAX_HOUSEHOLD_ATHLETES`                                           |
| C6          | Correctness                                                   | Tests can't fail on the policy, the file order or the instance pin                                            | **accepted** | No-policy `checkExportLimit`; B4 (a) asserts order; `built` pin and isolation tests        |
| C7          | Correctness, Scope S5, Reuse S4, Architecture S4, Security N6 | Doc list misses many stale statements                                                                         | **accepted** | A5 and B5 list them; SECURITY.md → Rate limiting becomes the one statement                 |
| S1          | Scope                                                         | Two concerns in one PR, against "each its own small PR"                                                       | **accepted** | Two PRs, limiter first                                                                     |
| S3          | Scope, Reuse S3, Architecture N8                              | `tooManyRequests` helper with one caller; `retry-after` duplicates the window                                 | **accepted** | Inlined 429, no `retry-after`                                                              |
| S4          | Scope                                                         | Step 6's guard doesn't exist; route tests already cover the order                                             | **accepted** | A4: no new guard                                                                           |
| SEC-S4/A-S7 | Security, Architecture                                        | Add a caller allowlist and an order assertion to the guard                                                    | **rejected** | Scope S4's reasoning: a no-policy function plus the route tests catch what the guard would |
| SEC-S3      | Security                                                      | Limiter before the id check allows a cross-site budget drain                                                  | **accepted** | A2 order: profile, then limiter                                                            |
| A-S3        | Architecture, Security S4, Reuse N7                           | Widening `MutationLimitPolicy` breaks `limiterFor` and lets actions spend it                                  | **accepted** | A1 `checkExportLimit`, private shared `check`                                              |
| R-S1        | Reuse                                                         | Extract session + limiter into one `enterPrincipal`                                                           | **deferred** | Alternatives: at `/api/sync`                                                               |
| P1/P2       | Privacy (BLOCKING ×2)                                         | Notice and inventory lines go false; the notice overstates the protection                                     | **accepted** | B5 lists each line and writes the sentence, day page and shared phone included             |
| P3          | Privacy                                                       | An adult member athlete; runbooks offer a partial export before erasure                                       | **accepted** | B5 notice + runbooks; Risks                                                                |
| P5          | Privacy                                                       | Upstash gets a new key; inventory §7/§8 go false                                                              | **accepted** | A5; prefix `mat-plan:export`                                                               |
| P6/A-S6     | Privacy, Architecture                                         | A member can't tell their export is partial                                                                   | **question** | Q3, recommended notice-only until `INVITE-1`                                               |
| N           | all                                                           | `user.id` → `user.userId`; dead milestone link; line slips; "#621 not 14b"; pick one test file; ID-1 sentence | **accepted** | Fixed in this revision                                                                     |

### `ID-1`'s six keep-open items (from the architecture lens)

| #   | Item                                            | Verdict | Why                                                                                                                                                                                                                     |
| --- | ----------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The principal is a login, never a profile       | holds   | The limiter key is the Clerk user id; the owner test reads the membership's role. No column. The notice says "today, the household owner", never that an athlete can't have their own file. A profile has no login yet. |
| 2   | Every access decision via `getHouseholdScope()` | holds   | `buildExportEntries` narrows once with `ownerScope()`; the route reads no role. When Q2 is taken, "who may read bodyweight" becomes one named narrowing, so a later grant widens one function.                          |
| 3   | State D is not the model                        | holds   | The budget is per principal; nothing caches "is an owner" outside the scope.                                                                                                                                            |
| 4   | Nothing pins an athlete to a household          | holds   | The Redis key is `mat-plan:export:<clerk user id>`, with no household or profile id. Zip paths stay rooted on `public_id`.                                                                                              |
| 5   | No age-based permission logic                   | holds   | The rule applies to every profile regardless of `profiles.kind`; branching on `kind` is refused. Hence Q4.                                                                                                              |
| 6   | Roles stay a shared const plus a CHECK          | holds   | No role is added; `HOUSEHOLD_ROLE.owner` inside `ownerScope()`. A later `guardian` fails closed (no file) until `ID-1` widens item 2's narrowing.                                                                       |

### Re-review (round 2, rev 2 → rev 3, 2026-11-19)

> Privacy, correctness and architecture, one light pass each. Every rev-1 BLOCKING and SHOULD is
> closed. Architecture accepts the SEC-S4/A-S7 rejection, on the condition recorded in A3.

| #   | Lens                      | Critique (short)                                                                                                                               | Verdict      | Resolution                                                                              |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | --------------------------------------------------------------------------------------- |
| R1  | Architecture, Correctness | Moving the breadcrumb into `check` breaks `mutation-entry.test.ts` or doubles it                                                               | **accepted** | A1: `enterMutation` untouched; the route has its own breadcrumb (A3 tests it)           |
| R2  | Correctness               | Hoisting `asOwner` edits PRIV-3's `erasure.ts` and its guide                                                                                   | **accepted** | B3: new helper in `harness.ts`; erasure's swap goes to the board as a P2                |
| R3  | Correctness               | (b) passes on a wrong skip; no owner weigh-in-only case                                                                                        | **accepted** | B4 (b) exact paths; (d) added                                                           |
| R4  | Privacy                   | Notice sentence implies a restriction nobody is under today                                                                                    | **accepted** | B5: "today every login is the owner" clause; inventory §4; dated entry worded as a rule |
| N   | all                       | PR A re-read entry; tech-debt empty-zip row; Q4 qualifier; "minted, not forged" cast; skip on arrays; `rate-limit.ts:9` header; cap is a floor | **accepted** | Fixed in this revision (the `:9` header joins A1's docblock edits)                      |
