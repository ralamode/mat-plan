# FAM-1 export follow-ups: a rate limit on the export, and the export for the household owner only

_Lane E, 2026-11-19. One plan, **two PRs**: (A) the rate limit first, then (B) the export for the
household owner only. Rev 4: reshaped by the panel, then by the maintainer's answers (2026-11-19,
§ Decisions). Code follows the plan's merge._

## Where this sits

- **Pillar:** the export (lane E owns it, FAM-1 step 14).
- **Milestone:** [FAM-1](../milestones/fam-1-family-program.md).
- **What these are:** two of the follow-ups the maintainer decided at step 14's questions
  ([fam-1-14-export.md](./fam-1-14-export.md) → "Questions for the maintainer", 2026-11-17):
  "Bodyweight download, operator only", decided as its own small PR. The board added the export
  rate limit, the route's other open debt, on 2026-11-18. Formula escaping shipped separately (#621).
- **Next:** nothing is gated on them. PR B's refusal has no population until
  [`INVITE-1`](../plan.md) makes members real (see Facts).
- **Roadmap:** no item moves. The FAM-1 plan's step-14 line belongs to the roadmap thread, which
  gets an as-built sentence after each PR merges.
- _Roadmap alignment (2026-11-19):_ answers `.github/SECURITY.md` → Sensitive data for the export.
  Pays the export half of [tech-debt](../tech-debt.md) → "The zip export is not rate-limited".
  `ID-1`'s six keep-open items are answered in the log; Q1 adds a requirement to `ID-1`, and `COACH-1`'s "may
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
2. Any other login is refused the export with the same `404` as a miss, and no month or file read
   runs. Neither export link is shown to a non-owner.
3. The export's first read (`loggedMonths`) refuses a non-owner scope in SQL (`isOwnerOf`).
   `db:verify` proves a member-role scope reads zero months, and a mutation proves that assertion
   can fail.
4. The notice, inventory, SECURITY.md and runbooks say exactly what the code does.

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

## PR B — the export for the household owner only

_Rev 4: the maintainer's Q1 (2026-11-19) replaces rev 3's "leave the bodyweight file out". **The
owner gets everything; any other login is refused the export.**_

**B1. `packages/db/src/queries/export-month.ts`** (EDIT): `loggedMonths` takes `scope: OwnerScope`,
and its WHERE gains `isOwnerOf(args.scope)`, as `archiveProfile` does.

- It is the export's first read, and every file is built from the months it returns. So one
  conjunct gates the whole export: a member scope cast past the type gets no months and therefore no
  files.
- The type catches an accidental caller; the conjunct is the guard.
- The three file reads keep `HouseholdScope` and are unchanged. That leaves no edit to
  `bodyweightMonthRows` and none to its five proof call sites.

**B2. `apps/web/lib/dal/export.ts`** (EDIT): `buildExportEntries` narrows once, with
`const owner = ownerScope(scope)`.

- With no owner, it returns a refusal, `null`, before any month query. `buildExportZip` passes the
  `null` through.
- The owner's path passes `owner` to `loggedMonths` and is otherwise unchanged.
- A non-owner's refusal is reported with `reportAuthorityRefusal(AUTHORITY_ACTION.exportProfile)`,
  a new member of the existing const, the same id-free signal `archiveAthlete` sends.

**B3. `apps/web/app/p/[profileId]/export/route.ts`** (EDIT): a `null` zip answers `notFound()`, the
same byte-identical miss as an unknown id.

- A member can already see that the athlete exists in the app, so the `404` hides nothing new, and
  the route keeps one miss shape (#643).
- The order is session, profile, limiter, then build. A member spends one unit of budget per
  refused attempt, which is harmless.

**B4. The link** (EDIT): `householdState()` gains `canExportAthletes: ownerScope(scope) !== null`
(`apps/web/lib/dal/household.ts:376`, one capability per boolean, beside `canArchiveAthletes`).

- `apps/web/app/p/[profileId]/page.tsx:279` and `apps/web/app/settings/athlete-list.tsx:328` render
  the export link only when it's true, so the UI never offers what the endpoint refuses.
- A non-owner sees no link and no replacement copy. Q3 says the notice carries it until `INVITE-1`.
- It's a small visual change, so one UX reviewer reads it before code (AGENTS.md → UI PR rules).
  Today nobody sees the difference: every login is an owner.

**B5. `db:verify`** (EDIT):

- **The helper.** Add `asOwner(scope, what)` to `packages/db/scripts/verify/harness.ts`, in the shape
  of the file-private one at `verify/erasure.ts:630`, with the message taking its prefix from
  `what`.
  - `erasure.ts` keeps its copy. The swap goes to Native Scaling after this PR (board,
    2026-11-19).
- **The six `loggedMonths` call sites in `verify.ts` narrow through `asOwner`:** `:2523`, `:8477`,
  `:10100`, `:10153`, `:10180`, and the `TEN1_READS_1C` row at `:5404`, inside its lambda, which
  keeps the row's household-B assertion meaningful.
- **The new proof**, in `verify.ts` beside the TEN-1 matrix (not in a `verify/` module, where a cast
  is red by design, `verify/harness.ts:281-288`):
  - the owner scope reads the fixture's months;
  - `A_MEMBER_SCOPE` (minted at `verify.ts:431`) is cast `as OwnerScope` and reads zero months. The
    cast is new, and `verify.ts` is already on the per-file allowlist.
- **Mutation 610** drops the conjunct, and its first failing assertion is the new proof's.
- Every patch that touches `loggedMonths` (`03-undo-1c-predicates.patch` among them) is checked
  with `git apply --check`, re-cut where needed, and proved red again.
- `db:mutations` runs locally (a `packages/db/**` diff), taking the machine-wide slot.

**B6. Tests:**

- **`apps/web/lib/dal/export-prescribed.test.ts`** (EDIT, the existing harness). The scope becomes
  mutable, built with `HOUSEHOLD_ROLE.owner` / `.member`, which also fixes the hand-typed
  `role: 'owner'` at `:32`. The real `ownerScope` is used. Cases:
  - (a) owner: `entries.map(e => e.path)` equals strength, bodyweight, check-ins for each month,
    as today;
  - (b) member: the result is `null`, no month or file read is called, and one authority refusal is
    reported.
- **`export/route.test.ts`**: a `null` zip gives today's `404` with `no-store`.
- **`household.test.ts`**: `canExportAthletes` is true for an owner scope and false for a member.
- The page tests or e2e: the seeded owner still sees the link.

**B7. Docs** (the privacy lens re-reads every sentence in the PR):

- **`docs/privacy/notice.md`:**
  - "Getting your data out" gets a sentence, roughly: _only the household's owner can download an
    athlete's export. Today every adult given a sign-in to a household is its owner, so this changes
    nothing for anyone yet; it applies once people can be invited as members. Anyone signed in to
    the household sees weigh-ins in the app._
  - Limitation 3 (`:150-153`) is reworded: anyone signed in can see any athlete's history in the
    app; only the owner can download it.
  - `:109` becomes "the household owner".
  - The archived-athlete export lines (`:272-274`, `:287`) say "the owner".
  - `:122`'s "shared login" goes; sign-in is per person.
  - A dated "What changed on …" entry, worded as a rule that now exists. The sign-off line
    (`:426-432`), "Last updated", and the regenerated `notice-content.ts` go with it.
- **`docs/privacy/data-inventory.md`:**
  - §4: the export row ("any member can export any athlete") becomes the owner only, and states
    that every login bound today is an owner;
  - §6: the recipient;
  - a dated re-read entry in the header.
- **`.github/SECURITY.md:134`**, reworded per Q4:
  - **Bodyweight** is privileged: never logged, and never in an LLM or MCP payload unless a scoped,
    explicit purpose requires it.
  - Anyone signed in to the household may see it in the app (Q2). The export goes to owner logins
    only.
  - It never appears on a child's feed in any future feed or sharing feature; an adult may choose
    to publish their own (Q2).
  - An adult athlete's own access is `ID-1`'s question.
- **`docs/runbooks.md`:** `:1461`, `:1973` and `:2195` say the owner runs the in-app export.
  `:1466`'s "no check-ins" went false at #655 and is fixed in the same edit.
- **The feature guides:** `docs/features/write-path.md` invariant 16 (the export reads take an
  owner scope at `loggedMonths`) and the mutations README (row 610, plus any re-cut).
- Plus a changelog fragment.
- **Not in this repo PR:** the `ID-1` requirement and the feed rule go to the roadmap thread to
  record in `docs/plan.md` (`ID-1`) and the program plan; lane E edits neither.

## Alternatives considered

- **One PR for both.** Rejected (scope S1). The maintainer's decision was "each its own small PR".
  The halves share only the route's neighbourhood. Bundled, the limiter would wait on PR B's
  questions, and reverting a misfiring 429 would re-expose the file.
- **Leave only the bodyweight file out of a member's zip** (rev 1–3). Superseded by the
  maintainer's Q1: a non-owner is refused the whole export until `ID-1` lets an adult export their
  own data.
- **Gate the bodyweight read rather than `loggedMonths`** (rev 2–3). Superseded with it. One
  conjunct on the first read gates every file and avoids five proof call-site edits.
- **A `403` for a member.** Rejected: one miss shape (#643), and a member learns nothing new from
  `404`.
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

- **The owner's zip must not change.** B6 (a) pins the order. `export-full-day.spec.ts` runs as the
  seeded owner.
- **The limiter fails open, as every policy does.** A Redis outage leaves the export unlimited, never
  unavailable; the breadcrumb records it.
- **An adult athlete who is a member** cannot export their own data until `ID-1` builds it; they
  can ask for the full copy. The notice says only the owner can download.
- **Rollback:** revert either PR on its own. Neither has a migration or stored state.

## Out of scope

- **"An adult member exports only their own data."** That's an `ID-1` requirement (Q1), buildable
  once a login can be linked to its own athlete.
- **The day page's bodyweight reads.** There is no change: any household member may see weigh-ins
  in the app (Q2).
- **Copy for a non-owner where the link was.** None until `INVITE-1` (Q3).
- A `guardian` role, per-athlete grants, and audit logging of exports.

## Decisions _(maintainer, 2026-11-19, relayed by the board from the orchestrator's chat)_

- **Q1: the owner gets everything; any other login is refused the export, for now.** "An adult
  member exports only their own data" is built with `ID-1`, once a login can be linked to its own
  athlete, and is recorded there as a requirement. The maintainer's words: _"They can only export
  their own data, if they are an adult, otherwise refuse unless it's the owner."_
- **Q2: no day-page change.** Any household member may see weigh-ins in the app. A product rule for
  any future feed or sharing feature: bodyweight never appears on a child's feed, and an adult may
  choose to publish their own. The maintainer's words: _"Shouldn't any member of the household be ok
  to see it? This shouldn't go on a child's feed but and adult could choose to publish."_
- **Q3: the privacy notice only, until `INVITE-1`.**
- **Q4: reword SECURITY.md:134**, as B7 writes it.

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

### Rev 4 (2026-11-19): the maintainer's decisions

PR B is rebuilt on Q1. The refusal is the whole export, so the gate moves from `bodyweightMonthRows`
to `loggedMonths` (one conjunct gates every file; B5 lists its six call sites instead of five). The
link is hidden through a `canExportAthletes` capability (B4, one UX reviewer before code). Rev 3's
member month-skip and its tests are gone. Q2 removes the day-page question, and SECURITY.md:134 is
reworded around it.
