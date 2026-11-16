# V1-24 PR 3b — the new day page: Bodyweight and Life, entered once and then changed

> Backlog: [plan.md](../plan.md) → V1-24 (PR 3b). Spec:
> [crud-1-fix-it-yourself.md](../specs/crud-1-fix-it-yourself.md) **criterion 48**, **M26**.
> Parent: [v1-24-form-is-the-day.md](./v1-24-form-is-the-day.md) (its 2026-11-15 note). Sibling:
> [V1-9b](./v1-9b-delete-and-restore.md) B2 (its 2026-11-15 Amendment). Milestones:
> [CRUD-1](../milestones/crud-1-fix-it-yourself.md) track E, and
> [FAM-1](../milestones/fam-1-family-program.md), whose plan schedules this as lane S (its step 12c builds on this page). **Accepted
> prototype:** Beta 0's **v11** (v10 of #411 plus this PR's read-only older days) at [`docs/prototypes/beta-0/`](../prototypes/beta-0/index.html) (#411,
> 2026-11-15). This is **Beta 0**.
>
> **Branches:** 3b-0 `db/v1-24-3b-0-practice-one-per-day` · 3b-page `feat/v1-24-3b-page-old-forms-leave` ·
> 3b-bw `feat/v1-24-3b-bw-check-to-log` · 3b-life `feat/v1-24-3b-life-practice-minutes`.

> ⚠️ **Scheduling, 2026-11-15:** this plan's four PRs run as **lane S** of the
> [FAM-1 plan](./fam-1-family-program.md) (§5 "Lane S", §6, §7). Where this plan says a PR waits on
> nothing or that either order works, the gates and shared-file order there win: 3b-page after
> FAM-1's 0b; 3b-0 in the one migration queue, after FAM-1's step 5; database proofs in
> `verify/single-values.ts`; a day after today is read-only too (FAM-1 D32).

## Why this plan changed (2026-11-15)

The first version (2026-11-13, panelled, never merged) kept the old Check-ins and Strength forms and
moved every entry into a section beside them. The maintainer then re-scoped Beta 0 against the
accepted prototype, in two rounds on 2026-11-15:

| Decision (maintainer, 2026-11-15)                                                                                                                                            | Effect here                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **The new day page on every day.** No old Check-ins or Strength forms                                                                                                        | They leave the page now (3b-page); confirmed when asked, see "The cost"               |
| **Single-value entries are edit-only.** Bodyweight, wrestling practice, any one-line Life field: enter once, then Change. No Delete, Undo or tomb. Change to blank clears it | Bodyweight gains blank-to-clear (3b-bw); practice gets the same shape (3b-0, 3b-life) |
| **Practice is a minutes field, empty** unless a program's author set a default                                                                                               | The one-tap 90-minute button goes (3b-life)                                           |
| **Old entries are out of scope until FAM-1 is done.** No read-only past rows, no own-name sections                                                                           | The first version's router, own-name sections and partition proof are **dropped**     |
| **Copy, focus and button style follow the prototype**                                                                                                                        | The copy below is v10's                                                               |

So **V1-24 2a is cut** (no Check-ins section remains) and 2b was already FAM-1 13b; the PR 2 plan is
withdrawn. **V1-9b B1-3 is cut** (its Delete covered Life and past entries, and both are gone); B2,
clear a day, stays.

**Criterion 48, honestly.** Its "the area you log in is the source of truth, no second list" holds:
the list goes. Its "no entry vanishes" **does not** hold until FAM-1 is done: a check-in or strength
session logged before 3b-page is still stored (strength is in the CSV export; check-ins never were,
`apps/web/lib/dal/export.ts:198` writes that file header-only _(corrected 2026-11-15, #418)_), but no longer shown on the day
page. That is the maintainer's "old entries are out of scope" decision, stated here so a reviewer does
not take the gap for a bug.

## The day page after 3b

For an athlete with no program (every athlete until FAM-1 step 15):

1. **Bodyweight.** Unlogged on a writable day: `Last time 72.5 lb` (the athlete's latest earlier
   weigh-in, if any), an `lb` field and a **✓** button (`aria-label="Log bodyweight"`). Logged: `✓ 72.5
lb · 7:02 AM` and **Change**. Change opens the field with **Cancel** and **Save**; saving a blank
   field clears the weigh-in. One per day (migration 0012, unchanged).
2. **Life.** Wrestling practice: the same shape, with an empty `min` field and ✓; logged reads
   `✓ Wrestling practice · 45 min` and Change. **No Wake on any day.**
3. **Clear this day…** at the foot of the page when anything is logged (V1-9b B2).

FAM-1 step 12c later adds the program's workouts **after** Life, as the prototype shows _(corrected 2026-11-15; was "between Bodyweight and Life")_.

## Staging

| PR          | What                                                                                                                                                                                                       | ~lines           | Waits on                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ------------------------------ |
| **3b-0**    | **One practice per day, enforced by the database**: the prod read for duplicates, then a migration, a partial unique index on the practice metric per (profile, day), live rows only, in the shape of 0012 | ~150             | the read returns no duplicates |
| **3b-page** | **The old forms leave the page**: the Check-ins sections, the Strength section, the "Logged entries" list and the "Calisthenics today" card                                                                | ~120 + deletions | nothing                        |
| **3b-bw**   | **Bodyweight to the prototype**: ✓ instead of a Log button, the "Last time" hint, Cancel/Save on Change, blank clears                                                                                      | ~200             | nothing; serial with 3b-page   |
| **3b-life** | **Practice minutes, entered once then changed**; Wake removed                                                                                                                                              | ~300             | 3b-0, 3b-bw (reuses its row)   |

3b-0 is its own PR because a migration never shares a review with UI (AGENTS.md). It takes the next
migration number at merge, so it sits in the same queue as FAM-1's 3 → 4a → 4b → 5; it is expand-only
and touches no FAM-1 table, so either order works.

**The cost, stated plainly.** From 3b-page until FAM-1 slices 1 and 3, nobody can log a check-in or a
strength session in the app; bodyweight and practice still log. FAM-1 already keeps the household off
the new page until slice 3, so nobody loses a habit _(maintainer, 2026-11-15, asked and confirmed)_.

## Decisions

**D1 — 3b-page removes; it does not reroute.** `page.tsx` stops rendering the Check-ins sections,
`StrengthSection` (form, program card, receipts with Change), `LifeForm`'s Wake, the list
(`page.tsx:378-444`) and the card (`:352-374`), with the derivations only they used.

- **The removed components stay in the tree, unmounted**, until FAM-1 12f deletes them (strength returns on the new page at 12d and 13b)
  (the PICK-1 PR 3 precedent, `docs/features/movement-picker.md`). [tech-debt.md](../tech-debt.md) gets
  one row naming them, with **FAM-1 12f as its expiry** _(corrected 2026-11-15; was 13b)_. PICK-1 PR 4, which mounts into the strength
  form, waits for FAM-1 13b's surface instead.
- **Their Server Actions stay**, tested in Vitest, though nothing on the page posts to them. Wake is the
  exception (D3), because its section is the one this plan rebuilds.
- **Days before yesterday are read-only** _(maintainer, 2026-11-15)_. Only today and yesterday (the
  existing writable window, `apps/web/lib/entries/declared-day.ts:26`) can be logged, changed or
  cleared. On an older day the page shows what was logged as text: no ✓, no Change, no field, no
  **Clear this day…**. `CLOSED_DAY_NOTICE` becomes v11's _"This day is read-only. Only today and
  yesterday can be logged or changed."_ This **supersedes V1-24 1b's "a logged weight is correctable on
  every day including closed ones"**: a weigh-in found wrong a week later stays as logged, or is fixed
  with a correction (`db:correct`), as before 1b.
- **Guides:** `strength-logging.md` and `programming.md` (its Today lines) say the form and the program
  card are off the page until FAM-1 12d and 13b. Neither owns `page.tsx`, so the PR names them rather than
  relying on `guides:check`.

**D2 — Bodyweight (3b-bw).** The create form and the amend exist (V1-24 1a–1e); this matches them to
v10.

- **✓ replaces Log**: a `button` with `aria-label="Log bodyweight"`, the existing ≥44px target.
- **`Last time 72.5 lb`**: the profile's latest live weigh-in **before** the viewed day, read in the DAL
  with the day's entries (one more indexed query on `(profile_id, day)`). Omitted when there is none.
- **Change → Cancel / Save**, on today and yesterday only. `editBodyweightAction` gains the
  writable-window bound the create path has (`resolveDeclaredDay`, read from the row's day), so a
  crafted POST cannot change an older day; a boundary test proves it. Saving a **blank** field clears the weigh-in, through a new pinned
  writer, `clearSingleValue` in `packages/db/src/writers/`, **not** a bare `hideEntries` call (which
  hides any owned entry on the day, with no metric pin or stale check, `hide.ts:83-96`). It refuses
  unless the row carries the expected metric and still holds the value the form showed (a row already hidden is a replay unless the day's slot is held again: 3b-bw W9)
  (`seenValue`, the amend's guard, `bodyweight.ts:27-52`); it reads the day from the row, so the form
  posts no day. It writes one hide with no reason. `editBodyweightSchema` (`packages/shared/src/bodyweight.ts:131-137`)
  accepts a blank as "clear". No tomb renders and no Undo exists: the empty field returns, so
  re-entering is the recovery.
- **A fresh `client_id` per unlogged mount.** The create row mints its id when it mounts and is
  unmounted while a value shows (today's `form-${day}` key), so re-entering after a clear never replays
  the hidden row's id (no `own_hidden`) and 0012, being live-only, does not count the hidden row.
- **Copy (v10/v11):** errors `Enter your bodyweight, then ✓.` and the existing
  `IMPLAUSIBLE_BODYWEIGHT_MESSAGE`; announcements `Bodyweight logged`, `Bodyweight changed to 72.5 lb`,
  `Bodyweight cleared`. **Focus:** after Save, on Change; after a clear, on the field.
- ⚠️ **The range stays `BODYWEIGHT_BOUNDS`** (20–500 lb, `packages/shared/src/bodyweight.ts:35-38`).
  v12 checks the same 20–500 _(corrected 2026-11-15; this said 40–400)_; the shared bound's copy wins over v12's.

**D3 — Practice (3b-0, 3b-life).**

- **The shape is D2's**: an empty `min` field (`inputmode="numeric"`,
  `aria-label="Wrestling practice minutes"`) and ✓; logged, `✓ Wrestling practice · 45 min` and Change;
  blank clears.
- **One per day, enforced by the index (3b-0)**, so a second phone's ✓ gets a typed "already logged",
  never a second row whose sum would double the day. That takes two writer changes in 3b-0, beside the
  index: the practice insert becomes target-less `ON CONFLICT DO NOTHING` with a `dayTaken` result
  (`insertBodyweightEntry`'s pattern; today `checkin.ts:89-92` arbitrates on `client_id` only, so the
  index alone would surface a bare 23505); and `hideEntries`' restore generalises its slot check and
  its 23505 catch from the bodyweight index alone (`hide.ts:280-284, :345`) to both, so a Restore all
  after a clear and a re-entered practice refuses that item instead of throwing.
- **The action:** `logLifeActivitiesAction` takes `minutes`, zod-validated as a whole number from 1 to a
  new `PRACTICE_MINUTES_MAX` (300, the prototype's) in `packages/shared` beside the metric. The existing
  `MAX_QUANTITY_BY_UNIT.min` of 1440 is a unit cap, not a typo guard. Errors (v10/v11): `Enter the minutes,
then ✓.` / `Enter whole minutes, 1 to 300.` `DEFAULT_PRACTICE_MINUTES`
  (`apps/web/lib/life/life-activities.ts:32`) is deleted.
- **An amend**, `editPracticeAction`, beside `editBodyweightAction`, through a writer in
  `packages/db/src/writers/` that pins the row to the practice metric (bodyweight's pattern). Blank →
  D2's `clearSingleValue`, pinned to the practice metric.
- **Wake leaves the action's trusted set**, so a crafted POST cannot log one; the Wake arm is deleted.
  `life:wake` stays in the routine catalog until FAM-1 replaces the routine. Old Wake entries are old
  entries: not shown.
- **Announcements and focus** (v10/v11): `Wrestling practice logged`, `…changed to 45 min`, `…cleared`;
  focus on Change after a log or a save, on the field after a clear. The field unmounts on a log, so a
  `role="status"` region mounted in both states carries the message (round 1's UX-B2).
- **Retired:** `SAVED_STATE_COPY.lifeLogged` ("· logged today").

## The e2e cost

No e2e can seed an entry except through a form, so the tests of the removed forms are **deleted**, not
re-pointed. Each deletion is named in the PR with the coverage that remains.

| Spec                                                                                                                                                                     | 3b-page                                                         | Remains                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `scaffold-submit.spec.ts` (4 tests)                                                                                                                                      | deleted                                                         | the strength writer's `db:verify` and `actions.test.ts`; FAM-1 12d brings an e2e back                                |
| `log-bodyweight.spec.ts`: the check-in, calisthenics and re-submit tests                                                                                                 | deleted                                                         | the check-in writer's `db:verify` (#385)                                                                             |
| `a11y.spec.ts`: the five strength-form and program-card tests (`:302`, `:330`, `:472`, `:524`, `:601`) and the scaffolded block with its time-zone constant (`:656-733`) | deleted; the weigh-in test (`:395`) and the Today route stay    | axe and tap targets on today; axe and 360px on yesterday's weigh-in. A day before yesterday has no e2e (see 3b-page) |
| `export-full-day.spec.ts`                                                                                                                                                | logs bodyweight and practice **through the page**, then exports | still the one test whose input the app produced; strength export stays in Vitest                                     |
| `global.setup.ts`                                                                                                                                                        | warms the bodyweight path on its own (profile, day), retry-safe | —                                                                                                                    |
| `day-navigation.spec.ts`                                                                                                                                                 | asserts Bodyweight instead of `strengthSection`                 | —                                                                                                                    |
| `day-nav-form-state.spec.ts` (the day-role select, `openStrengthForm`)                                                                                                   | deleted with the strength form                                  | FAM-1 13b                                                                                                            |

3b-bw and 3b-life each add their row's e2e: log with ✓, Change, blank-clear **then re-enter**, the announcement and focus.

## File-by-file

**3b-0**

| Path                                                      | Change   | What & why                                                                                                                                  |
| --------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/db/scripts/` (the V1-24 1c prod-read precedent) | NEW      | Count live practice rows per (profile, day) with more than one. Aggregate only; committed in the PR.                                        |
| `packages/db/src/schema.ts`, the generated migration      | EDIT/NEW | The partial unique index, hardened per AGENTS.md (timeouts, `IF NOT EXISTS`, concurrent build).                                             |
| `packages/db/src/writers/checkin.ts`, `hide.ts`           | EDIT     | D3: the practice insert's `dayTaken`; restore's slot check and catch cover the practice index.                                              |
| `packages/db/scripts/verify.ts`                           | EDIT     | A second live practice on one day is refused, typed; a hidden one is not counted; Restore all into a re-entered practice refuses that item. |
| `docs/features/write-path.md`, `docs/architecture.md`     | EDIT     | The new arbiter.                                                                                                                            |

**3b-page**

| Path                                                         | Change   | What & why                                                             |
| ------------------------------------------------------------ | -------- | ---------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/page.tsx`                        | EDIT     | D1.                                                                    |
| `apps/web/app/p/[profileId]/life-section.tsx` (+ test)       | NEW      | P2, P3, P4, P8.                                                        |
| `apps/web/app/p/[profileId]/life-form.tsx` (+ test)          | EDIT     | The unlogged button only; the logged line moves to the section.        |
| `apps/web/app/p/[profileId]/bodyweight-section.tsx` (+ test) | EDIT     | P1.                                                                    |
| `apps/web/lib/constants.ts`                                  | EDIT     | `CLOSED_DAY_NOTICE`; the practice row's copy.                          |
| `apps/web/e2e/*`, including `steps.ts`                       | EDIT/DEL | The table; the kept helpers assert in their own section, not the list. |
| `docs/features/strength-logging.md`, `programming.md`        | EDIT     | D1.                                                                    |
| `docs/tech-debt.md`                                          | EDIT     | The unmounted components, expiring at FAM-1 12f.                       |

**3b-bw**

| Path                                                                               | Change | What & why                                                                                  |
| ---------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `apps/web/app/p/[profileId]/bodyweight-form.tsx`, `bodyweight-amend.tsx` (+ tests) | EDIT   | D2.                                                                                         |
| `apps/web/app/p/[profileId]/actions.ts` (+ tests)                                  | EDIT   | Blank → `clearSingleValue` in `editBodyweightAction`.                                       |
| `packages/db/src/writers/` (+ `db:verify`)                                         | NEW    | `clearSingleValue`: live, metric-pinned, `seenValue`; refuses a strength or check-in entry. |
| `packages/shared/src/bodyweight.ts`                                                | EDIT   | `editBodyweightSchema` accepts a blank as a clear.                                          |
| `apps/web/e2e/bodyweight-receipt.spec.ts`, `steps.ts`                              | EDIT   | `Log weight` → the ✓ button; clear, then re-enter.                                          |
| `apps/web/lib/dal/entries.ts`                                                      | EDIT   | The "last time" read.                                                                       |
| `apps/web/lib/constants.ts`                                                        | EDIT   | v11's copy.                                                                                 |
| `docs/features/write-path.md`, `delete-and-restore.md`                             | EDIT   | A blank amend is a hide.                                                                    |

**3b-life**

| Path                                                      | Change | What & why                                     |
| --------------------------------------------------------- | ------ | ---------------------------------------------- |
| `apps/web/app/p/[profileId]/life-form.tsx` (+ test)       | EDIT   | D3, reusing 3b-bw's row.                       |
| `apps/web/app/p/[profileId]/actions.ts` (+ tests)         | EDIT   | `minutes`; Wake refused; `editPracticeAction`. |
| `packages/db/src/writers/` (+ `db:verify`)                | NEW    | The practice amend writer.                     |
| `packages/shared`, `apps/web/lib/life/life-activities.ts` | EDIT   | `PRACTICE_MINUTES_MAX`; delete the default.    |
| `apps/web/lib/constants.ts`                               | EDIT   | v11's copy; delete `SAVED_STATE_COPY`.         |
| `docs/features/write-path.md`                             | EDIT   | The life action's new shape.                   |

Each PR also carries `docs/plan.md`, the milestone chart and a changelog fragment.

## Acceptance

1. **3b-page:** no day shows a Check-ins form, a Strength section, a "Logged entries" list or a
   "Calisthenics today" card.
2. **3b-bw:** bodyweight logs with ✓; Change saves a new value; saving a blank clears it and shows the
   empty field, with no tomb; each is announced and focus lands as D2 says.
3. **3b-0:** the database refuses a second live practice on one day.
4. **3b-life:** practice logs the minutes typed into an empty field; Change and blank-clear behave as
   bodyweight's; no day shows Wake; a POST with `activityKey=wake`, or with minutes missing, 0, 301 or
   45.5, is refused.
5. A day before yesterday shows no ✓, Change, field or Clear, and the server refuses a log, a change or
   a clear of bodyweight or practice there. ⚠️ Not strength: `editStrengthSetAction` keeps no day bound
   until FAM-1 12f deletes it, and nothing on the page posts to it _(scoped 2026-11-15, #418)_.
6. axe and the tap-target scan pass on today; axe and the 360px overflow scan pass on yesterday's
   weigh-in. The read-only day's states pass their
   component tests (no e2e reaches it; see 3b-page).

## Test plan

- **Boundary tests** (AGENTS.md → Backend) for the life action and `editPracticeAction`:
  unauthenticated, wrong owner, bad body, **and a day before yesterday** (also for
  `editBodyweightAction`). **Each starts from one valid body with minutes**, so each
  fails on its own guard and not on zod. Plus 1, 300, 301 and 45.5, and a same-`client_id` replay that
  produces one row.
- **`db:verify`:** the index and the typed `dayTaken` (3b-0); Restore all into a re-entered practice refuses that item; the practice amend pins its metric; `clearSingleValue` (3b-bw's `clearBodyweight`) refuses a wrong metric and a stale `seenValue`, treats a hidden row as 3b-bw W9 says, and changes exactly one row.
- **Playwright:** `pnpm e2e:local` on every PR.
- **360px:** the logged row is `✓ Wrestling practice · 45 min` plus Change (~64px) in a 294px card, so
  the label wraps before the button does; the field row is label, a 72px field, `min` and a 44px ✓.
  Each PR measures on the real page and puts the numbers in the PR.
- **Screenshots** at 390, 820 and 1280px, beside the prototype's day page.

## Risks / rollback

| Risk                                        | Mitigation                                                                                                                                                    |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prod already holds two practices on one day | 3b-0's read runs first, and again just before merge (the 1d precedent); a duplicate needs a correction                                                        |
| A deleted e2e leaves a flow untested        | The table names what remains; `hold-the-bar` reviews the list                                                                                                 |
| An earlier entry looks lost                 | It is stored (strength is also exported; check-ins are not); the plan and the changelog say it is not shown until FAM-1                                       |
| A wrong value on a read-only day            | No in-app route; a correction (`db:correct`) fixes it. Acceptable for one household; the tech-debt row revisits it before FAM-1 slice 3 or a second household |
| Rollback                                    | 3b-0 is forward-only (the index stays, harmless). The UI PRs revert on their own; no data changes                                                             |

## Out of scope

- Showing earlier entries, and deleting them: after FAM-1 (the maintainer's decision).
- Clear a day: V1-9b B2.
- The program's workouts, row-completed logging and per-row edit: FAM-1 12, 13 and 13b.
- A practice default from the program: FAM-1, when a program can prescribe a life item.

## Prototype-fidelity check (2026-11-15, against v11)

| v11                                                                                                                             | This plan                          |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Bodyweight: "Last time" hint, field, ✓; logged row with time and Change; Cancel/Save; blank clears                              | Same (D2)                          |
| Bodyweight range 20–500 lb _(corrected 2026-11-15; this said 40–400)_                                                           | Same; the shared bound's copy wins |
| Practice: empty field, ✓, Change, blank clears; 1–300 whole minutes                                                             | Same (D3)                          |
| No Wake; no Check-ins or Strength section; no past rows                                                                         | Same                               |
| Older days read-only: no ✓, Change, field or Clear; "This day is read-only. Only today and yesterday can be logged or changed." | Same (D1)                          |
| Announcements and focus targets for log, change and clear                                                                       | Same                               |

Cases v11 does not show, for its next round: two phones logging practice on one day (3b-0's typed
refusal) and that refusal's copy.

## 3b-page: what the slice settles (2026-11-15)

D1 names what leaves the page. Building it raised points D1 does not decide. Each is settled here,
after the UX panel's round (first in the log below). "Writable" is the page's existing flag: today
or yesterday, and the athlete is not archived (`page.tsx:107-108`).

| #   | Question                                           | 3b-page does                                                                                                                                                                                                                                                                                                                                     |
| --- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P1  | Bodyweight on a day before yesterday               | **Change** follows the day, not `writable`: shown on today and yesterday, gone before that (`bodyweight-section.tsx:66-93` passes it on every day today). An archived athlete keeps Change on today and yesterday, as on `main`. The server-side bound is 3b-bw's (D2); until it merges a crafted POST to an older day is accepted, as on `main` |
| P2  | A logged practice, on every day                    | One row per practice, in a list: `Wrestling practice · 90 min`, in the bodyweight receipt's bordered row. It replaces `· logged today`, which named the wrong day on yesterday and hid the 90 minutes the one-tap button writes. 3b-life adds the ✓ and Change to this row                                                                       |
| P3  | Life with nothing logged                           | Writable: the existing one-tap **Wrestling practice** button (3b-life replaces it). Not writable: `Nothing logged.` (v11)                                                                                                                                                                                                                        |
| P4  | Wake                                               | The Life section never renders Wake, as a button or as a row (D1). A routine whose only life item is Wake, or with no life item (the default routine), shows no Life section. The action still accepts Wake until 3b-life (D3)                                                                                                                   |
| P5  | The day-role label beside the date (`Strength B`)  | Removed with the program card it described (`page.tsx:227-233`). `DayNav`'s prop is optional and stays for FAM-1. The page no longer reads the program (`getProgramDay`, `householdProgramsAnything`); FAM-1 12c listed both, and the roadmap thread updated it (#418)                                                                           |
| P6  | The empty state and `This week`                    | `No entries logged today.` goes with the list. `WeeklyAdherence` stays: it is not one of D1's removals, and it renders nothing until its schedule is seeded                                                                                                                                                                                      |
| P7  | The read-only notice on an archived athlete's page | Not shown: "today and yesterday can be logged" is false there, and the archived notice already says why and where to restore                                                                                                                                                                                                                     |
| P8  | Announcement and focus after logging a practice    | The section mounts the existing `SavedAnnouncer` in both states: it announces `Wrestling practice logged` and moves focus to the new row, which the unmounting button used to drop to `<body>` (round 1's UX-B2, brought forward because the list no longer shows the log)                                                                       |

**One Life section** in a new server component, `life-section.tsx`, beside `bodyweight-section.tsx`,
replaces the per-block loop (`page.tsx:297-361`): with the Strength and Check-ins blocks gone there
is nothing left to interleave, and `page.tsx` is an async Server Component that Vitest cannot render.

**What scans the read-only day.** No e2e reaches a day before yesterday: profiles are seeded today,
and `resolveViewedDay` floors `?d=` into the writable window (`day-navigation.spec.ts:52-55`). So the
read-only states (bodyweight without Change, the practice rows, `Nothing logged.`) are covered by
component tests, and the read-only weigh-in by screenshots from the backdated screenshot fixture
(which seeds weigh-ins only), **not** by axe or the 360px overflow scan. The backdated e2e fixture that would close this is the open follow-up on the
V1-24 row in [plan.md](../plan.md).

## 3b-bw: what the slice settles (2026-11-15)

D2 says what Bodyweight becomes. These are the points it leaves open, settled before code and put to
the UX panel and a correctness lens (the log below). The reference is **v12** (`renderBodyweight`,
`docs/prototypes/beta-0/index.html:1652-1700`; its handlers, `:3536-3560`). "Writable" and
"amendable" are `dayPageFlags`' (`apps/web/lib/entries/declared-day.ts:56`).

| #   | Question                                          | 3b-bw does (rev 2, after the panel)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| W1  | The unlogged row, at 360px                        | `Last time 72.5 lb` is its **own muted line** under the heading, plain text (never a placeholder, never tappable, never a prefill). It gains the day when it is not the day before: the weekday 2–6 days back (`Last time 72.5 lb · Tue`), the date from 7 (`· Nov 3`), formatted from the day string, never `new Date(day)` in local time. Then **one row that cannot wrap**: the field's wrapper `min-w-[72px] flex-1`, the input `w-full min-w-0`, the unit select, a ✓ `size="icon-lg"`; the row has no `flex-wrap`, so a regression is horizontal overflow, which `a11y.spec.ts` catches. Measured (Chromium, 328px of content): field 200, select 60, ✓ 44. Without the min-width the input's intrinsic width (~256px) wraps the ✓, invisibly to every gate. The field is **described by** the hint and the error together (`aria-describedby` lists whichever ids are present); ids come from `useId()`, since 3b-life puts a second row on the page. The visible `Weight` and `Unit` labels stay                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| W2  | The unit select                                   | **Stays**, now starting on the **last weigh-in's unit** (W10 reads it), else `lb`: a kg athlete no longer sees `Last time 38 kg` over an `lb` select. Removing it is the maintainer's question (`## Needs a decision` in the PR); the last prod read found no kg rows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| W3  | Input and an empty ✓                              | Both fields become **`type="text" inputMode="decimal"`** (v12's markup) with no `required`, `step` or `min`, so no browser bubble ever stands in for the copy and unparseable text reaches zod instead of reading as blank. Before coercing, one `,` becomes `.` (a comma-decimal phone region) and the string must match `^\d+(\.\d+)?$`, so `1e2` and `0x50` are refused rather than coerced. An empty ✓ is refused **in the submit handler**, synchronously: `Enter your bodyweight, then ✓.` under the field, and focus on the field on the same tap, so the keypad opens. After an async result (a clear, a refusal), focus is outside a user gesture and iOS may not open the keypad; the plan claims focus there, not the keypad. In the alert the glyph is `aria-hidden` beside `sr-only` "Log bodyweight", the button's name, from one constant. Not a number, or out of range: `IMPLAUSIBLE_BODYWEIGHT_MESSAGE` (the shared bound's copy wins over v12's), set as the `value` error on both schemas, since zod's own `Invalid input` would otherwise reach the screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| W4  | The ✓ and the logged row                          | The unlogged ✓ is an **outline** button with lucide's `Check` (`aria-hidden`), so it does not read as done; pending, a spinner replaces the icon, with `aria-busy`. The logged row: `✓ 84.5 lb` (the tick in the filled done style, with `sr-only` "Logged"), then **Change**, in the existing bordered row. `Saved:` and `One weigh-in per day.` go (v12 shows neither); the refusal that line used to explain is now reported (W6). The duplicates line stays for a pre-1d day. **No time** (v12's `· 7:02 AM`): no column records when a weight was taken; on the next prototype round's list. This supersedes V1-24 1a's "a receipt, not a checkmark"; `bodyweight-receipt.tsx`'s docblock says so                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| W5  | The Change editor                                 | The saved value stays visible **above** the open editor, as now (it shows what you change from). Then the field with its unit, then **Cancel** and **Save** (v12's order; nobody uses the app yet, D29). Opening **selects** the value once, `setSelectionRange(0, length)` beside the existing `autoFocus` (not `onFocus`, which iOS undoes on mouseup), so typing replaces it and a correction never passes through blank; a component test asserts the selection. **While the field is empty after trim, Save reads `Clear`** (accessible name `Clear bodyweight`, `variant="destructive"`). A muted line `To remove this weigh-in, leave the field empty.` renders **always** (true in both states, so nothing jumps), in the field's `aria-describedby`. The same `isBlank` predicate picks the label, the wrapper's report and the server's branch. **An archived athlete:** Change stays, the label stays Save, the hint line does not render, and a blank is refused (`Enter your bodyweight, then Save.`), because the empty field the recovery relies on does not render for them; the component test asserts all three                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| W6  | Announcements, refusals and focus                 | From the **action's own result**, never from a value appearing. `single-value-live.tsx` is a client **context provider** wrapping the section's children (the server receipt passes through as `children`), keyed on the day, mounted in both states. It renders the shared `Announcer` (`components/ui/announcer.tsx`) **once, with a visible class** (never hidden while empty, its rule 3), directly under the field row (not beside `Last time`), so one element carries both the visible and the spoken text. The form and the amend call `report({ message, visible?, focus })` from their action wrapper after the result, never from `useOnActionSuccess`. `report` empties the region, then writes, so a repeated message is announced again. `report` changes a `key` on the text, so a repeated message is a new node and is read again without a blank frame. Focus: the target is focused at once if mounted, else a **single-use** claim the target's ref callback takes. A claim expires on the next `report`, a day change, or the first `focusin` or `pointerdown` by the person, never on "the next commit": a `setState` after an `await` is not in the transition, so it can commit before the revalidated tree mounts the target. Only the e2e's focus assertions see that ordering. **Log** → sr `Bodyweight logged`, focus on Change. **Save** → sr `Bodyweight changed to 72.5 lb`, focus on Change. **Clear** → muted status `Bodyweight cleared. It was 84.5 lb.`, focus on the field; it stays until a successful log or a day change (a field error does not replace it), and is not a tomb (no control, gone on reload). **A refusal whose reporter unmounts** (`dayTaken`, `notFound`, stale, read-only) → its copy as a `role="alert"` in `text-destructive`, focus on the field (v12 `:4046-4051`). **Field errors** (empty, not a number, out of range) stay in the form's or the amend's own `role="alert"` under the field, which is still mounted, with focus on the field. A weigh-in from another phone is silent. The amend's own region and receipt-focus effect go; the receipt's `id`, `tabIndex` and focus class go with `SavedAnnouncer`'s bodyweight use. Life keeps `SavedAnnouncer` until 3b-life |
| W7  | The server order in `editBodyweightAction`        | zod → profile → **a pre-read** of the row → `resolveDeclaredDay(row.day)` → a blank: `clearBodyweight` → a number: `updateBodyweightEntryById`, then the existing three-way branch, whose **re-read stays the live-only `findAmendableBodyweight`, after the UPDATE** (a pre-read value would turn a retry's race into "changed on another device" about nobody). The pre-read is a new `bodyweightRowForAmend` returning `{ day, hidden }`, built on `isLiveProfile` and the amend's shape pins, listed in `delete-and-restore.md`'s audit as a tombstone-returning read; it does not widen a live reader (that guide's trap). **zod:** a string that is empty **after trim** is a clear, on both sides (`''` and `'  '` → `null`, the same `isBlank` the UI uses): `value` in the **edit** schema's `.extend` becomes `z.union([blank → null, z.string().trim().min(1).pipe(z.coerce.number())], { error: IMPLAUSIBLE_BODYWEIGHT_MESSAGE })`; absent, `null` or a `File` is refused; `checkBodyweightBound` skips `null`. The create schema keeps refusing a blank. **Every refusal revalidates**, so the page shows what is true; the island carries the message (W6)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| W8  | Copy for a refused change of an older day         | `That day is read-only now, so the weight wasn't changed.` (covers a blank Save too), a sibling of `DECLARED_DAY_CLOSED_ERROR` in `declared-day.ts`; the action substitutes it for `resolveDeclaredDay`'s logging copy. No "Reload the page": the action revalidates, and `CLOSED_DAY_NOTICE` gives the reason                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| W9  | `clearBodyweight`                                 | NEW `packages/db/src/writers/single-value.ts`, exporting **per-metric wrappers** (`clearBodyweight`; 3b-life adds `clearPractice`) over one private core, so the metric stays a pinned constant (`bodyweight.ts:27-32`'s doctrine). **The writer opens the transaction.** It locks the owned row `FOR UPDATE OF entries` (ownership through `isLiveProfile`, the shape pins, live or hidden) and compares `deleted_at`, unit and `seenValue` **in JS after the lock**, so a concurrent amend answers `stale`, not `notFound`. **Hidden:** a replay if no other live weigh-in holds the day's slot (`bodyweightSlot`), `stale` if one does (another phone cleared and re-entered). **Live, unit and value match:** `hideEntries` for that one id on the row's day, so `hide.ts` stays the only app writer of `deleted_at` (`delete-and-restore.md` invariant 1); a `notFound` from it after the lock throws. **Otherwise** `stale`. The token never reaches the client. It edits nothing in `hide.ts`. D2's "refuses … a hidden row" and the Test plan's are amended to this                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| W10 | "Last time"                                       | NEW `packages/db/src/queries/last-bodyweight.ts` (the `has-live-entries.ts` precedent), with a thin DAL wrapper in `entries.ts` resolving `getHouseholdScope()`: the latest live `done` numeric bodyweight of that profile with `activity_date < day`, ordered `activity_date desc, created_at desc, id desc`, `limit 1`, on `idx_entries_profile_date`; it reuses the amend's shape pins. Returns `{ value, unit, day }`. Read only when the form renders. A new row in `delete-and-restore.md`'s reader audit. Not a new reader of the data: the same athlete's page shows that weight a day back                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| W11 | Bodyweight with nothing logged on a read-only day | `Nothing logged.` (v12, and Life's), replacing `No weight logged.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| W12 | A day after today                                 | Nothing new. The page never renders one (`resolveViewedDay` clamps), and both actions bound through `resolveDeclaredDay`, which 12c narrows (FAM-1 D32). No future-day test here                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| W13 | Owed by the 3b-page review                        | `write-path.md`'s `client_id` lifetime line and the comment at `actions.ts:491` describe the Life button's current key (`${day}:${a.key}`); the Life row and the bodyweight row share one height (`min-h-11`, `py-3`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| W14 | The privacy notice                                | This PR ships the first removal from the app that cannot be undone in it, so `docs/privacy/notice.md`'s "no Delete button yet … a mis-tap is fixable" and `data-inventory.md` say: clearing a weigh-in hides it; it cannot be restored in the app; it is not yet removed from the database. `delete-and-restore.md` invariant 1's table: the app reaches `hideEntries` from 3b-bw, not B1-2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

**Tests.**

- **Component:** the states (unlogged with and without "Last time", with and without its day; logged; editing; editing blank, where Save reads Clear; archived blank refused; read-only empty); the empty ✓ refused before any request, focus on the field; a select seeded from a kg "Last time".
- **The island:** each report; a repeated message re-announces; a claim taken in both orders (result before and after the target mounts); an unconsumed claim does not fire on a later mount; a result after the day key changed is silent; `dayTaken` and `notFound` stay visible after the reporter unmounts.
- **Schema:** `''` and `'  '` → `null`; absent and `null` refused; `'84..5'` and `'abc'` refused **with `IMPLAUSIBLE_BODYWEIGHT_MESSAGE`** (asserted, not just refused), on both schemas.
- **Actions:**
  - a blank clears; an absent `value` calls neither writer;
  - a replay succeeds once, with the pre-read and the re-read mocked to different values;
  - a stale clear refuses;
  - **a row on a day before yesterday refuses a change and a clear, with a forged `day=<today>` posted**, and calls neither writer (acceptance 5's server half);
  - archived blank refused;
  - the matrix binding gains `clearBodyweight`.
- **`db:verify`** (`verify/single-values.ts`), for `clearBodyweight`: a wrong metric (a check-in entry's id); a stale `seenValue`; a wrong unit; a sibling profile; a foreign household; a replay; a hidden row whose slot is re-held → `stale`; exactly one row changes and the day's other entries are untouched; a new weigh-in on a cleared day inserts (0012 is live-only).
- **`db:verify`**, for `lastBodyweightBefore`: a cleared row is skipped; day D excludes D and D+1; a sibling profile and a foreign household → `null`; non-`done` and text rows skipped; the tiebreak.
- **`db:verify`**, for `bodyweightRowForAmend`: its day (and nothing else, as built: the review dropped the hidden flag nobody read); `null` for a sibling, a foreign household and a wrong shape.
- **Mutation patches:** drop the clear's metric pin; drop its `seenValue` compare; drop its profile join; drop "last time"'s `deleted_at IS NULL`.
- **The lock:** a two-connection probe on `e2e:local`'s embedded Postgres (1e's precedent), recorded in the PR, not committed. PGlite's one connection cannot show it.
- **e2e** (`bodyweight-receipt.spec.ts`): on an athlete the spec creates through Add an athlete, so a retry starts fresh and the clear never touches Athlete Two's history (which `export-csv.spec.ts` needs). Log on `?d=<yesterday>` first (`resolveViewedDay` permits yesterday for a new profile); on today, assert `Last time <v> lb` with no day suffix, then log with ✓, Change, clear (Save reads Clear; the visible line), re-enter, with focus at each. Back on yesterday, clear: its re-entry shows no hint (nothing before it).
- **`a11y.spec.ts`'s weigh-in test:** ✓ and field on one row at 360px, and the ✓ ≥ 44px wide (width is otherwise ungated); axe after the empty-✓ refusal.
- **Updated for the copy:** `steps.ts`, `a11y.spec.ts` and `screenshot-ephemeral.ts`.
- **Manual:** one VoiceOver pass and one iOS Safari pass on a phone, recorded in the PR: after Change, one digit replaces the value; after a clear, the line shows and focus is on the field (whether the keypad opens is noted, not required).

**What scans what.**

- **"Last time":** shown deterministically on the created athlete's today, after the spec logs yesterday; absent on yesterday, which has nothing before it.
- **The read-only day:** component tests only, as in 3b-page.

**Files beyond D2's table:**

- `bodyweight-section.tsx`, `bodyweight-receipt.tsx`, `single-value-live.tsx` (+ tests);
- `packages/db/src/queries/last-bodyweight.ts`;
- `apps/web/e2e/a11y.spec.ts`, `apps/web/scripts/screenshot-ephemeral.ts`;
- `docs/privacy/notice.md`, `data-inventory.md`;
- `docs/tech-debt.md` (the announcer row: one more consumer).

**Accepted, said in the PR:** V1-9b Decision 7's bodyweight throw (`bodyweight.ts:267-284`) becomes reachable. It takes a ✓ whose response is lost, another phone clearing in between, and a retry from the same mount, and the result is `error.tsx`.

## 3b-0: what the slice settles (2026-11-16)

> This section **replaces** the 3b-0 rows of the file table, the 3b-0 half of D3's "One per day"
> bullet, and the 3b-0 Risks row, after a DB-safety and a correctness lens re-read them against main at
> `5c20dd23` (log below). Where the two disagree, this section wins.
>
> _Roadmap alignment (2026-11-16): advances V1-24 3b within FAM-1's lane S; gates 3b-life; the
> restore list is shared with FAM-1 11b (lane E), which appends #447's entries arbiter to it._

**Z1 — The index.** `PRACTICE_DAY_UNIQUE_INDEX = 'uq_entries_profile_day_practice'`, beside
`BODYWEIGHT_DAY_UNIQUE_INDEX` (`schema.ts:281`): `UNIQUE (profile_id, activity_date) WHERE deleted_at
IS NULL AND metric_key = 'practice_minutes'`. No `coalesce(context)`: practice has no slot. The
predicate is a SQL literal in `schema.ts` (an interpolated const renders as `$1`, `schema.ts:430-432`).
`practice_minutes` aggregates by `sum` (`catalog-metrics.ts:145-149`); with the index the sum is over
one row, and two sessions a day would need a re-key migration.

**Z2 — The migration is 0012's shape, not a concurrent build.**

- `SET lock_timeout = '5s'`, `SET statement_timeout = '60s'`, `LOCK TABLE "entries" IN SHARE MODE`.
- A `DO` block that counts live practice groups by `(profile_id, activity_date)` with more than one row
  and raises a count-only message naming the runbook section. Then a plain `CREATE UNIQUE INDEX`, in
  the transaction. Every statement gets a breakpoint.
- No `CONCURRENTLY` (drizzle's migrator wraps the file in one transaction, `scripts/migrate.ts:21`;
  the stripping runner does not exist) and no `IF NOT EXISTS` (it would skip a same-named index with a
  different predicate, `0012:21-23`). The header says why, and that this is a partial index over
  practice rows only (the 13th on `entries`).
- **Why the pre-check, not only the prod read:** the practice ✓ is live, so a duplicate can land
  between the last read and `migrate.yml`'s apply. A bare `23505` would print the key (a profile id and
  a date) into the world-readable Actions log and wedge every later migration (lane A's 4b included).
- **The number is not fixed** until the board says which of 3b-0 and lane A's 4b goes first; the file is
  regenerated on top of main by the db-migration skill's recipe, and no doc names its number.
- A runbook entry, **"If 3b-0's migration refuses"**: read the groups, decide each with the maintainer
  (two real sessions on one day are a sum, not a duplicate), correct, re-run `migrate.yml`.

**Z3 — The prod read (the maintainer runs it).** Inside `BEGIN READ ONLY` on `DATABASE_URL_UNPOOLED`;
only the count is committed, never a profile or a date. Its predicate is exactly the index's:

```sql
BEGIN READ ONLY;
SELECT count(*) AS duplicate_groups
FROM (
  SELECT 1 FROM entries
  WHERE deleted_at IS NULL AND metric_key = 'practice_minutes'
  GROUP BY profile_id, activity_date
  HAVING count(*) > 1
) d;
ROLLBACK;
```

Run once before the migration is written into the PR's final head, and again just before merge.
A non-zero answer stops 3b-0 for a correction PR (Z2's runbook entry).

**Z4 — The insert (`writers/checkin.ts`).** `writeCheckinEntries`' INSERT becomes **target-less**
`ON CONFLICT DO NOTHING`, for the whole batch: only a practice row can hit a non-`client_id` unique on
this path, and a target-less skip is per row, so a habit in the same batch still inserts (with today's
`client_id` target, the new index would raise a statement-level `23505` and lose the batch). A row not
inserted is classified in this order:

1. **replay**: a live row of this profile holds the `client_id`, **with the same metric and day** (the
   pin `bodyweight.ts:240-256` has; today's lookup has neither, `checkin.ts:119, 142`);
2. **`day_taken`**: the item is `practice_minutes` and a live row holds `practiceSlot(profileId, day)`;
3. **`own_hidden`**: a hidden row of this profile holds the `client_id` and the day is free;
4. **conflict**: another profile's row holds it;
5. otherwise the existing throw.

`practiceSlot` is exported from `checkin.ts` (not `single-value.ts`, which imports `hide.ts`), for
3b-life's clear. The `checkin.ts:85-88` comment and write-path.md invariant 6 are updated in the PR.

**Z5 — The action, until 3b-life.** `logLifeActivitiesAction` (`actions.ts:495-499`) handles
`day_taken` explicitly as `ok: true`, with a comment and a test: in 3b-0 the ✓ writes a constant, so the
other phone's row already says what this tap meant. Refusing would show an alert inside `LifeButton`
that unmounts on the revalidate. **3b-life** turns it into `{ ok: false }` through the island, with its
copy and a boundary test (added to 3b-life's table).

**Z6 — Restore (`writers/hide.ts`).** The 23505 matcher becomes a **list of index-name consts**
(maintainer, 2026-11-16), `[BODYWEIGHT_DAY_UNIQUE_INDEX, PRACTICE_DAY_UNIQUE_INDEX]`; lane E's 11b
appends `ENTRY_PRESCRIPTION_SET_UNIQUE_INDEX` (the other two #447 arbiters are on `sessions` and
`supersets`, which restore never writes). **Practice goes through the catch only**: no holder lookup and
no swap, so a practice restore into a re-entered day answers `slot_taken` without `heldBy`, and
`keepInsteadOf` stays bodyweight-only. Bodyweight's pre-check and swap are unchanged. This keeps the
list provable: with a pre-check in front, the catch is unreachable on single-connection PGlite, and a
wrong name in the list would pass every gate.

**Z7 — Deploy order.** New code before the index is safe (the target-less insert names no index; the
new branches are dead until it exists). The index before the new code is not: the old writer turns a
second same-day practice into a bare `23505`. So the migration header says: merge when nobody is
logging, confirm `migrate.yml` green and `pg_indexes.indexdef` before 3b-life merges, and a Vercel
rollback past this PR re-exposes the bare `23505`. A separate writer-first PR was considered and
rejected at today's traffic.

**Z8 — Proofs, in `verify/single-values.ts`, and their mutation patches.**

- Index: `pg_indexes.indexdef` is the shipped line; a raw second live practice is rejected by name
  (`expectRejectedBy`, inside the savepoint); a hidden one, another day, another profile, and a
  bodyweight on the same day are allowed.
- The migration's own `DO` block, read from disk by slug, refuses a seeded duplicate, with a fixture
  where dropping `profile_id` from the key would change the count.
- Writer: same `client_id` → `replay`, same id; another `client_id` → `day_taken`, one live row, its
  value untouched; a habit plus a taken practice in one batch → `created` and `day_taken`; after a
  hide, a new insert → `created`; a hidden `client_id` holder with a free day → `own_hidden`; a
  non-practice no-op with no holder throws; a `client_id` replayed under another metric is not a replay.
- Restore: a habit plus a re-entered practice → `ok` and `slot_taken` in one call; the hidden practice
  restores once the live one is hidden.
- Mutation patches (with `.expect`): the index loses `deleted_at is null`; the insert's `client_id`
  target comes back; `day_taken` loses its metric pin; the slot lookup loses its live-only filter;
  the practice index leaves the restore list; the replay lookup loses its metric pin. Patch 40 still
  applies to `checkin.ts`, or it is regenerated.
- **PGlite has one connection**, so two phones racing cannot be shown there: a two-connection probe
  on `e2e:local`'s embedded Postgres, recorded in the PR (3b-bw's precedent).

**Z9 — Files.** `schema.ts`, the generated migration, `writers/checkin.ts`, `writers/hide.ts`,
`apps/web/lib/dal/entries.ts` (the type), `apps/web/app/p/[profileId]/actions.ts` (+ test),
`verify/single-values.ts`, the mutation patches and README, `docs/features/write-path.md` (invariant 6;
the bodyweight and strength inserts cannot hit the new index), `docs/features/delete-and-restore.md`
(owns `hide.ts`; the reader audit gains the slot lookup), `docs/runbooks.md` (Z2), `docs/architecture.md`
(the new arbiter), the changelog fragment.

**Not in 3b-0:** any copy, any screen, the practice amend and clear (3b-life).

## Review-response log (adversarial panel)

### 3b-0 — a DB-safety and a correctness lens, before implementation (2026-11-16)

Against main at `5c20dd23`, after #447 (three new arbiters) and the maintainer's two decisions of
2026-11-16 (restore's check is a list of index names; a ✓ on a slot held by its own hidden entry
revives it, in 11b/11c).

| #   | Lens        | Critique (short)                                                                                         | Verdict      | Resolution                                                                                   |
| --- | ----------- | -------------------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| D1  | DB-safety   | **BLOCKING:** a concurrent build and `IF NOT EXISTS` cannot run here and contradict "0012's shape"       | **accepted** | Z2                                                                                           |
| D2  | DB-safety   | **BLOCKING:** the prod read does not protect the apply; a bare 23505 leaks a key and wedges the queue    | **accepted** | Z2's pre-check; Z3 stays as the early warning                                                |
| D3  | DB-safety   | Deploy order unanalysed                                                                                  | **accepted** | Z7; the writer-first PR rejected at today's traffic                                          |
| D4  | DB-safety   | "The practice insert" is the shared batched writer; the typed result reaches nobody                      | **accepted** | Z4, Z5                                                                                       |
| D5  | DB-safety   | Restore needs a shape; a registry in `single-value.ts` is an import cycle                                | **accepted** | Z6 (catch-only for practice, per C4); `practiceSlot` in `checkin.ts`                         |
| D6  | DB-safety   | Proofs under-specified, aimed at `verify.ts`                                                             | **accepted** | Z8                                                                                           |
| D7  | DB-safety   | The index shape is not written down                                                                      | **accepted** | Z1                                                                                           |
| D8  | DB-safety   | The prod read is SQL in the plan, not a script                                                           | **accepted** | Z3                                                                                           |
| D9  | DB-safety   | Classification order: the `client_id` holder first, so a hidden holder with a held day is `own_hidden`   | **rejected** | Z4 follows C3: the slot decides before `own_hidden`, as bodyweight's does (plan C3, round 2) |
| C1  | Correctness | **BLOCKING:** no PR consumes `day_taken`; it would read as success                                       | **accepted** | Z5: explicit `ok` in 3b-0 while the value is constant; a refusal in 3b-life                  |
| C2  | Correctness | **BLOCKING:** the migration instructions contradict 0012; no runbook entry                               | **accepted** | Z2                                                                                           |
| C3  | Correctness | The classification order and its metric pin are unspecified                                              | **accepted** | Z4                                                                                           |
| C4  | Correctness | With a pre-check, the restore catch list is unprovable on PGlite                                         | **accepted** | Z6: practice through the catch only; bodyweight unchanged                                    |
| C5  | Correctness | Owed proofs and patches not named                                                                        | **accepted** | Z8                                                                                           |
| C6  | Correctness | The prod read: same predicate as the index; a group may be two real sessions                             | **accepted** | Z3, Z2's runbook entry                                                                       |
| N1  | both        | File table omits `delete-and-restore.md`, `runbooks.md`, `actions.ts`; `verify.ts` vs `single-values.ts` | **accepted** | Z9                                                                                           |
| X1  | both        | The check-in replay lookup has no metric or day pin (outside the diff, #385; crafted input only)         | **accepted** | Z4 step 1 pins it, with a proof and a patch                                                  |
| X2  | both        | Is the revive-and-amend decision scoped to program rows?                                                 | **open**     | Asked of the maintainer; Z4–Z8 assume single values keep new-row re-entry, as #442 shipped   |

### 3b-bw — the UX panel and a correctness lens, before implementation (2026-11-15)

> Panel cost: interaction 120k · 4m31s, a11y/360px 141k · 7m29s, trust 132k · 5m09s, correctness 199k · 8m07s.

_Roadmap alignment (2026-11-15): advances `V1-24` as FAM-1 lane S's wave 2; gates 3b-life (which reuses the row and the island); checked against the private roadmap; nothing to add here._

| #   | Lens                     | Critique (short)                                                                                                                                      | Verdict                  | Resolution                                                                                                                                                                                                                       |
| --- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X1  | Interaction, trust, a11y | **BLOCKING:** a clear is confirmed to screen readers only; v12's `say()` is visible to everyone; the cleared number is shown nowhere                  | **accepted**             | W6: a visible line, `Bodyweight cleared. It was 84.5 lb.`; W5 keeps the value above the editor                                                                                                                                   |
| X2  | Interaction, trust       | Nothing says a blank Save clears, and every correction passes through blank; the Android action key submits it                                        | **accepted**             | W5: Save reads `Clear` while blank, with a hint line; the value is selected on open                                                                                                                                              |
| X3  | All four                 | On `type="number"`, unparseable text reads as `''`: a typo would clear, once native validation is off                                                 | **accepted**             | W3: v12's `type="text" inputMode="decimal"`; W7: only `''` after trim is a clear                                                                                                                                                 |
| C1  | Correctness              | **BLOCKING:** a nullable `value` makes an absent field a clear; the bound refuses `null`                                                              | **accepted**             | W7's zod union in the edit schema only; the bound skips `null`; schema and action tests                                                                                                                                          |
| C2  | Correctness              | **BLOCKING:** "Last time" has no proof at any tier, and the cleared-typo case is the motivating one                                                   | **accepted**             | W10: a `packages/db` query with `db:verify` proofs, a mutation patch, an audit row, a tiebreak                                                                                                                                   |
| A1  | a11y                     | **BLOCKING:** "never wraps" needs an explicit min-width; measured, the ✓ wraps at 360px and no gate sees it                                           | **accepted**             | W1: named classes, no `flex-wrap`, a same-row assertion and a width check in `a11y.spec.ts`                                                                                                                                      |
| X4  | Interaction, a11y        | A refusal leaves focus on `<body>` (a disabled button drops it); v12 focuses the field                                                                | **accepted**             | W3, W6: every refusal focuses the field; the empty ✓ does so in the submit handler                                                                                                                                               |
| X5  | Trust, correctness       | `dayTaken`, `notFound` and the read-only refusal vanish when the revalidate unmounts the form or the amend                                            | **accepted**             | W6: the island carries refusals, visibly; W7: every refusal revalidates                                                                                                                                                          |
| X6  | All four                 | The select defaults to `lb` under a `Last time … kg`; a kg kid saves lb, in range                                                                     | **accepted**             | W2: seeded from the last weigh-in's unit                                                                                                                                                                                         |
| X7  | Interaction              | Settle the select before code                                                                                                                         | **rejected**             | Keeping it is the status quo and costs one row's width; removing it is the maintainer's call, asked in the PR. If the answer is remove, the row loses one child                                                                  |
| A2  | a11y, correctness        | W6's delivery, both orders, a stale claim, the render-time call site; reuse `Announcer`                                                               | **accepted**             | W6: a context provider, single-use claims, `report` from the wrapper, the shared `Announcer`                                                                                                                                     |
| A3  | a11y                     | A repeated message is silent; a clear's announcement competes with the focus move                                                                     | **accepted**             | W6: `report` empties, then writes; the clear's line is also visible. VoiceOver pass in the PR                                                                                                                                    |
| A4  | a11y                     | `aria-describedby` must join hint and error; ids are page-global before 3b-life adds a row                                                            | **accepted**             | W1: joined list, `useId()`                                                                                                                                                                                                       |
| A5  | a11y                     | "then ✓" names a control called "Log bodyweight"; the logged tick is `aria-hidden` with no text                                                       | **accepted**             | W3, W4: an `sr-only` name beside the glyph; `sr-only` "Logged"                                                                                                                                                                   |
| A6  | a11y, interaction        | The ✓'s look and pending state; one glyph for the action and the done mark                                                                            | **accepted**             | W4: outline + lucide `Check`; a spinner with `aria-busy`; the logged tick in the done style                                                                                                                                      |
| A7  | a11y                     | Files that assert the removed copy are missing; the new states have no named scan                                                                     | **accepted**             | "Files beyond D2's table" and "What scans what"                                                                                                                                                                                  |
| T1  | Trust                    | "Last time" carries no age                                                                                                                            | **accepted**             | W1: the day when not the day before                                                                                                                                                                                              |
| T2  | Trust                    | The privacy notice still says a mis-tap is fixable                                                                                                    | **accepted**             | W14                                                                                                                                                                                                                              |
| T3  | Trust, interaction       | `Reload the page.` names an outcome nobody can see and a gesture that doesn't help                                                                    | **accepted**             | W8                                                                                                                                                                                                                               |
| C3  | Correctness              | A hidden row "with the seen value" is a replay even when another phone cleared and re-entered                                                         | **accepted**             | W9: the slot decides; D2 and the Test plan amended                                                                                                                                                                               |
| C4  | Correctness              | One widened read feeds the replay branch a stale value, and widens a live reader                                                                      | **accepted**             | W7: a separate pre-read; the re-read stays live-only and after the UPDATE                                                                                                                                                        |
| C5  | Correctness              | An archived athlete's clear leaves no field to re-enter into                                                                                          | **accepted**             | W5: a blank is refused for an archived athlete. The lens asked for a maintainer decision; refusing keeps Change exactly as P1/I4 left it ("correctable") and removes nothing, so it is the default, listed in the PR to overturn |
| C6  | Correctness              | Proofs that cannot fail: the lock on PGlite, no mutation patches, no sibling profile, "no reason" asserts nothing, the matrix binding, the forged day | **accepted**             | Tests: each named                                                                                                                                                                                                                |
| C7  | Correctness              | Compare inside the lock query and a concurrent amend answers `notFound`                                                                               | **accepted**             | W9: compare in JS after the lock                                                                                                                                                                                                 |
| C8  | Correctness              | The e2e's clear removes Athlete Two's only row, which `export-csv` needs, and is not retry-safe                                                       | **accepted**             | Tests: a spec-created athlete                                                                                                                                                                                                    |
| C9  | Correctness              | Decision 7's bodyweight throw becomes reachable                                                                                                       | **rejected** for this PR | It needs a lost response, another phone's clear and a retry from the same mount; a typed `ownHidden` with id rotation is the fix, as the life form did, and is a write-path change of its own. Said in the PR                    |
| C10 | Correctness              | A clear retried across midnight answers "read-only" though it landed                                                                                  | **rejected**             | The revalidate shows the empty field, which is the truth; a two-second window at midnight                                                                                                                                        |

**Re-review (rev 2, one pass each; correctness 76k · 1m51s, UX 3 lenses):** no blocking concern
survives. Taken: the `value` error copy on both schemas (zod's own `Invalid input` would reach the
screen); trim-then-empty is a clear on both sides; the e2e logs yesterday first so "Last time" can
actually render; field errors stay in the form's own alert and the island carries only results whose
reporter unmounts, as an alert (refusal) or status (clear), in one `Announcer` element with a visible
class; the cleared line survives a field error; the Clear hint is always shown, and Save turns
destructive while it reads Clear; the archived case keeps Save; select once via `setSelectionRange`;
focus claims expire on the next report, a day change or the person's own focus, never on "the next
commit"; weekday from 2–6 days back; one comma normalised and a digits-only check; the `Unit` label
stays; a keyed text node re-announces a repeat. iOS keypad behaviour after an async focus is
**unverified**, so the plan claims focus only, with the iOS pass to record it.

NITs taken: the metric as per-metric wrappers (W9); the writer opens the transaction (W9); the hint is
never a placeholder (W1); `Nothing logged.` (W11); the receipt's now-unused id and focus class go (W6).
NITs left: sr-only labels on the create row (lens 1's NIT 7): the visible `Weight` label is the
AGENTS.md "clear labels" rule, and the e2e finds the field by it. The button order follows v12 over
the current build (trust NIT): the app has no users yet (D29). v12's range is 20–500, not 40–400 as
D2 said; corrected below.

### 3b-page — the UX panel, before implementation (2026-11-15)

> Panel cost: interaction 107k · 2m12s, a11y/360px 147k · 3m50s, trust 111k · 3m17s.

_Roadmap alignment (2026-11-15): advances `V1-24` (CRUD-1 track E) and unblocks FAM-1 steps 11a–13b;
checked against the private roadmap; nothing to add here._

| #   | Lens               | Critique (short)                                                                                                       | Verdict      | Resolution                                                                                                                                                                                 |
| --- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A1  | a11y               | **BLOCKING:** the plan cited a closed-day axe scan that does not exist, and the new read-only states render only there | **accepted** | The e2e table and acceptance 6 say what is scanned; the states get component tests (the next row)                                                                                          |
| A1b | a11y               | Also render the read-only states as cells in the token inventory, for axe in both themes                               | **rejected** | The rows use the foreground and muted pairs every scanned route already audits, and a 215px line cannot overflow 328px. The cell would add a second copy to keep in step for no new signal |
| I1  | Interaction, a11y  | Inline in an async page, the read-only branch has no test at any tier                                                  | **accepted** | `life-section.tsx` with tests for writable, read-only logged (one and two rows), read-only empty, and Wake                                                                                 |
| I2  | All three          | `· logged today` is the only record left: wrong on yesterday, and it hides the 90 minutes                              | **accepted** | P2: the row with its minutes on every day                                                                                                                                                  |
| I3  | Interaction        | The new notice is false on an archived athlete's older day                                                             | **accepted** | P7                                                                                                                                                                                         |
| I4  | Interaction, trust | P1–P3 said "day" where the code's gate folds in archive; which does Change follow?                                     | **accepted** | P1: the day. An archived athlete's Change is unchanged; the amend has no archive check and adding one is not this PR                                                                       |
| A2  | a11y               | The read-only markup was unspecified                                                                                   | **accepted** | P2, P3: `ul`/`li`, foreground medium tabular text for the value, a muted `p` for the empty line, a static `life-heading` id                                                                |
| A3  | a11y               | Focus drops to `<body>` after a practice log and nothing announces it; worse now the list is gone                      | **accepted** | P8                                                                                                                                                                                         |
| A4  | a11y               | The kept specs assert into the removed list; `steps.ts` was missing from the file table                                | **accepted** | File table; `logBodyweight` and `logLifeActivity` assert in their own section                                                                                                              |
| A5  | a11y               | The e2e table's `:689-762` would delete a helper four other tests use                                                  | **accepted** | `:656-733`                                                                                                                                                                                 |
| T1  | Trust              | `Nothing logged.` under Life is untrue on a day that holds stored, unshown entries; use `No practice logged.`          | **rejected** | Copy follows v11 (maintainer, 2026-11-15), and the line sits under the Life heading. Raised to the maintainer in the PR as a one-constant change                                           |
| T2  | Trust              | The read-only rule states no recovery path, and nothing records when to revisit that                                   | **accepted** | A Risks row; one sentence in the tech-debt row. The notice keeps v11's sentence                                                                                                            |
| I5  | Interaction        | Drop the `getWeeklyAdherence` read too                                                                                 | **rejected** | P6: not one of D1's removals; FAM-1 decides what "This week" counts                                                                                                                        |

**Re-review (a11y lens, B1 only):** the acceptance 6 wording overstated today's scans (fixed); the
screenshot fixture seeds weigh-ins only (fixed); the Life section's day key is stated and tested
(`life-section.test.tsx`, "paging days does not"); a second row on one day stays silent, as
`SavedAnnouncer` announces none → value only. **Rejected:** tapping practice inside the a11y spec's
weigh-in test so axe sees the new `ul`. That test runs on Athlete Two, whose seeded routine has no
practice (`packages/db/src/seed.ts:83-95`), and re-seeding a shared fixture to reach a plain `ul`/`li`
of text is more risk than signal; the component test asserts the list and listitem roles.

NITs: `No weight logged.` beside `Nothing logged.` is 3b-bw's to align (it rebuilds that row); the
loading skeleton is left alone, since the body's shape changes again in 3b-bw, 3b-life and FAM-1 12.

**Implementation review (four lenses, 2026-11-15, #418):** fixed in the PR — the export spec read
its day from a form that is gone on a retry; the read-only rule moved into a pure, tested
`dayPageFlags`; the practice label and minutes derive from the app's constants in the e2e; the
architecture diagram, the tech-debt row's list and the "still in the export" claim (check-ins never
were) were corrected; acceptance 5 is scoped to bodyweight and practice. **Owed by 3b-bw**, which
takes its turn on `write-path.md`: the guide's `client_id` lifetime line and the matching comment at
`actions.ts:491` still describe `life-form.tsx`'s old key (`${day}:${activity}:${entryId}`); it is now
`${day}:${a.key}`, safe because a logged activity unmounts its button. **Owed by 3b-life:** two
`SavedAnnouncer`s on one page mean another phone's practice, arriving on this phone's weigh-in
revalidate, announces and takes focus; 3b-life announces from the practice action's own result.

For 3b-bw's panel: D2 names no copy for a refused older-day amend, and `DECLARED_DAY_CLOSED_ERROR`
says "logging" over a Change.

### Round 3 — a correctness re-check of this version (2026-11-15)

| #   | Finding                                                                                                        | Verdict  | Where it went                                               |
| --- | -------------------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------- |
| R1  | **BLOCKING:** Restore all throws on the new practice index: restore's slot check and catch are bodyweight-only | accepted | D3; 3b-0 edits `hide.ts`; a `db:verify` case                |
| R2  | **BLOCKING:** a second phone's practice ✓ would be a bare 23505: the insert arbitrates on `client_id` only     | accepted | D3; 3b-0's target-less insert with `dayTaken`               |
| R3  | Blank → `hideEntries` drops the amend's metric pin and stale check, and needs a day the form doesn't post      | accepted | D2: a pinned `clearSingleValue`; the schema accepts a blank |
| R4  | The closed-day sentence contradicted v10 and the code; a closed-day blank is unrecoverable                     | accepted | Resolved by the maintainer: older days are read-only (D1)   |
| R5  | `hide_reason`'s lifecycle unspecified                                                                          | accepted | V1-9b Amendment, B2-0                                       |
| R6  | The e2e table deleted the weigh-in a11y test and missed two specs                                              | accepted | e2e table                                                   |
| R7  | Re-entering after a clear must mint a fresh `client_id`                                                        | accepted | D2                                                          |
| R8  | Stale references (the notice's lines; v10 "when published")                                                    | accepted | Fixed                                                       |

### Round 2 — the first re-scope draft (2026-11-15)

Six lenses (UX, correctness, scope, architecture, privacy, prototype fidelity) reviewed a draft that
kept read-only own-name sections for earlier entries and V1-9b B1-3's in-place Delete. The maintainer's
second decision of the day (old entries out of scope; single values edit-only; B1-3 cut) removed most
of what they reviewed. How each finding landed:

| #   | Lens         | Finding                                                                                  | Verdict              | Where it went                                                                        |
| --- | ------------ | ---------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| C1  | Correctness  | **BLOCKING:** tombs cannot be ordered; the live and hidden reads share no order key      | moot                 | No tombs on the page (single values never tomb; B1-3 cut)                            |
| C2  | Correctness  | **BLOCKING:** a clear cannot be told from a single hide                                  | **accepted**         | The maintainer chose to store the event kind: V1-9b B2-0's migration                 |
| C3  | Correctness  | Practice has no slot, so a second phone doubles the day                                  | **accepted**         | 3b-0                                                                                 |
| C4  | Correctness  | Sections render from derivations the router does not own                                 | moot                 | No router                                                                            |
| C5  | Correctness  | The render test cannot fail                                                              | moot                 | No router                                                                            |
| C6  | Correctness  | e2e deletions drop the export's app-produced input and the warmup                        | **accepted**         | e2e table: the export logs through the page; setup warms bodyweight                  |
| C7  | Correctness  | No minutes bound in shared; the boundary tests would pass on zod                         | **accepted**         | D3; Test plan                                                                        |
| S1  | Scope        | **BLOCKING:** the e2e table was unbuildable: nothing can seed without the forms          | **accepted**         | Deleted, not re-pointed (e2e table)                                                  |
| S2  | Scope        | 3b-i was throwaway around ~45 lines                                                      | **accepted**         | 3b-page removes in one step; no interim list                                         |
| S6  | Scope        | Do not ship the superseded PR 2 plan                                                     | **accepted**         | Withdrawn; its two reusable decisions are listed in the PR body for FAM-1 13 and 13b |
| S7  | Scope, Arch. | Round 1's log cited a local-only SHA                                                     | **accepted**         | Round 1's live rows inlined below                                                    |
| A1  | Architecture | **BLOCKING:** the amendment overrode ADR 0008 Decision 2 with no merged record           | **accepted**         | ADR 0008 gets a dated Amendment recording the maintainer's 2026-11-15 decisions      |
| A2  | Architecture | No seam for FAM-1 12's workouts                                                          | moot                 | No router; step 12 inserts its workouts between Bodyweight and Life                  |
| A3  | Architecture | FAM-1's text is falsified ("No Log buttons", the byte-identical legacy Today, its gates) | **accepted, routed** | Listed in the PR body for the roadmap thread, which owns FAM-1's gates               |
| A4  | Architecture | Guides unnamed                                                                           | **accepted**         | D1; each file table                                                                  |
| A6  | Architecture | Unmerged 2026-11-13 amendments cited the cut PR 2                                        | **accepted**         | Replaced by one 2026-11-15 note each                                                 |
| A8  | Architecture | The CRUD-1 chart disagreed with the text                                                 | **accepted**         | Chart redrawn                                                                        |
| P1  | Privacy      | "A weigh-in can't be deleted" made Clear a second deletion route; "ask us" led nowhere   | moot                 | Blank-to-clear is the in-app route; Clear hides it too (maintainer, 2026-11-15)      |
| P4  | Privacy      | The hidden DTO widened without need                                                      | moot                 | No hidden rows render                                                                |
| P7  | Privacy      | "The 'How did it feel?' note stays" misleads once nothing shows it                       | **accepted**         | V1-9b Amendment, B2's copy                                                           |
| U1  | UX           | The closed-day sentence was false twice                                                  | **accepted**         | D1: v10's one sentence                                                               |
| U5  | UX           | "No Log buttons" was reworded, not resolved                                              | **resolved**         | v10 uses ✓, not Log                                                                  |
| U7  | UX           | The danger "Clear day" fails AA in dark                                                  | **accepted**         | V1-9b Amendment, B2                                                                  |
| U8  | UX           | Clear-dialog focus in and out unspecified                                                | **accepted**         | V1-9b Amendment, B2                                                                  |
| F   | Fidelity     | Copy, announcements, singular forms, the dialog's date, Escape                           | **accepted**         | D2, D3 and the V1-9b Amendment use v10's                                             |

The other UX majors (strength sessions losing their note and grouping; a practice tomb whose Undo
always refuses; Undo re-announcing; 360px for read-only rows) concerned rows this plan no longer
renders.

### Round 1 — the first version (2026-11-13): the rows still in force

| #     | Lens      | Critique                                                           | Verdict  | Change                                                |
| ----- | --------- | ------------------------------------------------------------------ | -------- | ----------------------------------------------------- |
| UX-B2 | UX (a11y) | The life receipt drops focus to `<body>`, and nothing announces it | accepted | D3: a status region mounted in both states, and focus |
| UX-M1 | UX        | Wake on yesterday logs today (`actions.ts:432-436`)                | accepted | Superseded: Wake leaves every day                     |
| UX-m4 | UX        | A closed empty day's copy                                          | accepted | Superseded by v10's single closed-day sentence        |

**Blocking concerns left open:** none.
