# FAM-1 7b — the program builder's real pages

> Backlog: [plan.md](../plan.md) row `FAM-1`; plan row **7b** in
> [fam-1-family-program](./fam-1-family-program.md). Lane B. **Approved by the maintainer
> (orchestrator's chat, 2026-11-18: "Approve (Recommended)").**

## Where this sits

- **Pillar:** FAM-1 (the family program), lane B (builder).
- **Milestone:** [FAM-1](../milestones/fam-1-family-program.md), step 7b, "Wiring II".
  - The builder's screens (8a to 10b) and its actions (7a-i, 7a-ii) are merged. So far they run only
    on the design preview.
  - 7b puts them on real, session-gated pages.
- **Gates:** see §The split; each PR has its own.
  - 7b-i and 7b-ii wait for **6c-ii** (lane P's list and view reads) and **#605** (lane P's caps in
    the writers; board decision, 2026-11-18).
  - 7b-i also waits for **the maintainer's H7**, the program-deletion notice (below).
  - 7b-i also waits for **the roadmap thread's amendment of rows 7b and 15**: Home tiles move to 15,
    and 15's gates gain 6c-ii.
- **After it:** step 15, which adds put on and take off. 15 also names each athlete's programs on
  their Home tile, read through lane P's `readProgramsByAthlete`, and wires `programsHref` on the day
  page.
- _Roadmap alignment (2026-11-18): advances FAM-1 (step 7b). It adds no column or scope; every new
  read goes through `getHouseholdScope()`. `ID-1`'s six items are answered in the log. Checked
  against the private roadmap; nothing to add here._

## Goal

A parent opens **Programs** from Home and works on real pages backed by the household's own data. On
those pages they can:

- see their programs;
- open one and see its workouts and week;
- create, rename and copy programs and workouts;
- edit the week;
- open or start a workout and edit it in the full-screen picker, with "How to" on library rows;
- save.

They do this with the screens and actions already merged and tested on the preview. Nobody can be
put on a program yet (step 15), so nothing here changes an athlete's day page.

## Acceptance

From plan row 7b (`fam-1-family-program.md:594`), as amended by the spec owner on 2026-11-18 (Home
tiles move to step 15): four thin pages, the list and view reads behind the DAL, and Home's Programs
link. The owed tests are an e2e on a phone that builds a program, and the a11y scan. Done when:

- **Four pages exist:** `/programs`, `/programs/[programId]`,
  `/programs/[programId]/workouts/[workoutId]` and `/programs/[programId]/workouts/new`. Each is a
  Server Component that:
  - calls `await requireSession()`;
  - loads through `lib/dal/program/`;
  - mounts one lane B screen with `PROGRAM_ACTIONS`;
  - sets a **static document title** from a copy const (WCAG 2.4.2). The program page's title is
    "Program", never the program's name, which is spoken aloud and kept in history (PROF-1 D8).
- **Misses give `notFound()`.** A program or workout id that isn't the household's, or isn't a uuid,
  renders `app/programs/not-found.tsx` ("← Programs"). The DAL reports the miss once.
- **No household gives `redirect(APP_HOME_PATH)`** on `/programs` (that screen is `NoHouseholdState`).
- **`app/programs/loading.tsx`** shows a frame with `aria-busy` while a page loads on a slow
  connection.
- **Home** (`app/p/page.tsx`): the `Household` nav becomes
  `<ul className="flex flex-col gap-2">`, **Programs first, then Settings**, both `NAV_ROW_CLASS`.
  The Programs label is "Programs ›" (`BUILDER_COPY.programs`). The desktop **rail** gains a Programs
  row above Settings, and `NavRailCurrent` gains `'programs'` (a board-granted guest edit of
  `nav-rail.tsx`; see below).
- **"How to" works on real pages.** See §How to; the spec owner decided this on 2026-11-18.
- **Every cap stops at its entry point, and every `limit_reached` reaches the person in its screen's
  own words** (§Caps).
- **Saving a new workout never reuses a saved one's id.**
  - The editor mints `workoutClientId` on the client, once, when it opens a new workout.
  - Save, Discard and leaving with no changes use `router.replace`, so `/workouts/new` never stays
    in history.
- **The stay-dark pin lifts.** Its `OWED_AT_7B` list ships in 7b-i, in full and as the privacy lens
  widened it (§Privacy).
- **The owed `it.todo`s for 7b** become tests:
  - in `components/program-builder/owed.test.ts`, `:21`, `:23`, `:24` and `:36`, plus the Copy half
    of `:39`. The Put-on half of `:39` moves to step 15.
  - in `catalog/owed.test.ts`, the P16 line. The roadmap thread deletes it once told the test's name.

## The split (four PRs, one concern each, each with its own browser proof)

| #   | PR                                                   | What                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Gate                                            |
| --- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| 0   | **`fix`: `getWorkoutDraft` through `quietDbErrors`** | 7a-i promised this (plan row 7a-i) and it was never done (`reads.ts:23-33`). About 30 lines, with a test that a failed read's parameters stay out of the thrown error. Guide and fragment.                                                                                                                                                                                                                                                                                                                                                                                                                                                               | none: now                                       |
| 1   | **How to**                                           | The Route Handler, `getHowTo`, `howToPath`, `catalogHowToSchema` (from the contract owner), the client wrapper that supplies the loader, the widened tenancy test, and the docblocks and guides that change.                                                                                                                                                                                                                                                                                                                                                                                                                                             | `catalogHowToSchema` on `main` (roadmap thread) |
| 2   | **7b-i: the list and program pages**                 | <br>• The DAL wrappers for 6c-ii's list and view reads.<br>• `/programs` and `/programs/[programId]`, with titles, `not-found`, `loading` and no-household handling.<br>• Home's nav and the rail row.<br>• The stay-dark pin lifts and **the privacy list ships in full**.<br>• The program page's caps: the "+ New workout" stop, the copy dialog's words, the week editor's day stop and the full-day checkboxes.<br>• The interim note under "Who's on it".<br>• `program-builder.spec.ts` starts at `/p`: create, rename, copy a seeded workout, and Copy at 360px.<br>• `program-builder.a11y.spec.ts` covers two routes.<br>• Guide and fragment. | 6c-ii · #605 · H7 · the row amendment           |
| 3   | **7b-ii: the workout pages**                         | <br>• `/workouts/[workoutId]` and `/workouts/new`, with titles.<br>• `program` passed to the editor.<br>• The client-minted id and `router.replace`.<br>• `saveRefusal`'s and `newItemRefusal`'s cap words, and the "+ New item" stop.<br>• The workout editor's "+ Add items" stop gets the same visible shape (a #460 defect).<br>• The spec extends: add a workout with two items, save, then Back.<br>• The a11y spec gains the two routes, plus a desktop axe pass on all four.<br>• Guide and fragment.                                                                                                                                            | 7b-i · How to                                   |

Each PR is under 400 lines. **7b-iii is gone:** each page PR carries its own e2e (scope S3).

## Design

### Pages (Server Components, thin; each mounts `AppShell` itself, as every sibling does)

```tsx
// app/programs/page.tsx (7b-i)
export const metadata = { title: BUILDER_COPY.programs };
export default async function ProgramsPage() {
  await requireSession();
  const programs = await getProgramList(await getActiveLocalDay());
  if (!programs) redirect(APP_HOME_PATH);
  return (
    <AppShell athletes={await listProfiles()} current="programs">
      <ProgramsListScreen programs={programs} actions={PROGRAM_ACTIONS} />
    </AppShell>
  );
}
```

- **No `layout.tsx`** (scope S4, architecture S3).
  - `revalidatePath(PROGRAMS_PATH, 'layout')` derives its tag from the path, not from a layout file.
  - Siblings mount `AppShell` per page.
  - A layout would read household data outside the page scanner's reach.
- **Time zone:** `TimeZoneSync` moves from `app/p/[profileId]/` to `components/` and is mounted on
  the program pages. Otherwise a parent who opens Programs first gets the default zone's "today".
- **Program page:**
  - `getProgramView(programId, today, tz)` (lane B's wrapper with primitive arguments; it passes `{ today, tz }` on to lane P's read, adopted as 6c-ii lands); `null`
    gives `notFound()`.
  - The "Who's on it" section shows an interim line until step 15: "Putting someone on a program
    comes in the next update." Its owed line in `owed.test.ts` is deleted by 15 (UX1 #4, option b).
- **Workout pages:**
  - `getWorkoutDraft` (7a-i order) and `getItemPickerData()` (its first consumer).
  - `program` is found with `list.find(…)` on `getProgramList`, **comparing lower-cased ids**
    (`readWorkoutDraft` echoes the URL's spelling; 6c-ii lower-cases). Not found gives `notFound()`
    plus a report. `programIn` is not called separately (reuse S5). **Both** workout pages pass
    `program` (`owed.test.ts:21`). On the workout page, any `null` among draft, picker or program
    gives `notFound()`.
  - **A workout of another program in the same household** (`/programs/A/workouts/<B's>`) is a
    `notFound()`, correct by construction. Its report is false today: `reportProgramMiss` sends it
    as a cross-household miss (7a-i, lane B's `report-miss.ts`). 7b-ii fixes this by checking
    `workoutInHousehold` before reporting a workout miss.
  - The new-workout page passes a draft **without** a client id. The editor mints it (UX1 #1), so
    the contract docblock at `program-shapes.ts:86` ("minted by the editor") stays true.
- **Server Action object:** `PROGRAM_ACTIONS` crosses to the client as references
  (`server-and-client-boundary.md:164`). **A plain function cannot cross** (architecture B1), so the
  How to loader is supplied by a small client wrapper (§How to).

### DAL (`lib/dal/program/reads.ts`, lane B)

- `getProgramList(today)` and `getProgramView(id, today, tz)` (**primitive arguments**, because
  `cache()` compares by identity, so an object literal would run the read and report the miss twice:
  correctness S5) use **`getWorkoutDraft`'s order**:
  1. uuid first (a bad id gives `null`, no report);
  2. then the scope (none gives `null` **and one `no_scope` report**, as `report-miss.ts` does);
  3. then lane P's read through `quietDbErrors`;
  4. then `reportProgramMiss` on a miss;
  5. then the contract DTO.
- The 6c-ii view's `candidates` (every live athlete with their programs) reaches the browser in 7b-i,
  though Put on can't open until 15. This is accepted and written into inventory §4 (privacy S1): the
  audience is the same as Home's athlete picker, and lane P's read shape is not edited for one step.

### How to (PR 1; decided by the spec owner, 2026-11-18)

- **Route:** `app/programs/how-to/[optionId]/route.ts` (`GET`).
  - It sits inside the program-builder guide's owned directory (architecture S2), not under `/api`,
    which AGENTS.md ties to versioning.
  - A static segment wins over `[programId]`, and ids are uuids.
  - The path comes from `howToPath(optionId)` in `routes.ts`, pinned in `routes.test.ts`.
  - The owed line "every path in routes.ts has its page.tsx" is reworded to "a page.tsx or route.ts".
- **The handler mirrors the export route** (`app/p/[profileId]/export/route.ts`):
  - `if (!(await sessionUserOrNull())) return MISS`;
  - `export const dynamic = 'force-dynamic'`;
  - `Cache-Control: no-store, private` on every response.
- **One answer for every miss: 404**, byte-identical for each of:
  - signed out;
  - a non-uuid id (`lowerCaseUuidSchema`, checked before any query);
  - an unknown id or another household's id;
  - the household's own item;
  - a built-in with no library entry (K22).

  A 200 always has a body. The handler deliberately reports no cross-household miss: no answer can
  hold household data, because even the owner gets a 404 for their own item (security N2).

- **`getHowTo(optionId)`** (`lib/dal/program/picker.ts`):
  - One private, cached `householdMovementRows(scope)` read is shared with `getItemPickerData`, so
    there is no second `movementOptions` query.
  - `row = rows.find(r => r.publicId === id)`; `row?.owner === 'catalog' ? catalogHowToOf(CATALOG_MOVEMENTS, row.slug) : null`.
  - The slug never leaves the DAL.
- **Response schema:** `catalogHowToSchema` (`CatalogHowTo = z.infer`), asked of the contract owner
  because `catalog/option.ts` is theirs. The route builds its answer with it and the loader parses
  with it.
- **Loader** (client, `components/program-builder/how-to-loader.ts`). The picker's contract is
  movement-picker invariant 14: **a failure is a rejection**.
  - A 404 gives `null`, shown as "No steps for this movement yet."
  - A 200 is parsed.
  - Anything else, including a body that fails the schema, **throws**, which shows "Couldn't load the
    steps" with "Try again".
  - The id is passed through `encodeURIComponent`.
- **Who supplies it:** `WorkoutEditorPage` (**NEW**, `'use client'`, `components/program-builder/`)
  wraps `WorkoutEditorScreen` and passes `howTo={howToLoader}`. The server page renders the wrapper.
- **Logging:** no movement name is logged. In Sentry the id appears only as the request path, masked
  by `maskIds` (`lib/sentry-scrub.ts:150`), as for `/p/<id>`. Vercel's request log keeps the opaque
  id for 24 hours, as for every page.
- **Docs that change:**
  - movement-picker invariant 14's "No production caller passes a loader yet";
  - `catalog/option.ts`'s docblock ("the server action"): sent to the contract owner;
  - the `picker-options.ts` docblock: sent to the roadmap thread.
- **Tests** (each one can fail; the "two households, one id" case cannot, because catalog rows
  are global and household rows carry no slug: correctness S3):
  - a household item whose stored slug equals a library slug gives a 404 (this catches a lookup
    without the `owner === 'catalog'` arm);
  - a global row outside `MOVEMENT_PICKER_ENTRIES` that has a library entry gives a 404 (it isn't
    among the options);
  - a library entry with no `instructions` gives a 404;
  - a non-uuid id gives a 404 and runs no query;
  - a `db:mutations`-style patch that resolves over all `movements` by `publicId` turns the gate
    red;
  - the miss cases, plus signed out, give byte-identical status, body and headers;
  - a 200 body passes the schema, and the option list still has no `instructions` key;
  - the loader rejects on 500, 401 and a bad body, and resolves `null` on 404;
  - the tenancy test globs `app/**/route.ts` with a non-vacuity floor, instead of naming one file.
- **When it merges,** the test's name goes to the roadmap thread for `catalog/owed.test.ts`'s P16
  line.

### Caps: every stop at its entry point, and every refusal in its screen's words

Words always come from the shared consts and say "**full** … holds at most N", never "has N" (trust
S1). No word offers a delete, because none exists. Helpers live in `builder-text.ts` next to
`capText`, one per screen (reuse S6).

| Where                                    | The stop, before the person does the work                                                                                                                                                                                                                             | The refusal, if a race or typed URL reaches it                                                                                                                                                                                                                                                                                                                                                                                                                                                      | PR    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| Program page, "+ New workout"            | At `MAX_PROGRAM_WORKOUTS`: an `aria-disabled` control with a visible hint, "This program is full: a program holds at most 50 workouts. To add one, change a workout that's not on any day, or create another program."                                                | (the editor's line, below)                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | 7b-i  |
| Week editor, a day's "+ Add"             | At `MAX_DAY_SLOTS`: `aria-disabled` + `PENDING_CLASS`; a tap posts the reason and opens no form; a visible `dayFullText(day)` hint **under** the header row, never in it (width math: in the row it is about 429px against 328px); `aria-describedby` only while full | `weekRefusal`: "{days} {is/are} full: a day holds at most 30 workouts. Nothing was added; the week is back as it was." No `router.refresh()`: the page is not stale                                                                                                                                                                                                                                                                                                                                 | 7b-i  |
| The add form's and Copy's day checkboxes | A full day is `aria-disabled`, with visible "full" and the name "Tuesday, full", as "has it" is shown (each cell is 69.5px at 360px)                                                                                                                                  | —                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 7b-i  |
| Copy dialog                              | Within this program, a full day is greyed (row above)                                                                                                                                                                                                                 | **D13, no cap field:** <br>• into another program: "This program can't take another workout, or one of those days is full (50 workouts in a program, 30 on a day)." <br>• within this program, with no day picked: "This program is full: a program holds at most 50 workouts. Nothing was copied. Create another program to copy it into." <br>Focus goes to **To**, with `aria-invalid` and the message in its `aria-describedby`. `NAME_WRAP_CLASS` on the message. Via `copyRefusal(reason, …)` | 7b-i  |
| Workout editor, new workout              | (stopped at "+ New workout")                                                                                                                                                                                                                                          | `saveRefusal`: "This program is full: a program holds at most 50 workouts. This one wasn't saved."                                                                                                                                                                                                                                                                                                                                                                                                  | 7b-ii |
| "+ New item"                             | The picker counts the household's own options when it opens; at `MAX_HOUSEHOLD_ITEMS` it shows the line below before any typing, and Create stays only for a name that selects an existing item (never capped, invariant 30)                                          | `newItemRefusal` → `{ field: null, footer: ITEM_PICKER_COPY.full }`: "Your household has the most custom items it can keep (500), so this one wasn't made. Pick one from the list instead." Also shown in the form                                                                                                                                                                                                                                                                                  | 7b-ii |
| Create or rename program                 | none (no cap)                                                                                                                                                                                                                                                         | the generic failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —     |

- The workout editor's existing "+ Add items" stop at `MAX_WORKOUT_ITEMS` gets the same visible
  shape (`PENDING_CLASS`, hint). It looked live when full (a defect from #460).
- **Permanence, said where it starts:**
  - `BUILDER_COPY.createHint`: "A program can be renamed but not deleted in the app. To have one
    removed, ask (see the privacy notice)."
  - Copy's footer (`COPY_COPY.permanent`): "A copy can't be deleted in the app. To have one removed,
    ask (see the privacy notice)."

  H7 picked (a), so neither says "yet" (which would promise a Delete with no row): both say how,
  and the notice says the rest.

### Privacy (7b-i; the whole owed list, as the privacy lens widened it)

**The source list is `program-tables-stay-dark.test.ts:285-292`.** This plan widens it. Each line
below names its inventory owner sentence.

1. **"Programs you build yourself":** "coming" goes, and the sentence says **all six actions** are
   reachable.
2. **Free-text boxes:** every new one moves into inventory §3's numbered list:
   - the program name, the week label and Copy's label (7b-i);
   - via the registered actions, the workout name and description, each item's instructions, the
     rest note, the group name, and "+ New item" (`:494-500`, `:478`).

   The notice's "Three text boxes" count is rewritten. "Worth knowing" says which of them reach the
   export: only a logged workout's name, and a movement only through a logged entry (§6).

3. **"Technical bits":** client ids for a program, a copied workout and an item card, all minted on
   the device (the new workout's id now is too).
4. **Export omissions:** verified, unchanged (true since 14a).
5. **"Hidden, not erased":** two sentences, from `:823` and `:825`:
   - (a) a **removed** card, a **swapped** item, a **cleared** target (these pile up) and a workout
     saved **empty**;
   - (b) a week slot taken off or moved, with its label (these pile up too).

   Nothing in the app can show, restore, export or erase these rows. `notice.md:208-215`'s "no Delete
   button" paragraph is rewritten to match.

6. **Every forward-looking "7b" in the inventory** is rewritten as reachable:
   `grep -n "7b" docs/privacy/data-inventory.md` must leave only dated history (`:340`, `:378`,
   `:438`, `:478`, `:496`, `:499`, `:500`, `:821`, `:823`, `:825`).
7. **§4, who sees what** (from lane P's 6c-ii note): any member sees who is on each program, since
   and through which day, and `candidates`. This is the same audience as Home's picker. An adult
   athlete's programs show to every member (`ID-1`). One sentence goes in the notice's "Who can see
   it".
8. **§7, Sentry:** the new `reportProgramMiss` call sites, How to's no-report rule, and the masking.
9. **H7, the deletion path (decided (a), maintainer, 2026-11-18):** the app deletes no built
   program, workout or typed item, and the notice says a household can ask and it is removed. Before
   removing, the household is told which athletes it affects and offered a rename or taking everyone
   off instead; there is no waiting period; the restore point is held 3 days; logs keep their names
   (board, from #632). The notice points at the runbook section "Remove one program, workout or typed
   item on request" (`docs/runbooks.md`, #627).
10. **Process:** a dated inventory header entry; the notice's "Last updated"; `notice-content.ts`
    regenerated with `pnpm --filter web privacy:generate`; and `notice.md:290` changed to "the
    programs you built".

The pin's replacement test checks three things:

- pages may import `PROGRAM_ACTIONS`;
- no client component imports lane P's reads;
- `notice.md` no longer contains "(coming; the app cannot save one yet)", and the inventory has no
  forward-looking "7b".

## Test plan

- **Vitest:**
  - the DAL wrappers' order, including one `no_scope` report;
  - How to's DAL, route and loader (above);
  - each caps helper and stop, including focus staying on the stopped "+ Add" after the 30th workout
    is added (a component test seeds a full day until the roadmap thread's
    `family-program-full-weekday` fixture lands);
  - the editor's client-minted id;
  - titles as static `metadata`;
  - the pin's replacement.
- **e2e:**
  - `program-builder.spec.ts` (7b-i, then extended in 7b-ii) starts at `/p` and taps Programs.
  - It covers the Back-after-Save probe (UX1 #1), a random uuid reaching `not-found`, and another
    fixture program's workout under the wrong program giving a 404 (async Server Components, so
    Playwright).
  - **Names are unique per run** (`Date.now().toString(36)` plus `workerIndex`). Nothing can be
    deleted and CI retries once, so a fixed name would answer `name_taken` on the retry. The
    created programs stay in the e2e database.
  - `owed.test.ts:24` ("every path has its page") turns green in 7b-ii.
  - `program-builder.a11y.spec.ts`, at 360px, runs the preview walk's four checks (axe, tap targets,
    link heights, overflow), plus one desktop axe pass per route. Route ids are found by tapping
    through, never hard-coded.
  - The spec opens Copy and forces `limit_reached`.
  - `pnpm e2e:local` runs once per PR, in the board's slot.
- **Probes:** each rule named above is mutation-probed before its PR.

## Risks / rollback

- **All six actions become reachable at 7b-i** (`PROGRAM_ACTIONS` registers them all). Mitigations:
  - the session, household and zod checks per action;
  - the boundary matrices;
  - the limiter. It fails open, but sign-up is invite-only.
  - Lane P's caps inside each writer's transaction (#605, a merge gate).
- **The builder's dead end between 7b and 15:** nobody can be put on a program. The interim line
  under "Who's on it" says so.
- **Swipe-back on the editor discards unsaved work** (guide invariant 15, "recorded, not built"). It
  is **re-accepted for 7b with the new evidence recorded**: real work is at stake now, and the sheet
  teaches that Back means dismiss. A guard entry that asks "Discard?" on `popstate` is **owed before
  the first invite**, as an `owed.test.ts` line.
- **R2 timing:** a program built on an old built-in loses those items at the fresh start (K23, K4).
  The maintainer's household is the only one before R2. The PR says so.
- **Rollback:** each PR reverts on its own. The stay-dark pin comes back with 7b-i's revert.

## Out-of-scope / deferred

- Programs on Home tiles; put on and take off; the Put-on dialog's e2e; `programsHref` on the day
  page: **step 15** (board, 2026-11-18).
- Deleting a workout or a program, and the deletion runbook if H7 picks it: Native Scaling (PRIV-3),
  after "resume".
- The swipe-back guard: owed before the first invite (above).

## Open questions

- ~~Q1, How to's owner~~: decided, PR 1 (2026-11-18).
- ~~Q2, Home tiles~~: decided, step 15 (2026-11-18).
- ~~Q3, whether 7b-i waits for lane P's caps~~: decided, yes, #605 is a merge gate (board).
- ~~The copy refusal's cap field~~: decided, none (D13); the dialog names both causes.
- ~~**H7**~~ **Decided by the maintainer (2026-11-18): (a), the runbook.** 7b-i's notice says "ask,
  and a program or workout is removed". The runbook section "Remove one program on request" is
  Native Scaling's (PRIV-3). **7b-i merges only once that section is on `main`**, so the notice is
  true when it lands.
- **Asked of the contract owner:** `catalogHowToSchema` beside `CatalogHowTo` (gates PR 1); the
  `option.ts` docblock; the `family-program-full-weekday` fixture (already queued).

## Review-response log (adversarial panel)

> Panel cost: correctness 159k · 9m00s, scope 86k · 5m20s, architecture 114k · 6m27s, reuse 109k ·
> 5m28s, security 124k · 6m20s, privacy 117k · 6m25s, UX interaction 118k · 6m26s, UX a11y/360 142k
> · 7m56s, UX trust 98k · 4m42s.
> Models: high-stakes **yes** (the actions become reachable; privacy; a new handler) · every lens
> opus. The Fable cap (until 2026-11-19) overrides the table's Fable default.

### Engineering panel (round 1)

| #         | Lens         | Critique (short)                                                                      | Verdict               | Resolution                                                                                       |
| --------- | ------------ | ------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------ |
| Sc-B1     | Scope        | 7b-ii was five concerns                                                               | **accepted**          | How to is its own PR (1)                                                                         |
| Sc-S1     | Scope        | The copy and week cap fixes were placed in 7b-ii, but those screens go live in 7b-i   | **accepted**          | Moved to 7b-i                                                                                    |
| Sc-S2     | Scope        | Blocked work was ordered first                                                        | **accepted**          | PR 0 (`quietDbErrors`) and PR 1 (How to) go first                                                |
| Sc-S3     | Scope        | A PR with only the e2e left page PRs without browser proof                            | **accepted**          | Each page PR carries its spec flow; 7b-iii is gone                                               |
| Sc-S4     | Scope        | `layout.tsx` is unneeded and mis-justified                                            | **accepted**          | No layout; `AppShell` per page                                                                   |
| Sc-S5     | Scope        | One e2e file, and pick one                                                            | **accepted, adapted** | `program-builder.a11y.spec.ts`; `ROUTES` runs at 390 with no overflow check (UX2 S6)             |
| Sc-N1…N3  | Scope        | Q3 moot; "every action registered"; links, guides and fragments; `notFound` via e2e   | **accepted**          | —                                                                                                |
| Re-B1     | Reuse        | The loader turned failure into `null`                                                 | **accepted**          | It rejects; 404 → `null`                                                                         |
| Re-B2     | Reuse        | The handler used `requireSession`                                                     | **accepted**          | `sessionUserOrNull`, the export route's shape                                                    |
| Re-S1     | Reuse        | `getHowTo` couldn't see the slug; wrong `catalogHowToOf` arguments                    | **accepted**          | Shared `householdMovementRows`                                                                   |
| Re-S2     | Reuse        | No response schema                                                                    | **accepted**          | `catalogHowToSchema`, asked of the contract owner                                                |
| Re-S3     | Reuse        | URL typed by hand                                                                     | **accepted**          | `howToPath` in `routes.ts`                                                                       |
| Re-S4     | Reuse        | DAL order misdescribed                                                                | **accepted**          | `getWorkoutDraft`'s order, with the `no_scope` report                                            |
| Re-S5     | Reuse        | `newWorkoutDraft` and `programIn` duplicated                                          | **accepted**          | `list.find`; the editor mints the id                                                             |
| Re-S6     | Reuse        | Inline refusal mapping; day cap not next to `capText`                                 | **accepted**          | `copyRefusal`, `dayFullText`                                                                     |
| Re-also   | Reuse        | `TimeZoneSync`; `getActiveLocalDay`; `BUILDER_COPY.programs`; point at `OWED_AT_7B`   | **accepted**          | —                                                                                                |
| Se-B1     | Security     | Unauthenticated and missing answers differ; the scan goes red                         | **accepted**          | Byte-identical 404s                                                                              |
| Se-S1     | Security     | All six actions reachable; caps only in the fake                                      | **accepted**          | #605 is a merge gate; lane P confirms the counts run in the transaction under locks              |
| Se-S2     | Security     | Handler caching unguarded                                                             | **accepted**          | `force-dynamic` + `no-store`; the tenancy test globs                                             |
| Se-S3     | Security     | No param or response zod                                                              | **accepted**          | `lowerCaseUuidSchema`; `catalogHowToSchema`                                                      |
| Se-S4     | Security     | The new-workout ownership check was impossible as written                             | **accepted**          | `list.find` in the DAL                                                                           |
| Se-N1…N3  | Security     | Sentry path; no-report reason; layout reads                                           | **accepted**          | —                                                                                                |
| Pr-B1     | Privacy      | Item 2 undercounted the text boxes                                                    | **accepted**          | All of them, §3                                                                                  |
| Pr-B2     | Privacy      | Item 5 had 1 of 5 hide triggers and no week                                           | **accepted**          | Two sentences                                                                                    |
| Pr-B3     | Privacy      | A built program has no deletion path                                                  | **held (H7)**         | Both paragraphs drafted; merge waits                                                             |
| Pr-S1…S5  | Privacy      | §4 `candidates`; client ids; six actions; §7; the "7b" grep and the pin's replacement | **accepted**          | —                                                                                                |
| Pr-N1, N2 | Privacy      | Export verified; "programs you built"                                                 | **accepted**          | —                                                                                                |
| Ar-B1     | Architecture | A function cannot cross the RSC boundary                                              | **accepted**          | `WorkoutEditorPage` client wrapper                                                               |
| Ar-B2, B3 | Architecture | Same as Se-B1 and Re-B1                                                               | **accepted**          | —                                                                                                |
| Ar-S1, S2 | Architecture | Schema and path; the route outside `owns:`                                            | **accepted**          | `app/programs/how-to/…`                                                                          |
| Ar-S3     | Architecture | Layout and rail                                                                       | **accepted**          | Per-page shell; rail row (board guest edit)                                                      |
| Ar-S4     | Architecture | Rows 7b and 15 unamended                                                              | **accepted**          | A gate on 7b-i                                                                                   |
| Ar-S5     | Architecture | `ID-1` answers missing                                                                | **accepted**          | Below                                                                                            |
| Co-B1     | Correctness  | Copy onto a full weekday stores 31; the words cover one cause                         | **accepted / routed** | #605 refuses it (D8); D13 words; the fake's weekday cap goes to the roadmap thread's contract PR |
| Co-B2     | Correctness  | The add form and Copy can tick a full day; "+ New workout" isn't stopped              | **accepted**          | Full-day checkboxes; "+ New workout" stop                                                        |
| Co-S1     | Correctness  | A server-minted new-workout id can be replayed via Back                               | **accepted**          | Client-minted + `router.replace` + e2e probe                                                     |
| Co-S2     | Correctness  | How to as designed breaks the session scan and the picker contract                    | **accepted**          | = Se-B1, Re-B1, Re-S1                                                                            |
| Co-S3     | Correctness  | The "two households" test cannot fail                                                 | **accepted**          | Five cases that can                                                                              |
| Co-S4     | Correctness  | Null paths; lower-case lookup; `/new` without `program`                               | **accepted**          | Specified                                                                                        |
| Co-S5     | Correctness  | `cache()` with an object argument reports twice                                       | **accepted**          | Primitive arguments + a test                                                                     |
| Co-S6     | Correctness  | e2e retry-safety; wrong-program 404; `:24` unassigned                                 | **accepted**          | Unique names; the step; 7b-ii                                                                    |
| Co-N1, N2 | Correctness  | `no_scope` report; named copy helper with imported consts                             | **accepted**          | —                                                                                                |
| Co-out    | Correctness  | Same-household other-program workout reported as cross-household (7a-i)               | **accepted**          | Fixed in 7b-ii                                                                                   |

### UX panel (round 1)

| #          | Lens        | Critique (short)                                                                                   | Verdict                             | Resolution                                                      |
| ---------- | ----------- | -------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| U1-1       | Interaction | Back after Save could overwrite a saved workout                                                    | **accepted**                        | Client-minted id + `router.replace` + e2e probe                 |
| U1-3       | Interaction | `programsHref` belongs to step 15                                                                  | **accepted**                        | Board told lane C                                               |
| U1-4       | Interaction | Dead end between 7b and 15                                                                         | **accepted (b)**                    | Interim line under "Who's on it"                                |
| U1-5       | Interaction | No loading feedback                                                                                | **accepted**                        | `app/programs/loading.tsx`                                      |
| U1-6, U1-7 | Interaction | Rail; Home order and stacking; e2e from `/p`                                                       | **accepted**                        | —                                                               |
| U1-8       | Interaction | Swipe-back discard becomes real                                                                    | **re-accepted with new evidence**   | A guard is owed before the first invite                         |
| U1-also    | Interaction | "+ New workout" stop; null branch; programs `not-found`; titles; R2 timing                         | **accepted**                        | —                                                               |
| U2-B1      | a11y/360    | No document titles, so route changes are silent                                                    | **accepted**                        | Static `metadata` per page                                      |
| U2-S1…S6   | a11y/360    | Stop shape and width math; full-day checkboxes; Copy wrap and focus; Home stacked; rail; a11y spec | **accepted**                        | —                                                               |
| U3-B1      | Trust       | Copy has two causes; a copy onto a full day stored 31                                              | **accepted / routed**               | D13 words; #605 refuses the copy (D8)                           |
| U3-B2      | Trust       | A full day was reachable through the form                                                          | **accepted**                        | Full-day checkboxes                                             |
| U3-B3      | Trust       | A full program was found out only after building                                                   | **accepted**                        | Stop at "+ New workout"                                         |
| U3-S1…S3   | Trust       | "is full: at most N"; "custom items"; permanence hints                                             | **accepted**                        | —                                                               |
| U3-N2      | Trust       | Permanent writes are one tap from the kids' picker                                                 | **accepted, recorded (2026-11-18)** | Tiles aren't a boundary; the permanence warning precedes Create |

### Re-review (round 2)

> Light passes by the lenses whose blocking findings reshaped the plan: correctness and security
> (one pass), and privacy. Models: opus, effort medium.

| #    | Lens                     | Critique (short)                                                                                                                                                  | Verdict      | Resolution                                       |
| ---- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------ |
| R2-1 | Correctness and security | Every round-1 blocker resolved. The wrapper leaves the preview alone, the rail type change is additive, and the own-item 404 agrees with the picker's How to rule | —            | Confirmed                                        |
| R2-2 | Correctness and security | §Pages still showed `getProgramView(id, { today, tz })`, which reintroduces Co-S5                                                                                 | **accepted** | Primitive arguments everywhere; "as 6c-ii lands" |
| R2-3 | Correctness and security | `cache()` does nothing in a Route Handler                                                                                                                         | **accepted** | Claim narrowed                                   |
| R2-4 | Privacy                  | B1 and B2 resolved; H7 handling acceptable                                                                                                                        | —            | Confirmed                                        |
| R2-5 | Privacy                  | When H7 is answered: (b) makes "yet" a promise with no row; (a) needs the runbook before the notice says "ask"                                                    | **accepted** | Recorded under H7                                |

No blocking concern survives round 2.

### `ID-1`'s six keep-open items

| #   | Item                               | Answer                                                                                                          |
| --- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | A profile tied to a login          | No column added                                                                                                 |
| 2   | Access through the household scope | Every new read, `getHowTo` included, goes through `getHouseholdScope()`                                         |
| 3   | One household per person           | Nothing assumes it; `getHowTo` uses the resolver's scope                                                        |
| 4   | Keys on (household, profile)       | None. `cache()` is per request; How to is `no-store`                                                            |
| 5   | Age logic                          | None. Showing who is on a program to every member is a role question (`household_members.role`), not an age one |
| 6   | Roles                              | Untouched                                                                                                       |
