# FAM-1 step 15 — putting an athlete on a program, from the app

> Backlog: [plan.md](../plan.md) row FAM-1, step 15 of [the FAM-1 plan](./fam-1-family-program.md)
> (row 15, `fam-1-family-program.md:606`). Branch for this plan: `docs/fam-1-15-put-on-plan`.
> Lane B. Two code PRs: **15a** (Put on and Take off) and **15b** (Home's tiles, the add-athlete
> form, the day page's Programs link).

## Where this sits

- **Pillar:** FAM-1, the family program. **Milestone:** [FAM-1](../milestones/fam-1-family-program.md).
- **What this is:** the step where a parent can first put an athlete on a program they built. Every
  piece below it exists: the writers (`putOn` 6c-i, `takeOff` 6d-i), the reads (6c-ii, including
  `readProgramsByAthlete`), the dialog and the button (10b, on the preview), and the day page that
  shows an athlete's programs (12a–12d). Step 15 connects them on the real pages.
- **Before it:** 7b-ii (the workout pages), which lane B builds next. The row's gate says "7b" and the
  roadmap thread reads that as both halves (2026-11-18). Every other gate is on `main`: 6d-i #617,
  6c-ii #612, 10b #489, 12c #567, 12d #607, 12a-ii #525, 13b #446/#462, 12d-ii #644.
- **After it:** 15c (Program order on the day page, lane C; gated on 6d-ii and 6d-iii, not on 15).
  Until 6d-iii ships, a Put on puts the new program last in the athlete's order
  (`fam-1-6d-iii-put-on-place.md:13`: "Step 15c waits for 6d-iii; step 15 does not").
- _Roadmap alignment (2026-11-19): advances FAM-1 step 15; gates 15c only through the e2e it adds.
  Adds no column, no scope and no role check: every read and write goes through `getHouseholdScope()`.
  `ID-1`'s six items are answered in the log. Checked against the private roadmap; nothing to add
  here._

## Goal

A parent opens a program, puts one or more athletes on it from today or tomorrow, and those athletes'
day pages show it. A parent can take an athlete off. Home names each athlete's programs, the
add-athlete form stops promising a program the household no longer hands out, and an athlete on no
program gets a link to Programs from their day page. Nothing new is stored: the writers, the shapes
and the dialog exist; this step registers two actions and mounts what the preview already shows.

## Acceptance

Row 15, verbatim (`fam-1-family-program.md:606`): **Put on and Take off, wired**: the two actions
join `ProgramActions`, and the dialog and the button, hidden until now, appear. Take off's message
follows its answer (`lastDay`: "comes off after today", or `null`: "won't start"), not the start date
(C15). **The add-athlete form stops promising a program** … the form shows v12's line, "New athletes
start with no program. Put them on one or more from Programs.", and the page stops calling
`householdProgramsAnything` … **Home's tiles name each athlete's programs** … read with the
per-athlete read 6c-ii is to add (`readProgramsByAthlete`): every athlete who is not archived, their
programs in their own order, none for one on no program. e2e: a parent puts a test athlete on a
program and they log it.

Done when:

- On `/programs/<id>`, "Put someone on" opens the dialog; Put on answers, the athlete appears under
  "Who's on it", and their day page (today or tomorrow, as chosen) shows the program.
- Take off answers "comes off after today" or "won't start" from `lastDay`, never from the start date.
- "Putting someone on a program isn't in the app yet." is gone from the code, its tests and the e2e.
- Home's tile for each live athlete names their programs in their order, or says they have none.
- `/p/new` shows v12's line and no longer reads `householdProgramsAnything`.
- An athlete on no program sees "Programs" linked from their day page's empty state.
- The e2e: a parent puts a test athlete on a program, and the athlete logs an item on it.

## File-by-file changes

### 15a — Put on and Take off (≈ 300 lines with tests)

| Path                                                                                             | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/program/writes.ts`                                                             | EDIT   | Two functions beside the six (`:62-110`): `putOnProgram(input, today)` and `takeOffProgram(input, today)`. Each takes `getHouseholdScope()`, calls lane P's writer (`writers/program/assign.ts:151`, `take-off.ts:50`) and maps a miss through `reportProgramMiss` as the other six do. `today` is an argument (AGENTS.md → Server conventions → Time).                                                                                                                                  |
| `apps/web/app/programs/actions.ts`                                                               | EDIT   | `putOnAction` and `takeOffAction`, built exactly as the six (`:63-151`): Sentry-wrapped, zod-parse with the contract's `assignDraftSchema` / `takeOffSchema`, resolve the day from the tz cookie (only actions read it), call the DAL, answer the contract's `ProgramResult` (`actions.ts:121`, `:128` in `packages/shared/src/program/`). Refusals are returned, never thrown. Revalidate the program page, `/programs`, `/p` (Home's tiles, 15b) and each affected athlete's day page. |
| `apps/web/app/programs/actions.registry.ts` · `actions.contract.ts`                              | EDIT   | Register both; `PROGRAM_ACTIONS` gains `putOn` and `takeOff`. That alone makes `ProgramScreen` show the dialog and the button (`whos-on-it.tsx:117`, `:146`), and lights the Copy dialog's `putOnInsteadText` (`copy-dialog.tsx:406`) and the dialog's `switchHintText` (`put-on-dialog.tsx:300`), which read `putOnWired` / `takeOffWired`.                                                                                                                                             |
| `apps/web/components/program-builder/whos-on-it.tsx` · `builder-text.ts`                         | EDIT   | Delete the `putOn`-undefined branch (`whos-on-it.tsx:149`) and `BUILDER_COPY.putOnComing` (`builder-text.ts:74`). The preview always passes fakes, so nothing else renders it.                                                                                                                                                                                                                                                                                                           |
| `apps/web/app/programs/actions.test.ts`                                                          | EDIT   | The pin "no putOn or takeOff yet" (`:114`) becomes the boundary set for both: unauthenticated → refused; another household's program or athlete → `not_found` (the same answer as a missing one); bad body → `invalid`; replay → one effect, the same answer (the writers are idempotent without a client id: `assign.ts:131`, `take-off.ts:26-30`); `from` other than today or tomorrow → `invalid`.                                                                                    |
| `apps/web/components/program-builder/caps.test.tsx`                                              | EDIT   | Drop the describe `"Who's on it" until step 15` (`:288-296`).                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `apps/web/e2e/program-builder.spec.ts`                                                           | EDIT   | `:64` asserts the interim line; it becomes the row's e2e: put a seeded athlete who is on no program on "Family program" from today, open their day page, tick one item, and see it logged; then take them off (the answer is "comes off after today", since they logged). The athlete is chosen by a seed constant, never by position, and the spec never counts programs (lane P's e2e seed adds one, board 2026-11-19).                                                                |
| `apps/web/e2e/program-builder.a11y.spec.ts`                                                      | EDIT   | The Put-on dialog open at 360px joins the scan (`owed.test.ts:41` names this).                                                                                                                                                                                                                                                                                                                                                                                                           |
| `docs/features/program-builder.md` · `docs/privacy/data-inventory.md` · `docs/privacy/notice.md` | EDIT   | The guide's "not wired" lines for Put on and Take off; the inventory's `program_assignments` row (written from a screen since 15a) and §4 (who sees it: unchanged, every member); the notice's "Putting someone on a program isn't in the app yet." becomes what it does.                                                                                                                                                                                                                |

`owed.test.ts:41` and `:43` (in `packages/shared/src/program/`, a contract file) are flipped as its
header says lanes may; if the header does not cover it, the two sentences go to the roadmap thread.

### 15b — Home's tiles, the add-athlete form, the Programs link (≈ 200 lines with tests)

| Path                                                                                 | Change | What & why                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/lib/dal/program/reads.ts`                                                  | EDIT   | `getProgramsByAthlete(today)`: scope, then `readProgramsByAthlete` (`queries/program/program-list.ts:71`), returning `Map<profilePublicId, ProgramRef[]>`. `cache()`d with the primitive day.                                                                                                                                                                                                                                             |
| `apps/web/app/p/page.tsx` · `apps/web/components/profiles/profile-tile.tsx`          | EDIT   | Each live athlete's tile gains one line under the name and kind: their programs joined with " · " in their own order, or "No program yet" (the prototype's `vPicker`, `docs/prototypes/beta-0/index.html:1808-1830`). The line is part of the tile's link text, and wraps at 360px; it is never truncated (a parent must see every program). Archived athletes have no tile today (`page.tsx:71`), so there is no archived state to draw. |
| `apps/web/app/p/new/page.tsx` · `add-athlete-form.tsx` · `apps/web/lib/constants.ts` | EDIT   | The form shows v12's line for every kind; `ATHLETE_FORM_COPY.kidWithProgram` (`constants.ts:1270`) and the `programsAnything` prop go; the page stops calling `householdProgramsAnything` (`p/new/page.tsx:91`). The function stays until 12f (row 15 says so).                                                                                                                                                                           |
| `apps/web/app/p/[profileId]/page.tsx`                                                | EDIT   | Pass `programsHref={PROGRAMS_PATH}` (`components/program-builder/routes.ts:14`) to `NotOnAProgram` (`:223`; the component already takes it, `components/day/not-on-a-program.tsx:20`). The day page file is unowned; the component is lane C's and is not edited.                                                                                                                                                                         |
| tests                                                                                | EDIT   | `profile-tile` (one / several / none), `add-athlete-form.test.tsx:110-119` (the new line, every kind), the day page's link (a Playwright check in the 15a spec, since the page is an async Server Component).                                                                                                                                                                                                                             |
| `apps/web/lib/dal/programming.ts:43-46`                                              | EDIT   | The docblock stops saying the day page needs it; it names its last caller as gone and 12f as the deletion.                                                                                                                                                                                                                                                                                                                                |

`app/design/program/preview-harness.tsx:211` ("until step 7b") is a contract file: its comment goes
to the roadmap thread.

## Test plan

- **Unit/integration (Vitest):** the boundary set above for both actions; the DAL maps a writer's
  refusal and reports a scope miss once; the tile's three states; the form's line for each kind.
- **Probes:** each new test is RED against a mutation before it is trusted (`pnpm probe`): the action
  that skips the ownership scope, the tile that drops the last program, Take off reading the start
  date instead of `lastDay`.
- **e2e:** the 15a spec above, on the e2e seed; the a11y scan of the open dialog at 360px. Local run
  with the board's slot (`pnpm e2e:local`), otherwise CI.
- **db:verify:** none new. The writers and the read are proved by lane P (`verify/program.ts:3931-3974`
  and mutation 499 for the read; 6c-i and 6d-i's proofs for the writers).

## Risks / rollback

- **The wrong athlete is put on a program.** The dialog lists names and confirms; Take off the same day
  removes a start that has not begun (C15), so the recovery is one tap and leaves nothing.
- **An adult athlete can be put on a program.** Intended: `candidates` and `lockAthletes`
  (`assign.ts:43-60`) apply no kind filter, and `ID-1` forbids age-based permissions. The day plan
  reads assignments with no kind filter (`queries/day/day-plan.ts`), so an adult put on a program sees
  it. The legacy `readsHouseholdProgram` (`packages/shared/src/programming.ts:55`) governs only the old
  seeded program and is unaffected.
- **Two parents put the same athlete on at once.** The writer locks the program, then the athletes in
  id order (`assign.ts:24-60`), and skips an athlete already on it: one row, both answered ok.
- **Home grows a query.** One grouped read for the household, not one per athlete.
- **Rollback:** each PR reverts on its own. Reverting 15a hides the dialog and the button again (the
  real page passes no `putOn`), and assignments already made stay valid: the day page reads them
  regardless.

## Out-of-scope / deferred

- Where a new program sits in the athlete's order: 6d-iii (lane P). Until then, last.
- The Program order control on the day page: 15c (lane C).
- The prototype's second Home line ("N logged today"): not in row 15; it needs a per-athlete day read.
  Open question 1.
- Changing an athlete's weekdays or start on an existing assignment: not in FAM-1.
- Deleting `householdProgramsAnything`: 12f.

## Open questions

1. **Home's "N logged today" line** (the prototype has it; row 15 does not). Recommended: leave it
   out of 15 and give it its own row if wanted; it adds a read of every athlete's day to Home.

## Review-response log (adversarial panel)

_Pending: correctness, scope, architecture, reuse, and the UX panel (three lenses) on the Put-on
flow on real data, Home's tiles and the add-athlete line._
