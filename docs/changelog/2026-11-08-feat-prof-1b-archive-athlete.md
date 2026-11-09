---
id: PROF-1 b
pr: pending
---

## Archive an athlete, restore them, and a Household settings screen

An athlete can be taken off the picker without losing anything, and put back. `profiles.archived_at`
— shipped dark at `a-0` — gets its writer.

**The authority is split, and the split is the point.** The household **owner** archives; **any
member** restores (decision M1). Requiring owner authority to undo an owner's mistake is the failure
mode, not the protection: the scenario this exists for is the owner archiving the wrong kid at home,
practice starting, and the other adult needing to fix it without finding the owner.

That split is carried by **parameter types**, not by an `if` per action. `archiveProfile` takes
`OwnerScope`; `restoreProfile` takes a plain `HouseholdScope`. Forgetting the authority is a compile
error. ⚠️ And because `archiveProfile`'s predicate is `isLiveProfile ∧ isOwnerOf`, **0 rows cannot
tell "unknown id" from "not owner"** — so the distinct refusal exists only because the **DAL**
resolves, then narrows, then writes. That order lives in `lib/dal/profiles.ts` and not in the action,
for `write-path.md` invariant 3's reason: a guard that exists only in the action is one a second
caller can skip.

**`archived_at` is a list filter, never a conjunct in `isLiveProfile`** (new invariant 10). An
archived athlete still resolves, still renames, still exports, and still accepts a write already in
flight from an offline queue. What changes is which lists include them — and both lists come from
**one** query, so the tenancy predicate they share is defined exactly once.

## What the proofs cover that the last chunk's could not

`b-s` proved the owner conjunct against a **forged** scope, which is the right test for a forgery and
the wrong one for "a member of this household cannot archive". This chunk mints a **legitimate**
member scope — the actor the resolver hands every non-owner on every request — and drives the real
writers:

- the owner archives, and a **replay keeps the first date** (`COALESCE`), because the row count is 1
  either way and only the date can distinguish a double tap from a first archive;
- a member of the **same** household archives 0 rows, cast or not;
- **the same member restores**, with no cast and no narrowing;
- the other household refuses both directions;
- an archived athlete still renames and still exports.

Two new mutation patches, bringing the gate to **17**: one drops the owner conjunct from
`archiveProfile`, one adds it to `restoreProfile`. ⚠️ The second had to change the **SQL** rather than
the type — `db:mutations` runs `verify.ts` under `tsx`, where a type-only patch is erased at runtime
and the gate would have stayed green on a vacuous proof.

`scope.test.ts`'s mint guard moved from a **count** (`<= 2`) to a `Record<name, reason>`, because the
count was the thing blocking this: raising it says nothing, and spreading a forgery proves the wrong
sentence.

## The screen

Household settings lists Athletes and Archived. One row component with a `controls` prop, not two
near-copies — which is also what keeps the 360px math from being fixed in one section and missed in
the other: at 360px a single flex row of name + kind + Edit + Archive leaves **~101px for a 40-char
name**, and nothing in CI sees the result because `scrollWidth` never grows and the tap-target gate
measures height.

- **Undo** sits between the heading and the first section, always mounted, with **no dismiss timer** —
  a timer races the parent who looked up at the mat. It calls `restoreAthleteAction`, the same action
  the Restore button does, so losing the Undo line costs a scroll rather than a capability. The e2e
  covers archive → reload → Restore for exactly that reason.
- Focus is **transition-driven** (`useActionState` identity), not mount-driven, and the announcement
  lands **a frame after** the focus move: a synchronous focus change makes VoiceOver speak the focused
  element and commonly swallows a pending polite region.
- Controls use `aria-disabled`, never `disabled`, which blurs the focused button mid-request and drops
  a screen-reader user to `<body>`.
- The export control is **disabled with a stated reason** when an athlete has logged nothing
  (maintainer decision N3). Without it the route builds an EOCD-only zip that iOS Files opens as
  nothing — indistinguishable from a failed download. It is labelled from the same constant the day
  page uses, because "Download history" and "↓ Export CSV" were two names for one file.

## Telemetry, and the notice

The owner-only refusal emits a **tag-only** Sentry event (decision N2) — no name, no id, no
household id, no Clerk id. It is worth an event precisely because the UI renders no Archive control
for a member, so the path takes a crafted request: it is the clearest "someone is probing an
owner-only control" signal this app will produce. [runbooks.md](../runbooks.md) gains its triage.

The published notice now says what archive does and does not do, that an archived athlete still
exports, and that the owner archives while any member can add, rename and restore. The
[inventory](../privacy/data-inventory.md) records that `archived_at` has a writer and that it holds
**no new category of personal data** — it is a timestamp about a training state. What did change is
the set of readers of the existing name and kind: a new screen lists every athlete, to the same
audience that could already open any athlete's page.

## What a five-lens round changed, including one P0

The panel ran before screenshots and after the implementation was green on every gate. It found a
**P0** and six other things worth naming, which is the argument for the order.

🔴 **The P0: `hasEntries` was an UNCORRELATED subquery, so decision N3's control was wrong for
everyone.** Drizzle strips the table qualifier from a `Column` interpolated into a `sql` chunk in a
single-table SELECT list, so
`` sql`EXISTS (SELECT 1 FROM ${entries} WHERE ${entries.profileId} = ${profiles.id} …)` `` rendered as
`WHERE "profile_id" = "id"` — binding to **`entries.id`**. The predicate became "does any live entry
have `profile_id` equal to its own id", almost always FALSE in production, so **every** archived
athlete would have been told there was nothing to export — the exact control the notice promises.
The type was right (it really is a boolean), nothing asserted the value, and the inline form had
already been hand-copied to a second call site. It is now one `exists()`-with-nested-select helper in
`packages/db`, proved by value (a profile with a live entry, and one whose only entry is
soft-deleted), with a mutation patch that breaks the correlation. [lessons.md](../lessons.md) takes
the trap.

**The COALESCE replay proof passed by luck.** Run with the `COALESCE` removed it was green in 2 of 3
runs: the replay lands ~0.3ms later and JS `Date` carries milliseconds. The stored date is now pinned
to a fixed past value first, which `now()` cannot reproduce, and patch `18` holds it there. **19/19
RED.**

**Three UI defects a gate cannot see:**

- An archived athlete's day page rendered **"New entries are closed for this day — it's more than a
  day ago"** above the real reason, on today, because archive was folded into `writable` and the
  V1-15 notice was gated on it. False, and it promised amend controls the page no longer offers.
- The island **dropped every action error on the floor**. `enterMutation` returns `NO_ATHLETE_SAVE`
  on a lapsed session (iOS evicting a backgrounded tab) and `RATE_LIMITED` under the limiter —
  neither needs a crafted request. A parent tapped Restore and nothing happened, so they tapped
  again, which the limiter counted.
- Two new **name renderers skipped `NAME_WRAP_CLASS`** (the archived notice and the Undo result
  line), and the 360px test used the 11-character seed name, so neither was measured. The long-name
  test now archives the long-named athlete and measures both.
- `aria-disabled` on a `type="submit"` inside a `<form action>` **does not stop the native submit** —
  the mitigation was half theatre, and told a screen reader "dimmed" about a control that still
  fired. It is `onSubmit` + `preventDefault` now, in the shared button.

**Three notice-truth defects**, which matter because the notice is served: it claimed any member can
**add** an athlete (add ships at `a-1`), that "the app" refuses an empty export when only `/settings`
did (the day page now does too), and that an archived athlete's page "opens for anyone who has the
link" without saying _in your household_.

**And the reuse rule caught me twice.** `EXPORT_CSV_LABEL` was added for "one definition, two
surfaces" while the day page still hard-coded the string; and the island re-implemented
`useOnActionSuccess`'s body twice — a hook whose own docblock says it exists _because_ the idiom had
been copy-pasted four times. Both fixed, along with one shared button for the two id-only forms and
one `UNDO_LABEL`.

🔴 **One thing the refusal order needed that no suite had.** `archiveAthlete` resolves, then narrows,
then writes; swap the first two and a member gets the distinct `OWNER_ONLY_ATHLETE` for a _foreign_
or _non-existent_ id, which is an existence oracle. `db:verify` drives the writer, not the order; the
action tests mock the DAL wholesale. `lib/dal/profiles-authority.test.ts` now pins the order by which
refusal comes back and whether the writer and the telemetry were reached — and pins the refusal
event's payload to two tags and nothing else, which was prose until now.

The event is also **bounded per principal** now rather than "unbounded, deliberately". The limiter
allows ~24 archives/min, so one hostile member produces ~34,500 events a day — past a 5k monthly
quota in about three hours, and when it is gone `cross_household` is dropped too. That is the same
failure the capped `no_scope` event exists to prevent.
