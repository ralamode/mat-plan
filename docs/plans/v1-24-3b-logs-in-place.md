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
session logged before 3b-page is still stored and still in the export, but no longer shown on the day
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

- **The removed components stay in the tree, unmounted**, until FAM-1 13 and 13b reuse or delete them
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
  card are off the page until FAM-1 13b. Neither owns `page.tsx`, so the PR names them rather than
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
  unless the row is live, carries the expected metric, and still holds the value the form showed
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
  v11 checks 40–400. The shared bound is a recorded decision with its reasoning; its numbers go on
  the next prototype round's list.

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
| `scaffold-submit.spec.ts` (4 tests)                                                                                                                                      | deleted                                                         | the strength writer's `db:verify` and `actions.test.ts`; FAM-1 13b brings an e2e back                                |
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
   a clear there.
6. axe and the tap-target scan pass on today; axe and the 360px overflow scan pass on yesterday's
   weigh-in. The read-only day's states pass their
   component tests (no e2e reaches it; see 3b-page).

## Test plan

- **Boundary tests** (AGENTS.md → Backend) for the life action and `editPracticeAction`:
  unauthenticated, wrong owner, bad body, **and a day before yesterday** (also for
  `editBodyweightAction`). **Each starts from one valid body with minutes**, so each
  fails on its own guard and not on zod. Plus 1, 300, 301 and 45.5, and a same-`client_id` replay that
  produces one row.
- **`db:verify`:** the index and the typed `dayTaken` (3b-0); Restore all into a re-entered practice refuses that item; the practice amend pins its metric; `clearSingleValue` refuses a wrong metric, a stale `seenValue` and a hidden row, and writes one hide with no reason.
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
| An earlier entry looks lost                 | It is stored and exported; the plan and the changelog say it is not shown until FAM-1                                                                         |
| A wrong value on a read-only day            | No in-app route; a correction (`db:correct`) fixes it. Acceptable for one household; the tech-debt row revisits it before FAM-1 slice 3 or a second household |
| Rollback                                    | 3b-0 is forward-only (the index stays, harmless). The UI PRs revert on their own; no data changes                                                             |

## Out of scope

- Showing earlier entries, and deleting them: after FAM-1 (the maintainer's decision).
- Clear a day: V1-9b B2.
- The program's workouts, row-completed logging and per-row edit: FAM-1 12, 13 and 13b.
- A practice default from the program: FAM-1, when a program can prescribe a life item.

## Prototype-fidelity check (2026-11-15, against v11)

| v11                                                                                                                             | This plan                                   |
| ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Bodyweight: "Last time" hint, field, ✓; logged row with time and Change; Cancel/Save; blank clears                              | Same (D2)                                   |
| Bodyweight range 40–400 lb                                                                                                      | **Keeps 20–500** (shared bound); next round |
| Practice: empty field, ✓, Change, blank clears; 1–300 whole minutes                                                             | Same (D3)                                   |
| No Wake; no Check-ins or Strength section; no past rows                                                                         | Same                                        |
| Older days read-only: no ✓, Change, field or Clear; "This day is read-only. Only today and yesterday can be logged or changed." | Same (D1)                                   |
| Announcements and focus targets for log, change and clear                                                                       | Same                                        |

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
| P5  | The day-role label beside the date (`Strength B`)  | Removed with the program card it described (`page.tsx:227-233`). `DayNav`'s prop is optional and stays for FAM-1. The page no longer reads the program (`getProgramDay`, `householdProgramsAnything`)                                                                                                                                            |
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

## Review-response log (adversarial panel)

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
