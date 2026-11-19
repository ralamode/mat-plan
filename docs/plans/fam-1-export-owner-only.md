# FAM-1 export follow-up: the bodyweight file for the owner only, and a rate limit on the export

_Lane E, 2026-11-19. One PR, one route. Draft: no code is committed before this plan is approved._

## Where this sits

- **Pillar:** the export (lane E owns it, FAM-1 step 14).
- **Milestone:** [FAM-1](../milestones/family-program.md). This is one of two follow-ups the maintainer
  decided at step 14's questions ([fam-1-14-export.md](./fam-1-14-export.md) → "Questions for the
  maintainer", 2026-11-17). The other is formula-injection escaping, which shipped at 14b.
- **Next:** nothing is gated on it.
- _Roadmap alignment (2026-11-19):_ answers `.github/SECURITY.md` → Sensitive data for the export
  only. It closes the export half of [tech-debt](../tech-debt.md) → "The zip export is not
  rate-limited". `ID-1`'s six keep-open items are answered in the log below. Checked against the
  private roadmap; nothing to add here.

## Acceptance

Copied from the decision (fam-1-14-export.md, 2026-11-17): _"Bodyweight download, operator only. The
code is made to match `.github/SECURITY.md:134`, with a boundary test that a non-operator member is
refused. The privacy lens reviews it, and the inventory and notice change in the same PR."_ The board
added the rate limit to the same PR (2026-11-18): the route imports no limiter.

Done when:

1. The household **owner** downloads exactly today's zip, byte for byte.
2. A **member** downloads the zip with no bodyweight file in any month. The bodyweight query never
   runs for them, and the type system stops it from being called without an owner scope.
3. A principal past the export limit gets `429`, `no-store`, and no DB read runs. The limiter is
   keyed on the Clerk principal, after the session check. An unauthenticated caller gets the same
   byte-identical `404` as today and costs no Redis.
4. The tech-debt row is corrected and the export half marked paid. `AGENTS.md`'s "NOT wired: export
   limit" is removed, and SECURITY.md, the inventory and the notice say what the code does.

## Facts this plan rests on (read from `origin/main`)

- "Operator" is the role `owner`: `HOUSEHOLD_ROLES = ['owner','member']` (`packages/shared/src/enums.ts:63`).
  SECURITY.md:9 has one adult operator owning each household. Members exist today only through an
  operator correction (`corrections/registry.ts:828`, `:935`); no screen invites one.
- There is already an owner-only pattern: `ownerScope(scope)` narrows `HouseholdScope` to `OwnerScope`
  or returns `null` (`packages/db/src/scope.ts:105`). `archiveAthlete` uses it
  (`apps/web/lib/dal/profiles.ts:369`), and `reportAuthorityRefusal` records the refusal.
- The zip is built in one place: `buildExportEntries` (`apps/web/lib/dal/export.ts:81`) pushes three
  files a month. `bodyweightMonthRows(db, { profilePublicId, month, scope })` is the only bodyweight
  read (`packages/db/src/queries/export-month.ts:342`).
- The route (`apps/web/app/p/[profileId]/export/route.ts`) checks the session, then the profile, and
  has no limiter. `checkMutationLimit(userId, policy)` takes a closed set of policies
  (`apps/web/lib/rate-limit.ts:203`, the `MutationLimitPolicy` type) and fails open. Its docblock and
  `pages-need-a-session.test.ts` say its one caller is `enterMutation`.

## File-by-file

1. **`packages/db/src/queries/export-month.ts`** (EDIT): `bodyweightMonthRows`'s `scope` becomes
   `OwnerScope`. A member's scope does not typecheck there, so a later caller cannot forget the check.
   This is the type-level half of acceptance 2. `strengthMonthRows` and `checkinMonthRows` keep
   `HouseholdScope`.
2. **`apps/web/lib/dal/export.ts`** (EDIT): `const owner = ownerScope(scope)` once, before the month
   loop. With an owner, the zip is unchanged. Without one, the bodyweight query is skipped and the
   month pushes two files. No refusal is reported: a member asking for the export is not refused, the
   file is just not theirs to receive.
3. **`apps/web/lib/rate-limit.ts`** (EDIT):
   - add `EXPORT_RATE_LIMIT = { attempts: 10, window: '10 m' }`, its limiter instance and its branch
     in `limiterFor`, and add it to the policy union;
   - correct the docblock's "one caller", and remove the ⏳ line at :32.
   - Sizing: a parent exporting every athlete of a three-athlete household twice is six. Ten in ten
     minutes refuses only a loop.
4. **`apps/web/app/p/[profileId]/export/route.ts`** (EDIT):
   - after `sessionUserOrNull()` and before `getProfileByPublicId`, call
     `checkMutationLimit(user.id, EXPORT_RATE_LIMIT)`;
   - when refused, return `429` with `NO_STORE` and `retry-after: 600`, and no body that names the
     profile.
   - Order: unauthenticated → `404` (no Redis), limited → `429`, then today's checks. A limited caller
     learns nothing about the profile id, because the limit is checked before the profile is read.
5. **`apps/web/lib/route-miss.ts`** (EDIT): add `tooManyRequests(retryAfterSeconds)` beside
   `notFound()`, so the export's two refusals share one module.
6. **Guard: `apps/web/…/pages-need-a-session.test.ts`** (EDIT): allow `checkMutationLimit` in exactly
   one more module, the export route, and require it after the session check there, as the guard
   does for `enterMutation`.
7. **Tests:**
   - `apps/web/lib/dal/export-prescribed.test.ts`, or a sibling `export-owner.test.ts`:
     - (a) the owner scope gets three files a month and calls `bodyweightMonthRows`;
     - (b) a member scope gets two files a month, no path matching `bodyweightPath`, and
       `bodyweightMonthRows` is never called;
     - (c) a null scope gets `[]`, as today.
   - `export/route.test.ts` (EDIT, the #643 file):
     - (d) limited → `429` + `no-store`, and `getProfileByPublicId` and `buildExportZip` are not
       called;
     - (e) signed out → `404`, and the limiter is not called;
     - (f) allowed → today's response.
   - `rate-limit.test.ts`: the export instance drains at 10, as the file does for each policy.
   - There's no `db:verify` proof or mutation. The narrowing is a type and a DAL branch, and (b) is the
     boundary test the decision asks for. That's why lane E needs no new mutation block.
8. **Docs, same PR:**
   - `.github/SECURITY.md` → Sensitive data: the export half is enforced (owner scope). Say plainly
     that the day page still shows a weigh-in to any member (see Out of scope).
   - [data-inventory.md](../privacy/data-inventory.md): the bodyweight file's recipient is the owner.
   - [notice.md](../privacy/notice.md) "Getting your data out": the bodyweight log is in the export for
     the household owner only. Bump "Last updated" and regenerate `notice-content.ts`.
   - [tech-debt.md](../tech-debt.md): correct the row's "1c-4 PR 4" pointer, and mark the export half
     paid.
   - `AGENTS.md` backend rule 7: drop "export limit" from "NOT wired".
   - `docs/features/write-path.md` invariant 16: one line saying the bodyweight file needs an owner
     scope.
   - Plus a changelog fragment.

## Alternatives considered

- **Refuse the whole export to a member (`404`).** Rejected (recommended against; a maintainer
  question). The member would lose the athlete's training history, which nothing marks privileged,
  to keep back one file.
- **Write a header-only bodyweight file for a member.** Rejected. An empty file reads as "no
  weigh-ins", which is false, and a member could act on it.
- **Check the role in the route, not the DAL.** Rejected. AGENTS.md puts authorization in the DAL, and
  the `OwnerScope` parameter makes the query itself refuse a member scope at compile time.
- **A limiter keyed on the profile id.** Rejected. That's tech-debt's own argument: the id is
  caller-supplied, and a fresh UUID gets a fresh bucket.
- **Reuse `MUTATION_RATE_LIMIT`.** Rejected. 120 per 5 minutes doesn't bound the app's most expensive
  request, and sharing a bucket would let exports eat a parent's ✓ budget.

## Risks / rollback

- **The owner's zip must not change.** Test (a) and the existing e2e `export-full-day.spec.ts` cover
  it; the seeded e2e principal is the owner.
- **A member made by correction loses a file they could download yesterday.** That is the decision.
  The notice says so.
- **The limiter fails open, as every policy does.** A Redis outage leaves the export unlimited, never
  unavailable.
- **Rollback:** revert the PR. There is no migration and no stored state.

## Out of scope

- **The day page still shows a weigh-in, and the "Last time" hint, to any member.** SECURITY.md:134
  says "never returned outside the household operator", and the export is only one of the reads. The
  others (`loggedBodyweight`, `lastBodyweightBefore`, the bodyweight amend and clear) are a separate
  decision with UI consequences: what does a member see on the day page? That's a question for the
  maintainer, not for this PR.
- A `guardian` role, per-athlete permissions, and audit logging of exports.

## Questions for the maintainer

- **Q1:** a member's export leaves out the bodyweight file (recommended), or refuses the whole zip?
- **Q2:** the day page's bodyweight reads for a member: a backlog row now, or after Beta 0, when
  invites exist?

## Review-response log

_(panel pending)_
